import { describe, it, expect, afterEach, vi } from 'vitest';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { ProviderRequestError, isProviderRequestError } from '../src/main/providers/provider-errors';
import { TaskScope } from '../src/shared/task-scope';
import { MAX_COLLECTION_PAGES } from '../src/main/providers/provider-constants';
import { isJiraConfigured } from '../src/shared/provider-settings';

/**
 * The Jira Cloud adapter.
 *
 * Written against the documented v3 API and the fake harness, not against a
 * live site, so these tests are the only thing standing behind it. They
 * concentrate on the parts a reader cannot verify by inspection: the two
 * different pagination schemes, and the two request formats that fail with a
 * bare 400 when they are wrong (`started` and the ADF comment).
 */
describe('JiraProvider', () => {
  const SITE = 'https://acme.atlassian.net';
  const originalFetch = global.fetch;
  const noBackoff = { sleepFn: async (): Promise<void> => undefined };

  function ok(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body
    } as unknown as Response;
  }

  async function configured(overrides: Record<string, string> = {}): Promise<JiraProvider> {
    const provider = new JiraProvider(noBackoff);
    await provider.initialize({
      domain: SITE,
      jiraEmail: 'dev@acme.test',
      jiraApiToken: 'token-123',
      ...overrides
    });
    return provider;
  }

  /** Records every request the provider issues. */
  function record(...responses: Response[]): { urls: string[]; inits: RequestInit[] } {
    const urls: string[] = [];
    const inits: RequestInit[] = [];
    let call = 0;
    global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      urls.push(url);
      inits.push(init);
      const res = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve(res);
    });
    return { urls, inits };
  }

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('site and credentials', () => {
    it('SanitizeSite_BareHost_AssumesHttps', () => {
      expect(JiraProvider.sanitizeSite('acme.atlassian.net')).toBe('https://acme.atlassian.net');
    });

    it('SanitizeSite_PlainHttp_IsUpgraded', () => {
      // Jira Cloud is only served over TLS, so unlike a self-hosted
      // OpenProject there is no legitimate plain-HTTP site to preserve -- and
      // the API token travels in a Basic header on every request.
      expect(JiraProvider.sanitizeSite('http://acme.atlassian.net')).toBe(
        'https://acme.atlassian.net'
      );
    });

    it('SanitizeSite_PastedApiUrl_IsReducedToTheOrigin', () => {
      // Pasting the URL from the API docs is the obvious mistake to make.
      expect(JiraProvider.sanitizeSite('https://acme.atlassian.net/rest/api/3/myself')).toBe(
        'https://acme.atlassian.net'
      );
    });

    it('SanitizeSite_TrailingSlashes_AreRemoved', () => {
      expect(JiraProvider.sanitizeSite('https://acme.atlassian.net///')).toBe(
        'https://acme.atlassian.net'
      );
    });

    it('IsConfigured_MissingEmail_IsFalse', () => {
      // Jira needs three values where OpenProject needs two: the token is the
      // password *for an account*, so the email is not optional.
      expect(isJiraConfigured(SITE, '', 'token')).toBe(false);
      expect(isJiraConfigured(SITE, 'dev@acme.test', 'token')).toBe(true);
    });

    it('GetProjects_NotConfigured_ThrowsNotConfiguredRatherThanReturningEmpty', async () => {
      // F-01: an empty list is what the sync worker prunes against.
      const provider = new JiraProvider(noBackoff);
      await provider.initialize({});

      await expect(provider.getProjects()).rejects.toMatchObject({ kind: 'not_configured' });
    });

    it('GetProjects_AnyRequest_SendsBasicAuthOfEmailAndToken', async () => {
      const { inits } = record(ok({ values: [], isLast: true }));

      await (await configured()).getProjects();

      const auth = (inits[0].headers as Record<string, string>).Authorization;
      expect(auth).toBe(`Basic ${Buffer.from('dev@acme.test:token-123').toString('base64')}`);
    });
  });

  describe('projects page on startAt', () => {
    it('GetProjects_TwoPages_ReturnsBoth', async () => {
      record(
        ok({ values: [{ id: 1, key: 'ALPHA', name: 'Alpha' }], isLast: false }),
        ok({ values: [{ id: 2, key: 'BETA', name: 'Beta' }], isLast: true })
      );

      const projects = await (await configured()).getProjects();

      expect(projects.map(p => p.key)).toEqual(['ALPHA', 'BETA']);
    });

    it('GetProjects_SecondPage_AdvancesStartAtByWhatItReceived', async () => {
      const { urls } = record(
        ok({ values: [{ id: 1, key: 'A', name: 'A' }, { id: 2, key: 'B', name: 'B' }], isLast: false }),
        ok({ values: [], isLast: true })
      );

      await (await configured()).getProjects();

      expect(new URL(urls[0]).searchParams.get('startAt')).toBe('0');
      expect(new URL(urls[1]).searchParams.get('startAt')).toBe('2');
    });

    it('GetProjects_EmptyPageStillClaimingMore_StopsWalking', async () => {
      // A site that miscounts must not be able to spin us up to the page cap.
      const { urls } = record(ok({ values: [], isLast: false }));

      const projects = await (await configured()).getProjects();

      expect(projects).toEqual([]);
      expect(urls).toHaveLength(1);
    });

    it('GetProjects_NeverEndingPagination_ThrowsRatherThanReturningPartialData', async () => {
      record(ok({ values: [{ id: 1, key: 'A', name: 'A' }], isLast: false }));

      await expect((await configured()).getProjects()).rejects.toThrow(ProviderRequestError);
      expect(global.fetch).toHaveBeenCalledTimes(MAX_COLLECTION_PAGES);
    });

    it('GetProjects_ResponseWithoutValues_ThrowsProtocol', async () => {
      record(ok({ unexpected: 'shape' }));

      await expect((await configured()).getProjects()).rejects.toMatchObject({ kind: 'protocol' });
    });

    it('GetProjects_GenuinelyEmptySite_ReturnsEmptyWithoutThrowing', async () => {
      record(ok({ values: [], isLast: true }));

      await expect((await configured()).getProjects()).resolves.toEqual([]);
    });
  });

  describe('issues page on nextPageToken', () => {
    it('GetTasks_TwoPages_FollowsTheTokenAndConcatenates', async () => {
      const { urls } = record(
        ok({
          issues: [{ id: 10, key: 'A-1', fields: { summary: 'One' } }],
          nextPageToken: 'tok-2',
          isLast: false
        }),
        ok({ issues: [{ id: 11, key: 'A-2', fields: { summary: 'Two' } }], isLast: true })
      );

      const tasks = await (await configured()).getTasks('1');

      expect(tasks.map(t => t.key)).toEqual(['A-1', 'A-2']);
      expect(new URL(urls[0]).searchParams.get('nextPageToken')).toBeNull();
      expect(new URL(urls[1]).searchParams.get('nextPageToken')).toBe('tok-2');
    });

    it('GetTasks_LastPageWithoutAToken_StopsWalking', async () => {
      const { urls } = record(ok({ issues: [{ id: 10, key: 'A-1', fields: {} }] }));

      await (await configured()).getTasks('1');

      expect(urls).toHaveLength(1);
    });

    it('GetTasks_AnyRequest_AsksOnlyForTheFieldsItUses', async () => {
      // The default is every field on every issue, which for a busy project is
      // megabytes of description and changelog this would discard.
      const { urls } = record(ok({ issues: [], isLast: true }));

      await (await configured()).getTasks('1');

      expect(new URL(urls[0]).searchParams.get('fields')).toBe('summary,status,project');
    });

    it('GetTasks_NoProjectId_ThrowsArgumentException', async () => {
      await expect((await configured()).getTasks('')).rejects.toThrow(/projectId/);
    });

    it('GetTasks_ResponseWithoutIssues_ThrowsProtocol', async () => {
      record(ok({ unexpected: 'shape' }));

      await expect((await configured()).getTasks('1')).rejects.toMatchObject({ kind: 'protocol' });
    });
  });

  describe('status comes from the category, not a configured id', () => {
    // Every Jira workflow files its statuses under one of three fixed
    // categories, so this needs no setup -- unlike OpenProject, where the same
    // mapping is three numeric ids the user has to look up by hand.

    it('MapStatusCategory_KnownCategories_MapToTheThreeTrackedStates', () => {
      expect(JiraProvider.mapStatusCategory('new')).toBe('todo');
      expect(JiraProvider.mapStatusCategory('indeterminate')).toBe('in_progress');
      expect(JiraProvider.mapStatusCategory('done')).toBe('done');
    });

    it('MapStatusCategory_MissingOrUnknown_IsTreatedAsOutstanding', () => {
      // The safe direction: an unrecognised category keeps the issue visible
      // rather than hiding it as finished.
      expect(JiraProvider.mapStatusCategory(undefined)).toBe('todo');
      expect(JiraProvider.mapStatusCategory('something-new-from-atlassian')).toBe('todo');
    });

    it('GetTasks_IssueInProgress_IsReportedAsInProgress', async () => {
      record(
        ok({
          issues: [
            {
              id: 10,
              key: 'A-1',
              fields: { summary: 'One', status: { statusCategory: { key: 'indeterminate' } } }
            }
          ],
          isLast: true
        })
      );

      const tasks = await (await configured()).getTasks('1');

      expect(tasks[0].status).toBe('in_progress');
    });
  });

  describe('the task scope becomes JQL', () => {
    function jqlOf(urls: string[]): string {
      return new URL(urls[0]).searchParams.get('jql') ?? '';
    }

    it('GetTasks_AssignedToMe_RestrictsToTheCurrentUser', async () => {
      const { urls } = record(ok({ issues: [], isLast: true }));

      await (await configured({ jiraTaskScope: TaskScope.ASSIGNED_TO_ME })).getTasks('42');

      expect(jqlOf(urls)).toContain('assignee = currentUser()');
      expect(jqlOf(urls)).toContain('project = "42"');
      expect(jqlOf(urls)).toContain('statusCategory != Done');
    });

    it('GetTasks_AllOpen_DropsOnlyTheAssigneeClause', async () => {
      const { urls } = record(ok({ issues: [], isLast: true }));

      await (await configured({ jiraTaskScope: TaskScope.ALL_OPEN })).getTasks('42');

      expect(jqlOf(urls)).not.toContain('assignee');
      expect(jqlOf(urls)).toContain('project = "42"');
      expect(jqlOf(urls)).toContain('statusCategory != Done');
    });

    it('GetTasks_ScopeNeverConfigured_DefaultsToAssignedToMe', async () => {
      const { urls } = record(ok({ issues: [], isLast: true }));

      await (await configured()).getTasks('42');

      expect(jqlOf(urls)).toContain('assignee = currentUser()');
    });

    it('GetTasks_CustomJql_IsSentVerbatim', async () => {
      const { urls } = record(ok({ issues: [], isLast: true }));
      const jql = 'labels = urgent ORDER BY priority DESC';

      await (
        await configured({ jiraTaskScope: TaskScope.CUSTOM, jiraTaskQuery: jql })
      ).getTasks('42');

      expect(jqlOf(urls)).toBe(jql);
    });

    it('GetTasks_CustomScopeWithNoQuery_ReportsNotConfiguredWithoutRequesting', async () => {
      // JQL itself cannot be validated here -- only Jira parses JQL -- but an
      // empty query is a plain configuration mistake and worth catching before
      // spending a request on it.
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const err = await (await configured({ jiraTaskScope: TaskScope.CUSTOM, jiraTaskQuery: '  ' }))
        .getTasks('42')
        .catch((e: unknown) => e);

      expect((err as ProviderRequestError).kind).toBe('not_configured');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('QuoteJqlValue_ValueWithAQuote_IsEscaped', () => {
      expect(JiraProvider.quoteJqlValue('we"ird')).toBe('"we\\"ird"');
    });
  });

  describe('logging time', () => {
    it('LogTime_Success_ReturnsTheRemoteWorklogId', async () => {
      record(ok({ id: '90210' }));

      const result = await (await configured()).logTime({
        taskId: 'A-1',
        durationSeconds: 3600,
        startedAtUtc: '2026-01-01T09:00:00.000Z',
        comment: 'work',
        isAdHoc: false
      });

      expect(result).toEqual({ success: true, remoteWorklogId: '90210' });
    });

    it('LogTime_AnyRequest_SendsTimeSpentInSeconds', async () => {
      const { inits } = record(ok({ id: '1' }));

      await (await configured()).logTime({
        taskId: 'A-1',
        durationSeconds: 5400,
        startedAtUtc: '2026-01-01T09:00:00.000Z',
        comment: 'work',
        isAdHoc: false
      });

      const body = JSON.parse(inits[0].body as string) as { timeSpentSeconds: number };
      expect(body.timeSpentSeconds).toBe(5400);
    });

    it('LogTime_AnyRequest_SendsTheCommentAsAtlassianDocumentFormat', async () => {
      // A plain string is what the v2 API took. v3 rejects it with a bare 400.
      const { inits } = record(ok({ id: '1' }));

      await (await configured()).logTime({
        taskId: 'A-1',
        durationSeconds: 60,
        startedAtUtc: '2026-01-01T09:00:00.000Z',
        comment: 'Fixed the thing',
        isAdHoc: false
      });

      const body = JSON.parse(inits[0].body as string) as { comment: Record<string, unknown> };
      expect(body.comment).toEqual({
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fixed the thing' }] }]
      });
    });

    it('LogTime_ZeroDuration_ThrowsWithoutIssuingARequest', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      await expect(
        (await configured()).logTime({
          taskId: 'A-1',
          durationSeconds: 0,
          startedAtUtc: '2026-01-01T09:00:00.000Z',
          comment: 'work',
          isAdHoc: false
        })
      ).rejects.toThrow(/durationSeconds/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('LogTime_ServerRejects_ThrowsRatherThanReportingAPlainFailure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ errorMessages: ['Client must be authenticated'] })
      } as unknown as Response);

      const err = await (await configured())
        .logTime({
          taskId: 'A-1',
          durationSeconds: 60,
          startedAtUtc: '2026-01-01T09:00:00.000Z',
          comment: 'work',
          isAdHoc: false
        })
        .catch((e: unknown) => e);

      expect(isProviderRequestError(err)).toBe(true);
      expect((err as ProviderRequestError).kind).toBe('auth');
      expect((err as ProviderRequestError).message).toContain('Client must be authenticated');
    });

    it('LogTime_ServerReturns503_IsNotRetried', async () => {
      // No idempotency key on the worklog endpoint, so a repeat after a lost
      // response bills the session twice.
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({})
      } as unknown as Response);

      await expect(
        (await configured()).logTime({
          taskId: 'A-1',
          durationSeconds: 60,
          startedAtUtc: '2026-01-01T09:00:00.000Z',
          comment: 'work',
          isAdHoc: false
        })
      ).rejects.toThrow(ProviderRequestError);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('the started timestamp format', () => {
    // Jira wants yyyy-MM-dd'T'HH:mm:ss.SSSZ where Z is a numeric offset. All
    // three of these are 400s when wrong, with nothing in the body naming the
    // field. Asserted by shape, so the suite does not depend on the machine's
    // timezone.

    it('ToJiraTimestamp_AnyInstant_HasMillisecondsAndANumericOffset', () => {
      const formatted = JiraProvider.toJiraTimestamp(new Date('2026-01-01T09:00:00.000Z'));

      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
    });

    it('ToJiraTimestamp_AnyInstant_DoesNotUseTheZuluSuffix', () => {
      // `toISOString()` is rejected outright.
      const formatted = JiraProvider.toJiraTimestamp(new Date('2026-01-01T09:00:00.000Z'));

      expect(formatted.endsWith('Z')).toBe(false);
    });

    it('ToJiraTimestamp_AnyInstant_OmitsTheColonInTheOffset', () => {
      // The device's `toIsoWithLocalOffset` emits `+02:00`, which Jira also
      // rejects -- which is why this cannot simply reuse it.
      const formatted = JiraProvider.toJiraTimestamp(new Date('2026-06-01T09:00:00.000Z'));

      // The offset is four digits with no separator, so the time portion must
      // not end in the `+HH:MM` shape the device helper produces.
      expect(formatted.slice(-5)).toMatch(/^[+-]\d{4}$/);
      expect(formatted.split('T')[1]).not.toMatch(/[+-]\d{2}:\d{2}$/);
    });

    it('LogTime_AnyRequest_SendsStartedInThatFormat', async () => {
      const { inits } = record(ok({ id: '1' }));

      await (await configured()).logTime({
        taskId: 'A-1',
        durationSeconds: 60,
        startedAtUtc: '2026-01-01T09:00:00.000Z',
        comment: 'work',
        isAdHoc: false
      });

      const body = JSON.parse(inits[0].body as string) as { started: string };
      expect(body.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
    });
  });

  describe('status changes go through transitions', () => {
    it('UpdateTaskStatus_ConfiguredByName_ReadsTheTransitionsThenExecutesIt', async () => {
      // Jira has no writable status field, and which transitions exist depends
      // on the issue's current status.
      const { urls, inits } = record(
        ok({ transitions: [{ id: '31', name: 'Start work' }] }),
        ok({})
      );

      const moved = await (
        await configured({ jiraTransitionInProgress: 'Start work' })
      ).updateTaskStatus('A-1', 'in_progress');

      expect(moved).toBe(true);
      expect(inits[0].method ?? 'GET').toBe('GET');
      expect(inits[1].method).toBe('POST');
      expect(urls[1]).toContain('/issue/A-1/transitions');
      expect(JSON.parse(inits[1].body as string)).toEqual({ transition: { id: '31' } });
    });

    it('UpdateTaskStatus_ConfiguredById_AlsoMatches', async () => {
      // A transition id is per-workflow, so names are the portable option --
      // but an id must still work for anyone who has one.
      record(ok({ transitions: [{ id: '31', name: 'Start work' }] }), ok({}));

      const moved = await (await configured({ jiraTransitionInProgress: '31' })).updateTaskStatus(
        'A-1',
        'in_progress'
      );

      expect(moved).toBe(true);
    });

    it('UpdateTaskStatus_ConfiguredByTargetStatusName_AlsoMatches', async () => {
      // People read the status off the board, not the transition button.
      record(
        ok({ transitions: [{ id: '31', name: 'Start work', to: { name: 'In Progress' } }] }),
        ok({})
      );

      const moved = await (
        await configured({ jiraTransitionInProgress: 'in progress' })
      ).updateTaskStatus('A-1', 'in_progress');

      expect(moved).toBe(true);
    });

    it('UpdateTaskStatus_NoTransitionConfigured_ReturnsFalseWithoutRequesting', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const moved = await (await configured()).updateTaskStatus('A-1', 'in_progress');

      expect(moved).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('UpdateTaskStatus_TransitionNotAvailableFromHere_ReturnsFalseRatherThanThrowing', async () => {
      // A workflow may legitimately not permit the move. Throwing would make
      // the sync queue retry something that cannot happen.
      record(ok({ transitions: [{ id: '99', name: 'Close' }] }));

      const moved = await (
        await configured({ jiraTransitionInProgress: 'Start work' })
      ).updateTaskStatus('A-1', 'in_progress');

      expect(moved).toBe(false);
    });

    it('UpdateTaskStatus_DoneWithCompletionActionToReview_UsesTheReviewTransition', async () => {
      const { inits } = record(ok({ transitions: [{ id: '41', name: 'Send to review' }] }), ok({}));

      await (
        await configured({
          jiraTransitionToReview: 'Send to review',
          jiraTransitionToTest: 'Send to test',
          jiraCompletionAction: 'to_review'
        })
      ).updateTaskStatus('A-1', 'done');

      expect(JSON.parse(inits[1].body as string)).toEqual({ transition: { id: '41' } });
    });

    it('UpdateTaskStatus_RequestFails_Throws', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({ errorMessages: ['You do not have permission'] })
      } as unknown as Response);

      await expect(
        (await configured({ jiraTransitionInProgress: 'Start work' })).updateTaskStatus(
          'A-1',
          'in_progress'
        )
      ).rejects.toMatchObject({ kind: 'auth' });
    });
  });
});
