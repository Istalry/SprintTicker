import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { createFakeJira, FAKE_ACCOUNT } from '../../../scripts/fake-jira.js';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { isProviderRequestError } from '../src/main/providers/provider-errors';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import type { ProviderManager } from '../src/main/providers/provider-manager';

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
  let activity: ReturnType<typeof createFakeJira>['activity'];
  let worklogs: ReturnType<typeof createFakeJira>['worklogs'];
  let fakeOptions: ReturnType<typeof createFakeJira>['options'];
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
    activity = fake.activity;
    worklogs = fake.worklogs;
    fakeOptions = fake.options;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    requests.length = 0;
    activity.length = 0;
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

    it('GetTasks_AnyScope_RequestsOnlyTheFieldsItMaps', async () => {
      // The default is every field on every issue, which for a busy project is
      // megabytes of changelog and custom fields the adapter then discards.
      const provider = await configured();

      await provider.getTasks('10000');

      const search = requests.find(r => r.pathname === '/rest/api/3/search/jql');
      expect(search?.fields).toBe('summary,status,project,priority,description');
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

  describe('correcting a worklog', () => {
    const START = '2026-09-09T10:15:00.000Z';

    /** A worklog as the queue sends it: the marker of its row at the end of the comment. */
    const sent = async (taskId: string, marker: string, durationSeconds = 1800): Promise<string> => {
      const result = await (await configured()).logTime({
        taskId,
        durationSeconds,
        startedAtUtc: START,
        comment: `Paired on the sync queue ${marker}`,
        isAdHoc: false
      });
      return result.remoteWorklogId!;
    };

    it('FindWorklog_MarkerInTheComment_FindsTheEntryLogTimeMade', async () => {
      const id = await sent('FAKE1-3', '[#find0001]');

      expect(await (await configured()).findWorklog('FAKE1-3', START, '[#find0001]')).toBe(id);
    });

    it('FindWorklog_PastTheFirstPage_StillFindsIt', async () => {
      for (let i = 0; i < PAGE_SIZE + 3; i++) await sent('FAKE1-4', `[#page${String(i).padStart(4, '0')}]`);
      requests.length = 0;

      const found = await (await configured()).findWorklog('FAKE1-4', START, `[#page${String(PAGE_SIZE + 2).padStart(4, '0')}]`);

      expect(found).not.toBeNull();
      const reads = requests.filter(r => r.pathname === '/rest/api/3/issue/FAKE1-4/worklog');
      expect(reads.map(r => r.startAt)).toEqual([0, PAGE_SIZE]);
    });

    it('FindWorklog_NoEntryCarriesIt_IsNull', async () => {
      await sent('FAKE1-5', '[#other001]');

      expect(await (await configured()).findWorklog('FAKE1-5', START, '[#absent01]')).toBeNull();
    });

    it('UpdateWorklog_SentEntry_IsRewrittenInTheSameFormat', async () => {
      const id = await sent('FAKE1-6', '[#edit0001]');

      await (await configured()).updateWorklog('FAKE1-6', id, {
        taskId: 'FAKE1-6',
        durationSeconds: 3600,
        startedAtUtc: '2026-09-09T09:00:00.000Z',
        comment: 'Paired on the sync queue [#edit0001]',
        isAdHoc: false
      });

      const put = requests.find(r => r.method === 'PUT');
      expect(put?.pathname).toBe(`/rest/api/3/issue/FAKE1-6/worklog/${id}`);
      const body = put?.body as Record<string, unknown>;
      expect(body.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
      expect(body.comment).toMatchObject({ type: 'doc', version: 1 });
      expect(worklogs.get(id)).toMatchObject({ timeSpentSeconds: 3600 });
    });

    it('DeleteWorklog_SentEntry_IsGone_AndDeletingItAgainIsNotAFailure', async () => {
      const id = await sent('FAKE1-7', '[#dele0001]');
      const provider = await configured();

      await provider.deleteWorklog('FAKE1-7', id);
      await expect(provider.deleteWorklog('FAKE1-7', id)).resolves.toBeUndefined();

      expect(worklogs.has(id)).toBe(false);
    });

    it('UpdateWorklog_DeletedInJira_IsAPermanentFailure', async () => {
      const id = await sent('FAKE1-8', '[#gone0001]');
      const provider = await configured();
      await provider.deleteWorklog('FAKE1-8', id);

      await expect(
        provider.updateWorklog('FAKE1-8', id, {
          taskId: 'FAKE1-8',
          durationSeconds: 600,
          startedAtUtc: START,
          comment: '[#gone0001]',
          isAdHoc: false
        })
      ).rejects.toSatisfy((err: unknown) => isProviderRequestError(err) && err.status === 404 && err.isPermanent);
    });

    it('QueueSend_AnswerLostAfterJiraRecordedIt_IsNotRecordedTwice', async () => {
      // Real adapter, worker and queue: Jira stores the worklog and the
      // connection drops before its answer. The retry finds it by its marker.
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const provider = await configured();
      const manager = {
        getProvider: () => provider,
        logTimeForProvider: (_id: string, payload: Parameters<JiraProvider['logTime']>[0]) => provider.logTime(payload)
      } as unknown as ProviderManager;
      const db = new DatabaseConnection(':memory:');
      const repo = new WorklogRepository(db);
      const worker = new OfflineSyncWorker(manager, repo);
      repo.enqueueSyncItem({
        id: 'sync_lost0001', providerId: 'jira', taskId: 'FAKE1-10', durationSeconds: 1800, startedAtUtc: START, comment: 'Lost answer'
      });
      const onIssue = () => [...worklogs.values()].filter(w => w.issueId === 'FAKE1-10');
      fakeOptions.loseWorklogAnswers = 1;

      await worker.processPendingQueue();
      expect(onIssue()).toHaveLength(1);
      expect(repo.getSyncItem('sync_lost0001')?.status).toBe('PENDING');
      db.getDb().prepare('UPDATE worklog_sync_queue SET next_attempt_at_utc = NULL').run();

      await worker.processPendingQueue();

      expect(onIssue()).toHaveLength(1);
      expect(repo.getSyncItem('sync_lost0001')).toMatchObject({ status: 'SYNCED', remoteWorklogId: onIssue()[0].id });
      db.close();
    });

    it.each([
      // The fake cycles To Do, In Progress, To Review, Done.
      ['FAKE1-1', 'open'],
      ['FAKE1-4', 'closed'],
      ['FAKE9-999', 'gone']
    ])('GetTaskStanding_%s_Is%s', async (key, expected) => {
      expect(await (await configured()).getTaskStanding(key)).toBe(expected);
    });

    it('UpdateWorklog_BelowTheMinute_ThrowsPermanentWithoutSendingAnything', async () => {
      const id = await sent('FAKE1-9', '[#short001]');
      requests.length = 0;

      await expect(
        (await configured()).updateWorklog('FAKE1-9', id, {
          taskId: 'FAKE1-9',
          durationSeconds: 30,
          startedAtUtc: START,
          comment: '[#short001]',
          isAdHoc: false
        })
      ).rejects.toSatisfy((err: unknown) => isProviderRequestError(err) && err.isPermanent === true);
      expect(requests.filter(r => r.method === 'PUT')).toHaveLength(0);
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

    it.each([
      ['GetProjects', (p: JiraProvider) => p.getProjects()],
      ['GetTasks', (p: JiraProvider) => p.getTasks('FAKE1')],
      ['GetEventsSince', (p: JiraProvider) => p.getEventsSince(new Date(Date.now() - 60_000).toISOString())]
    ])('%s_TokenJiraTreatsAsAnonymous_ThrowsAuthRatherThanAnsweringEmpty', async (_name, read) => {
      // Jira answers the searches 200 and empty for a token it does not
      // accept. Read as the truth, that emptied the local project list at
      // every sync for as long as the token stayed expired.
      const provider = await configured({}, true);

      await expect(read(provider)).rejects.toSatisfy(
        (err: unknown) => isProviderRequestError(err) && err.kind === 'auth'
      );
      expect(requests.map(r => r.pathname)).toEqual(['/rest/api/3/myself']);
    });
  });

  describe('events', () => {
    it('GetEventsSince_ActivityOnAFollowedIssue_ComesBackAsEventsWithoutMyOwn', async () => {
      const alice = { accountId: 'acc-alice', displayName: 'Alice Martin' };
      const at = new Date(Date.now() - 30_000).toISOString();
      activity.push({
        id: '30001',
        key: 'FAKE1-7',
        fields: {
          summary: 'Fix the lobby',
          created: '2026-01-01T09:00:00.000+0000',
          creator: alice,
          assignee: FAKE_ACCOUNT,
          comment: {
            total: 1,
            comments: [{
              id: '700',
              author: alice,
              created: at,
              body: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: FAKE_ACCOUNT.accountId, text: '@Fake Me' } }] }]
              }
            }]
          }
        },
        changelog: {
          total: 2,
          histories: [
            { id: '80', author: alice, created: at, items: [{ field: 'status', fieldId: 'status', fromString: 'To Do', toString: 'In Progress' }] },
            { id: '81', author: FAKE_ACCOUNT, created: at, items: [{ field: 'status', fieldId: 'status', toString: 'Done' }] }
          ]
        }
      });
      const provider = await configured();

      const events = await provider.getEventsSince(new Date(Date.now() - 60_000).toISOString());

      expect(events.map(e => [e.kind, e.actorName, e.taskKey])).toEqual([
        ['status_changed', 'Alice Martin', 'FAKE1-7'],
        ['mentioned', 'Alice Martin', 'FAKE1-7']
      ]);
      // The event poll's search, not a task walk: it is the only one that
      // expands the changelog, and the fake answers it from `activity`.
      const search = requests.find(r => r.pathname === '/rest/api/3/search/jql');
      expect(search?.expand).toBe('changelog');
      expect(search?.jql).toMatch(/updated >= -\d+m/);
    });
  });
});
