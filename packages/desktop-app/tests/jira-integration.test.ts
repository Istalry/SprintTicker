import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { createFakeJira } from '../../../scripts/fake-jira.js';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { isProviderRequestError } from '../src/main/providers/provider-errors';

/**
 * The Jira adapter against a real socket.
 *
 * `jira-provider.test.ts` mocks `fetch` and proves each walk follows the
 * pagination field it is handed. What it cannot prove is that the adapter and a
 * server agree: that the URL it builds is one a router matches, that a token it
 * echoes back is read from where the server put it, and that the two request
 * bodies a live Jira refuses with a bare `400` -- the worklog's `started` format
 * and its ADF comment -- come out in the shape the API documents.
 *
 * The server is `scripts/fake-jira.js`, the same harness usable by hand, bound
 * here to an ephemeral port. Hermetic: loopback only, no fixtures on disk.
 *
 * **Why the provider is constructed directly rather than through
 * `ProviderManager`.** `JiraProvider.sanitizeSite` forces `https://` with no
 * opt-out, which is deliberate -- Jira Cloud is TLS-only and the API token
 * travels in a Basic header on every request (F-11). A plain-HTTP loopback fake
 * is therefore unreachable through the normal path, and weakening the scheme
 * rule to make a test convenient would trade a real protection for cover. So
 * the test injects a `fetchFn` that rewrites the origin, which the constructor
 * already accepts for exactly this kind of substitution. The cost is honest and
 * worth naming: this exercises the adapter, not `ProviderManager`'s credential
 * wiring, which `provider-integration.test.ts` covers on the OpenProject side.
 */
describe('JiraProvider against a live Jira-shaped server', () => {
  const PROJECT_COUNT = 25;
  const ISSUE_COUNT = 47;
  const PAGE_SIZE = 20;
  const SITE = 'https://acme.atlassian.net';

  let server: ReturnType<typeof createFakeJira>['server'];
  let requests: ReturnType<typeof createFakeJira>['requests'];
  let origin: string;

  beforeAll(async () => {
    const fake = createFakeJira({
      projects: PROJECT_COUNT,
      issues: ISSUE_COUNT,
      pageSize: PAGE_SIZE,
      quiet: true
    });
    server = fake.server;
    requests = fake.requests;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    requests.length = 0;
  });

  /**
   * Sends the adapter's real request to the fake, with only the origin swapped.
   *
   * Everything the adapter built -- path, query string, headers, body -- travels
   * untouched, so what the fake records is what a live site would have received.
   */
  const redirectToFake = (dropAuth = false): typeof fetch => {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
      const rewritten = String(input).replace(SITE, origin);
      const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
      if (dropAuth) delete headers.Authorization;
      return fetch(rewritten, { ...init, headers });
    }) as typeof fetch;
  };

  async function configured(
    overrides: Record<string, string> = {},
    dropAuth = false
  ): Promise<JiraProvider> {
    const provider = new JiraProvider({
      fetchFn: redirectToFake(dropAuth),
      // Backoff would otherwise cost real seconds on the retry paths.
      sleepFn: async (): Promise<void> => undefined
    });
    await provider.initialize({
      domain: SITE,
      jiraEmail: 'dev@acme.test',
      jiraApiToken: 'token-123',
      ...overrides
    });
    return provider;
  }

  describe('pagination', () => {
    it('GetProjects_MoreThanOnePage_WalksEveryStartAtPage', async () => {
      const provider = await configured();

      const projects = await provider.getProjects();

      expect(projects).toHaveLength(PROJECT_COUNT);
      // The marked last record proves the walk reached the end rather than
      // stopping at a page boundary that happened to look complete.
      expect(projects[projects.length - 1].name).toContain('(LAST)');

      // startAt is a record index, not a page number: 25 records at 20 a page
      // is two requests, and the second starts at 20 rather than at 1. An
      // adapter that paged by number would send startAt=1 here.
      //
      // Note what this cannot see: incrementing by `maxResults` instead of by
      // `values.length` gives the same sequence, because they only diverge on
      // the final partial page and no request follows it. `isLast` ends the
      // walk before the difference is observable.
      const search = requests.filter(r => r.pathname === '/rest/api/3/project/search');
      expect(search.map(r => r.startAt)).toEqual([0, 20]);
    });

    it('GetProjects_ServerClampsMaxResults_StillWalksToTheEnd', async () => {
      // The adapter asks for 100; the server allows 20. A harness that honoured
      // the request would return everything in one page and the walk under test
      // would never run.
      const provider = await configured();

      await provider.getProjects();

      const first = requests.find(r => r.pathname === '/rest/api/3/project/search');
      expect(first?.requestedMaxResults).toBe(100);
      expect(first?.maxResults).toBe(PAGE_SIZE);
    });

    it('GetTasks_MoreThanOnePage_FollowsTheOpaqueNextPageToken', async () => {
      const provider = await configured({ jiraTaskScope: 'everything_open' });

      const tasks = await provider.getTasks('10000');

      expect(tasks).toHaveLength(ISSUE_COUNT);
      expect(tasks[tasks.length - 1].title).toContain('(LAST)');

      const searches = requests.filter(r => r.pathname === '/rest/api/3/search/jql');
      expect(searches).toHaveLength(3);
      // The first request carries no token; each later one carries a token it
      // could only have got from the previous response. A walk that computed
      // its own offsets would send nothing here and pass a startAt harness.
      expect(searches[0].pageToken).toBeUndefined();
      expect(searches[1].pageToken).toBeTruthy();
      expect(searches[2].pageToken).toBeTruthy();
      expect(searches[1].pageToken).not.toBe(searches[2].pageToken);
    });

    it('GetTasks_AnyScope_RequestsOnlyTheThreeFieldsItMaps', async () => {
      // The default is every field on every issue, which for a busy project is
      // megabytes of description and changelog the adapter then discards.
      const provider = await configured();

      await provider.getTasks('10000');

      const search = requests.find(r => r.pathname === '/rest/api/3/search/jql');
      expect(search?.fields).toBe('summary,status,project');
    });

    it('GetTasks_AssignedToMeScope_SendsCurrentUserClause', async () => {
      const provider = await configured();

      await provider.getTasks('10000');

      const search = requests.find(r => r.pathname === '/rest/api/3/search/jql');
      expect(search?.jql).toContain('assignee = currentUser()');
      expect(search?.jql).toContain('statusCategory != Done');
    });

    it('GetTasks_CyclingStatusCategories_MapsEachToItsLocalStatus', async () => {
      // Categories cycle new / indeterminate / indeterminate / done, so all
      // three local statuses must appear. A fixture of one category cannot
      // tell a correct mapping from a constant.
      const provider = await configured({ jiraTaskScope: 'everything_open' });

      const tasks = await provider.getTasks('10000');

      expect(new Set(tasks.map(t => t.status))).toEqual(new Set(['todo', 'in_progress', 'done']));
    });
  });

  describe('worklogs', () => {
    it('LogTime_ValidDuration_SendsNumericOffsetAndAdfComment', async () => {
      const provider = await configured();

      const result = await provider.logTime({
        taskId: 'FAKE1-1',
        durationSeconds: 1800,
        startedAtUtc: new Date('2026-09-09T10:15:00Z').toISOString(),
        comment: 'Paired on the sync queue',
        isAdHoc: false
      });

      expect(result.success).toBe(true);
      expect(result.remoteWorklogId).toBeTruthy();

      const posted = requests.find(r => r.pathname === '/rest/api/3/issue/FAKE1-1/worklog');
      expect(posted?.method).toBe('POST');

      const body = posted?.body as Record<string, unknown>;
      expect(body.timeSpentSeconds).toBe(1800);

      // `yyyy-MM-dd'T'HH:mm:ss.SSSZ` with a *numeric* offset. Jira rejects both
      // toISOString()'s trailing Z and the +02:00 form the device driver emits,
      // and says so only as a bare 400.
      expect(body.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);

      // v3 comments are Atlassian Document Format. A plain string is what the
      // v2 API took, and it fails validation here.
      expect(body.comment).toMatchObject({ type: 'doc', version: 1 });
      expect(JSON.stringify(body.comment)).toContain('Paired on the sync queue');
    });

    it('LogTime_EncodedIssueKey_ReachesTheIssueRoute', async () => {
      const provider = await configured();

      await provider.logTime({
        taskId: 'FAKE1-2',
        durationSeconds: 60,
        startedAtUtc: new Date().toISOString(),
        comment: 'Shortest loggable session',
        isAdHoc: false
      });

      expect(requests.some(r => r.pathname === '/rest/api/3/issue/FAKE1-2/worklog')).toBe(true);
    });

    it('LogTime_BelowMinimum_ThrowsPermanentWithoutSendingAnything', async () => {
      const provider = await configured();

      await expect(
        provider.logTime({
          taskId: 'FAKE1-1',
          durationSeconds: 30,
          startedAtUtc: new Date().toISOString(),
          comment: 'Too short for Jira',
          isAdHoc: false
        })
      ).rejects.toSatisfy(
        (err: unknown) => isProviderRequestError(err) && err.isPermanent === true
      );

      // The point of the client-side floor: the request is never made, so the
      // queue parks the row instead of spending its retry budget on identical
      // 400s.
      expect(requests).toHaveLength(0);
    });
  });

  describe('transitions', () => {
    it('UpdateTaskStatus_ConfiguredTransitionName_PostsMatchingTransitionId', async () => {
      const provider = await configured({ jiraTransitionInProgress: 'Start work' });

      const moved = await provider.updateTaskStatus('FAKE1-1', 'in_progress');

      expect(moved).toBe(true);
      const posted = requests.find(
        r => r.pathname === '/rest/api/3/issue/FAKE1-1/transitions' && r.method === 'POST'
      );
      // Configured by name, resolved to the id the workflow uses. A transition
      // id means nothing outside one workflow, which is why the name is what
      // the user enters.
      expect(posted?.body).toEqual({ transition: { id: '11' } });
    });

    it('UpdateTaskStatus_ConfiguredByDestinationStatusName_StillResolves', async () => {
      // The fixture's first transition is named 'Start work' but leads to
      // 'In Progress'. Both spellings must find it, because a user reads the
      // status off the board rather than the transition off the workflow.
      const provider = await configured({ jiraTransitionInProgress: 'In Progress' });

      const moved = await provider.updateTaskStatus('FAKE1-1', 'in_progress');

      expect(moved).toBe(true);
      const posted = requests.find(
        r => r.pathname === '/rest/api/3/issue/FAKE1-1/transitions' && r.method === 'POST'
      );
      expect(posted?.body).toEqual({ transition: { id: '11' } });
    });

    it('UpdateTaskStatus_TransitionNotOfferedByTheWorkflow_ReturnsFalseWithoutPosting', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const provider = await configured({ jiraTransitionInProgress: 'Teleport' });

      const moved = await provider.updateTaskStatus('FAKE1-1', 'in_progress');

      // Not a throw: a workflow may legitimately not permit this move from the
      // issue's current status, and throwing would make the queue retry
      // something that cannot happen.
      expect(moved).toBe(false);
      expect(
        requests.some(r => r.pathname === '/rest/api/3/issue/FAKE1-1/transitions' && r.method === 'POST')
      ).toBe(false);
    });

    it('UpdateTaskStatus_NoTransitionConfigured_ReturnsFalseWithoutCallingJira', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const provider = await configured();

      const moved = await provider.updateTaskStatus('FAKE1-1', 'in_progress');

      expect(moved).toBe(false);
      expect(requests).toHaveLength(0);
    });
  });

  describe('authentication', () => {
    it('GetProjects_ValidCredentials_SendsBasicAuthorizationHeader', async () => {
      const provider = await configured();

      await provider.getProjects();

      const expected = `Basic ${Buffer.from('dev@acme.test:token-123').toString('base64')}`;
      expect(requests[0].authorization).toBe(expected);
    });

    it('GetProjects_MissingAuthorizationHeader_ThrowsPermanent', async () => {
      const provider = await configured({}, true);

      // A 401 is permanent: retrying a revoked or absent credential to the
      // attempt ceiling is what parked rows with no explanation.
      await expect(provider.getProjects()).rejects.toSatisfy(
        (err: unknown) => isProviderRequestError(err) && err.isPermanent === true
      );
    });
  });
});
