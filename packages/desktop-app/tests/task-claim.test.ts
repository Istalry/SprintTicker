import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { createFakeJira, FAKE_ACCOUNT } from '../../../scripts/fake-jira.js';
import { createFakeOpenProject, FAKE_USER } from '../../../scripts/fake-openproject.js';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { isProviderRequestError } from '../src/main/providers/provider-errors';
import { taskLeftLabel } from '../src/shared/task-left';
import { describeClaimFailed, describeTaskTaken, describeTaskTakenForBar } from '../src/shared/provider-events';

/**
 * Assigning a task nobody owns to the user, on each provider, over a real
 * socket to the fakes. The read before the write is the point: a task
 * someone took since the sync must be left with them.
 */
describe('Assigning a task to the user on Jira', () => {
  const SITE = 'https://acme.atlassian.net';
  let fake: ReturnType<typeof createFakeJira>;
  let origin: string;
  let provider: JiraProvider;

  beforeAll(async () => {
    fake = createFakeJira({ issues: 3, quiet: true });
    await new Promise<void>(resolve => fake.server.listen(0, '127.0.0.1', () => resolve()));
    origin = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => fake.server.close(() => resolve()));
  });

  beforeEach(async () => {
    fake.requests.length = 0;
    provider = new JiraProvider({
      fetchFn: ((input: RequestInfo | URL, init?: RequestInit) => fetch(String(input).replace(SITE, origin), init)) as typeof fetch,
      sleepFn: async (): Promise<void> => undefined
    });
    await provider.initialize({ domain: SITE, jiraEmail: 'dev@acme.test', jiraApiToken: 'token-123' });
  });

  const issue = (key: string) => fake.issues.find(i => i.key === key)!;
  const puts = () => fake.requests.filter(r => r.method === 'PUT');

  it('AssignToMe_NobodysIssue_AssignsItToTheUser', async () => {
    issue('FAKE1-1').fields.assignee = null;

    await expect(provider.assignToMe('FAKE1-1')).resolves.toEqual({ outcome: 'assigned' });

    expect(puts()).toEqual([expect.objectContaining({ pathname: '/rest/api/3/issue/FAKE1-1/assignee', body: { accountId: FAKE_ACCOUNT.accountId } })]);
    expect(issue('FAKE1-1').fields.assignee).toEqual(FAKE_ACCOUNT);
  });

  it('AssignToMe_TakenMeanwhile_LeavesItWithThemAndNamesThem', async () => {
    issue('FAKE1-2').fields.assignee = { accountId: 'bob', displayName: 'Bob Stone' };

    await expect(provider.assignToMe('FAKE1-2')).resolves.toEqual({ outcome: 'taken', assigneeName: 'Bob Stone' });

    expect(puts()).toEqual([]);
    expect(issue('FAKE1-2').fields.assignee).toEqual({ accountId: 'bob', displayName: 'Bob Stone' });
  });

  it('AssignToMe_AlreadyTheUsers_WritesNothing', async () => {
    issue('FAKE1-3').fields.assignee = { ...FAKE_ACCOUNT };

    await expect(provider.assignToMe('FAKE1-3')).resolves.toEqual({ outcome: 'already_mine' });

    expect(puts()).toEqual([]);
  });

  it('AssignToMe_IssueGone_Throws', async () => {
    const failure = await provider.assignToMe('FAKE1-99').catch((err: unknown) => err);

    expect(isProviderRequestError(failure) && failure.status).toBe(404);
  });
});

describe('Assigning a task to the user on OpenProject', () => {
  let fake: ReturnType<typeof createFakeOpenProject>;
  let provider: OpenProjectProvider;
  const WP = 101;

  beforeAll(async () => {
    fake = createFakeOpenProject({ quiet: true });
    await new Promise<void>(resolve => fake.server.listen(0, '127.0.0.1', () => resolve()));
    provider = new OpenProjectProvider();
    await provider.initialize({ domain: `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`, apiToken: 'any-key-works' });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => fake.server.close(() => resolve()));
  });

  beforeEach(() => {
    fake.requests.length = 0;
    fake.assignees.clear();
    fake.lockVersions.clear();
    fake.hooks.onWorkPackagePatch = null;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  const patches = () => fake.requests.filter(r => r.method === 'PATCH');

  it('AssignToMe_NobodysWorkPackage_AssignsItUnderItsLockVersion', async () => {
    fake.assignees.set(WP, null);
    fake.lockVersions.set(WP, 4);

    await expect(provider.assignToMe(`OP-${WP}`)).resolves.toEqual({ outcome: 'assigned' });

    expect(fake.assignees.has(WP)).toBe(false); // the user's
    expect(fake.lockVersions.get(WP)).toBe(5);
    expect(patches()).toHaveLength(1);
  });

  it('AssignToMe_TeammatesWorkPackage_LeavesItWithThemAndNamesThem', async () => {
    fake.assignees.set(WP, { id: 12, name: 'Bob Stone' });

    await expect(provider.assignToMe(String(WP))).resolves.toEqual({ outcome: 'taken', assigneeName: 'Bob Stone' });

    expect(patches()).toEqual([]);
    expect(fake.assignees.get(WP)).toEqual({ id: 12, name: 'Bob Stone' });
  });

  it('AssignToMe_AlreadyTheUsers_WritesNothing', async () => {
    await expect(provider.assignToMe(String(WP))).resolves.toEqual({ outcome: 'already_mine' });

    expect(patches()).toEqual([]);
  });

  it('AssignToMe_TakenBetweenTheReadAndTheWrite_IsLeftWithThem', async () => {
    // The lock is what makes this safe: the write carries the version read,
    // and is refused once someone else's edit has moved it on.
    fake.assignees.set(WP, null);
    fake.hooks.onWorkPackagePatch = id => {
      fake.hooks.onWorkPackagePatch = null;
      fake.assignees.set(id, { id: 12, name: 'Bob Stone' });
      fake.lockVersions.set(id, 2);
    };

    await expect(provider.assignToMe(String(WP))).resolves.toEqual({ outcome: 'taken', assigneeName: 'Bob Stone' });

    expect(fake.assignees.get(WP)).toEqual({ id: 12, name: 'Bob Stone' });
    expect(patches()).toHaveLength(1);
  });

  it('AssignToMe_SomethingElseEditedMeanwhile_ReadsAgainAndAssigns', async () => {
    fake.assignees.set(WP, null);
    fake.hooks.onWorkPackagePatch = id => {
      fake.hooks.onWorkPackagePatch = null;
      fake.lockVersions.set(id, 2);
    };

    await expect(provider.assignToMe(String(WP))).resolves.toEqual({ outcome: 'assigned' });

    expect(fake.assignees.has(WP)).toBe(false);
    expect(patches()).toHaveLength(2);
  });

  it('AssignToMe_RefusedTwice_Throws', async () => {
    // One fresh read and write, never a loop against a busy work package.
    fake.assignees.set(WP, null);
    fake.hooks.onWorkPackagePatch = id => fake.lockVersions.set(id, (fake.lockVersions.get(id) ?? 1) + 1);

    const failure = await provider.assignToMe(String(WP)).catch((err: unknown) => err);

    expect(isProviderRequestError(failure) && failure.status).toBe(409);
    expect(patches()).toHaveLength(2);
  });

  it('AssignToMe_PatchNamesTheUser', async () => {
    fake.assignees.set(WP, null);

    await provider.assignToMe(String(WP));

    expect(patches()[0].body).toMatchObject({ _links: { assignee: { href: `/api/v3/users/${FAKE_USER.id}` } } });
  });
});

describe('ProviderManager.assignToMeFor', () => {
  let dbConn: DatabaseConnection;
  let manager: ProviderManager;

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    manager = new ProviderManager(new SettingsRepository(dbConn));
  });

  afterEach(() => dbConn.close());

  it('AssignToMeFor_ProviderWithoutAssignment_AnswersNull', async () => {
    await expect(manager.assignToMeFor('adhoc', 'X-1')).resolves.toBeNull();
  });

  it('AssignToMeFor_UnknownProvider_Throws', async () => {
    await expect(manager.assignToMeFor('nowhere', 'X-1')).rejects.toThrow(/nowhere/);
  });

  it('AssignToMeFor_ProviderNotSetUp_ThrowsNotConfigured', async () => {
    const failure = await manager.assignToMeFor('jira', 'X-1').catch((err: unknown) => err);

    expect(isProviderRequestError(failure) && failure.kind).toBe('not_configured');
  });
});

describe('what the user is told', () => {
  it('TaskLeftLabel_ReassignedWithAName_NamesTheOwner', () => {
    expect(taskLeftLabel('reassigned', 'Bob Stone')).toBe('Assigned to Bob Stone');
    expect(taskLeftLabel(undefined, ' Bob ')).toBe('Assigned to Bob');
    expect(taskLeftLabel('reassigned', '  ')).toBe('No longer assigned to you');
    expect(taskLeftLabel('closed', 'Bob')).toBe('Closed on the provider');
  });

  it('Describe_NoNames_FallBackToWords', () => {
    expect(describeTaskTaken('', '')).toMatchObject({ title: 'This task is taken' });
    expect(describeTaskTaken('', '').body).toMatch(/^Someone else took it/);
    expect(describeTaskTakenForBar(' ')).toEqual({ title: 'TAKEN', body: 'someone else' });
    expect(describeClaimFailed('', '').title).toBe('The task was not assigned to you');
    expect(describeClaimFailed('', '').body).toMatch(/^Your provider could not/);
  });
});
