const http = require('http');
const { URL } = require('url');

/**
 * A stand-in OpenProject v3 server, for exercising the provider layer end to
 * end without a real instance.
 *
 * The unit suite mocks `fetch` and proves the walker follows `nextByOffset`.
 * What it cannot prove is that the rest of the app agrees: that the URL the
 * provider builds is one a real server routes, that the sync worker commits
 * every page it fetched, and that the prune measures itself against the whole
 * collection rather than the first page of it.
 *
 * It deliberately serves more than one page of everything. A harness that fits
 * on a single page cannot fail the way production failed (audit F-12).
 *
 * Used two ways: as a CLI for driving the real app by hand, and imported by
 * `tests/provider-integration.test.ts`, which binds it to an ephemeral port.
 * One implementation, so the automated check and the manual one cannot drift.
 *
 *   node scripts/fake-openproject.js [--port 8099] [--projects 25] [--page-size 20]
 *                                    [--notify-every 30]
 *
 * `--notify-every N` posts a new unread notification every N seconds,
 * cycling through the reasons, so the app's toasts can be watched arriving.
 * The app starts from "now" on its first poll, so only those posted after it
 * show; the cycle includes reasons the app drops (`watched`), on purpose.
 *
 * Any API key is accepted; the point is the shape of the traffic, not auth.
 * Dev-only -- never imported by the app itself.
 */

const DEFAULT_OPTIONS = {
  port: 8099,
  projects: 25,
  workPackages: 47,
  statuses: 23,
  pageSize: 20,
  notifyEvery: 0,
  quiet: false
};

/** The order `--notify-every` cycles through. `watched` is one the app drops. */
const NOTIFICATION_REASONS = ['mentioned', 'assigned', 'commented', 'processed', 'watched', 'dateAlert'];

/** One unread notification about a work package, as /api/v3/notifications returns it. */
function buildNotification(id, reason, workPackageId) {
  return {
    _type: 'Notification',
    id,
    reason,
    readIAN: false,
    subject: `Fake notification ${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _links: {
      actor: reason === 'dateAlert' ? { href: null } : { href: '/api/v3/users/2', title: 'Alice Martin' },
      resource: { href: `/api/v3/work_packages/${workPackageId}`, title: `WP ${id} that needs you` }
    }
  };
}

/** Parses `--flag value` pairs, falling back to the given defaults. */
function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in out)) throw new Error(`Unknown option ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Option ${flag} needs a value`);
    out[key] = typeof out[key] === 'number' ? Number(value) : value;
    i += 1;
  }
  return out;
}

/**
 * Wraps elements in the collection envelope, including `nextByOffset` when
 * there is a further page.
 *
 * OpenProject's `offset` is a 1-based *page number*, not a record index. The
 * provider follows the link rather than computing offsets itself, which is the
 * detail that makes the contract the link and not the arithmetic.
 */
function collection(requestUrl, allElements, offset, pageSize) {
  const start = (offset - 1) * pageSize;
  const elements = allElements.slice(start, start + pageSize);
  const hasMore = start + pageSize < allElements.length;

  /**
   * Paging links carry every parameter of the original request, `filters`
   * included, exactly as a real instance does.
   *
   * The first draft of this harness rebuilt the link from the path alone and
   * dropped the filters, so page two of "work packages in project 7" answered
   * with page two of an unfiltered query. Every project then received the same
   * trailing rows, which upserted over each other until only the last project
   * kept them. That is a convincing imitation of a data-loss bug, and none of
   * it was in the app.
   */
  const linkFor = nextOffset => {
    const next = new URL(requestUrl);
    next.searchParams.set('offset', String(nextOffset));
    next.searchParams.set('pageSize', String(pageSize));
    return next.pathname + next.search;
  };

  const links = { self: { href: linkFor(offset) } };
  if (hasMore) {
    links.nextByOffset = { href: linkFor(offset + 1) };
  }

  return {
    _type: 'Collection',
    total: allElements.length,
    count: elements.length,
    pageSize,
    offset,
    _embedded: { elements },
    _links: links
  };
}

/** Projects, with the last one marked so "did we get everything?" is answerable by eye. */
function buildProjects(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    identifier: `project-${i + 1}`,
    name: i === count - 1 ? `Fake Project ${i + 1} (LAST)` : `Fake Project ${i + 1}`,
    templated: false
  }));
}

function buildStatuses(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? 'New' : `Status ${i + 1}`,
    isClosed: i === count - 1
  }));
}

/**
 * Work packages for a project, cycling through types.
 *
 * Epics and milestones are filtered out by the provider, so including them
 * proves the filter runs over the concatenated pages and not just the first.
 */
function workPackagesFor(projectId, count) {
  const types = ['Task', 'Bug', 'Feature', 'Epic', 'Milestone'];
  return Array.from({ length: count }, (_, i) => ({
    id: projectId * 1000 + i + 1,
    subject: `WP ${i + 1} of project ${projectId}`,
    lockVersion: 1,
    _links: {
      status: { href: '/api/v3/statuses/1' },
      type: { title: types[i % types.length] }
    }
  }));
}

/** The user the credentials belong to, whatever they are: `/api/v3/users/me`. */
const FAKE_USER = { id: 7, name: 'Fake Me' };

/**
 * Applies the assignee and status filters a task search sends, the way
 * OpenProject reads them: `=` `me` is the user's, `!*` nobody's (assignee IS
 * NULL), `!` `me` anyone's but the user's -- nobody's included -- and a
 * status `=` keeps that status id. Anything else is left unfiltered.
 */
function applyTaskFilters(packages, rawFilters) {
  let parsed = [];
  try {
    parsed = JSON.parse(rawFilters || '[]');
  } catch {
    // As projectIdFromFilters: an unreadable filter is not fatal here.
  }
  const assigneeId = wp => {
    const href = wp._links.assignee?.href;
    return href ? Number(href.split('/').pop()) : null;
  };
  return parsed.reduce((list, entry) => {
    if (entry.assignee) {
      const { operator, values } = entry.assignee;
      const me = (values || []).includes('me');
      if (operator === '=' && me) return list.filter(wp => assigneeId(wp) === FAKE_USER.id);
      if (operator === '!*') return list.filter(wp => assigneeId(wp) === null);
      if (operator === '!' && me) return list.filter(wp => assigneeId(wp) !== FAKE_USER.id);
    }
    if (entry.status && entry.status.operator === '=') {
      const wanted = entry.status.values.map(String);
      return list.filter(wp => wanted.includes(wp._links.status.href.split('/').pop()));
    }
    return list;
  }, packages);
}

/** Reads the `project` value out of the provider's JSON filter parameter. */
function projectIdFromFilters(rawFilters) {
  if (!rawFilters) return 1;
  try {
    const parsed = JSON.parse(rawFilters);
    for (const entry of parsed) {
      if (entry.project) return Number(entry.project.values[0]) || 1;
    }
  } catch {
    // A filter we cannot parse is not fatal here: this server exists to
    // exercise pagination, and defaulting keeps the walk observable.
  }
  return 1;
}

/**
 * Builds the server without binding it.
 *
 * The caller listens, so a test can take an ephemeral port and the CLI can
 * take a fixed one.
 */
function createFakeOpenProject(overrides = {}) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const projects = buildProjects(options.projects);
  const statuses = buildStatuses(options.statuses);
  const requests = [];
  /** Unread notifications, newest last. Push to it to post one. */
  const notifications = [];
  /** Time entries by id, as POSTed; PATCH rewrites one and DELETE removes it. */
  const timeEntries = new Map();
  let nextTimeEntryId = 500;

  /** Reads a JSON body, for the routes that need one; the rest never read theirs. */
  const readBody = (req, then) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        then(raw ? JSON.parse(raw) : {});
      } catch {
        then({});
      }
    });
  };

  // Work packages closed, or deleted, since they were listed: a test puts ids here.
  const closedWorkPackages = new Set();
  const deletedWorkPackages = new Set();
  /** The instance's holidays, `{ date, name }`: a test pushes to it. */
  const nonWorkingDays = [];
  /**
   * Whose a work package is, by id, when it is not the user's: `null` for
   * nobody, `{ id, name }` for a teammate. Every other package is assigned to
   * `FAKE_USER`, as the search used to return only the user's work.
   */
  const assignees = new Map();
  /**
   * Each work package's `lockVersion`, 1 until a PATCH moves it on. A PATCH
   * carrying another answers 409, as OpenProject refuses a write over an
   * edit made since the read.
   */
  const lockVersions = new Map();
  /**
   * Called with the id on every PATCH of one work package, before its
   * `lockVersion` is checked: a test changes the package there to play
   * someone editing it between the adapter's read and its write.
   */
  const hooks = { onWorkPackagePatch: null };
  /**
   * Which filter picks a time entry's work package. OpenProject 17.9 has
   * `entity_type` + `entity_id`, since time can be logged on a meeting, and
   * answers 400 "Filters Work package filter does not exist." to
   * `work_package` (measured on a real 17.9 instance, 2026-10-16). `'legacy'` is an
   * instance from before that, which knows `work_package` only.
   */
  const timeEntryFilters = { mode: 'entity' };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const offset = Number(url.searchParams.get('offset')) || 1;

    // A real instance clamps to its `maximum_page_size`: asking for 100 does
    // not mean receiving 100. Honouring the request instead would hand the
    // provider every element in a single page, and the multi-page walk this
    // harness exists to exercise would silently never run.
    const requestedPageSize = Number(url.searchParams.get('pageSize')) || options.pageSize;
    const pageSize = Math.min(requestedPageSize, options.pageSize);

    // `body` is filled in by the routes that read one, as they read it.
    const entry = { method: req.method, pathname: url.pathname, offset, pageSize, requestedPageSize };
    requests.push(entry);

    const send = (status, body) => {
      const json = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(json);
      if (!options.quiet) {
        console.log(
          `[FakeOpenProject] #${String(requests.length).padStart(3)} ${status} ${req.method} ${url.pathname}` +
            ` offset=${offset} pageSize=${pageSize} -> ${json.length} bytes`
        );
      }
    };

    if (!req.headers.authorization) {
      send(401, { message: 'You did not provide the correct credentials.' });
      return;
    }

    if (url.pathname === '/api/v3/projects') {
      send(200, collection(url, projects, offset, pageSize));
      return;
    }

    if (url.pathname === '/api/v3/days/non_working') {
      // The date filter is inclusive at both ends; without one, a real
      // instance answers the current year.
      let from = '0000-00-00';
      let to = '9999-99-99';
      try {
        const filter = JSON.parse(url.searchParams.get('filters') || '[]').find(f => f.date);
        if (filter) [from, to] = filter.date.values;
      } catch {
        // An unreadable filter: answer every day, as an unfiltered request would.
      }
      const inRange = nonWorkingDays
        .filter(day => day.date >= from && day.date <= to)
        .map((day, i) => ({ _type: 'NonWorkingDay', id: i + 1, ...day }));
      send(200, collection(url, inRange, offset, pageSize));
      return;
    }

    if (url.pathname === '/api/v3/statuses') {
      send(200, collection(url, statuses, offset, pageSize));
      return;
    }

    if (url.pathname === '/api/v3/users/me') {
      send(200, { _type: 'User', ...FAKE_USER });
      return;
    }

    if (url.pathname === '/api/v3/work_packages') {
      const filters = url.searchParams.get('filters');
      const projectId = projectIdFromFilters(filters);
      const packages = workPackagesFor(projectId, options.workPackages).map(wp => {
        const owner = assignees.has(wp.id) ? assignees.get(wp.id) : FAKE_USER;
        const assignee = owner ? { href: `/api/v3/users/${owner.id}`, title: owner.name } : { href: null };
        return { ...wp, _links: { ...wp._links, assignee } };
      });
      send(200, collection(url, applyTaskFilters(packages, filters), offset, pageSize));
      return;
    }

    if (url.pathname === '/api/v3/time_entries') {
      if (req.method === 'POST') {
        readBody(req, body => {
          const id = nextTimeEntryId++;
          const href = body?._links?.workPackage?.href || '';
          timeEntries.set(String(id), {
            id,
            _type: 'TimeEntry',
            workPackageId: href.split('/').pop(),
            hours: body.hours,
            spentOn: body.spentOn,
            comment: body.comment
          });
          send(201, { id, _type: 'TimeEntry' });
        });
        return;
      }
      // Filtered by work package, as a search for one entry is, it answers
      // from what was POSTed; unfiltered -- today's total -- from a fixed set.
      const filters = JSON.parse(url.searchParams.get('filters') || '[]');
      const unknown = filters
        .map(f => Object.keys(f)[0])
        .find(key => (timeEntryFilters.mode === 'legacy' ? /^entity_/.test(key) : key === 'work_package'));
      if (unknown) {
        const name = unknown === 'work_package' ? 'Work package' : unknown === 'entity_id' ? 'Entity' : 'Entity type';
        send(400, { _type: 'Error', message: `Filters ${name} filter does not exist.` });
        return;
      }
      const byEntity = filters.find(f => f.entity_type)?.entity_type?.values?.[0] === 'WorkPackage'
        ? filters.find(f => f.entity_id)?.entity_id?.values?.[0]
        : undefined;
      const byPackage = byEntity ?? filters.find(f => f.work_package)?.work_package?.values?.[0];
      if (byPackage !== undefined) {
        const range = filters.find(f => f.spent_on)?.spent_on?.values ?? ['0000-00-00', '9999-99-99'];
        const entries = [...timeEntries.values()].filter(
          e => e.workPackageId === String(byPackage) && e.spentOn >= range[0] && e.spentOn <= range[1]
        );
        send(200, collection(url, entries, offset, pageSize));
        return;
      }
      const entries = [{ hours: 'PT1H30M' }, { hours: 'PT45M' }, { hours: 'PT30S' }];
      send(200, collection(url, entries, offset, pageSize));
      return;
    }

    const oneTimeEntry = /^\/api\/v3\/time_entries\/(\d+)$/.exec(url.pathname);
    if (oneTimeEntry) {
      const existing = timeEntries.get(oneTimeEntry[1]);
      if (!existing) {
        send(404, { _type: 'Error', message: 'The requested resource could not be found.' });
        return;
      }
      if (req.method === 'PATCH') {
        readBody(req, body => {
          timeEntries.set(oneTimeEntry[1], { ...existing, ...body });
          send(200, timeEntries.get(oneTimeEntry[1]));
        });
        return;
      }
      if (req.method === 'DELETE') {
        timeEntries.delete(oneTimeEntry[1]);
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'GET') {
        send(200, existing);
        return;
      }
    }

    if (url.pathname === '/api/v3/notifications') {
      send(200, collection(url, notifications, offset, pageSize));
      return;
    }

    const singleWorkPackage = /^\/api\/v3\/work_packages\/(\d+)$/.exec(url.pathname);
    if (singleWorkPackage) {
      const id = Number(singleWorkPackage[1]);
      if (deletedWorkPackages.has(id)) {
        send(404, { _type: 'Error', message: 'The requested resource could not be found.' });
        return;
      }
      const lockVersion = () => lockVersions.get(id) ?? 1;
      if (req.method === 'PATCH') {
        readBody(req, body => {
          entry.body = body;
          if (hooks.onWorkPackagePatch) hooks.onWorkPackagePatch(id);
          if (body?.lockVersion !== lockVersion()) {
            send(409, {
              _type: 'Error',
              errorIdentifier: 'urn:openproject-org:api:v3:errors:UpdateConflict',
              message: 'Your changes could not be saved, because the resource was changed in the meantime.'
            });
            return;
          }
          const href = body?._links?.assignee?.href;
          if (href !== undefined) {
            const userId = href ? Number(String(href).split('/').pop()) : null;
            if (userId === FAKE_USER.id) assignees.delete(id);
            else assignees.set(id, userId === null ? null : { id: userId, name: `User ${userId}` });
          }
          lockVersions.set(id, lockVersion() + 1);
          send(200, { id, lockVersion: lockVersion() });
        });
        return;
      }
      // Status embedded as a real instance embeds it, `isClosed` and all.
      const status = closedWorkPackages.has(id) ? statuses[statuses.length - 1] : statuses[0];
      const owner = assignees.has(id) ? assignees.get(id) : FAKE_USER;
      const assignee = owner ? { href: `/api/v3/users/${owner.id}`, title: owner.name } : { href: null };
      send(200, { id, lockVersion: lockVersion(), subject: 'Fake work package', _embedded: { status }, _links: { assignee } });
      return;
    }

    send(404, { message: `No fake route for ${url.pathname}` });
  });

  return {
    server, options, projects, statuses, requests, notifications, timeEntries, closedWorkPackages, deletedWorkPackages, nonWorkingDays,
    timeEntryFilters, assignees, lockVersions, hooks
  };
}

module.exports = { createFakeOpenProject, buildNotification, DEFAULT_OPTIONS, FAKE_USER };

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2), DEFAULT_OPTIONS);
  const { server, notifications } = createFakeOpenProject(options);
  if (options.notifyEvery > 0) {
    setInterval(() => {
      const id = notifications.length + 1;
      const reason = NOTIFICATION_REASONS[(id - 1) % NOTIFICATION_REASONS.length];
      notifications.push(buildNotification(id, reason, 1000 + id));
      console.log(`[FakeOpenProject] Posted notification ${id} (${reason}).`);
    }, options.notifyEvery * 1000);
  }
  server.listen(options.port, '127.0.0.1', () => {
    const pages = n => Math.ceil(n / options.pageSize);
    console.log(`[FakeOpenProject] Listening on http://127.0.0.1:${options.port}`);
    console.log('[FakeOpenProject] Any API key is accepted.');
    console.log(
      `[FakeOpenProject] ${options.projects} projects (${pages(options.projects)} pages of ${options.pageSize}), ` +
        `${options.workPackages} work packages per project (${pages(options.workPackages)} pages), ` +
        `${options.statuses} statuses (${pages(options.statuses)} pages).`
    );
    console.log(
      `[FakeOpenProject] Before F-12 the app showed the first ${options.pageSize} of each. ` +
        `Look for "Fake Project ${options.projects} (LAST)".`
    );
  });
}
