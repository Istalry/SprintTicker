const crypto = require('crypto');
const path = require('path');

/**
 * The conformance check of `Documentation/PROVIDER-API.md`, section 13: runs
 * the contract against a server and says, rule by rule, what it gets wrong.
 *
 *   node scripts/provider-api-check.js --url <base URL> --token <token> --task <task id>
 *   node scripts/provider-api-check.js --fake [--fake-fault <name>[=<value>]]...
 *
 * The reader of its output is whoever -- or whatever -- is building the
 * server, from the contract alone. So a failure names the rule and its
 * section, says what was sent and what came back, and why the rule exists,
 * in the contract's words: "answered 201" is not enough to fix a server by.
 *
 * **It writes only on the task given**: worklogs, which it deletes again
 * whatever happens (a `finally`), and `start` transitions, which move the
 * task to in progress. It never closes a week -- on a real server that is a
 * timesheet submitted -- and takes no task: `week_close` and `assign` are
 * checked on the answers that change nothing.
 *
 * `--fake` starts `fake-provider-api.js` in this process on a free port,
 * seeds a task, runs the check against it and stops it. CI runs that
 * (`pnpm provider:check --fake`), so the fake and the check hold each other
 * honest (15, step 2). `--fake-fault` turns on one of the fake's switches --
 * `ignoreClientRef`, `anonymousOnBadToken`, `loseWorklogAnswers=1`... -- to
 * watch the check catch it; nothing turns one on by default.
 *
 * The token may come from `SPRINTTICKER_PROVIDER_TOKEN` instead of `--token`,
 * which keeps it out of the process list. It is never printed.
 *
 * Exit code: 0 when every check passes, 1 when one fails, 2 when the check
 * could not run (bad arguments).
 *
 * Dependency-free CommonJS on Node's own `fetch`, like everything in scripts/.
 */

const VERSION = (() => {
  try {
    return require(path.join(__dirname, '..', 'package.json')).version;
  } catch {
    // Only the User-Agent reads it; a check run from a copy of this file still works.
    return '0.0.0';
  }
})();
const USER_AGENT = `SprintTicker/${VERSION} (provider-check)`;

/** The client's own budget per request (9): a server slower than this is unreachable to SprintTicker. */
const TIMEOUT_MS = 15000;
const MAX_PAGE_ITEMS = 500;
const MAX_PAGES = 5000;
const MAX_WORKLOG_SECONDS = 90000;
const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const TASK_STATES = ['open', 'closed'];
const EVENT_KINDS = ['assigned', 'mentioned', 'commented', 'status_changed', 'date_alert'];
const KNOWN_CAPABILITIES = ['assign', 'task_state', 'calendar', 'events', 'today_total', 'inbox', 'week_close', 'labels', 'task_by_key'];

/** Section 13's table: the number, what it checks, the rule it names. */
const CHECKS = [
  { n: 1, title: '/capabilities is complete, contract 1, siteUrl https', rule: '5' },
  { n: 2, title: 'A wrong token answers 401', rule: '3.3, 6.1' },
  { n: 3, title: '/me answers a User', rule: '6.1' },
  { n: 4, title: '/projects is a well-formed collection and pages with ?limit=1', rule: '3.7, 6.2' },
  { n: 5, title: 'Every task is well-formed', rule: '4.3' },
  { n: 6, title: 'No task outside the default scope, no closed task', rule: '6.3' },
  { n: 7, title: 'Every url is under siteUrl', rule: '5' },
  { n: 8, title: 'POST /worklogs is idempotent on clientRef', rule: '6.4' },
  { n: 9, title: 'GET /worklogs?clientRef= finds a worklog, and only it', rule: '6.5' },
  { n: 10, title: 'PATCH corrects, keeps the comment, refuses taskId', rule: '6.6' },
  { n: 11, title: 'DELETE answers 204 then 404; the clientRef stays reserved', rule: '6.7, 6.4' },
  { n: 12, title: 'A duration under the minimum answers 422 with field', rule: '6.4, 10.1' },
  { n: 13, title: 'start answers 200 twice in a row', rule: '6.8' },
  { n: 14, title: 'An unknown intent answers 422', rule: '6.8' },
  { n: 15, title: 'Each declared capability answers in its documented shape', rule: '7' },
  { n: 16, title: 'Every error body has code and message', rule: '10.1' }
];

// -- Shapes (3.4)

const isId = v => typeof v === 'string' && v.length >= 1 && v.length <= 128;
const isKey = v => typeof v === 'string' && v.length >= 2 && v.length <= 12 && /^[\x21-\x7E]+$/.test(v);
const isCode = v => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v);
const isInstant = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && !Number.isNaN(Date.parse(v));
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function isLocalDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const pad = n => String(n).padStart(2, '0');
/** The local day on this machine, as the client computes it (3.4). */
const localDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const wholeSecondsIso = ms => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const sameInstant = (a, b) => isInstant(a) && isInstant(b) && Math.floor(Date.parse(a) / 1000) === Math.floor(Date.parse(b) / 1000);
const random = n => crypto.randomBytes(n).toString('hex').toUpperCase().slice(0, n);
const show = value => {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value);
  return text && text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

/** What is wrong with a User (4.1), as phrases. */
function userProblems(user) {
  if (!isObject(user)) return [`is ${show(user)}, not an object with id and displayName`];
  const out = [];
  if (!isId(user.id)) out.push(`id is ${show(user.id)}; it must be a string of 1 to 128 characters (3.4)`);
  if (typeof user.displayName !== 'string' || !user.displayName) out.push(`displayName is ${show(user.displayName)}; it must be non-empty text`);
  return out;
}

/** What is wrong with a Task (4.3), as phrases. `requireState` for the answers that name one task. */
function taskProblems(task, { requireState = false, projectId, labelsOffered = false } = {}) {
  if (!isObject(task)) return [`is ${show(task)}, not a Task object`];
  const out = [];
  if (!isId(task.id)) out.push(`id is ${show(task.id)}; it must be a string of 1 to 128 characters (3.4)`);
  if (!isId(task.projectId)) out.push(`projectId is ${show(task.projectId)}; it is required`);
  else if (projectId !== undefined && task.projectId !== projectId) out.push(`projectId is ${show(task.projectId)} in the list of project ${show(projectId)}; each task of /projects/{projectId}/tasks has that projectId (6.3)`);
  if (!isKey(task.key)) out.push(`key is ${show(task.key)}; a key is 2 to 12 printable ASCII characters with no space, because it is drawn on a 72x16 LED panel whose fonts have only ASCII (3.4)`);
  if (typeof task.title !== 'string') out.push(`title is ${show(task.title)}; it is required text`);
  if (!TASK_STATUSES.includes(task.status)) out.push(`status is ${show(task.status)}; it must be one of todo, in_progress, done -- a closed list of codes, never the server's own status name, which goes in serverStatus (3.5)`);
  if (!('assignee' in task)) out.push('has no assignee field; it is always present, null for nobody, so that "nobody" and "not sent" cannot be confused');
  else if (task.assignee !== null) {
    const p = userProblems(task.assignee);
    if (p.length) out.push(`assignee ${p.join('; ')}`);
  }
  if (task.priorityRank != null && !(Number.isInteger(task.priorityRank) && task.priorityRank >= 0 && task.priorityRank <= 4)) out.push(`priorityRank is ${show(task.priorityRank)}; it is an integer from 0 to 4, or left out`);
  if (task.serverStatus != null && !(isObject(task.serverStatus) && isId(task.serverStatus.id) && typeof task.serverStatus.name === 'string')) out.push(`serverStatus is ${show(task.serverStatus)}; it is { "id", "name" } or left out`);
  if (task.description != null && typeof task.description !== 'string') out.push(`description is ${show(task.description)}; it is plain text or left out`);
  if (task.url != null && typeof task.url !== 'string') out.push(`url is ${show(task.url)}; it is a string or left out`);
  if (task.labels != null) {
    if (!labelsOffered) out.push('carries labels, but /capabilities does not list labels (7.8)');
    else if (!Array.isArray(task.labels) || task.labels.length > 3 || !task.labels.every(l => typeof l === 'string' && [...l].length <= 16)) out.push(`labels is ${show(task.labels)}; at most 3 labels of at most 16 characters (7.8)`);
  }
  if (task.state != null && !TASK_STATES.includes(task.state)) out.push(`state is ${show(task.state)}; it is open or closed`);
  if (requireState && task.state == null) out.push('has no state; an answer about one task always carries state (open or closed), because the task may have been closed since the client last read it (4.3)');
  return out;
}

/** What is wrong with a Worklog (4.4), as phrases. */
function worklogProblems(w) {
  if (!isObject(w)) return [`is ${show(w)}, not a Worklog object`];
  const out = [];
  if (!isId(w.id)) out.push(`id is ${show(w.id)}`);
  if (typeof w.clientRef !== 'string') out.push(`clientRef is ${show(w.clientRef)}`);
  if (!isId(w.taskId)) out.push(`taskId is ${show(w.taskId)}`);
  if (!isInstant(w.startedAt)) out.push(`startedAt is ${show(w.startedAt)}; an instant is ISO 8601 in UTC with Z (3.4)`);
  if (!isLocalDay(w.day)) out.push(`day is ${show(w.day)}; a local day is YYYY-MM-DD`);
  if (!Number.isInteger(w.durationSeconds)) out.push(`durationSeconds is ${show(w.durationSeconds)}; durations are integer seconds`);
  if (typeof w.comment !== 'string') out.push(`comment is ${show(w.comment)}`);
  return out;
}

/** One run's findings, per check: failures fail it, notes do not. */
class Findings {
  constructor() {
    this.byCheck = new Map(CHECKS.map(c => [c.n, { failures: [], notes: [], ran: false }]));
  }
  ran(n) {
    this.byCheck.get(n).ran = true;
  }
  fail(n, rule, message) {
    const c = this.byCheck.get(n);
    c.ran = true;
    c.failures.push(`[${rule}] ${message}`);
  }
  note(n, message) {
    this.byCheck.get(n).notes.push(message);
  }
}

/**
 * Runs every check against `url` and returns `{ ok, findings, server }`.
 * `log` receives the report line by line; `fetchFn` is for a caller with
 * its own transport.
 */
async function runConformanceCheck({ url, token, task, log = console.log, fetchFn = fetch }) {
  if (!url || !token || !task) throw new Error('runConformanceCheck needs url, token and task');
  const base = String(url).replace(/\/+$/, '');
  const f = new Findings();
  /** Every answer of 400 or more, for check 16. */
  const errorAnswers = [];
  /** Every url handed out, `[where, url]`, for check 7. */
  const urls = [];
  /** Worklogs this run made and has not deleted yet. */
  const created = new Set();
  /**
   * Every clientRef this run sent. Cleanup looks each up before giving up on
   * it: a POST whose answer was lost made a worklog whose id nobody heard.
   */
  const sentRefs = new Set();
  /** A worklog answer was lost: the run no longer knows every worklog it left, so today_total is not measured. */
  let lostAnswer = false;

  async function call(method, pathAndQuery, { body, auth = token, retries } = {}) {
    const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
    if (auth !== null) headers.Authorization = `Bearer ${auth}`;
    if (method === 'POST' && pathAndQuery === '/worklogs' && body && body.clientRef) sentRefs.add(body.clientRef);
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    // GETs are retried as the client retries them (9); writes never are here,
    // since a write retried is the double send this check is looking for.
    let attempts = retries ?? (method === 'GET' ? 2 : 0);
    for (;;) {
      let answer;
      try {
        const res = await fetchFn(`${base}${pathAndQuery}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        const text = await res.text();
        let json;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        answer = { status: res.status, json, text, retryAfter: res.headers.get('retry-after') };
      } catch (error) {
        answer = { status: 0, error: error.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : String(error.cause?.message || error.message) };
      }
      const transient = answer.status === 0 || [429, 502, 503, 504].includes(answer.status);
      if (transient && attempts > 0) {
        attempts -= 1;
        const wait = answer.status === 429 && Number(answer.retryAfter) > 0 ? Math.min(Number(answer.retryAfter), 60) * 1000 : 750;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (answer.status >= 400) errorAnswers.push({ method, path: pathAndQuery, ...answer });
      if (answer.status === 0 && method !== 'GET') lostAnswer = true;
      return answer;
    }
  }
  /** How an answer reads in a failure message. */
  const said = a => (a.status === 0 ? `did not answer (${a.error})` : `answered ${a.status}${a.text ? ` ${show(a.json ?? a.text)}` : ''}`);
  const enc = encodeURIComponent;

  /**
   * Reads a whole list (3.7), page by page. Records envelope failures under
   * check `n` and answers `{ items, pages }`, or null when a page failed.
   */
  async function readAll(n, rule, listPath, query = {}) {
    const items = [];
    const seen = new Set();
    let cursor = null;
    let pages = 0;
    const limit = query.limit;
    for (;;) {
      const params = new URLSearchParams(query);
      if (cursor !== null) params.set('cursor', cursor);
      const qs = params.toString();
      const a = await call('GET', `${listPath}${qs ? `?${qs}` : ''}`);
      pages += 1;
      if (a.status !== 200) {
        f.fail(n, rule, `GET ${listPath}${qs ? `?${qs}` : ''} (page ${pages}) ${said(a)}; expected 200 and a collection.`);
        return null;
      }
      if (!isObject(a.json) || !Array.isArray(a.json.items)) {
        f.fail(n, '3.7', `GET ${listPath} answered ${show(a.json ?? a.text)}; every list answers the envelope { "items": [...], "nextCursor": null | "<cursor>" }.`);
        return null;
      }
      const next = a.json.nextCursor;
      if (next === undefined) f.note(n, `GET ${listPath} has no nextCursor field; send "nextCursor": null on the last page (3.7).`);
      else if (next !== null && typeof next !== 'string') {
        f.fail(n, '3.7', `GET ${listPath} answered nextCursor ${show(next)}; it is a string while more pages follow, and null on the last.`);
        return null;
      }
      if (a.json.items.length > MAX_PAGE_ITEMS) f.fail(n, '3.7', `GET ${listPath} answered ${a.json.items.length} items in one page; a page must not exceed ${MAX_PAGE_ITEMS}.`);
      if (limit !== undefined && a.json.items.length > Number(limit)) f.fail(n, '3.7', `GET ${listPath}?limit=${limit} answered ${a.json.items.length} items; with ?limit=<n> the server answers at most n.`);
      items.push(...a.json.items);
      if (typeof next !== 'string') return { items, pages };
      if (seen.has(next) || pages >= MAX_PAGES) {
        f.fail(n, '3.7', `GET ${listPath} keeps answering a nextCursor (${pages} pages read, the same cursor ${seen.has(next) ? 'twice' : 'never ending'}); a read must end with nextCursor null.`);
        return null;
      }
      seen.add(next);
      cursor = next;
    }
  }

  const server = { name: null, version: null };
  let caps = [];
  let site = null;
  let minimum = 1;
  let me = null;
  let projects = [];
  let theTask = null; // the given task, as a list or task_state shows it
  let inboxTaskId = null;

  try {
    // ---------------------------------------------------------------- 1
    {
      f.ran(1);
      let parsedBase = null;
      try {
        parsedBase = new URL(base);
      } catch {
        f.fail(1, '3.1', `${show(url)} is not a URL.`);
      }
      if (parsedBase) {
        const local = ['localhost', '127.0.0.1'].includes(parsedBase.hostname);
        if (parsedBase.protocol !== 'https:' && !(parsedBase.protocol === 'http:' && local)) {
          f.fail(1, '3.2', `the base URL is ${parsedBase.protocol}//; HTTPS is required except on localhost and 127.0.0.1, because the token is a permanent credential and must never travel in clear text.`);
        }
        if (!/\/v1$/.test(parsedBase.pathname)) f.note(1, `the base URL does not end with /v1; it should end with the contract version, such as https://tracker.example.com/sprintticker/v1 (3.1).`);
      }
      const a = await call('GET', '/capabilities');
      if (a.status === 0) {
        // Sixteen verdicts made of the same network error would bury the one
        // thing to fix.
        log(`The server did not answer GET ${base}/capabilities: ${a.error}. Nothing was checked.`);
        return { ok: false, failed: CHECKS.length, findings: f.byCheck, server, unreachable: true };
      }
      const c = a.json;
      if (a.status !== 200 || !isObject(c)) {
        f.fail(1, '5', `GET /capabilities ${said(a)}; expected 200 and the capabilities object. Every other check reads it, so they run on defaults.`);
      } else {
        if (c.contract !== 1) f.fail(1, '5', `contract is ${show(c.contract)}; it must be the integer 1. The client refuses a version it does not know.`);
        if (!isObject(c.server) || typeof c.server.name !== 'string' || !c.server.name) f.fail(1, '5', `server.name is ${show(c.server?.name)}; it is required text, shown to the user as the provider's name.`);
        if (!isObject(c.server) || typeof c.server.version !== 'string') f.fail(1, '5', `server.version is ${show(c.server?.version)}; it is a required string, shown in diagnostics.`);
        else Object.assign(server, { name: c.server.name, version: c.server.version });
        let siteParsed = null;
        try {
          siteParsed = new URL(c.siteUrl);
        } catch {
          f.fail(1, '5', `siteUrl is ${show(c.siteUrl)}; it is required: https:// and a host, the server's web interface.`);
        }
        if (siteParsed) {
          const local = ['localhost', '127.0.0.1'].includes(siteParsed.hostname);
          if (siteParsed.protocol === 'https:' || (siteParsed.protocol === 'http:' && local)) site = siteParsed;
          else f.fail(1, '5', `siteUrl is ${show(c.siteUrl)}; it must be https:// (http:// only on localhost). The client opens a task's url only on this origin, and only over http(s).`);
        }
        if (!Number.isInteger(c.minimumWorklogSeconds) || c.minimumWorklogSeconds < 1) f.fail(1, '5', `minimumWorklogSeconds is ${show(c.minimumWorklogSeconds)}; it is a required integer of at least 1 (1 if any duration works).`);
        else if (c.minimumWorklogSeconds >= MAX_WORKLOG_SECONDS) f.fail(1, '5', `minimumWorklogSeconds is ${c.minimumWorklogSeconds}; no worklog could be recorded, since the longest is ${MAX_WORKLOG_SECONDS} s (6.4).`);
        else minimum = c.minimumWorklogSeconds;
        if (!Array.isArray(c.capabilities) || !c.capabilities.every(isCode)) f.fail(1, '5', `capabilities is ${show(c.capabilities)}; it is a required array of capability codes, empty if none.`);
        else {
          caps = c.capabilities;
          const unknown = caps.filter(x => !KNOWN_CAPABILITIES.includes(x));
          if (unknown.length) f.note(1, `capabilities the client does not know and will ignore: ${unknown.join(', ')} (3.5).`);
        }
        if (caps.includes('inbox')) {
          if (!isId(c.inboxTaskId)) f.fail(1, '5', `inbox is listed but inboxTaskId is ${show(c.inboxTaskId)}; with inbox it names the task that receives unplanned time (7.6).`);
          else inboxTaskId = c.inboxTaskId;
        }
        if (c.eventsInboxUrl != null) urls.push(['/capabilities eventsInboxUrl', c.eventsInboxUrl]);
      }
    }

    // ---------------------------------------------------------------- 3
    {
      f.ran(3);
      const a = await call('GET', '/me');
      if (a.status !== 200) f.fail(3, '6.1', `GET /me ${said(a)}; expected 200 and the User the token belongs to.`);
      else {
        const p = userProblems(a.json);
        if (p.length) f.fail(3, '4.1', `GET /me: the User ${p.join('; ')}.`);
        else me = a.json;
      }
    }

    // ---------------------------------------------------------------- 4
    {
      f.ran(4);
      const all = await readAll(4, '6.2', '/projects');
      if (all) {
        const ids = new Set();
        for (const p of all.items) {
          const problems = [];
          if (!isObject(p)) problems.push(`is ${show(p)}`);
          else {
            if (!isId(p.id)) problems.push(`id is ${show(p.id)}`);
            if (!isKey(p.key)) problems.push(`key is ${show(p.key)}; a key is 2 to 12 printable ASCII characters with no space (3.4)`);
            if (typeof p.name !== 'string' || !p.name) problems.push(`name is ${show(p.name)}; it is required text`);
            if (ids.has(p.id)) problems.push('appears twice in one read');
            ids.add(p.id);
          }
          if (problems.length) f.fail(4, '4.2', `the project ${show(p?.id ?? p)} ${problems.join('; ')}.`);
        }
        projects = all.items.filter(p => isObject(p) && isId(p.id));
        if (!projects.length) f.note(4, 'GET /projects answered no project, so the task checks (5 to 7) have nothing to read.');
        const paged = await readAll(4, '3.7', '/projects', { limit: 1 });
        if (paged) {
          const a1 = all.items.map(p => p?.id);
          const b1 = paged.items.map(p => p?.id);
          const missing = a1.filter(id => !b1.includes(id));
          const extra = b1.filter(id => !a1.includes(id));
          if (missing.length || extra.length || a1.length !== b1.length) {
            f.fail(4, '3.7', `reading /projects with ?limit=1 gave ${b1.length} projects over ${paged.pages} pages, against ${a1.length} without it` +
              `${missing.length ? `; missing ${show(missing.slice(0, 5))}` : ''}${extra.length ? `; extra or repeated ${show(extra.slice(0, 5))}` : ''}. ` +
              'Paging with nextCursor must walk the same set, each item once.');
          } else if (a1.join('\u0000') !== b1.join('\u0000')) {
            f.note(4, 'the order of /projects differs between page sizes; the order should be stable, as it is what the client keeps for equal tasks (3.7).');
          }
        }
      }
    }

    // ---------------------------------------------------------------- 5, 6, 7 (tasks)
    {
      f.ran(5);
      f.ran(6);
      const seen = new Map();
      for (const project of projects) {
        const list = await readAll(5, '6.3', `/projects/${enc(project.id)}/tasks`);
        if (!list) continue;
        for (const t of list.items) {
          const p = taskProblems(t, { projectId: project.id, labelsOffered: caps.includes('labels') });
          if (p.length) f.fail(5, '4.3', `the task ${show(t?.key ?? t?.id)} in project ${show(project.id)} ${p.join('; ')}.`);
          if (!isObject(t)) continue;
          if (seen.has(t.id)) f.fail(5, '4.3', `the task ${show(t.id)} is listed in project ${show(seen.get(t.id))} and in ${show(project.id)}; a task belongs to exactly one project.`);
          seen.set(t.id, project.id);
          if (typeof t.url === 'string') urls.push([`task ${t.key ?? t.id}`, t.url]);
          if (t.id === task) theTask = t;
          if (t.state === 'closed') {
            f.fail(6, '6.3', `the task ${show(t.key ?? t.id)} is listed with state closed; a closed task is never listed. A listed task is always open.`);
          } else if (me && isObject(t.assignee) && t.assignee.id !== me.id && t.status !== 'in_progress') {
            // 6.3 lets a server return more than the default scope -- the
            // client applies the rule after reading -- so this is reported,
            // not failed, despite section 13's wording (see the report).
            f.note(6, `the task ${show(t.key ?? t.id)} is ${t.assignee.displayName}'s and ${t.status}, outside the default scope; allowed (6.3: the server may return more), and the client drops it.`);
          }
        }
      }
      if (!me) f.note(6, 'the default scope could not be checked: /me did not answer a User (check 3).');
    }

    // ---------------------------------------------------------------- 2
    {
      f.ran(2);
      const wrong = `provider-check-wrong-${random(16)}`;
      const targets = ['/capabilities', '/me', '/projects'];
      const project = (theTask && theTask.projectId) || (projects[0] && projects[0].id);
      if (project) targets.push(`/projects/${enc(project)}/tasks`);
      else f.note(2, 'no project to read a task list from; the task list was not tried with a wrong token.');
      for (const target of targets) {
        const a = await call('GET', target, { auth: wrong, retries: 0 });
        if (a.status !== 401) {
          const empty = a.status === 200 && isObject(a.json) && Array.isArray(a.json.items) && a.json.items.length === 0;
          f.fail(2, '3.3', `GET ${target} with a wrong token ${said(a)}; it must answer 401, never 200.` +
            (empty ? ' An empty list for a bad token is exactly what Jira Cloud does, and SprintTicker read it as "this user has no projects" and emptied the user\'s lists at every sync (6.1).' : ''));
        }
      }
      const none = await call('GET', '/me', { auth: null, retries: 0 });
      if (none.status !== 401) f.fail(2, '3.3', `GET /me with no Authorization header ${said(none)}; a missing token answers 401.`);
    }

    // ---------------------------------------------------------------- 8 to 12 (worklogs)
    const startedAtMs = Math.floor(Date.now() / 1000) * 1000 - 3 * 3600 * 1000;
    const day = localDay(new Date(startedAtMs));
    const marker = `[#PC${random(6)}]`;
    // Text beyond ASCII and two spaces in a row: "stored exactly as sent" is
    // only tested by a comment a careless server would change.
    const comment = `SprintTicker conformance check -- café, 時間, \u{1F552}  two spaces ${marker}`;
    const ref = `pc_${random(20)}`;
    const d1 = Math.min(Math.max(minimum, 60), MAX_WORKLOG_SECONDS - 180);
    const d2 = d1 + 60;
    const worklog = { clientRef: ref, taskId: task, startedAt: wholeSecondsIso(startedAtMs), day, durationSeconds: d1, comment };
    let worklogId = null;
    let totalBefore = null;

    if (caps.includes('today_total')) {
      const a = await call('GET', `/worklogs/summary?day=${day}`);
      if (a.status === 200 && isObject(a.json) && Number.isInteger(a.json.totalSeconds)) totalBefore = a.json.totalSeconds;
    }

    // 8
    {
      f.ran(8);
      let a = await call('POST', '/worklogs', { body: worklog });
      if (a.status === 0) {
        // What the client does when an answer is lost (6.4): send it again.
        // On a conforming server the resend answers 200 and the first id,
        // whether or not the first one was recorded.
        f.note(8, `the first POST /worklogs ${said(a)}; it was sent again, as the client would.`);
        const resent = await call('POST', '/worklogs', { body: worklog });
        if (resent.status === 200 || resent.status === 201) a = { ...resent, status: 201 };
        else a = resent;
      }
      if (a.status === 201 || a.status === 200) {
        if (a.json && isId(a.json.id)) {
          worklogId = a.json.id;
          created.add(worklogId);
        }
      }
      if (a.status !== 201) {
        f.fail(8, '6.4', `POST /worklogs with a new clientRef on the task ${show(task)} ${said(a)}; expected 201 and { "id" }.` +
          (a.status === 404 ? ' 404 says the token\'s user cannot see this task: give --task a task they may log time on.' : '') +
          (a.status === 200 ? ' 200 means "this clientRef already exists", which it cannot: it is new.' : ''));
      } else if (!worklogId) {
        f.fail(8, '6.4', `POST /worklogs answered 201 with ${show(a.json)}; the body is { "id": "<worklog id>" }.`);
      }
      if (worklogId) {
        const again = await call('POST', '/worklogs', { body: worklog });
        if (again.json && isId(again.json.id) && again.json.id !== worklogId) created.add(again.json.id);
        if (again.status !== 200 || !again.json || again.json.id !== worklogId) {
          f.fail(8, '6.4', `the same POST /worklogs sent again (same clientRef ${ref}) ${said(again)}; expected 200 and the first id ${show(worklogId)}. ` +
            'Sending can fail after the server recorded the worklog -- a timeout, a dropped connection -- and the client sends again; without this the user is billed twice. Enforce it with a unique constraint on (user, clientRef).');
        }
        const changed = await call('POST', '/worklogs', { body: { ...worklog, durationSeconds: d2 } });
        if (changed.json && isId(changed.json.id) && changed.json.id !== worklogId) created.add(changed.json.id);
        if (changed.status !== 200 || !changed.json || changed.json.id !== worklogId) {
          f.fail(8, '6.4', `POST /worklogs under the same clientRef with durationSeconds ${d2} instead of ${d1} ${said(changed)}; expected 200 and the first id. A resend may differ from the first send: the user corrected it while it waited in the queue.`);
        } else {
          const read = await call('GET', `/worklogs?clientRef=${enc(ref)}`);
          const stored = read.status === 200 && isObject(read.json) && Array.isArray(read.json.items) ? read.json.items[0] : undefined;
          if (!stored || stored.durationSeconds !== d2) {
            f.fail(8, '6.4', `after a resend with durationSeconds ${d2}, GET /worklogs?clientRef= reads ${show(stored?.durationSeconds)}; a resend under a known clientRef makes the stored worklog match the request.`);
          }
        }
      }
      // Two at once: the client may send again while the first is still being processed.
      const ref2 = `pc_${random(20)}`;
      const pair = { ...worklog, clientRef: ref2, comment: `SprintTicker conformance check, concurrent pair [#PC${random(6)}]` };
      const [x, y] = await Promise.all([call('POST', '/worklogs', { body: pair }), call('POST', '/worklogs', { body: pair })]);
      for (const r of [x, y]) if (r.json && isId(r.json.id)) created.add(r.json.id);
      const statuses = [x.status, y.status].sort().join(' and ');
      if (![x, y].every(r => r.status === 200 || r.status === 201)) {
        f.fail(8, '6.4', `two identical POST /worklogs sent at the same moment answered ${statuses} (${said(x.status >= 300 || x.status === 0 ? x : y)}); expected one 201 and one 200 with the same id.`);
      } else {
        const read = await call('GET', `/worklogs?clientRef=${enc(ref2)}`);
        const count = read.status === 200 && isObject(read.json) && Array.isArray(read.json.items) ? read.json.items.length : null;
        if (x.json?.id !== y.json?.id || statuses !== '200 and 201' || count !== 1) {
          f.fail(8, '6.4', `two identical POST /worklogs sent at the same moment answered ${statuses} with ids ${show(x.json?.id)} and ${show(y.json?.id)}, and GET /worklogs?clientRef= then finds ${count ?? 'no readable list:'} ${count === 1 ? 'worklog' : 'worklogs'}; ` +
            'expected one 201, one 200, the same id, and one worklog. Two requests that both read "not there" both create: the uniqueness must be a constraint on (user, clientRef), not a read before the write.');
        }
      }
    }

    // 9
    if (worklogId) {
      f.ran(9);
      const found = await call('GET', `/worklogs?clientRef=${enc(ref)}`);
      const items = found.status === 200 && isObject(found.json) && Array.isArray(found.json.items) ? found.json.items : null;
      if (!items) f.fail(9, '6.5', `GET /worklogs?clientRef=${ref} ${said(found)}; expected 200 and a collection.`);
      else if (items.length !== 1) f.fail(9, '6.5', `GET /worklogs?clientRef=${ref} answered ${items.length} items; it holds the one worklog with that clientRef.`);
      else {
        const w = items[0];
        const p = worklogProblems(w);
        if (p.length) f.fail(9, '4.4', `the worklog found ${p.join('; ')}.`);
        const wrong = [];
        if (w.id !== worklogId) wrong.push(`id ${show(w.id)}, not ${show(worklogId)}`);
        if (w.clientRef !== ref) wrong.push(`clientRef ${show(w.clientRef)}`);
        if (w.taskId !== task) wrong.push(`taskId ${show(w.taskId)}`);
        if (!sameInstant(w.startedAt, worklog.startedAt)) wrong.push(`startedAt ${show(w.startedAt)}, sent ${worklog.startedAt}`);
        if (w.day !== day) wrong.push(`day ${show(w.day)}, sent ${day} -- the day is the client's, never recomputed from startedAt in the server's timezone`);
        if (w.comment !== comment) wrong.push(`comment ${show(w.comment)}, sent ${show(comment)} -- stored exactly as sent, byte for byte`);
        if (wrong.length) f.fail(9, '6.4', `the worklog found by its clientRef holds ${wrong.join('; ')}.`);
      }
      const unknown = await call('GET', `/worklogs?clientRef=pc_unknown_${random(12)}`);
      if (unknown.status !== 200 || !isObject(unknown.json) || !Array.isArray(unknown.json.items) || unknown.json.items.length !== 0) {
        f.fail(9, '6.5', `GET /worklogs?clientRef= with a reference nobody sent ${said(unknown)}; expected 200 and { "items": [] }. An unknown clientRef is never 404.`);
      }
    } else f.note(9, 'not run: check 8 made no worklog to look for.');

    // 10
    if (worklogId) {
      f.ran(10);
      const d3 = d2 + 60;
      const a = await call('PATCH', `/worklogs/${enc(worklogId)}`, { body: { durationSeconds: d3 } });
      if (a.status !== 200) f.fail(10, '6.6', `PATCH /worklogs/${worklogId} { durationSeconds: ${d3} } ${said(a)}; expected 200 and the whole Worklog as now stored.`);
      else {
        const p = worklogProblems(a.json);
        if (p.length) f.fail(10, '6.6', `the PATCH answered a Worklog that ${p.join('; ')}; it answers the whole Worklog (4.4).`);
        if (a.json?.durationSeconds !== d3) f.fail(10, '6.6', `after PATCH { durationSeconds: ${d3} } the worklog says ${show(a.json?.durationSeconds)}.`);
        if (a.json?.comment !== comment) f.fail(10, '6.6', `a PATCH of the duration alone changed the comment to ${show(a.json?.comment)}; fields left out keep their value, and the comment is kept byte for byte (it ends with the marker that finds the entry).`);
        if (a.json?.day !== day) f.fail(10, '6.6', `a PATCH of the duration alone changed day to ${show(a.json?.day)}.`);
      }
      for (const fixed of [{ taskId: task }, { clientRef: ref }]) {
        const name = Object.keys(fixed)[0];
        const r = await call('PATCH', `/worklogs/${enc(worklogId)}`, { body: fixed });
        if (r.status !== 422) f.fail(10, '6.6', `PATCH /worklogs/${worklogId} carrying ${name} ${said(r)}; expected 422 -- a worklog is corrected, never moved, and sending ${name} answers 422 even with its current value.`);
      }
    } else f.note(10, 'not run: check 8 made no worklog to correct.');

    // 11
    if (worklogId) {
      f.ran(11);
      const del = await call('DELETE', `/worklogs/${enc(worklogId)}`);
      if (del.status === 204) created.delete(worklogId);
      if (del.status !== 204) f.fail(11, '6.7', `DELETE /worklogs/${worklogId} ${said(del)}; expected 204 and no body.`);
      else if (del.text) f.fail(11, '6.7', `DELETE /worklogs/${worklogId} answered 204 with a body; 204 has none.`);
      const again = await call('DELETE', `/worklogs/${enc(worklogId)}`);
      if (again.status !== 404) f.fail(11, '6.7', `DELETE /worklogs/${worklogId} a second time ${said(again)}; a worklog that no longer exists answers 404, which the client counts as deleted.`);
      const resend = await call('POST', '/worklogs', { body: worklog });
      if (resend.json && isId(resend.json.id) && resend.json.id !== worklogId) created.add(resend.json.id);
      if (resend.status !== 200 || resend.json?.id !== worklogId) {
        f.fail(11, '6.4', `POST /worklogs with the deleted worklog's clientRef ${said(resend)}; expected 200 with the old id ${show(worklogId)}, creating nothing. A clientRef is unique per user forever, including after deletion: the resend of a send whose answer was lost must not bring deleted time back.`);
      }
      const read = await call('GET', `/worklogs?clientRef=${enc(ref)}`);
      if (read.status !== 200 || !isObject(read.json) || !Array.isArray(read.json.items) || read.json.items.length !== 0) {
        f.fail(11, '6.5', `after deleting it, GET /worklogs?clientRef=${ref} ${said(read)}; a deleted worklog is no longer found -- 200 and no item.`);
      }
    } else f.note(11, 'not run: check 8 made no worklog to delete.');

    // 12
    {
      f.ran(12);
      const short = minimum - 1;
      const a = await call('POST', '/worklogs', { body: { ...worklog, clientRef: `pc_${random(20)}`, durationSeconds: short } });
      if (a.json && isId(a.json.id)) created.add(a.json.id);
      if (a.status !== 422) f.fail(12, '6.4', `POST /worklogs with durationSeconds ${short}, under minimumWorklogSeconds ${minimum}, ${said(a)}; expected 422 validation_failed.`);
      else if (a.json?.error?.field !== 'durationSeconds') f.fail(12, '10.1', `the 422 for a short duration carries field ${show(a.json?.error?.field)}; validation_failed names the request field at fault: "field": "durationSeconds".`);
    }

    // 13
    {
      f.ran(13);
      if (theTask && me && isObject(theTask.assignee) && theTask.assignee.id !== me.id) {
        f.note(13, `the task given is ${theTask.assignee.displayName}'s; the client sends start only for the user's own task (6.8). Give the check a task of the token's user.`);
      }
      for (const time of ['first', 'second']) {
        const a = await call('POST', `/tasks/${enc(task)}/transitions`, { body: { intent: 'start' } });
        if (a.status !== 200) {
          f.fail(13, '6.8', `POST /tasks/${task}/transitions { "intent": "start" }, the ${time} time, ${said(a)}; expected 200 and the Task.` +
            (time === 'second' ? ' An intent the task already satisfies changes nothing and answers 200: SprintTicker restarts a task after every stand-up and lunch.' : ''));
          continue;
        }
        const p = taskProblems(a.json, { requireState: true, labelsOffered: caps.includes('labels') });
        if (p.length) f.fail(13, '4.3', `the Task answered by start ${p.join('; ')}.`);
        if (isObject(a.json)) {
          if (typeof a.json.url === 'string') urls.push(['the start transition', a.json.url]);
          if (a.json.state === 'closed') {
            if (time === 'first') f.note(13, 'the task given is closed, so start changed nothing, as it must; give the check an open task to see it move.');
          }
          else if (a.json.status !== 'in_progress') f.fail(13, '6.8', `after start the task's status is ${show(a.json.status)}; start moves it to the status that means "being worked on": in_progress.`);
          if (!theTask) theTask = a.json;
        }
      }
    }

    // 14
    {
      f.ran(14);
      const a = await call('POST', `/tasks/${enc(task)}/transitions`, { body: { intent: 'provider_check_unknown' } });
      if (a.status !== 422) f.fail(14, '6.8', `POST /tasks/${task}/transitions with the intent "provider_check_unknown" ${said(a)}; intents are a closed list (start, finish) and an unknown one answers 422.`);
    }

    // 15
    {
      f.ran(15);
      const has = c => caps.includes(c);
      if (!caps.length) f.note(15, 'no capability declared: nothing optional to check.');

      if (has('task_state')) {
        const a = await call('GET', `/tasks/${enc(task)}`);
        if (a.status !== 200) f.fail(15, '7.2', `GET /tasks/${task} ${said(a)}; with task_state it answers the Task, closed or not, with state.`);
        else {
          const p = taskProblems(a.json, { requireState: true, labelsOffered: has('labels') });
          if (p.length) f.fail(15, '7.2', `GET /tasks/${task}: the Task ${p.join('; ')}.`);
          else if (a.json.id !== task) f.fail(15, '7.2', `GET /tasks/${task} answered the task ${show(a.json.id)}.`);
          if (isObject(a.json) && typeof a.json.url === 'string') urls.push([`GET /tasks/${task}`, a.json.url]);
          if (isObject(a.json) && (!theTask || !theTask.key)) theTask = a.json;
        }
        const gone = await call('GET', `/tasks/provider-check-none-${random(10).toLowerCase()}`);
        if (gone.status !== 404) f.fail(15, '7.2', `GET /tasks/<an id that names nothing> ${said(gone)}; a task deleted, or never there, answers 404.`);
        if (inboxTaskId) {
          const inbox = await call('GET', `/tasks/${enc(inboxTaskId)}`);
          if (inbox.status !== 200) f.fail(15, '7.6', `GET /tasks/${inboxTaskId}, the inboxTaskId, ${said(inbox)}; the inbox task is a task the user can see.`);
        }
      }

      if (has('task_by_key')) {
        if (theTask && isKey(theTask.key)) {
          const typed = theTask.key.toLowerCase() === theTask.key ? theTask.key.toUpperCase() : theTask.key.toLowerCase();
          const a = await call('GET', `/tasks?key=${enc(typed)}`);
          if (a.status !== 200) f.fail(15, '7.9', `GET /tasks?key=${typed} ${said(a)}; expected 200 and the task ${show(theTask.key)} -- the key is compared without regard to case.`);
          else {
            const p = taskProblems(a.json, { requireState: true, labelsOffered: has('labels') });
            if (p.length) f.fail(15, '7.9', `GET /tasks?key=: the Task ${p.join('; ')}.`);
            else if (a.json.id !== task) f.fail(15, '7.9', `GET /tasks?key=${typed} answered the task ${show(a.json.id)}, not ${show(task)}.`);
          }
        } else f.note(15, 'task_by_key: the given task\'s key is unknown (not listed, no task_state), so only the unknown key was tried.');
        const none = await call('GET', `/tasks?key=NO-${random(8)}`);
        if (none.status !== 404) f.fail(15, '7.9', `GET /tasks?key=<a key no task has> ${said(none)}; expected 404.`);
      }

      if (has('assign')) {
        const mine = theTask && me && isObject(theTask.assignee) && theTask.assignee.id === me.id;
        if (mine && theTask.state === 'closed') {
          const a = await call('POST', `/tasks/${enc(task)}/assignment`, { body: { ifUnassigned: true } });
          if (a.status !== 409 || a.json?.error?.code !== 'workflow_refused') f.fail(15, '7.1', `POST /tasks/${task}/assignment on a closed task ${said(a)}; a closed task answers 409 workflow_refused and changes nothing.`);
        } else if (mine) {
          const a = await call('POST', `/tasks/${enc(task)}/assignment`, { body: { ifUnassigned: true } });
          if (a.status !== 200 || a.json?.outcome !== 'already_mine') f.fail(15, '7.1', `POST /tasks/${task}/assignment on a task already the user's ${said(a)}; expected 200 { "outcome": "already_mine", "task": <Task> }.`);
          else {
            const p = taskProblems(a.json.task, { requireState: true, labelsOffered: has('labels') });
            if (p.length) f.fail(15, '7.1', `the assignment's task ${p.join('; ')}.`);
          }
        } else f.note(15, 'assign: the given task is not the user\'s, so the assignment was not sent -- it would take the task. Only the refused request was tried.');
        const bad = await call('POST', `/tasks/${enc(task)}/assignment`, { body: {} });
        if (bad.status !== 422) f.fail(15, '7.1', `POST /tasks/${task}/assignment without ifUnassigned ${said(bad)}; ifUnassigned is always true in v1, and a request without it answers 422.`);
      }

      if (has('calendar')) {
        const today = localDay(new Date());
        const from = addDays(today, -7);
        const to = addDays(today, 28);
        const a = await call('GET', `/calendar/non-working-days?from=${from}&to=${to}`);
        if (a.status !== 200 || !isObject(a.json) || !Array.isArray(a.json.days)) f.fail(15, '7.3', `GET /calendar/non-working-days?from=${from}&to=${to} ${said(a)}; expected 200 { "days": [ "YYYY-MM-DD", ... ] }.`);
        else {
          const bad = a.json.days.filter(d => !isLocalDay(d) || d < from || d > to);
          if (bad.length) f.fail(15, '7.3', `the calendar answered ${show(bad.slice(0, 5))}; each day is YYYY-MM-DD between from and to, both included.`);
        }
        const far = await call('GET', `/calendar/non-working-days?from=${today}&to=${addDays(today, 401)}`);
        if (far.status !== 422) f.fail(15, '7.3', `GET /calendar/non-working-days for 401 days ${said(far)}; from and to are at most 400 days apart, and more answers 422.`);
      }

      if (has('events')) {
        const since = wholeSecondsIso(Date.now() - 3600 * 1000);
        const all = await readAll(15, '7.4', '/events', { since });
        if (all) {
          for (const e of all.items) {
            const p = [];
            if (!isObject(e)) p.push(`is ${show(e)}`);
            else {
              if (!isId(e.id)) p.push(`id is ${show(e.id)}`);
              if (!EVENT_KINDS.includes(e.kind)) p.push(`kind is ${show(e.kind)}; a server sends only the kinds listed in 4.5 -- the client drops any other`);
              if (!isObject(e.task) || !isId(e.task.id) || typeof e.task.key !== 'string' || typeof e.task.title !== 'string') p.push(`task is ${show(e.task)}; it is { "id", "key", "title" }`);
              if (e.actor != null) {
                const u = userProblems(e.actor);
                if (u.length) p.push(`actor ${u.join('; ')}`);
                else if (me && e.actor.id === me.id) p.push('was caused by the user; events never include the user\'s own actions -- SprintTicker moves statuses for the user, and each move would come back as a notification');
              }
              if (e.summary != null && (typeof e.summary !== 'string' || [...e.summary].length > 300)) p.push('summary is not text of at most 300 characters');
              if (!isInstant(e.occurredAt)) p.push(`occurredAt is ${show(e.occurredAt)}`);
              else if (Date.parse(e.occurredAt) < Date.parse(since)) p.push(`occurredAt ${e.occurredAt} is before since=${since}; events are at or after since`);
              if (typeof e.url === 'string') urls.push([`event ${e.id}`, e.url]);
            }
            if (p.length) f.fail(15, '4.5', `the event ${show(e?.id)} ${p.join('; ')}.`);
          }
        }
        const bad = await call('GET', '/events?since=yesterday');
        if (bad.status !== 422) f.fail(15, '7.4', `GET /events?since=yesterday ${said(bad)}; since must be an Instant, and anything else answers 422.`);
      }

      if (has('today_total')) {
        const a = await call('GET', `/worklogs/summary?day=${day}`);
        if (a.status !== 200 || !isObject(a.json) || a.json.day !== day || !Number.isInteger(a.json.totalSeconds) || a.json.totalSeconds < 0) {
          f.fail(15, '7.5', `GET /worklogs/summary?day=${day} ${said(a)}; expected 200 { "day": "${day}", "totalSeconds": <integer> }.`);
        }
        const bad = await call('GET', '/worklogs/summary?day=2026-02-30');
        if (bad.status !== 422) f.fail(15, '7.5', `GET /worklogs/summary?day=2026-02-30 ${said(bad)}; a day that is not a real date answers 422.`);
      }

      if (has('week_close')) {
        // Never the 200 path: on a real server that submits the user's timesheet.
        const a = await call('POST', '/weeks/not-a-day/close', { body: { workingDays: [] } });
        if (a.status !== 422) f.fail(15, '7.7', `POST /weeks/not-a-day/close ${said(a)}; a weekStart that is not a Monday as YYYY-MM-DD answers 422. (The check never closes a real week.)`);
        f.note(15, 'week_close: only the refused request is tried -- closing a week would submit the user\'s timesheet.');
      }
    }

    // today_total, measured: the sum moves by what was recorded. The worklogs
    // of check 8 are deleted by now except the concurrent pair's, so the sum
    // read here is before + d1 for that pair, if the server is right.
    if (caps.includes('today_total') && totalBefore !== null && !lostAnswer) {
      const a = await call('GET', `/worklogs/summary?day=${day}`);
      if (a.status === 200 && Number.isInteger(a.json?.totalSeconds) && created.size === 1) {
        const expected = totalBefore + d1;
        if (a.json.totalSeconds !== expected) {
          f.fail(15, '7.5', `GET /worklogs/summary?day=${day} reads ${a.json.totalSeconds} s; before the check it read ${totalBefore} s, and the check now leaves one worklog of ${d1} s on that day, so ${expected} s -- unless something else recorded time on that day meanwhile. The sum covers every worklog of the user on that day, and none deleted.`);
        }
      }
    }
  } finally {
    // Every worklog this run made goes, whatever failed above -- including
    // one whose answer was lost, found by the clientRef it was sent under.
    for (const sent of sentRefs) {
      const found = await call('GET', `/worklogs?clientRef=${enc(sent)}`);
      if (found.status === 200 && isObject(found.json) && Array.isArray(found.json.items)) {
        for (const w of found.json.items) if (isObject(w) && isId(w.id)) created.add(w.id);
      }
    }
    const left = [];
    for (const id of created) {
      const a = await call('DELETE', `/worklogs/${enc(id)}`);
      if (a.status !== 204 && a.status !== 404) left.push(`${id} (${said(a)})`);
    }
    if (left.length) log(`The check could not delete these worklogs; remove them by hand: ${left.join(', ')}`);
  }

  // ---------------------------------------------------------------- 7
  f.ran(7);
  if (!site) f.note(7, 'siteUrl unknown (check 1), so no url could be checked against it.');
  else {
    for (const [where, u] of urls) {
      let parsed = null;
      try {
        parsed = new URL(u);
      } catch {
        f.fail(7, '5', `${where}: url ${show(u)} is not an absolute URL; urls are under siteUrl ${site.href}.`);
        continue;
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== site.origin) {
        f.fail(7, '5', `${where}: url ${show(u)} is not on siteUrl's origin ${site.origin}; the client opens only http(s) urls on that origin, since opening whatever a server names would let it launch any program registered for a URL scheme.`);
      } else if (!parsed.pathname.startsWith(site.pathname.replace(/\/?$/, '/')) && site.pathname !== '/') {
        f.note(7, `${where}: url ${show(u)} is on siteUrl's origin but outside its path ${site.pathname}.`);
      }
    }
  }

  // ---------------------------------------------------------------- 16
  f.ran(16);
  for (const a of errorAnswers) {
    const e = isObject(a.json) ? a.json.error : undefined;
    const problems = [];
    if (!isObject(e)) problems.push('has no "error" object');
    else {
      if (!isCode(e.code)) problems.push(`error.code is ${show(e.code)}; a lowercase snake_case code such as not_found or validation_failed`);
      if (typeof e.message !== 'string' || !e.message) problems.push(`error.message is ${show(e.message)}; text for the user saying what went wrong`);
      if (e.field != null && typeof e.field !== 'string') problems.push(`error.field is ${show(e.field)}`);
    }
    if (problems.length) {
      f.fail(16, '10.1', `${a.method} ${a.path} answered ${a.status} with ${show(a.json ?? a.text)}: it ${problems.join('; ')}. Every status of 400 or more carries { "error": { "code", "message" } }.`);
    }
  }

  // ---------------------------------------------------------------- the report
  log('SprintTicker Provider API conformance check, contract v1');
  log(`Base URL:     ${base}`);
  log(`Server:       ${server.name ? `${server.name} ${server.version}` : 'unknown'}`);
  log(`Capabilities: ${caps.length ? caps.join(', ') : 'none'}`);
  log(`Task:         ${task}${theTask && theTask.key ? ` (${theTask.key})` : ''}`);
  log('');
  let failed = 0;
  for (const check of CHECKS) {
    const c = f.byCheck.get(check.n);
    const verdict = c.failures.length ? 'FAIL' : c.ran ? 'PASS' : 'SKIP';
    if (c.failures.length) failed += 1;
    log(`${verdict}  ${String(check.n).padStart(2)}  ${check.title} (${check.rule})`);
    for (const failure of c.failures) log(`          - ${failure}`);
    for (const note of c.notes) log(`          note: ${note}`);
  }
  log('');
  log(`${CHECKS.length} checks: ${CHECKS.length - failed} passed, ${failed} failed.`);
  if (failed) log('Section 12 of PROVIDER-API.md lists what this check cannot see; it applies in full.');
  return { ok: failed === 0, failed, findings: f.byCheck, server };
}

/** Parses `--name value` and `--flag`; `--fake-fault` may repeat. */
function parseArgs(argv) {
  const out = { faults: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--url') out.url = value();
    else if (arg === '--token') out.token = value();
    else if (arg === '--task') out.task = value();
    else if (arg === '--fake') out.fake = true;
    else if (arg === '--fake-fault') out.faults.push(value());
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

/** `name`, `name=3`, `name=true`, `failPage=/projects@2`, `takeOnAssign=Rin Tanaka`, as the fake's options. */
function faultOptions(faults, defaults) {
  const out = {};
  for (const fault of faults) {
    const [name, raw] = fault.includes('=') ? [fault.slice(0, fault.indexOf('=')), fault.slice(fault.indexOf('=') + 1)] : [fault, undefined];
    if (name === 'failPage') {
      const [p, page] = raw.includes('@') ? raw.split('@') : [undefined, raw];
      out.failPage = { path: p, page: Number(page) };
    } else if (name === 'takeOnAssign') out.takeOnAssign = { id: 'u-3', displayName: raw || 'Rin Tanaka' };
    else if (Array.isArray(defaults[name])) out[name] = (raw || '').split(',').filter(Boolean);
    else if (raw === undefined || raw === 'true') out[name] = true;
    else if (raw === 'false') out[name] = false;
    else if (/^\d+$/.test(raw)) out[name] = Number(raw);
    else out[name] = raw;
  }
  return out;
}

/** The fake, in this process: started, seeded with a task, checked, stopped. */
async function runAgainstFake(faults, log = console.log) {
  const { createFakeProviderApi, DEFAULT_OPTIONS } = require('./fake-provider-api.js');
  const { closedTasks = [], ...options } = faultOptions(faults, DEFAULT_OPTIONS);
  for (const key of Object.keys(options)) {
    if (!(key in DEFAULT_OPTIONS)) throw new Error(`The fake has no switch ${key}`);
  }
  // Every capability on, and something for each to answer -- an event, a
  // day off, a label -- so no branch of the check passes for having nothing
  // to read. A fault may still turn one off.
  const { ALL_CAPABILITIES } = require('./fake-provider-api.js');
  const today = localDay(new Date());
  const fake = createFakeProviderApi({ quiet: true, capabilities: ALL_CAPABILITIES, nonWorkingDays: [addDays(today, 3), addDays(today, 90)], ...options });
  const url = await fake.listen(0);
  const taskId = 't-conformance';
  fake.addTask({ id: taskId, projectId: fake.state.projects[0].id, key: 'CHK-1', title: 'Conformance check task', status: 'todo', labels: ['Check'] });
  fake.addEvent({ kind: 'commented', taskId, summary: 'Seeded by the conformance check' });
  // The user's own action: stored, and never served (7.4).
  fake.addEvent({ kind: 'status_changed', taskId, actor: fake.state.me });
  // After the seed, so `closedTasks=t-conformance` can close the check's own task.
  for (const id of closedTasks) fake.closeTask(id);
  try {
    if (faults.length) log(`Fake server faults on: ${faults.join(', ')}\n`);
    const result = await runConformanceCheck({ url, token: fake.options.token, task: taskId, log });
    // The check is a client too: a request it made against the contract is
    // its own bug, and would make every verdict above suspect.
    if (fake.state.violations.length) {
      log('\nThe check itself broke the contract as a client:');
      for (const v of fake.state.violations) log(`  - [${v.rule}] ${v.method} ${v.path}: ${v.message}`);
      return { ...result, ok: false };
    }
    const left = [...fake.state.worklogs.values()].filter(w => !w.deleted);
    if (left.length) {
      log(`\nThe check left ${left.length} worklog(s) on the fake: ${left.map(w => w.id).join(', ')}`);
      return { ...result, ok: false };
    }
    return result;
  } finally {
    await fake.close();
  }
}

const USAGE = `Usage:
  node scripts/provider-api-check.js --url <base URL> --token <token> --task <task id>
  node scripts/provider-api-check.js --fake [--fake-fault <name>[=<value>]]...

  --url    The base URL, ending with the contract version: https://host/sprintticker/v1
  --token  The user's API token (or set SPRINTTICKER_PROVIDER_TOKEN). Never printed.
  --task   A task the token's user may log time on, made for the purpose: the check
           records and deletes worklogs on it and moves it to in progress.
  --fake   Run against scripts/fake-provider-api.js, started in this process.`;

module.exports = { runConformanceCheck, runAgainstFake, CHECKS };

if (require.main === module) {
  (async () => {
    let args;
    try {
      args = parseArgs(process.argv.slice(2));
    } catch (error) {
      console.error(`${error.message}\n\n${USAGE}`);
      process.exit(2);
    }
    if (args.help) {
      console.log(USAGE);
      return;
    }
    let result;
    if (args.fake) result = await runAgainstFake(args.faults);
    else {
      const token = args.token || process.env.SPRINTTICKER_PROVIDER_TOKEN;
      if (!args.url || !token || !args.task) {
        console.error(`--url, --token and --task are required (or --fake).\n\n${USAGE}`);
        process.exit(2);
      }
      result = await runConformanceCheck({ url: args.url, token, task: args.task });
    }
    process.exitCode = result.ok ? 0 : 1;
  })().catch(error => {
    console.error(error.stack || String(error));
    process.exit(2);
  });
}
