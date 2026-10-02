import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { isProviderRequestError } from '../src/main/providers/provider-errors';
import { JIRA_EVENT_WINDOW_MARGIN_MINUTES } from '../src/main/providers/provider-constants';
import { ArgumentException } from '../src/shared/dtos';
import { PROVIDER_EVENT_SUMMARY_MAX_CHARS } from '../src/shared/provider-events';

const SITE = 'https://acme.atlassian.net';
const ME = 'acc-me';
const ALICE = { accountId: 'acc-alice', displayName: 'Alice Martin' };
const SELF = { accountId: ME, displayName: 'Me' };
const SINCE = '2026-10-01T10:00:00.000Z';
/** Jira's own format: numeric offset, no colon. 12:05+0200 is 10:05Z. */
const AFTER = '2026-10-01T12:05:00.000+0200';
const BEFORE = '2026-10-01T11:59:00.000+0200';

type Json = Record<string, unknown>;

function ok(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as unknown as Response;
}

function adf(...content: Json[]): Json {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] };
}

function issue(overrides: { fields?: Json; histories?: Json[]; comments?: Json[]; changelogTotal?: number; commentTotal?: number } = {}): Json {
  const histories = overrides.histories ?? [];
  const comments = overrides.comments ?? [];
  return {
    id: '10042',
    key: 'SCRUM-42',
    fields: {
      summary: 'Rework the pause menu',
      created: '2026-09-01T09:00:00.000+0200',
      creator: ALICE,
      reporter: ALICE,
      assignee: SELF,
      comment: { comments, total: overrides.commentTotal ?? comments.length },
      ...overrides.fields
    },
    changelog: { histories, total: overrides.changelogTotal ?? histories.length }
  };
}

function history(id: string, author: Json, items: Json[], created = AFTER): Json {
  return { id, author, created, items };
}

/**
 * Jira's activity, as provider events.
 *
 * Jira Cloud has no notifications API, so these are read off a search with
 * changelog and comments. The cases that matter are the ones a wrong reading
 * would turn into noise: the user's own changes, which must never notify them,
 * and the edges of the window, which must neither drop nor repeat an event.
 */
describe('Jira events', () => {
  let fetchFn: Mock<(input: string) => Promise<Response>>;
  let provider: JiraProvider;
  let issues: Json[];
  let pages: Array<{ issues: Json[]; nextPageToken?: string; isLast?: boolean }> | null;
  let myself: Json;

  const urls = (): URL[] => fetchFn.mock.calls.map(call => new URL(String(call[0])));
  const calls = (path: string): URL[] => urls().filter(url => url.pathname === path);

  beforeEach(async () => {
    issues = [];
    pages = null;
    myself = { accountId: ME, displayName: 'Me' };
    fetchFn = vi.fn(async (input: string): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname === '/rest/api/3/myself') return ok(myself);
      if (url.pathname === '/rest/api/3/search/jql') {
        if (!pages) return ok({ issues, isLast: true });
        const token = url.searchParams.get('nextPageToken');
        return ok(pages[token ? Number(token) : 0]);
      }
      throw new Error(`No route for ${url.pathname}`);
    });
    provider = new JiraProvider({ fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined });
    await provider.initialize({ domain: SITE, jiraEmail: 'me@acme.test', jiraApiToken: 'token-123' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('GetEventsSince_AssignedToMeBySomeoneElse_IsAssigned', async () => {
    issues = [issue({ histories: [history('500', ALICE, [{ field: 'assignee', fieldId: 'assignee', from: null, to: ME, toString: 'Me' }])] })];

    const events = await provider.getEventsSince(SINCE);

    expect(events).toEqual([{
      id: 'jira:10042:history:500:assignee',
      providerId: 'jira',
      kind: 'assigned',
      taskKey: 'SCRUM-42',
      taskTitle: 'Rework the pause menu',
      actorName: 'Alice Martin',
      url: `${SITE}/browse/SCRUM-42`,
      occurredAtUtc: '2026-10-01T10:05:00.000Z'
    }]);
  });

  it('GetEventsSince_AssignedToSomeoneElse_IsNotNews', async () => {
    issues = [issue({ histories: [history('500', ALICE, [{ field: 'assignee', fieldId: 'assignee', from: ME, to: 'acc-bob' }])] })];

    expect(await provider.getEventsSince(SINCE)).toEqual([]);
  });

  it('GetEventsSince_StatusChange_SaysFromWhatToWhat', async () => {
    issues = [issue({ histories: [history('501', ALICE, [{ field: 'status', fieldId: 'status', fromString: 'To Do', toString: 'In Progress' }])] })];

    const [event] = await provider.getEventsSince(SINCE);

    expect(event).toMatchObject({ id: 'jira:10042:history:501:status', kind: 'status_changed', summary: 'To Do → In Progress' });
  });

  it('GetEventsSince_StatusItemWithoutToString_HasNoSummaryRatherThanSourceCode', async () => {
    // `item.toString` on an item without the field is Object.prototype's
    // function; read naively it would put "function toString() { [native
    // code] }" in a toast.
    issues = [issue({ histories: [history('502', ALICE, [{ field: 'status' }])] })];

    const [event] = await provider.getEventsSince(SINCE);

    expect(event.kind).toBe('status_changed');
    expect(event.summary).toBeUndefined();
  });

  it('GetEventsSince_Comment_IsCommentedWithAnExcerptAndALinkToIt', async () => {
    issues = [issue({ comments: [{ id: '9001', author: ALICE, created: AFTER, body: adf({ type: 'text', text: 'Looks good,   ship it' }) }] })];

    const [event] = await provider.getEventsSince(SINCE);

    expect(event).toMatchObject({
      id: 'jira:comment:9001',
      kind: 'commented',
      actorName: 'Alice Martin',
      summary: 'Looks good, ship it',
      url: `${SITE}/browse/SCRUM-42?focusedCommentId=9001`
    });
  });

  it('GetEventsSince_LongComment_IsCutToAnExcerpt', async () => {
    issues = [issue({ comments: [{ id: '9002', author: ALICE, created: AFTER, body: adf({ type: 'text', text: 'word '.repeat(100) }) }] })];

    const [event] = await provider.getEventsSince(SINCE);

    expect(event.summary!.length).toBe(PROVIDER_EVENT_SUMMARY_MAX_CHARS);
    expect(event.summary!.endsWith('…')).toBe(true);
  });

  it('GetEventsSince_CommentMentioningMe_IsAMention', async () => {
    issues = [issue({ comments: [
      { id: '9003', author: ALICE, created: AFTER, body: adf({ type: 'mention', attrs: { id: ME, text: '@Me' } }, { type: 'text', text: ' can you look?' }) },
      { id: '9004', author: ALICE, created: AFTER, body: adf({ type: 'mention', attrs: { id: 'acc-bob', text: '@Bob' } }) }
    ] })];

    const events = await provider.getEventsSince(SINCE);

    expect(events.map(e => [e.id, e.kind])).toEqual([
      ['jira:comment:9003', 'mentioned'],
      // Someone else's mention is still a comment on an issue the user follows.
      ['jira:comment:9004', 'commented']
    ]);
  });

  it('GetEventsSince_MyOwnChanges_NeverNotifyMe', async () => {
    // Every status the app moves for the user comes back in the changelog
    // under their name; reporting it would notify them of their own clicks.
    issues = [issue({
      fields: { created: AFTER, creator: SELF, reporter: SELF },
      histories: [history('503', SELF, [{ field: 'status', fieldId: 'status', toString: 'Done' }])],
      comments: [{ id: '9005', author: SELF, created: AFTER, body: adf({ type: 'text', text: 'done' }) }]
    })];

    expect(await provider.getEventsSince(SINCE)).toEqual([]);
  });

  it('GetEventsSince_IssueCreatedForMe_IsAssigned', async () => {
    // An assignee set at creation leaves no changelog entry.
    issues = [issue({ fields: { created: AFTER } })];

    const [event] = await provider.getEventsSince(SINCE);

    expect(event).toMatchObject({ id: 'jira:10042:created', kind: 'assigned', actorName: 'Alice Martin' });
  });

  it('GetEventsSince_AtOrBeforeTheCursor_IsDropped', async () => {
    issues = [issue({
      histories: [
        history('504', ALICE, [{ field: 'status', toString: 'Done' }], BEFORE),
        history('505', ALICE, [{ field: 'status', toString: 'Done' }], '2026-10-01T12:00:00.000+0200')
      ],
      comments: [{ id: '9006', author: ALICE, created: BEFORE, body: adf() }]
    })];

    expect(await provider.getEventsSince(SINCE)).toEqual([]);
  });

  it('GetEventsSince_Search_CoversTheGapPlusAMarginInRelativeMinutes', async () => {
    // Relative, because JQL reads an absolute date in the Jira profile's
    // timezone, which is neither this machine's nor UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(SINCE) + 150_000));

    await provider.getEventsSince(SINCE);

    const [search] = calls('/rest/api/3/search/jql');
    const jql = search.searchParams.get('jql')!;
    expect(jql).toContain(`updated >= -${3 + JIRA_EVENT_WINDOW_MARGIN_MINUTES}m`);
    expect(jql).toContain('assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()');
    expect(search.searchParams.get('expand')).toBe('changelog');
    expect(search.searchParams.get('fields')).toContain('comment');
  });

  it('GetEventsSince_SeveralPages_FollowsTheToken', async () => {
    const second = { ...issue({ fields: { created: AFTER } }), id: '10043', key: 'SCRUM-43' };
    pages = [
      { issues: [issue({ fields: { created: AFTER } })], nextPageToken: '1', isLast: false },
      { issues: [second], isLast: true }
    ];

    const events = await provider.getEventsSince(SINCE);

    expect(events.map(e => e.taskKey)).toEqual(['SCRUM-42', 'SCRUM-43']);
    expect(calls('/rest/api/3/search/jql')[1].searchParams.get('nextPageToken')).toBe('1');
  });

  it('GetEventsSince_TruncatedChangelog_ReadsItsNewestPage', async () => {
    issues = [issue({ changelogTotal: 150 })];
    const route = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/rest/api/3/issue/10042/changelog') {
        return ok({ values: [history('600', ALICE, [{ field: 'status', toString: 'Done' }])] });
      }
      return route(input);
    });

    const events = await provider.getEventsSince(SINCE);

    const [changelog] = calls('/rest/api/3/issue/10042/changelog');
    expect(changelog.searchParams.get('startAt')).toBe('50');
    expect(events.map(e => e.id)).toEqual(['jira:10042:history:600:status']);
  });

  it('GetEventsSince_TruncatedComments_ReadsTheNewest', async () => {
    issues = [issue({ commentTotal: 300 })];
    const route = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/rest/api/3/issue/10042/comment') {
        return ok({ comments: [{ id: '9100', author: ALICE, created: AFTER, body: adf() }] });
      }
      return route(input);
    });

    const events = await provider.getEventsSince(SINCE);

    expect(calls('/rest/api/3/issue/10042/comment')[0].searchParams.get('orderBy')).toBe('-created');
    expect(events.map(e => e.id)).toEqual(['jira:comment:9100']);
  });

  it('GetEventsSince_TruncatedChangelogUnreadable_Throws', async () => {
    issues = [issue({ changelogTotal: 150 })];
    const route = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (input: string) =>
      new URL(input).pathname.endsWith('/changelog') ? ok({}) : route(input));

    await expect(provider.getEventsSince(SINCE)).rejects.toSatisfy(isProviderRequestError);
  });

  it('GetEventsSince_MyselfAskedOncePerConfiguration', async () => {
    await provider.getEventsSince(SINCE);
    await provider.getEventsSince(SINCE);
    expect(calls('/rest/api/3/myself')).toHaveLength(1);

    // Other credentials may be another account.
    await provider.initialize({ domain: SITE, jiraEmail: 'other@acme.test', jiraApiToken: 'token-456' });
    await provider.getEventsSince(SINCE);
    expect(calls('/rest/api/3/myself')).toHaveLength(2);
  });

  it('GetEventsSince_MyselfWithoutAnAccountId_Throws', async () => {
    // Without it, the user's own changes cannot be told apart from anyone's.
    myself = { displayName: 'Me' };

    await expect(provider.getEventsSince(SINCE)).rejects.toSatisfy(isProviderRequestError);
    expect(calls('/rest/api/3/search/jql')).toHaveLength(0);
  });

  it('GetEventsSince_SearchWithoutIssues_Throws', async () => {
    fetchFn.mockImplementation(async (input: string) =>
      new URL(input).pathname === '/rest/api/3/myself' ? ok(myself) : ok({ errorMessages: [] }));

    await expect(provider.getEventsSince(SINCE)).rejects.toSatisfy(isProviderRequestError);
  });

  it('GetEventsSince_Unauthorised_ThrowsRatherThanReportingNothing', async () => {
    fetchFn.mockResolvedValue({ ok: false, status: 401, headers: { get: () => null }, text: async () => '', json: async () => ({}) } as unknown as Response);

    await expect(provider.getEventsSince(SINCE)).rejects.toSatisfy(isProviderRequestError);
  });

  it('GetEventsSince_NotConfigured_Throws', async () => {
    await expect(new JiraProvider().getEventsSince(SINCE)).rejects.toSatisfy(isProviderRequestError);
  });

  it('GetEventsSince_CursorNotATimestamp_Throws', async () => {
    await expect(provider.getEventsSince('yesterday')).rejects.toBeInstanceOf(ArgumentException);
  });

  it('GetEventsInboxUrl_PointsAtYourWork', () => {
    expect(provider.getEventsInboxUrl()).toBe(`${SITE}/jira/your-work`);
    expect(new JiraProvider().getEventsInboxUrl()).toBeNull();
  });
});
