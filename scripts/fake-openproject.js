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
  quiet: false
};

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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const offset = Number(url.searchParams.get('offset')) || 1;

    // A real instance clamps to its `maximum_page_size`: asking for 100 does
    // not mean receiving 100. Honouring the request instead would hand the
    // provider every element in a single page, and the multi-page walk this
    // harness exists to exercise would silently never run.
    const requestedPageSize = Number(url.searchParams.get('pageSize')) || options.pageSize;
    const pageSize = Math.min(requestedPageSize, options.pageSize);

    requests.push({ method: req.method, pathname: url.pathname, offset, pageSize, requestedPageSize });

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

    if (url.pathname === '/api/v3/statuses') {
      send(200, collection(url, statuses, offset, pageSize));
      return;
    }

    if (url.pathname === '/api/v3/work_packages') {
      const projectId = projectIdFromFilters(url.searchParams.get('filters'));
      send(200, collection(url, workPackagesFor(projectId, options.workPackages), offset, pageSize));
      return;
    }

    if (url.pathname === '/api/v3/time_entries') {
      if (req.method === 'POST') {
        send(201, { id: Math.floor(Math.random() * 100000), _type: 'TimeEntry' });
        return;
      }
      const entries = [{ hours: 'PT1H30M' }, { hours: 'PT45M' }, { hours: 'PT30S' }];
      send(200, collection(url, entries, offset, pageSize));
      return;
    }

    if (url.pathname === '/api/v3/notifications') {
      send(200, collection(url, [], offset, pageSize));
      return;
    }

    const singleWorkPackage = /^\/api\/v3\/work_packages\/(\d+)$/.exec(url.pathname);
    if (singleWorkPackage) {
      send(200, { id: Number(singleWorkPackage[1]), lockVersion: 1, subject: 'Fake work package' });
      return;
    }

    send(404, { message: `No fake route for ${url.pathname}` });
  });

  return { server, options, projects, statuses, requests };
}

module.exports = { createFakeOpenProject, DEFAULT_OPTIONS };

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2), DEFAULT_OPTIONS);
  const { server } = createFakeOpenProject(options);
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
