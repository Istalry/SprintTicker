import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeProviderApi, OTHER } from '../../../scripts/fake-provider-api.js';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { SecretStore } from '../src/main/db/secret-store';
import { ProviderManager, providerCapabilities } from '../src/main/providers/provider-manager';
import { CustomServerProvider } from '../src/main/providers/custom-server-provider';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { WorklogCorrectionService } from '../src/main/services/worklog-correction-service';
import { ProviderEventService } from '../src/main/services/provider-event-service';
import { ToastRequest } from '../src/main/services/toast-presenter';
import { ProviderSettingKey } from '../src/shared/provider-settings';
import { ProviderId } from '../src/shared/provider-names';
import { TaskOwnership } from '../src/shared/task-ownership';
import { serverUrlProblem, sanitizeServerUrl } from '../src/shared/custom-server';
import { isProviderRequestError } from '../src/main/providers/provider-errors';

/**
 * The SprintTicker Provider API client (`PROVIDER-API.md` §15, step 6)
 * against `scripts/fake-provider-api.js` over a real socket: a sync, a lost
 * answer resent without a duplicate, an expired token, a task taken during
 * an assignment, a task closed mid-session, a refused `finish` -- and
 * everything wired the way main wires it, settings to worker.
 *
 * Every test ends by checking the fake's `violations`: what the client did
 * against the contract, recorded rather than refused.
 */
const LIVE_SERVER_TIMEOUT_MS = 15_000;

type Fake = ReturnType<typeof createFakeProviderApi>;

const CATALOG = [
  {
    id: 'p-1',
    key: 'PLAT',
    name: 'Platform',
    tasks: [
      { id: 't-1', key: 'PLAT-1', title: 'Mine, in progress', status: 'in_progress', priorityRank: 1, description: 'Cache\n the list' },
      { id: 't-2', key: 'PLAT-2', title: 'Nobody has it', status: 'todo', assignee: null },
      { id: 't-3', key: 'PLAT-3', title: 'Rin is on it', status: 'in_progress', assignee: OTHER },
      { id: 't-4', key: 'PLAT-4', title: 'Rin later', status: 'todo', assignee: OTHER },
      { id: 't-5', key: 'PLAT-5', title: 'Mine, to review', status: 'done' }
    ]
  },
  { id: 'p-2', key: 'OPS', name: 'Operations', tasks: [{ id: 't-6', key: 'OPS-1', title: 'Rotate keys', status: 'todo' }] }
];

describe('CustomServerProvider against the fake Provider API', { timeout: LIVE_SERVER_TIMEOUT_MS }, () => {
  let fake: Fake;
  let baseUrl: string;
  let db: DatabaseConnection;
  let settings: SettingsRepository;
  let projects: ProjectRepository;
  let tasks: TaskRepository;
  let worklogs: WorklogRepository;

  async function start(overrides: Record<string, unknown> = {}): Promise<void> {
    fake = createFakeProviderApi({ catalog: CATALOG, pageSize: 2, quiet: true, ...overrides });
    baseUrl = await fake.listen(0);
  }

  /** Settings, manager and worker, as main wires them; the provider read before the test goes on. */
  async function wire(token = 'fake-provider-token'): Promise<{ manager: ProviderManager; worker: OfflineSyncWorker; provider: CustomServerProvider }> {
    settings.setSetting(ProviderSettingKey.CUSTOM_SERVER_URL, baseUrl);
    new SecretStore(settings).setSecret(ProviderSettingKey.CUSTOM_SERVER_TOKEN, token);
    const manager = new ProviderManager(settings, { appVersion: '2.0.0' });
    manager.setActiveProviderId(ProviderId.CUSTOM);
    const provider = manager.getProvider(ProviderId.CUSTOM) as CustomServerProvider;
    // The manager's own initialize is not awaited; this one is, so the
    // capabilities are read before anything asks for them.
    await provider.initialize({ baseUrl, apiToken: token });
    return { manager, provider, worker: new OfflineSyncWorker(manager, worklogs, projects, tasks) };
  }

  function queue(id: string, taskId = 't-1', durationSeconds = 5400, startedAtUtc = '2026-10-23T07:42:10.000Z'): void {
    tasks.ensureTaskExists({ id: taskId, key: taskId.toUpperCase(), title: 'Fake', projectId: 'p-1' });
    worklogs.saveWorklog({ id: `w-${id}`, sessionId: 's', taskId, durationSeconds, startedAtUtc, comment: 'Cache the list', createdAtUtc: startedAtUtc });
    worklogs.enqueueSyncItem({ id, providerId: ProviderId.CUSTOM, taskId, durationSeconds, startedAtUtc, comment: 'Cache the list', worklogId: `w-${id}` });
  }

  const liveWorklogs = () => [...fake.state.worklogs.values()].filter(w => !w.deleted && !String(w.clientRef).startsWith('server_'));

  beforeEach(() => {
    db = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(db);
    projects = new ProjectRepository(db);
    tasks = new TaskRepository(db);
    worklogs = new WorklogRepository(db, { holdMs: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    expect(fake.state.violations).toEqual([]);
    await fake.close();
    db.close();
    vi.restoreAllMocks();
  });

  it('Sync_EveryPage_CachesTheProjectsAndTheDefaultScopeWithOwners', async () => {
    await start();
    const { worker } = await wire();

    const result = await worker.syncTasksAndProjects();

    expect(result.status).toBe('synced');
    expect(projects.getAllProjects().filter(p => p.providerId === ProviderId.CUSTOM).map(p => p.key).sort()).toEqual(['OPS', 'PLAT']);
    const plat = tasks.getTasksByProjectId('p-1');
    // A teammate's todo is out of scope (6.3); the rest is listed, each with its owner.
    expect(plat.map(t => [t.key, t.ownership ?? TaskOwnership.MINE]).sort()).toEqual([
      ['PLAT-1', TaskOwnership.MINE],
      ['PLAT-2', TaskOwnership.UNASSIGNED],
      ['PLAT-3', TaskOwnership.OTHER],
      ['PLAT-5', TaskOwnership.MINE]
    ]);
    expect(plat.find(t => t.key === 'PLAT-3')).toMatchObject({ assigneeName: OTHER.displayName });
    expect(plat.find(t => t.key === 'PLAT-1')).toMatchObject({ priorityRank: 1, description: 'Cache the list' });
    // Every request names the client, as the contract asks (3.2).
    expect(fake.state.requests.length).toBeGreaterThan(0);
  });

  it('Capabilities_NameTheServerAndAttachOnlyWhatItOffers', async () => {
    await start({ disableCapabilities: ['assign', 'events', 'calendar'], minimumWorklogSeconds: 120 });
    const { manager, provider } = await wire();

    expect(provider.providerName).toBe('Fake Provider');
    expect(provider.minimumLoggableSeconds).toBe(120);
    expect(manager.getActiveCapabilities()).toMatchObject({
      providerId: ProviderId.CUSTOM,
      providerName: 'Fake Provider',
      canAssign: false,
      canTransition: true,
      canFindWorklog: true,
      canFetchByKey: true,
      hasHolidays: false,
      hasEvents: false
    });
    // The name is kept, so the window names the server before the next read.
    expect(settings.getSetting(ProviderSettingKey.CUSTOM_SERVER_NAME, '')).toBe('Fake Provider');
  });

  it('Send_TheAnswerLost_TheResendIsTheSameWorklog', async () => {
    // The server stores the worklog, and the connection drops before the
    // answer: the client cannot tell that from a failure, and sends again.
    // Idempotent on clientRef (6.4), the second send is the first worklog.
    await start({ loseWorklogAnswers: 1 });
    const { worker } = await wire();
    queue('sync_1700000000000_a1b2');

    await worker.processPendingQueue();
    expect(worklogs.getSyncItem('sync_1700000000000_a1b2')?.status).not.toBe('SYNCED');
    expect(liveWorklogs()).toHaveLength(1);

    db.getDb().prepare("UPDATE worklog_sync_queue SET status = 'PENDING', next_attempt_at_utc = NULL WHERE id = ?").run('sync_1700000000000_a1b2');
    await worker.processPendingQueue();

    const stored = liveWorklogs();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ clientRef: 'sync_1700000000000_a1b2', taskId: 't-1', durationSeconds: 5400, comment: expect.stringMatching(/^Cache the list \[#/) });
    expect(worklogs.getSyncItem('sync_1700000000000_a1b2')).toMatchObject({ status: 'SYNCED', remoteWorklogId: stored[0].id });
  });

  it('Send_TheDayIsTheUsersOwn_NotTheServersReading', async () => {
    await start();
    const { worker } = await wire();
    // 23:30 local on the 23rd: the day is the one on this machine's calendar.
    const lateEvening = new Date(2026, 9, 23, 23, 30, 0).toISOString();
    queue('sync_late', 't-1', 1800, lateEvening);

    await worker.processPendingQueue();

    expect(liveWorklogs()[0]).toMatchObject({ day: '2026-10-23' });
  });

  it('Correction_PatchThenDelete_ReachTheServerThroughTheQueue', async () => {
    await start();
    const { manager, worker } = await wire();
    const service = new WorklogCorrectionService(worklogs, manager, () => undefined);
    const startedAt = '2026-10-23T07:42:10.000Z';
    queue('sync_corr', 't-1', 5400, startedAt);
    await worker.processPendingQueue();

    service.correct('w-sync_corr', { durationSeconds: 3600, startedAtUtc: startedAt, comment: 'Cache the list, part one' });
    await worker.processPendingQueue();
    expect(liveWorklogs()[0]).toMatchObject({ durationSeconds: 3600, comment: expect.stringMatching(/^Cache the list, part one \[#/) });

    // Sent before its id was kept: found again by its clientRef, not a search.
    db.getDb().prepare('UPDATE worklog_sync_queue SET remote_worklog_id = NULL').run();
    service.correct('w-sync_corr', { durationSeconds: 1800, startedAtUtc: startedAt, comment: 'Cache the list, part one' });
    await worker.processPendingQueue();
    expect(liveWorklogs()[0]).toMatchObject({ durationSeconds: 1800 });

    service.remove('w-sync_corr');
    await worker.processPendingQueue();
    expect(liveWorklogs()).toHaveLength(0);
    expect(worklogs.getSyncQueueSnapshot().counts).toMatchObject({ pending: 0, failed: 0 });
  });

  it('ExpiredToken_SyncFailsAndTheListsStay', async () => {
    await start();
    const { worker } = await wire();
    await worker.syncTasksAndProjects();
    const before = tasks.getTasksByProjectId('p-1').length;
    fake.state.faults.expiredToken = true;

    const result = await worker.syncTasksAndProjects();

    expect(result.status).toBe('failed');
    expect(tasks.getTasksByProjectId('p-1')).toHaveLength(before);
  });

  it('TestConnection_AWrongToken_IsRefusedNotEmpty', async () => {
    await start();
    const { provider } = await wire('not-the-token');

    const failure = await provider.getProjects().catch(err => err);

    expect(isProviderRequestError(failure) && failure.kind).toBe('auth');
  });

  it('Assign_TakenMeanwhile_LeftWithWhoeverTookIt', async () => {
    await start();
    const { provider } = await wire();
    fake.state.faults.takeOnAssign = OTHER;

    expect(await provider.assignToMe!('t-2')).toEqual({ outcome: 'taken', assigneeName: OTHER.displayName });
    expect(fake.state.tasks.get('t-2').assignee).toMatchObject({ id: OTHER.id });
  });

  it('Assign_NobodysTask_BecomesMine', async () => {
    await start();
    const { provider } = await wire();

    expect(await provider.assignToMe!('t-2')).toEqual({ outcome: 'assigned' });
    expect(await provider.assignToMe!('t-2')).toEqual({ outcome: 'already_mine' });
  });

  it('Standing_ClosedReassignedOrGone_EachToldApart', async () => {
    await start();
    const { provider } = await wire();

    expect(await provider.getTaskStanding!('t-1')).toEqual({ state: 'open', ownership: TaskOwnership.MINE });
    fake.setAssignee('t-1', OTHER);
    expect(await provider.getTaskStanding!('t-1')).toEqual({ state: 'open', ownership: TaskOwnership.OTHER, assigneeName: OTHER.displayName });
    fake.closeTask('t-1');
    expect(await provider.getTaskStanding!('t-1')).toEqual({ state: 'closed' });
    fake.deleteTask('t-6');
    expect(await provider.getTaskStanding!('t-6')).toEqual({ state: 'gone' });
  });

  it('Transitions_StartAndFinish_AreIntents_AndARefusalIsFalse', async () => {
    await start({ refuseTransitions: [{ intent: 'finish', message: 'Review first.' }] });
    const { provider } = await wire();

    expect(await provider.updateTaskStatus('t-6', 'in_progress')).toBe(true);
    expect(fake.state.tasks.get('t-6').status).toBe('in_progress');
    expect(await provider.updateTaskStatus('t-6', 'done')).toBe(false);
    expect(fake.state.tasks.get('t-6').status).toBe('in_progress');
  });

  it('FetchByKey_AnyCase_OrNullForNone', async () => {
    await start();
    const { provider } = await wire();

    expect(await provider.getTaskByKey!('plat-1')).toMatchObject({ id: 't-1', projectId: 'p-1', key: 'PLAT-1' });
    expect(await provider.getTaskByKey!('NOPE-9')).toBeNull();
  });

  it('TaskPage_OnlyUnderTheServersSite', async () => {
    await start();
    const { provider } = await wire();
    await provider.getTasks('p-1');

    expect(provider.getTaskPageUrl({ id: 't-1', key: 'PLAT-1' })).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/tasks\/t-1$/);
    expect(provider.getTaskPageUrl({ id: 'never-listed', key: 'X-1' })).toBeNull();
  });

  it('DaysOff_FromTheActiveServersCalendar', async () => {
    await start({ nonWorkingDays: ['2026-12-25'] });
    const { manager } = await wire();

    expect(await manager.getNonWorkingDays('2026-12-20', '2027-01-05')).toEqual(['2026-12-25']);
  });

  it('Events_InclusiveSince_EachShownOnce', async () => {
    await start();
    const { manager } = await wire();
    const toasts: ToastRequest[] = [];
    const events = new ProviderEventService({
      getActiveProvider: () => manager.getActiveProvider(),
      settings,
      toasts: { show: t => { toasts.push(t); return true; } },
      now: () => new Date('2026-10-23T07:00:00Z')
    });

    expect(await events.poll()).toBe('baseline');
    fake.addEvent({ kind: 'commented', taskId: 't-1', summary: 'Looks good', occurredAt: '2026-10-23T07:41:02Z' });
    expect(await events.poll()).toBe('delivered');
    // A second event in the same second, after the first was read.
    fake.addEvent({ kind: 'assigned', taskId: 't-2', occurredAt: '2026-10-23T07:41:02Z' });
    expect(await events.poll()).toBe('delivered');
    expect(await events.poll()).toBe('nothing_new');

    expect(toasts.map(t => t.title)).toEqual(['Grace Hopper commented on PLAT-1', 'Grace Hopper assigned you PLAT-2']);
    events.stop();
  });

  it('TodayTotal_IsTheServersSum', async () => {
    await start();
    const { provider } = await wire();
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    fake.recordWorklog({ taskId: 't-1', startedAt: '2026-10-23T07:00:00Z', day, durationSeconds: 1800 });

    expect((await provider.reconcileRemoteState()).remoteLoggedTimeToday).toBe(1800);
  });
});

describe('CustomServerProvider without a server', () => {
  it('ServerUrlProblem_HttpOffThisMachineOrNoVersion_IsRefused', () => {
    expect(serverUrlProblem('https://tracker.example.com/sprintticker/v1')).toBeNull();
    expect(serverUrlProblem('http://127.0.0.1:8097/sprintticker/v1')).toBeNull();
    expect(serverUrlProblem('http://tracker.example.com/sprintticker/v1')).toMatch(/https/);
    expect(serverUrlProblem('https://tracker.example.com/sprintticker')).toMatch(/\/v1/);
    expect(serverUrlProblem('')).toMatch(/Enter/);
    // A bare host is https, never http: the token is a permanent credential.
    expect(sanitizeServerUrl('tracker.example.com/st/v1/')).toBe('https://tracker.example.com/st/v1');
  });

  it('Capabilities_AnotherContract_IsRefusedAndAttachesNothing', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ contract: 2, server: { name: 'Next', version: '9' }, siteUrl: 'https://x.test', minimumWorklogSeconds: 1, capabilities: ['assign'] }), { status: 200 }));
    const provider = new CustomServerProvider({ http: { fetchFn: fetchFn as unknown as typeof fetch } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await provider.initialize({ baseUrl: 'https://x.test/v1', apiToken: 't' });

    expect(provider.assignToMe).toBeUndefined();
    const failure = await provider.getProjects().catch(err => err);
    expect(String(failure.message)).toMatch(/contract 2/);
    expect(providerCapabilities(provider)).toMatchObject({ canAssign: false, providerName: 'Your server' });
  });

  it('Requests_CarryTheBearerTokenAndTheUserAgent', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ contract: 1, server: { name: 'S', version: '1' }, siteUrl: 'https://x.test', minimumWorklogSeconds: 1, capabilities: [] }), { status: 200 }));
    const provider = new CustomServerProvider({ appVersion: '2.0.0', http: { fetchFn: fetchFn as unknown as typeof fetch } });

    await provider.initialize({ baseUrl: 'https://x.test/v1', apiToken: 'secret' });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.test/v1/capabilities');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret', Accept: 'application/json', 'User-Agent': 'SprintTicker/2.0.0' });
  });

  it('Initialize_NotConfigured_AsksNothing', async () => {
    const fetchFn = vi.fn();
    const provider = new CustomServerProvider({ http: { fetchFn: fetchFn as unknown as typeof fetch } });

    await provider.initialize({ baseUrl: '', apiToken: '' });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(provider.providerName).toBe('Your server');
    await expect(provider.getProjects()).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('LogTime_WithoutClientRef_IsRefused', async () => {
    const provider = new CustomServerProvider({ http: { fetchFn: vi.fn() as unknown as typeof fetch } });
    await expect(provider.logTime({ taskId: 't', durationSeconds: 60, startedAtUtc: '2026-10-23T07:00:00Z', comment: '', isAdHoc: false }))
      .rejects.toThrow(/clientRef/);
  });
});
