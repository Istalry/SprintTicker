const http = require('http');
const { URL } = require('url');

/**
 * A stand-in server for the SprintTicker Provider API, contract v1
 * (`Documentation/PROVIDER-API.md`), held in memory.
 *
 * The contract is the only source of truth: this file follows it, and
 * `scripts/provider-api-check.js` checks it. CI runs the check against this
 * fake (`pnpm provider:check --fake`), so the two hold each other honest --
 * a rule the fake breaks fails the check, and a check that passes a broken
 * fake is a check that would pass a broken server (section 15, steps 1-2).
 *
 * Built as a sibling of `fake-openproject.js` and `fake-jira.js`, the same
 * shape: a factory that builds the server without binding it, so a test takes
 * an ephemeral port and the CLI a fixed one.
 *
 *   node scripts/fake-provider-api.js [--port 8097] [--projects 3] [--tasks 30]
 *                                     [--page-size 20] [--event-every 30]
 *                                     [--disable-capabilities events,assign]
 *                                     [--expired-token] [--lose-worklog-answers 1]
 *                                     [--fail-page /projects@2]
 *
 * **Failures are switches, and they live in `state.faults`**, read at every
 * request, so a test turns one on in the middle of a run rather than building
 * a second server. Each is a failure the client must survive (15, step 1):
 *
 * - `expiredToken` -- every endpoint answers 401, as a revoked token must (3.3).
 * - `loseWorklogAnswers: n` -- the next n `POST /worklogs` are stored, then the
 *   connection is destroyed before the answer: a timeout that reached the
 *   server. `loseWriteAnswers: n` does the same to any write.
 * - `failPage: { path?, page, status? }` -- page `page` (1-based) of a list
 *   answers `status` (500 by default); `path` is the list's path under the
 *   base URL, such as `/projects` or `/projects/p-1/tasks`, any list if left
 *   out. It stays on until cleared, as a broken page does.
 * - `takeOnAssign: User | null` -- the next assignment of a task nobody has
 *   finds it taken by that user: a colleague faster than the client (7.1).
 * - closed tasks -- `closedTasks` at creation, `closeTask(id)` at any time.
 * - `refuseTransitions: [{ taskId?, intent?, message? }]` -- a matching
 *   transition answers 409 `workflow_refused` (6.8). On the command line,
 *   `--refuse-transitions finish,t-1-2`: an intent, or a task id.
 * - `lockedDays: Set` -- worklogs on those days answer 409 `period_locked`.
 * - `weekIncomplete: string | null` -- closing a week answers 409
 *   `week_incomplete` with that message (7.7).
 *
 * Two more switches make the fake *wrong* on purpose, so a test can prove the
 * conformance check catches a server that is: `ignoreClientRef` (every POST
 * creates, as Jira and OpenProject do) and `anonymousOnBadToken` (a bad token
 * reads as an anonymous visitor -- 200 and empty lists -- as Jira Cloud does).
 * Neither is ever on by default.
 *
 * **`state.violations` records what a client did against the contract** --
 * a `start` on a teammate's task, an optional endpoint called without its
 * capability, a request without `User-Agent: SprintTicker/...` -- without
 * refusing it, so an integration test can assert the list is empty rather
 * than have the fake guess what answer the client should have got.
 *
 * Dev-only -- never imported by the app itself.
 */

const DEFAULT_OPTIONS = {
  port: 8097,
  /** Every path is under it; the base URL the user types ends with it (3.1). */
  basePath: '/sprintticker/v1',
  token: 'fake-provider-token',
  userId: 'u-1',
  userName: 'Fake Me',
  projects: 3,
  /** Generated tasks per project, before the server drops those out of scope. */
  tasks: 30,
  /**
   * The page size without `?limit=`. Below the generated list's length on
   * purpose: a harness that fits on one page cannot fail the way a paging
   * client fails (the F-12 lesson of fake-openproject.js).
   */
  pageSize: 20,
  minimumWorklogSeconds: 60,
  serverName: 'Fake Provider',
  serverVersion: '1.0.0',
  /** `null`: the origin the request reached, `http://127.0.0.1:<port>`. */
  siteUrl: null,
  /**
   * Named projects and tasks instead of the generated ones:
   * `[{ id, key, name, tasks: [{ id, key, title, status?, assignee?, state?,
   * priorityRank?, description?, labels?, serverStatus? }] }]`. A task with
   * no `assignee` is the user's; `null` is nobody's; a User is someone else.
   */
  catalog: null,
  /** `null`: `DEFAULT_CAPABILITIES`. A list replaces it. */
  capabilities: null,
  /** Removed from whichever list applies: the way to turn one off. */
  disableCapabilities: [],
  /** Posts an event every N seconds from a teammate (CLI only). */
  eventEvery: 0,
  nonWorkingDays: [],
  quiet: false,
  // The failure switches, copied into `state.faults` (see above).
  expiredToken: false,
  loseWorklogAnswers: 0,
  loseWriteAnswers: 0,
  failPage: null,
  takeOnAssign: null,
  closedTasks: [],
  refuseTransitions: [],
  lockedDays: [],
  weekIncomplete: null,
  ignoreClientRef: false,
  anonymousOnBadToken: false
};

/**
 * What the fake offers unless told otherwise: every optional part that has an
 * endpoint (7.1-7.5, 7.7, 7.9). `labels` and `inbox` are implemented too but
 * listed only on request: SprintTicker does not build them yet (7.6, 7.8),
 * and a default that exercises nothing would only hide a client that ignores
 * them wrongly.
 */
const DEFAULT_CAPABILITIES = ['assign', 'task_state', 'calendar', 'events', 'today_total', 'week_close', 'task_by_key'];
const ALL_CAPABILITIES = [...DEFAULT_CAPABILITIES, 'labels', 'inbox'];

/** A teammate with a token of their own, so a test can prove another user's worklogs are invisible (4.4). */
const TEAMMATE = { id: 'u-2', displayName: 'Grace Hopper' };
const TEAMMATE_TOKEN = 'fake-provider-token-grace';
/** Someone with no token: an assignee only. */
const OTHER = { id: 'u-3', displayName: 'Rin Tanaka' };

const INBOX_TASK_ID = 't-inbox';
const MAX_PAGE_SIZE = 500;
const MAX_WORKLOG_SECONDS = 90000;
const MAX_COMMENT_CHARACTERS = 4000;
const MAX_CALENDAR_SPAN_DAYS = 400;
const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const EVENT_KINDS = ['assigned', 'mentioned', 'commented', 'status_changed', 'date_alert'];

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const CLIENT_REF = /^[A-Za-z0-9_-]{1,64}$/;

/** True for a real `YYYY-MM-DD` date: `2026-02-30` is the shape and not a day. */
function isLocalDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isInstant(value) {
  return typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

/** Whole seconds, `Z`: what both sides send (3.4). A fraction received is dropped here. */
function toInstant(ms) {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function dayNumber(day) {
  return Date.parse(`${day}T00:00:00Z`) / 86400000;
}

/** Text length in characters as a person counts them, not UTF-16 units: an emoji is one. */
function characters(text) {
  return [...text].length;
}

/** Parses `--flag value` pairs, typed by the default each flag overrides. */
function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in out)) throw new Error(`Unknown option ${flag}`);
    if (typeof defaults[key] === 'boolean') {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Option ${flag} needs a value`);
    i += 1;
    if (typeof defaults[key] === 'number') out[key] = Number(value);
    else if (Array.isArray(defaults[key])) out[key] = value.split(',').map(v => v.trim()).filter(Boolean);
    else if (key === 'failPage') {
      // `/projects@2`, or `2` for any list.
      const [path, page] = value.includes('@') ? value.split('@') : [undefined, value];
      out[key] = { path, page: Number(page) };
    } else if (key === 'takeOnAssign') out[key] = { ...OTHER, displayName: value };
    else if (key === 'catalog') throw new Error('--catalog is for the factory, not the command line');
    else out[key] = value;
  }
  return out;
}

/**
 * Projects and tasks when no catalog is given. The tasks cycle through every
 * case the default scope (6.3) has to tell apart -- the user's in each
 * status, nobody's, a teammate's in progress -- plus two the server must
 * leave out of a list: a teammate's `todo` and a closed task. A fixture with
 * only the user's open tasks cannot tell a filter from no filter.
 */
function buildCatalog(projectCount, taskCount) {
  return Array.from({ length: projectCount }, (_, p) => {
    const n = p + 1;
    return {
      id: `p-${n}`,
      key: `P${n}`,
      name: n === projectCount ? `Fake Project ${n} (LAST)` : `Fake Project ${n}`,
      tasks: Array.from({ length: taskCount }, (__, t) => {
        const m = t + 1;
        const shape = t % 6;
        const task = {
          id: `t-${n}-${m}`,
          key: `P${n}-${m}`,
          title: m === taskCount ? `Task ${m} of project ${n} (LAST)` : `Task ${m} of project ${n}`,
          status: ['todo', 'in_progress', 'done', 'todo', 'in_progress', 'todo'][shape],
          serverStatus: { id: `st-${shape}`, name: ['Backlog', 'In development', 'In review', 'Ready', 'In development', 'Backlog'][shape] }
        };
        if (shape === 3) task.assignee = null;
        if (shape === 4 || shape === 5) task.assignee = TEAMMATE;
        if (t % 11 === 10) task.state = 'closed';
        // Some unranked, so "sorts after every ranked one" has something to sort.
        if (t % 7 !== 0) task.priorityRank = t % 5;
        if (t % 4 === 0) task.description = `What task ${m} of project ${n} is about.`;
        if (t % 5 === 0) task.labels = ['Sprint 12'];
        return task;
      })
    };
  });
}

/**
 * Builds the server without binding it.
 *
 * Returns `{ server, state, options, listen, close, baseUrlOf, addTask,
 * closeTask, deleteTask, setAssignee, addEvent, recordWorklog }`. `listen(port)`
 * resolves the base URL; `close()` drops every open connection first, since a
 * keep-alive socket would hold `server.close()` open.
 */
function createFakeProviderApi(overrides = {}) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const me = { id: options.userId, displayName: options.userName };

  const state = {
    me,
    /** Token to user. A token not here is a bad token. */
    users: new Map([
      [options.token, me],
      [TEAMMATE_TOKEN, TEAMMATE]
    ]),
    capabilities: new Set(
      (options.capabilities ?? DEFAULT_CAPABILITIES).filter(c => !(options.disableCapabilities || []).includes(c))
    ),
    minimumWorklogSeconds: options.minimumWorklogSeconds,
    /** `[{ id, key, name }]`, in the order lists answer them. */
    projects: [],
    /**
     * Task id to task: the contract's fields plus `state` ('open' | 'closed'),
     * `listed` (false for the inbox task) and `deleted`. Rewrite a task here
     * to play an edit made on the server.
     */
    tasks: new Map(),
    /**
     * Worklog id to `{ id, ownerId, clientRef, taskId, startedAt, day,
     * durationSeconds, comment, deleted }`. A deleted worklog stays, flagged:
     * its `clientRef` is reserved forever (6.4).
     */
    worklogs: new Map(),
    /**
     * `(user, clientRef)` to worklog id: the unique constraint of 6.4. Set in
     * the same synchronous step that checks it, so two POSTs in flight at once
     * cannot both read "not there" -- Node runs one handler at a time between
     * the body arriving and the answer being written.
     */
    clientRefs: new Map(),
    /** Events, oldest first. Use `addEvent`, which stamps them. */
    events: [],
    nonWorkingDays: [...options.nonWorkingDays],
    /** Week start to the message its close answered. */
    closedWeeks: new Map(),
    lockedDays: new Set(options.lockedDays),
    faults: {
      expiredToken: options.expiredToken,
      loseWorklogAnswers: options.loseWorklogAnswers,
      loseWriteAnswers: options.loseWriteAnswers,
      failPage: options.failPage,
      takeOnAssign: options.takeOnAssign,
      // From the command line an entry is a word: an intent, or a task id.
      refuseTransitions: options.refuseTransitions.map(r =>
        typeof r === 'string' ? (r === 'start' || r === 'finish' ? { intent: r } : { taskId: r }) : r
      ),
      weekIncomplete: options.weekIncomplete,
      ignoreClientRef: options.ignoreClientRef,
      anonymousOnBadToken: options.anonymousOnBadToken
    },
    /** Every request: `{ method, path, query, body, userId, status }`, `status` set when answered. */
    requests: [],
    /** What a client did against the contract: `{ rule, message, method, path }`. */
    violations: []
  };

  let nextWorklog = 1;
  let nextEvent = 1;

  function addTask(task) {
    if (!task || !task.id || !task.projectId) throw new Error('addTask needs at least an id and a projectId');
    const stored = {
      status: 'todo',
      title: task.id,
      key: task.id.toUpperCase().slice(0, 12),
      state: 'open',
      listed: true,
      deleted: false,
      ...task,
      assignee: task.assignee === undefined ? me : task.assignee
    };
    state.tasks.set(task.id, stored);
    return stored;
  }

  for (const project of options.catalog ?? buildCatalog(options.projects, options.tasks)) {
    state.projects.push({ id: project.id, key: project.key, name: project.name });
    for (const task of project.tasks || []) addTask({ ...task, projectId: project.id });
  }
  for (const id of options.closedTasks) closeTask(id);
  // The inbox task (7.6): in no list, accepting anyone's time.
  addTask({
    id: INBOX_TASK_ID,
    projectId: state.projects[0] ? state.projects[0].id : 'p-inbox',
    key: 'INBOX',
    title: 'Unplanned work',
    assignee: null,
    listed: false
  });

  /** Closed for good: out of every list, `state: closed` alone (4.3). */
  function closeTask(id) {
    const task = state.tasks.get(id);
    if (!task) throw new Error(`No task ${id}`);
    task.state = 'closed';
    task.status = 'done';
  }

  /** Deleted, or no longer visible to the user: 404 everywhere (7.2). */
  function deleteTask(id) {
    const task = state.tasks.get(id);
    if (!task) throw new Error(`No task ${id}`);
    task.deleted = true;
  }

  function setAssignee(id, user) {
    const task = state.tasks.get(id);
    if (!task) throw new Error(`No task ${id}`);
    task.assignee = user;
  }

  /**
   * Records an event, stamped by this server's clock and never earlier than
   * the last one: `occurredAt` is when it became readable (7.4). Defaults to
   * the teammate as actor; an event whose actor is the user is stored but
   * never served, as the contract requires -- push one to prove a client
   * does not depend on it.
   */
  function addEvent({ kind = 'assigned', taskId, actor = TEAMMATE, summary, occurredAt } = {}) {
    const task = state.tasks.get(taskId);
    if (!task) throw new Error(`No task ${taskId}`);
    const last = state.events.length ? Date.parse(state.events[state.events.length - 1].occurredAt) : 0;
    const at = occurredAt ? Date.parse(occurredAt) : Math.max(Date.now(), last);
    const event = {
      id: `e-${nextEvent++}`,
      kind,
      task: { id: task.id, key: task.key, title: task.title },
      ...(actor ? { actor } : {}),
      ...(summary ? { summary } : {}),
      path: `/tasks/${encodeURIComponent(task.id)}`,
      occurredAt: toInstant(at)
    };
    state.events.push(event);
    return event;
  }

  /** A worklog made elsewhere -- the server's own interface, an import -- for `today_total`. */
  function recordWorklog({ ownerId = me.id, taskId, startedAt, day, durationSeconds, comment = '' }) {
    const id = `w-${nextWorklog++}`;
    const clientRef = `server_${id}`;
    state.worklogs.set(id, { id, ownerId, clientRef, taskId, startedAt, day, durationSeconds, comment, deleted: false });
    state.clientRefs.set(`${ownerId}\u0000${clientRef}`, id);
    return state.worklogs.get(id);
  }

  /** The contract's view of a task: the internal flags off, `url` under the site, labels only when offered. */
  function taskView(task, site) {
    const view = {
      id: task.id,
      projectId: task.projectId,
      key: task.key,
      title: task.title,
      status: task.status,
      assignee: task.assignee ?? null,
      state: task.state,
      url: `${site}/tasks/${encodeURIComponent(task.id)}`
    };
    if (task.serverStatus) view.serverStatus = task.serverStatus;
    if (task.priorityRank !== undefined) view.priorityRank = task.priorityRank;
    if (task.description) view.description = task.description;
    if (task.labels && state.capabilities.has('labels')) view.labels = task.labels.slice(0, 3);
    return view;
  }

  function worklogView(w) {
    return {
      id: w.id,
      clientRef: w.clientRef,
      taskId: w.taskId,
      startedAt: w.startedAt,
      day: w.day,
      durationSeconds: w.durationSeconds,
      comment: w.comment
    };
  }

  /** The default scope (6.3): not closed, and the user's, nobody's, or someone else's in progress. */
  function inScope(task) {
    if (task.deleted || !task.listed || task.state === 'closed') return false;
    if (!task.assignee || task.assignee.id === me.id) return true;
    return task.status === 'in_progress';
  }

  /** Visible to the user at all: every task is, in this fake, until deleted. */
  function visibleTask(id) {
    const task = state.tasks.get(id);
    return task && !task.deleted ? task : null;
  }

  // -- The cursor. Opaque to the client (3.7); here it carries the offset, the
  // page number (for `failPage`) and the list it belongs to, so a cursor
  // replayed on another list is refused rather than silently misread.
  const encodeCursor = c => Buffer.from(JSON.stringify(c)).toString('base64url');
  const decodeCursor = raw => {
    try {
      const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      return Number.isInteger(c.o) && Number.isInteger(c.p) && typeof c.l === 'string' ? c : null;
    } catch {
      // Anything that is not one of ours is a bad cursor, answered 400 below.
      return null;
    }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const site = options.siteUrl || `http://${req.headers.host}`;
    const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: undefined, userId: null, status: null };
    state.requests.push(entry);

    const violate = (rule, message) => state.violations.push({ rule, message, method: req.method, path: url.pathname });

    const send = (status, body, headers = {}) => {
      entry.status = status;
      if (status === 204) {
        res.writeHead(204, headers);
        res.end();
      } else {
        const json = JSON.stringify(body);
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
        res.end(json);
      }
      if (!options.quiet) console.log(`[FakeProviderApi] ${status} ${req.method} ${url.pathname}${url.search}`);
    };
    const fail = (status, code, message, field) => send(status, { error: { code, message, ...(field ? { field } : {}) } });

    /** The write happened; the answer does not arrive. The client cannot tell this from a failure before it. */
    const loseAnswer = counter => {
      if (state.faults[counter] > 0) {
        state.faults[counter] -= 1;
        entry.status = 'lost';
        if (!options.quiet) console.log(`[FakeProviderApi] answer lost ${req.method} ${url.pathname}`);
        req.socket.destroy();
        return true;
      }
      return false;
    };
    const loseWrite = () => loseAnswer('loseWriteAnswers');

    // -- What the client sends on every request (3.2). Recorded, not refused.
    if (!/^SprintTicker\//.test(req.headers['user-agent'] || '')) violate('3.2', 'User-Agent must be SprintTicker/<version>');
    if (!/application\/json/.test(req.headers.accept || '')) violate('3.2', 'Accept must be application/json');
    for (const name of ['token', 'access_token', 'api_key']) {
      if (url.searchParams.has(name)) violate('11', `a credential in the URL (${name}): only the Authorization header carries the token`);
    }

    // -- Authentication (3.3): a bad token is 401 everywhere, never 200 and empty.
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const user = auth ? state.users.get(auth[1]) : undefined;
    if (state.faults.expiredToken) {
      fail(401, 'unauthorized', 'The token has expired. Create a new one and enter it in SprintTicker.');
      return;
    }
    if (!user) {
      // The wrong server on purpose: Jira Cloud's anonymous visitor.
      if (state.faults.anonymousOnBadToken && req.method === 'GET' && !url.pathname.endsWith('/me')) {
        send(200, url.pathname.endsWith('/capabilities') ? capabilitiesBody() : { items: [], nextCursor: null });
        return;
      }
      fail(401, 'unauthorized', auth ? 'This token is not valid.' : 'An Authorization: Bearer <token> header is required.');
      return;
    }
    entry.userId = user.id;

    if (!url.pathname.startsWith(`${options.basePath}/`) && url.pathname !== options.basePath) {
      fail(404, 'not_found', `The contract is served under ${options.basePath}.`);
      return;
    }
    const rel = url.pathname.slice(options.basePath.length) || '/';
    let segments;
    try {
      segments = rel.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      fail(400, 'invalid_request', 'The path is not valid percent-encoding.');
      return;
    }

    function capabilitiesBody() {
      const body = {
        contract: 1,
        server: { name: options.serverName, version: options.serverVersion },
        siteUrl: site,
        minimumWorklogSeconds: state.minimumWorklogSeconds,
        capabilities: ALL_CAPABILITIES.filter(c => state.capabilities.has(c))
      };
      if (state.capabilities.has('events')) body.eventsInboxUrl = `${site}/notifications`;
      if (state.capabilities.has('inbox')) body.inboxTaskId = INBOX_TASK_ID;
      return body;
    }

    /** An optional endpoint without its capability answers as on a server that lacks it. */
    const offered = capability => {
      if (state.capabilities.has(capability)) return true;
      violate('5', `called the ${capability} endpoint, which /capabilities does not list`);
      fail(404, 'not_found', `This server does not offer ${capability}.`);
      return false;
    };

    /** One page of a list (3.7), honouring `limit`, `cursor` and `failPage`. */
    const sendPage = all => {
      const rawLimit = url.searchParams.get('limit');
      let size = options.pageSize;
      if (rawLimit !== null) {
        const limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1) {
          fail(422, 'validation_failed', 'limit must be a whole number of at least 1.', 'limit');
          return;
        }
        size = limit;
      }
      size = Math.min(size, MAX_PAGE_SIZE);
      let offset = 0;
      let page = 1;
      const rawCursor = url.searchParams.get('cursor');
      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor || cursor.l !== rel) {
          fail(400, 'invalid_request', 'This cursor does not belong to this list. Start the read again without one.');
          return;
        }
        offset = cursor.o;
        page = cursor.p;
      }
      const broken = state.faults.failPage;
      if (broken && broken.page === page && (!broken.path || broken.path === rel)) {
        fail(broken.status || 500, 'internal', `Page ${page} of ${rel} failed on the server.`);
        return;
      }
      const items = all.slice(offset, offset + size);
      const more = offset + size < all.length;
      send(200, { items, nextCursor: more ? encodeCursor({ o: offset + size, p: page + 1, l: rel }) : null });
    };

    /** Reads a JSON object body; answers 400 and resolves nothing when it is not one. */
    const withBody = then => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          entry.body = null;
          fail(400, 'invalid_request', 'The body must be a JSON object.');
          return;
        }
        entry.body = body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          fail(400, 'invalid_request', 'The body must be a JSON object.');
          return;
        }
        then(body);
      });
    };

    /** The 6.4 rules for one worklog field, as `[field, message]` or null. */
    const invalidField = (field, value) => {
      switch (field) {
        case 'startedAt':
          return isInstant(value) ? null : 'startedAt must be an instant in UTC, such as 2026-10-23T07:42:10Z.';
        case 'day':
          return isLocalDay(value) ? null : 'day must be a real date, YYYY-MM-DD.';
        case 'durationSeconds':
          if (!Number.isInteger(value)) return 'durationSeconds must be a whole number of seconds.';
          if (value < state.minimumWorklogSeconds) return `durationSeconds must be at least ${state.minimumWorklogSeconds}.`;
          if (value > MAX_WORKLOG_SECONDS) return `durationSeconds must be at most ${MAX_WORKLOG_SECONDS}.`;
          return null;
        case 'comment':
          if (typeof value !== 'string') return 'comment must be text.';
          return characters(value) > MAX_COMMENT_CHARACTERS ? `comment must be at most ${MAX_COMMENT_CHARACTERS} characters.` : null;
        default:
          return null;
      }
    };
    const firstInvalid = (body, fields) => {
      for (const field of fields) {
        const message = invalidField(field, body[field]);
        if (message) return [field, message];
      }
      return null;
    };
    const lockedMessage = day => `${day} is in a period that no longer accepts time.`;
    const ownWorklog = id => {
      const w = state.worklogs.get(id);
      return w && !w.deleted && w.ownerId === user.id ? w : null;
    };

    const [first, second, third] = segments;
    const method = req.method;

    // GET /capabilities (5)
    if (rel === '/capabilities' && method === 'GET') {
      send(200, capabilitiesBody());
      return;
    }

    // GET /me (6.1)
    if (rel === '/me' && method === 'GET') {
      send(200, user);
      return;
    }

    // GET /projects (6.2)
    if (rel === '/projects' && method === 'GET') {
      sendPage(state.projects);
      return;
    }

    // GET /projects/{projectId}/tasks (6.3)
    if (first === 'projects' && third === 'tasks' && segments.length === 3 && method === 'GET') {
      if (!state.projects.some(p => p.id === second)) {
        fail(404, 'not_found', `No project ${second}.`);
        return;
      }
      const tasks = [...state.tasks.values()].filter(t => t.projectId === second && inScope(t)).map(t => taskView(t, site));
      sendPage(tasks);
      return;
    }

    // GET /worklogs/summary (7.5) -- before /worklogs/{id}, whose id it would otherwise be.
    if (rel === '/worklogs/summary' && method === 'GET') {
      if (!offered('today_total')) return;
      const day = url.searchParams.get('day');
      if (!isLocalDay(day)) {
        fail(422, 'validation_failed', 'day must be a real date, YYYY-MM-DD.', 'day');
        return;
      }
      const totalSeconds = [...state.worklogs.values()]
        .filter(w => !w.deleted && w.ownerId === user.id && w.day === day)
        .reduce((sum, w) => sum + w.durationSeconds, 0);
      send(200, { day, totalSeconds });
      return;
    }

    // GET /worklogs?clientRef= (6.5)
    if (rel === '/worklogs' && method === 'GET') {
      const clientRef = url.searchParams.get('clientRef');
      if (clientRef === null) {
        fail(422, 'validation_failed', 'clientRef is required: this list answers one reference.', 'clientRef');
        return;
      }
      const id = state.clientRefs.get(`${user.id}\u0000${clientRef}`);
      const w = id ? ownWorklog(id) : null;
      sendPage(w ? [worklogView(w)] : []);
      return;
    }

    // POST /worklogs (6.4)
    if (rel === '/worklogs' && method === 'POST') {
      withBody(body => {
        if (typeof body.clientRef !== 'string' || !CLIENT_REF.test(body.clientRef)) {
          fail(422, 'validation_failed', 'clientRef must be 1 to 64 characters of A-Z, a-z, 0-9, _ and -.', 'clientRef');
          return;
        }
        if (typeof body.taskId !== 'string' || !visibleTask(body.taskId)) {
          fail(404, 'not_found', `No task ${body.taskId} that you can see.`);
          return;
        }
        const invalid = firstInvalid(body, ['startedAt', 'day', 'durationSeconds', 'comment']);
        if (invalid) {
          fail(422, 'validation_failed', invalid[1], invalid[0]);
          return;
        }
        const values = {
          startedAt: toInstant(Date.parse(body.startedAt)),
          day: body.day,
          durationSeconds: body.durationSeconds,
          comment: body.comment
        };
        const refKey = `${user.id}\u0000${body.clientRef}`;
        const existingId = state.faults.ignoreClientRef ? undefined : state.clientRefs.get(refKey);
        if (existingId) {
          const existing = state.worklogs.get(existingId);
          if (existing.taskId !== body.taskId) {
            fail(422, 'validation_failed', 'This clientRef already recorded time on another task; a worklog is never moved.', 'taskId');
            return;
          }
          if (existing.deleted) {
            // Deleted since: the reference stays reserved, and nothing comes back.
            send(200, { id: existing.id });
            return;
          }
          const same = Object.keys(values).every(k => existing[k] === values[k]);
          // A resend identical to what is stored changes nothing, so a lock
          // set since does not refuse it: answering 409 would make the client
          // keep locally time the server already holds. A resend that changes
          // the worklog is a correction, and the lock applies to both days.
          // (The contract is silent on this case; this is the fake's choice.)
          if (!same) {
            const locked = [existing.day, values.day].find(d => state.lockedDays.has(d));
            if (locked) {
              fail(409, 'period_locked', lockedMessage(locked));
              return;
            }
            Object.assign(existing, values);
          }
          if (loseAnswer('loseWorklogAnswers') || loseWrite()) return;
          send(200, { id: existing.id });
          return;
        }
        if (state.lockedDays.has(values.day)) {
          fail(409, 'period_locked', lockedMessage(values.day));
          return;
        }
        const id = `w-${nextWorklog++}`;
        state.worklogs.set(id, { id, ownerId: user.id, clientRef: body.clientRef, taskId: body.taskId, ...values, deleted: false });
        if (!state.faults.ignoreClientRef) state.clientRefs.set(refKey, id);
        if (body.taskId === INBOX_TASK_ID && !state.capabilities.has('inbox')) {
          violate('7.6', 'sent time to the inbox task without the inbox capability');
        }
        if (loseAnswer('loseWorklogAnswers') || loseWrite()) return;
        send(201, { id });
      });
      return;
    }

    // PATCH and DELETE /worklogs/{worklogId} (6.6, 6.7)
    if (first === 'worklogs' && segments.length === 2 && (method === 'PATCH' || method === 'DELETE')) {
      const worklog = ownWorklog(second);
      if (method === 'DELETE') {
        if (!worklog) {
          fail(404, 'not_found', `No worklog ${second}: it was deleted, or never existed.`);
          return;
        }
        if (state.lockedDays.has(worklog.day)) {
          fail(409, 'period_locked', lockedMessage(worklog.day));
          return;
        }
        worklog.deleted = true;
        if (loseWrite()) return;
        send(204);
        return;
      }
      withBody(body => {
        if (!worklog) {
          fail(404, 'not_found', `No worklog ${second}: it was deleted, or never existed.`);
          return;
        }
        for (const fixed of ['taskId', 'clientRef']) {
          if (fixed in body) {
            fail(422, 'validation_failed', `${fixed} cannot change: a worklog is corrected, never moved.`, fixed);
            return;
          }
        }
        const fields = ['startedAt', 'day', 'durationSeconds', 'comment'].filter(f => f in body);
        const invalid = firstInvalid(body, fields);
        if (invalid) {
          fail(422, 'validation_failed', invalid[1], invalid[0]);
          return;
        }
        const locked = [worklog.day, body.day].find(d => d && state.lockedDays.has(d));
        if (locked) {
          fail(409, 'period_locked', lockedMessage(locked));
          return;
        }
        for (const f of fields) worklog[f] = f === 'startedAt' ? toInstant(Date.parse(body[f])) : body[f];
        if (loseWrite()) return;
        send(200, worklogView(worklog));
      });
      return;
    }

    // POST /tasks/{taskId}/transitions (6.8)
    if (first === 'tasks' && third === 'transitions' && segments.length === 3 && method === 'POST') {
      withBody(body => {
        const task = visibleTask(second);
        if (!task) {
          fail(404, 'not_found', `No task ${second} that you can see.`);
          return;
        }
        if (body.intent !== 'start' && body.intent !== 'finish') {
          fail(422, 'validation_failed', 'intent must be start or finish.', 'intent');
          return;
        }
        if (task.id === INBOX_TASK_ID) violate('7.6', 'sent a transition for the inbox task');
        if (body.intent === 'start' && task.assignee && task.assignee.id !== user.id) {
          violate('6.8', `sent start for ${task.key}, which is ${task.assignee.displayName}'s: the client never moves a teammate's work`);
        }
        // Closed changes nothing, whatever the intent: no intent reopens a task.
        if (task.state === 'closed') {
          send(200, taskView(task, site));
          return;
        }
        const refusal = state.faults.refuseTransitions.find(r => (!r.taskId || r.taskId === task.id) && (!r.intent || r.intent === body.intent));
        if (refusal) {
          fail(409, 'workflow_refused', refusal.message || `${task.key} cannot be moved that way in its workflow.`);
          return;
        }
        // `finish` on a task already `done` is already satisfied; `start` moves
        // it back from `done` too: the user went back to it.
        task.status = body.intent === 'start' ? 'in_progress' : 'done';
        if (loseWrite()) return;
        send(200, taskView(task, site));
      });
      return;
    }

    // POST /tasks/{taskId}/assignment (7.1)
    if (first === 'tasks' && third === 'assignment' && segments.length === 3 && method === 'POST') {
      if (!offered('assign')) return;
      withBody(body => {
        const task = visibleTask(second);
        if (!task) {
          fail(404, 'not_found', `No task ${second} that you can see.`);
          return;
        }
        if (body.ifUnassigned !== true) {
          fail(422, 'validation_failed', 'ifUnassigned must be true.', 'ifUnassigned');
          return;
        }
        if (task.id === INBOX_TASK_ID) violate('7.6', 'sent an assignment for the inbox task');
        if (task.state === 'closed') {
          send(409, { task: taskView(task, site), error: { code: 'workflow_refused', message: `${task.key} is closed.` } });
          return;
        }
        // A colleague faster than the client. The check and the write below
        // are one synchronous step: nothing can run between them.
        if (!task.assignee && state.faults.takeOnAssign) {
          task.assignee = state.faults.takeOnAssign;
          state.faults.takeOnAssign = null;
        }
        if (task.assignee && task.assignee.id === user.id) {
          send(200, { outcome: 'already_mine', task: taskView(task, site) });
          return;
        }
        if (task.assignee) {
          send(409, {
            outcome: 'taken',
            task: taskView(task, site),
            error: { code: 'taken', message: `${task.assignee.displayName} has ${task.key}.` }
          });
          return;
        }
        task.assignee = user;
        if (loseWrite()) return;
        send(200, { outcome: 'assigned', task: taskView(task, site) });
      });
      return;
    }

    // GET /tasks/{taskId} (7.2)
    if (first === 'tasks' && segments.length === 2 && method === 'GET') {
      if (!offered('task_state')) return;
      const task = visibleTask(second);
      if (!task) {
        fail(404, 'not_found', `No task ${second} that you can see.`);
        return;
      }
      send(200, taskView(task, site));
      return;
    }

    // GET /tasks?key= (7.9)
    if (rel === '/tasks' && method === 'GET') {
      if (!offered('task_by_key')) return;
      const key = (url.searchParams.get('key') || '').trim().toLowerCase();
      const task = [...state.tasks.values()].find(t => !t.deleted && t.key.toLowerCase() === key);
      if (!key || !task) {
        fail(404, 'not_found', `No task with the key ${url.searchParams.get('key') || ''} that you can see.`);
        return;
      }
      send(200, taskView(task, site));
      return;
    }

    // GET /calendar/non-working-days (7.3)
    if (rel === '/calendar/non-working-days' && method === 'GET') {
      if (!offered('calendar')) return;
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      for (const [field, value] of [['from', from], ['to', to]]) {
        if (!isLocalDay(value)) {
          fail(422, 'validation_failed', `${field} must be a real date, YYYY-MM-DD.`, field);
          return;
        }
      }
      const span = dayNumber(to) - dayNumber(from);
      if (span < 0) {
        fail(422, 'validation_failed', 'to must not be before from.', 'to');
        return;
      }
      if (span > MAX_CALENDAR_SPAN_DAYS) {
        fail(422, 'validation_failed', `from and to must be at most ${MAX_CALENDAR_SPAN_DAYS} days apart.`, 'to');
        return;
      }
      send(200, { days: state.nonWorkingDays.filter(d => d >= from && d <= to).sort() });
      return;
    }

    // GET /events (7.4)
    if (rel === '/events' && method === 'GET') {
      if (!offered('events')) return;
      const since = url.searchParams.get('since');
      if (!isInstant(since)) {
        fail(422, 'validation_failed', 'since must be an instant in UTC, such as 2026-10-23T07:00:00Z.', 'since');
        return;
      }
      const from = Date.parse(since);
      const events = state.events
        // At or after `since`; never one the user caused.
        .filter(e => Date.parse(e.occurredAt) >= from && !(e.actor && e.actor.id === user.id))
        .map(({ path, ...e }) => ({ ...e, url: `${site}${path}` }));
      sendPage(events);
      return;
    }

    // POST /weeks/{weekStart}/close (7.7)
    if (first === 'weeks' && third === 'close' && segments.length === 3 && method === 'POST') {
      if (!offered('week_close')) return;
      withBody(body => {
        const weekStart = second;
        if (!isLocalDay(weekStart) || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) {
          fail(422, 'validation_failed', 'The week starts on a Monday, as YYYY-MM-DD.', 'weekStart');
          return;
        }
        const start = dayNumber(weekStart);
        const days = body.workingDays;
        if (!Array.isArray(days) || !days.every(d => isLocalDay(d) && dayNumber(d) >= start && dayNumber(d) < start + 7)) {
          fail(422, 'validation_failed', 'workingDays must list days of that week, YYYY-MM-DD.', 'workingDays');
          return;
        }
        if (state.closedWeeks.has(weekStart)) {
          send(200, { message: `The week of ${weekStart} was already closed.` });
          return;
        }
        if (state.faults.weekIncomplete) {
          fail(409, 'week_incomplete', state.faults.weekIncomplete);
          return;
        }
        const message = `Timesheet for the week of ${weekStart} submitted for approval.`;
        state.closedWeeks.set(weekStart, message);
        if (loseWrite()) return;
        send(200, { message });
      });
      return;
    }

    const knownPath =
      ['/capabilities', '/me', '/projects', '/worklogs', '/worklogs/summary', '/tasks', '/calendar/non-working-days', '/events'].includes(rel) ||
      ['projects', 'worklogs', 'tasks', 'weeks'].includes(first);
    if (knownPath) {
      fail(405, 'invalid_request', `${method} is not part of the contract for ${rel}.`);
      return;
    }
    fail(404, 'not_found', `Nothing at ${rel}.`);
  });

  const baseUrlOf = port => `http://127.0.0.1:${port}${options.basePath}`;

  return {
    server,
    state,
    options,
    baseUrlOf,
    /** Binds to 127.0.0.1 (port 0 = any free one) and resolves the base URL. */
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve(baseUrlOf(server.address().port));
        });
      });
    },
    close() {
      return new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
    addTask,
    closeTask,
    deleteTask,
    setAssignee,
    addEvent,
    recordWorklog
  };
}

module.exports = {
  createFakeProviderApi,
  DEFAULT_OPTIONS,
  DEFAULT_CAPABILITIES,
  ALL_CAPABILITIES,
  TEAMMATE,
  TEAMMATE_TOKEN,
  OTHER,
  INBOX_TASK_ID,
  EVENT_KINDS,
  TASK_STATUSES
};

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2), DEFAULT_OPTIONS);
  const fake = createFakeProviderApi(options);
  if (options.eventEvery > 0) {
    let n = 0;
    setInterval(() => {
      const listed = [...fake.state.tasks.values()].filter(t => t.listed && t.state === 'open');
      const kind = EVENT_KINDS[n % EVENT_KINDS.length];
      const event = fake.addEvent({ kind, taskId: listed[n % listed.length].id, summary: `Fake ${kind} event ${n + 1}` });
      n += 1;
      console.log(`[FakeProviderApi] Posted ${event.id} (${kind}) on ${event.task.key}.`);
    }, options.eventEvery * 1000);
  }
  fake.listen(options.port).then(base => {
    console.log(`[FakeProviderApi] Base URL: ${base}`);
    console.log(`[FakeProviderApi] Token:    ${options.token}`);
    console.log(`[FakeProviderApi] Capabilities: ${[...fake.state.capabilities].join(', ') || 'none'}`);
    console.log(
      `[FakeProviderApi] ${fake.state.projects.length} projects, ${options.tasks} tasks each before the default scope, ` +
        `pages of ${options.pageSize}. Look for "Fake Project ${options.projects} (LAST)".`
    );
  });
}
