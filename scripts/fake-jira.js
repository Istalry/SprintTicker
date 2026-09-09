const http = require('http');
const { URL } = require('url');

/**
 * A stand-in Jira Cloud REST v3 server, for exercising `JiraProvider` end to
 * end without a real site.
 *
 * The Jira adapter was verified once against a live site, and that run removed
 * the *unknowns* -- the numeric worklog offset, ADF comments, the
 * `nextPageToken` walk. It did not leave any regression cover: nothing
 * automated exercises the Jira dialect, so the next edit to those formats
 * fails the same way the first one did, silently and as a bare 400.
 *
 * Built as a sibling of `fake-openproject.js` and deliberately the same shape,
 * so there is one harness pattern in this repository rather than two. The
 * differences below are all Jira's, not stylistic:
 *
 * - **Two pagination schemes, because the provider has two.** `/project/search`
 *   pages on `startAt`, which is a *record index* (OpenProject's `offset` is a
 *   1-based page number -- not the same thing). `/search/jql` pages on an
 *   opaque `nextPageToken`. The adapter contains both loops on purpose; so does
 *   this.
 * - **Request bodies are captured.** The OpenProject fake records only the
 *   request line, which is enough when the query string is the contract. Here
 *   the *body* is the contract -- a worklog's `started` format and its ADF
 *   comment are exactly what a live 400 refuses to explain -- so a test has to
 *   be able to read what was sent.
 *
 * Used two ways: as a CLI for poking at it by hand, and imported by
 * `tests/jira-integration.test.ts`, which binds it to an ephemeral port. One
 * implementation, so the automated check and the manual one cannot drift.
 *
 *   node scripts/fake-jira.js [--port 8098] [--projects 25] [--page-size 20]
 *
 * Any credentials are accepted, but the `Authorization` header must be present:
 * its absence is a 401, because that is a path the adapter classifies.
 *
 * Dev-only -- never imported by the app itself.
 *
 * One caveat worth knowing before pointing the running app at this:
 * `JiraProvider.sanitizeSite` forces `https://` with no opt-out, so the app
 * cannot reach a plain-HTTP loopback server. That is the F-11 fix and not worth
 * weakening for a test harness. The integration test therefore constructs
 * `JiraProvider` directly and injects a `fetchFn` that rewrites the scheme.
 */

const DEFAULT_OPTIONS = {
  port: 8098,
  projects: 25,
  issues: 47,
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

/** Projects, with the last one marked so "did we get everything?" is answerable by eye. */
function buildProjects(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: 10000 + i,
    key: `FAKE${i + 1}`,
    name: i === count - 1 ? `Fake Jira Project ${i + 1} (LAST)` : `Fake Jira Project ${i + 1}`
  }));
}

/**
 * Issues for a project, cycling through the three status categories.
 *
 * All three appear because `mapStatusCategory` maps each to a different local
 * status, and a fixture with only one category cannot tell a correct mapping
 * from a constant.
 */
function buildIssues(count) {
  const statuses = [
    { name: 'To Do', statusCategory: { key: 'new' } },
    { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    { name: 'To Review', statusCategory: { key: 'indeterminate' } },
    { name: 'Done', statusCategory: { key: 'done' } }
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: 20000 + i,
    key: `FAKE1-${i + 1}`,
    fields: {
      summary: i === count - 1 ? `Fake issue ${i + 1} (LAST)` : `Fake issue ${i + 1}`,
      status: statuses[i % statuses.length]
    }
  }));
}

/**
 * The transitions every issue offers.
 *
 * `name` and `to.name` differ on the first one deliberately: the adapter
 * matches a configured value against the id, the transition name *and* the
 * destination status name, and a fixture where all three agree cannot tell
 * those three lookups apart.
 */
const TRANSITIONS = [
  { id: '11', name: 'Start work', to: { name: 'In Progress' } },
  { id: '21', name: 'To Review', to: { name: 'To Review' } },
  { id: '31', name: 'Close', to: { name: 'Done' } }
];

/**
 * Encodes a record index as an opaque continuation token.
 *
 * Base64 rather than the bare number, because the adapter must treat this as
 * opaque and echo it back. A plain integer would let a walk that computed its
 * own offsets pass this harness and then fail against Jira, which is the exact
 * class of bug the token scheme exists to prevent.
 */
function encodeToken(nextIndex) {
  return Buffer.from(`fake-jira:${nextIndex}`).toString('base64url');
}

function decodeToken(token) {
  if (!token) return 0;
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const match = /^fake-jira:(\d+)$/.exec(decoded);
  // An unreadable token restarts the walk rather than throwing: this harness
  // is here to exercise pagination, and a 500 would only obscure which request
  // was malformed.
  return match ? Number(match[1]) : 0;
}

/**
 * Builds the server without binding it.
 *
 * The caller listens, so a test can take an ephemeral port and the CLI can take
 * a fixed one.
 */
function createFakeJira(overrides = {}) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const projects = buildProjects(options.projects);
  const issues = buildIssues(options.issues);
  const requests = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // A real site clamps `maxResults` to its own ceiling: asking for 100 does
    // not mean receiving 100. Honouring the request instead would hand the
    // adapter every record in one page, and both multi-page walks this harness
    // exists to exercise would silently never run.
    const requestedMaxResults = Number(url.searchParams.get('maxResults')) || options.pageSize;
    const maxResults = Math.min(requestedMaxResults, options.pageSize);
    const startAt = Number(url.searchParams.get('startAt')) || 0;
    const pageToken = url.searchParams.get('nextPageToken') || undefined;

    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
    });

    req.on('end', () => {
      let body;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          // Kept as the raw string: a test asserting on a malformed body needs
          // to see what actually arrived, and throwing here would report the
          // harness's parse failure instead of the adapter's mistake.
          body = raw;
        }
      }

      const entry = {
        method: req.method,
        pathname: url.pathname,
        startAt,
        maxResults,
        requestedMaxResults,
        pageToken,
        jql: url.searchParams.get('jql') || undefined,
        fields: url.searchParams.get('fields') || undefined,
        authorization: req.headers.authorization,
        body
      };
      requests.push(entry);

      const send = (status, payload) => {
        const json = JSON.stringify(payload);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(json);
        if (!options.quiet) {
          console.log(
            `[FakeJira] #${String(requests.length).padStart(3)} ${status} ${req.method} ${url.pathname}` +
              ` startAt=${startAt} maxResults=${maxResults} -> ${json.length} bytes`
          );
        }
      };

      // Checked before routing, because the adapter classifies a 401 as a
      // permanent failure and that path deserves cover.
      if (!req.headers.authorization) {
        send(401, {
          errorMessages: ['Client must be authenticated to access this resource.'],
          errors: {}
        });
        return;
      }

      // `/project/search` pages on startAt, a record index.
      if (url.pathname === '/rest/api/3/project/search') {
        const values = projects.slice(startAt, startAt + maxResults);
        send(200, {
          startAt,
          maxResults,
          total: projects.length,
          isLast: startAt + values.length >= projects.length,
          values
        });
        return;
      }

      // `/search/jql` pages on an opaque token. The deprecated `startAt`
      // endpoint is not served: the adapter does not call it, and offering it
      // would let a regression onto the old scheme pass unnoticed.
      if (url.pathname === '/rest/api/3/search/jql') {
        const from = decodeToken(pageToken);
        const slice = issues.slice(from, from + maxResults);
        const nextIndex = from + slice.length;
        const isLast = nextIndex >= issues.length;
        send(200, {
          issues: slice,
          isLast,
          ...(isLast ? {} : { nextPageToken: encodeToken(nextIndex) })
        });
        return;
      }

      const worklog = /^\/rest\/api\/3\/issue\/([^/]+)\/worklog$/.exec(url.pathname);
      if (worklog && req.method === 'POST') {
        send(201, { id: String(Math.floor(Math.random() * 100000)), issueId: worklog[1] });
        return;
      }

      const transitions = /^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/.exec(url.pathname);
      if (transitions) {
        if (req.method === 'POST') {
          // A real site answers 204 with no body. Reproduced exactly: the
          // adapter must not depend on a body it will not receive.
          res.writeHead(204);
          res.end();
          if (!options.quiet) {
            console.log(`[FakeJira] #${requests.length} 204 POST ${url.pathname}`);
          }
          return;
        }
        send(200, { expand: 'transitions', transitions: TRANSITIONS });
        return;
      }

      send(404, {
        errorMessages: [`No fake route for ${req.method} ${url.pathname}`],
        errors: {}
      });
    });
  });

  return { server, options, projects, issues, transitions: TRANSITIONS, requests };
}

module.exports = { createFakeJira, DEFAULT_OPTIONS, TRANSITIONS };

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2), DEFAULT_OPTIONS);
  const { server } = createFakeJira(options);
  server.listen(options.port, '127.0.0.1', () => {
    const pages = n => Math.ceil(n / options.pageSize);
    console.log(`[FakeJira] Listening on http://127.0.0.1:${options.port}`);
    console.log('[FakeJira] Any credentials are accepted; a missing Authorization header is a 401.');
    console.log(
      `[FakeJira] ${options.projects} projects (${pages(options.projects)} pages of ${options.pageSize}, ` +
        `paged on startAt), ${options.issues} issues (${pages(options.issues)} pages, paged on nextPageToken).`
    );
    console.log(
      '[FakeJira] Note: the app itself cannot reach this. JiraProvider.sanitizeSite forces https://, ' +
        'so use curl, or the integration test which injects a fetchFn.'
    );
  });
}
