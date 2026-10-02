import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderEventService, ProviderEventBanner } from '../src/main/services/provider-event-service';
import { ToastRequest } from '../src/main/services/toast-presenter';
import { ITaskProvider } from '../src/main/providers/task-provider-interface';
import { ArgumentNullException } from '../src/shared/dtos';
import {
  DEFAULT_PROVIDER_EVENT_SETTINGS,
  LEGACY_MESSAGING_SETTINGS_KEY,
  MAX_PROVIDER_EVENT_POLL_SECONDS,
  MIN_PROVIDER_EVENT_POLL_SECONDS,
  PROVIDER_EVENT_CURSORS_KEY,
  PROVIDER_EVENT_FIRST_POLL_DELAY_MS,
  PROVIDER_EVENT_SETTINGS_KEY,
  ProviderEventDTO,
  ProviderEventKind,
  ProviderEventSettingsDTO,
  describeProviderEvent,
  describeProviderEventForBar,
  normaliseProviderEventSettings,
  summarizeProviderEvents
} from '../src/shared/provider-events';

const LOCAL_NOW = new Date('2026-10-01T12:00:00.000Z');

class MemorySettings {
  public readonly values = new Map<string, unknown>();
  getSetting<T>(key: string, defaultValue: T): T {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T;
  }
  setSetting<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
  cursor(providerId = 'openproject'): string | undefined {
    return (this.values.get(PROVIDER_EVENT_CURSORS_KEY) as Record<string, string> | undefined)?.[providerId];
  }
}

function event(id: number, occurredAtUtc: string, kind: ProviderEventKind = 'mentioned'): ProviderEventDTO {
  return {
    id: `openproject:${id}`,
    providerId: 'openproject',
    kind,
    taskKey: `OP-${id}`,
    taskTitle: `Task ${id}`,
    actorName: 'Alice',
    url: `https://op.test/work_packages/${id}`,
    occurredAtUtc
  };
}

function fakeProvider(getEventsSince?: (since: string) => Promise<ProviderEventDTO[]>): ITaskProvider {
  return {
    providerId: 'openproject',
    providerName: 'OpenProject',
    minimumLoggableSeconds: 1,
    initialize: async () => true,
    getProjects: async () => [],
    getTasks: async () => [],
    reconcileRemoteState: async () => ({ remoteLoggedTimeToday: null }),
    logTime: async () => ({ success: true }),
    updateTaskStatus: async () => true,
    ...(getEventsSince ? { getEventsSince, getEventsInboxUrl: () => 'https://op.test/notifications' } : {})
  };
}

describe('ProviderEventService', () => {
  let settings: MemorySettings;
  let toasts: ToastRequest[];
  let banners: ProviderEventBanner[];
  let barEnabled: boolean;
  let getEventsSince: ReturnType<typeof vi.fn>;
  let provider: ITaskProvider | null;
  let service: ProviderEventService;

  beforeEach(() => {
    settings = new MemorySettings();
    toasts = [];
    banners = [];
    barEnabled = true;
    getEventsSince = vi.fn().mockResolvedValue([]);
    provider = fakeProvider(getEventsSince);
    service = new ProviderEventService({
      getActiveProvider: () => provider,
      settings,
      toasts: { show: toast => { toasts.push(toast); return true; } },
      bar: { isEnabled: () => barEnabled, show: banner => { banners.push(banner); } },
      now: () => LOCAL_NOW
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    service.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Past the first poll, which only records where to start. */
  async function baseline(): Promise<void> {
    expect(await service.poll()).toBe('baseline');
  }

  it('Constructor_MissingDependency_Throws', () => {
    expect(() => new ProviderEventService(undefined as never)).toThrow(ArgumentNullException);
    expect(() => new ProviderEventService({ settings, toasts: { show: () => true } } as never)).toThrow(ArgumentNullException);
  });

  it('Poll_FirstEver_StartsFromNowWithoutAskingOrShowing', async () => {
    // A first launch must not replay every unread notification the user has.
    await baseline();

    expect(getEventsSince).not.toHaveBeenCalled();
    expect(settings.cursor()).toBe(LOCAL_NOW.toISOString());
    expect(toasts).toHaveLength(0);
  });

  it('Poll_NewEvent_ShowsAToastWithItsLinkAndABanner', async () => {
    await baseline();
    getEventsSince.mockResolvedValue([event(1, '2026-10-01T12:00:30Z')]);

    expect(await service.poll()).toBe('delivered');

    expect(getEventsSince).toHaveBeenCalledWith(LOCAL_NOW.toISOString());
    expect(toasts).toEqual([{ ...describeProviderEvent(event(1, '')), url: 'https://op.test/work_packages/1' }]);
    expect(banners).toEqual([{ appName: 'OpenProject', ...describeProviderEventForBar(event(1, '')) }]);
  });

  it('Poll_CursorAdvancesOnTheProvidersClockNotOurs', async () => {
    // The server runs 20 s behind this machine. Moving the cursor to our
    // "now" would put the next event, stamped by the server, before it.
    await baseline();
    getEventsSince.mockResolvedValue([event(1, '2026-10-01T12:00:10Z')]);

    await service.poll();

    expect(settings.cursor()).toBe('2026-10-01T12:00:10.000Z');
  });

  it('Poll_ProviderFails_KeepsTheCursorAndShowsNothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await baseline();
    getEventsSince.mockRejectedValue(new Error('HTTP 503'));

    expect(await service.poll()).toBe('failed');

    expect(settings.cursor()).toBe(LOCAL_NOW.toISOString());
    expect(toasts).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[ProviderEvents] OpenProject events unavailable: HTTP 503');

    // The next poll asks from the same place, so nothing is lost.
    getEventsSince.mockResolvedValue([event(1, '2026-10-01T12:01:00Z')]);
    await service.poll();
    expect(getEventsSince).toHaveBeenLastCalledWith(LOCAL_NOW.toISOString());
    expect(toasts).toHaveLength(1);
  });

  it('Poll_SameEventTwice_ShowsItOnce', async () => {
    await baseline();
    const same = event(1, '2026-10-01T12:00:30Z');
    getEventsSince.mockResolvedValue([same]);
    await service.poll();
    // A provider that answers inclusively hands it back on the next poll.
    settings.setSetting(PROVIDER_EVENT_CURSORS_KEY, { openproject: LOCAL_NOW.toISOString() });

    expect(await service.poll()).toBe('nothing_new');
    expect(toasts).toHaveLength(1);
  });

  it('Poll_EventAtOrBeforeTheCursor_IsIgnored', async () => {
    await baseline();
    getEventsSince.mockResolvedValue([event(1, LOCAL_NOW.toISOString()), event(2, '2026-10-01T11:00:00Z'), event(3, 'garbage')]);

    expect(await service.poll()).toBe('nothing_new');
    expect(settings.cursor()).toBe(LOCAL_NOW.toISOString());
  });

  it('Poll_KindTurnedOff_IsSkippedButStillMovesTheCursor', async () => {
    service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, kinds: { ...DEFAULT_PROVIDER_EVENT_SETTINGS.kinds, commented: false } });
    await baseline();
    getEventsSince.mockResolvedValue([event(1, '2026-10-01T12:00:30Z', 'commented'), event(2, '2026-10-01T12:00:20Z', 'assigned')]);

    await service.poll();

    expect(toasts.map(t => t.title)).toEqual(['Alice assigned you OP-2']);
    expect(settings.cursor()).toBe('2026-10-01T12:00:30.000Z');
  });

  it('Poll_AllOfTheirKindsOff_ReportsNothingNew', async () => {
    service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, kinds: { ...DEFAULT_PROVIDER_EVENT_SETTINGS.kinds, mentioned: false } });
    await baseline();
    getEventsSince.mockResolvedValue([event(1, '2026-10-01T12:00:30Z')]);

    expect(await service.poll()).toBe('nothing_new');
    expect(banners).toHaveLength(0);
  });

  it('Poll_SeveralEvents_ToastsEachOldestFirst', async () => {
    await baseline();
    getEventsSince.mockResolvedValue([event(3, '2026-10-01T12:00:30Z'), event(1, '2026-10-01T12:00:10Z'), event(2, '2026-10-01T12:00:20Z')]);

    await service.poll();

    expect(toasts.map(t => t.url)).toEqual([1, 2, 3].map(id => `https://op.test/work_packages/${id}`));
    // One banner, though: three in a row would each replace the last.
    expect(banners).toEqual([{ appName: 'OpenProject', title: '3 updates', body: '3 mentions' }]);
  });

  it('Poll_Burst_OneSummaryToastOpeningTheInbox', async () => {
    await baseline();
    getEventsSince.mockResolvedValue([
      event(1, '2026-10-01T12:00:10Z', 'mentioned'),
      event(2, '2026-10-01T12:00:20Z', 'commented'),
      event(3, '2026-10-01T12:00:30Z', 'commented'),
      event(4, '2026-10-01T12:00:40Z', 'assigned')
    ]);

    await service.poll();

    expect(toasts).toEqual([{
      title: '4 updates in OpenProject',
      body: '1 assignment, 1 mention, 2 comments',
      url: 'https://op.test/notifications'
    }]);
  });

  it('Poll_NoBar_ToastsOnly', async () => {
    barEnabled = false;
    await baseline();
    getEventsSince.mockResolvedValue([event(1, '2026-10-01T12:00:30Z')]);

    await service.poll();

    expect(toasts).toHaveLength(1);
    expect(banners).toHaveLength(0);
  });

  it('Poll_DestinationsOff_SendsToNeither', async () => {
    service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, showToasts: false, showOnBar: false });
    await baseline();
    getEventsSince.mockResolvedValue([event(1, '2026-10-01T12:00:30Z')]);

    await service.poll();

    expect(toasts).toHaveLength(0);
    expect(banners).toHaveLength(0);
  });

  it('Poll_Disabled_AsksNothing', async () => {
    service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, enabled: false });

    expect(await service.poll()).toBe('disabled');
    expect(getEventsSince).not.toHaveBeenCalled();
  });

  it('Poll_ProviderWithoutEvents_IsLeftAlone', async () => {
    provider = fakeProvider();

    expect(await service.poll()).toBe('unsupported');
    expect(settings.cursor()).toBeUndefined();
  });

  it('Poll_WhileOneIsRunning_DoesNotStartASecond', async () => {
    // A slow server must not have polls pile up behind it.
    await baseline();
    let release: (events: ProviderEventDTO[]) => void = () => undefined;
    getEventsSince.mockReturnValue(new Promise(resolve => { release = resolve; }));

    const first = service.poll();
    expect(await service.poll()).toBe('busy');
    release([]);
    expect(await first).toBe('nothing_new');
  });

  it('Poll_CursorsArePerProvider', async () => {
    settings.setSetting(PROVIDER_EVENT_CURSORS_KEY, { jira: '2026-09-01T00:00:00.000Z' });

    await baseline();

    expect(settings.cursor('jira')).toBe('2026-09-01T00:00:00.000Z');
    expect(settings.cursor('openproject')).toBe(LOCAL_NOW.toISOString());
  });

  it('SaveSettings_TurnedOff_ForgetsWhereItWasSoTurningOnStartsFresh', async () => {
    await baseline();
    service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, enabled: false });
    service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, enabled: true });

    expect(await service.poll()).toBe('baseline');
  });

  it('SaveSettings_StoresTheNormalisedFormAndAnswersIt', () => {
    const saved = service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, pollIntervalSeconds: 1 });

    expect(saved.pollIntervalSeconds).toBe(MIN_PROVIDER_EVENT_POLL_SECONDS);
    expect(settings.values.get(PROVIDER_EVENT_SETTINGS_KEY)).toEqual(saved);
    expect(() => service.saveSettings(null as never)).toThrow(ArgumentNullException);
  });

  it('GetSettings_UpgradeFromTheOldPollerTurnedOff_StaysOff', () => {
    // Someone who had switched OpenProject polling off must not be opted
    // back in by an upgrade.
    settings.setSetting(LEGACY_MESSAGING_SETTINGS_KEY, { enableOpenProjectNotifications: false, openProjectPollingIntervalSeconds: 300 });

    expect(service.getSettings()).toMatchObject({ enabled: false, pollIntervalSeconds: 300 });
  });

  it('Start_PollsShortlyAfterLaunchThenOnTheInterval', async () => {
    vi.useFakeTimers();
    const poll = vi.spyOn(service, 'poll').mockResolvedValue('nothing_new');

    service.start();
    await vi.advanceTimersByTimeAsync(PROVIDER_EVENT_FIRST_POLL_DELAY_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_PROVIDER_EVENT_SETTINGS.pollIntervalSeconds * 1000);
    expect(poll).toHaveBeenCalledTimes(2);

    service.stop();
    await vi.advanceTimersByTimeAsync(DEFAULT_PROVIDER_EVENT_SETTINGS.pollIntervalSeconds * 1000 * 3);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('Start_Disabled_SchedulesNothing', async () => {
    vi.useFakeTimers();
    settings.setSetting(PROVIDER_EVENT_SETTINGS_KEY, { ...DEFAULT_PROVIDER_EVENT_SETTINGS, enabled: false });
    const poll = vi.spyOn(service, 'poll');

    service.start();
    await vi.advanceTimersByTimeAsync(MAX_PROVIDER_EVENT_POLL_SECONDS * 1000);

    expect(poll).not.toHaveBeenCalled();
  });

  it('Start_PollRejects_IsLoggedNotThrown', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(service, 'poll').mockRejectedValue(new Error('boom'));

    service.start();
    await vi.advanceTimersByTimeAsync(PROVIDER_EVENT_FIRST_POLL_DELAY_MS);

    expect(warn).toHaveBeenCalledWith('[ProviderEvents] Poll failed:', expect.any(Error));
  });

  it('SendTest_UsesTheSwitchedOnDestinationsAndSaysWhich', () => {
    expect(service.sendTest()).toEqual({ toast: true, bar: true });
    expect(toasts).toHaveLength(1);
    expect(banners[0].appName).toBe('OpenProject');

    barEnabled = false;
    expect(service.sendTest()).toEqual({ toast: true, bar: false });

    service.saveSettings({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, showToasts: false });
    expect(service.sendTest()).toEqual({ toast: false, bar: false });
  });
});

describe('provider event settings and text', () => {
  it('Normalise_Nothing_IsTheDefaults', () => {
    expect(normaliseProviderEventSettings(undefined)).toEqual(DEFAULT_PROVIDER_EVENT_SETTINGS);
    expect(normaliseProviderEventSettings('junk')).toEqual(DEFAULT_PROVIDER_EVENT_SETTINGS);
  });

  it('Normalise_Malformed_TakesDefaultsAndClamps', () => {
    const result = normaliseProviderEventSettings({
      enabled: 'yes',
      pollIntervalSeconds: 999999,
      kinds: { mentioned: false, commented: 'no' }
    });

    expect(result.enabled).toBe(true);
    expect(result.pollIntervalSeconds).toBe(MAX_PROVIDER_EVENT_POLL_SECONDS);
    expect(result.kinds.mentioned).toBe(false);
    expect(result.kinds.commented).toBe(true);
    expect(normaliseProviderEventSettings({ pollIntervalSeconds: Number.NaN }).pollIntervalSeconds)
      .toBe(DEFAULT_PROVIDER_EVENT_SETTINGS.pollIntervalSeconds);
  });

  it('Normalise_StoredSettings_OutrankTheLegacyOnes', () => {
    const stored: ProviderEventSettingsDTO = { ...DEFAULT_PROVIDER_EVENT_SETTINGS, enabled: true, pollIntervalSeconds: 90 };

    expect(normaliseProviderEventSettings(stored, { enableOpenProjectNotifications: false, openProjectPollingIntervalSeconds: 300 }))
      .toMatchObject({ enabled: true, pollIntervalSeconds: 90 });
  });

  it('Describe_EachKind_WithAndWithoutAnActor', () => {
    const base = { ...event(7, ''), taskKey: 'OP-7' };
    const titles = (['assigned', 'mentioned', 'commented', 'status_changed', 'date_alert'] as const).map(kind => [
      describeProviderEvent({ ...base, kind }).title,
      describeProviderEvent({ ...base, kind, actorName: undefined }).title
    ]);

    expect(titles).toEqual([
      ['Alice assigned you OP-7', 'OP-7 was assigned to you'],
      ['Alice mentioned you on OP-7', 'You were mentioned on OP-7'],
      ['Alice commented on OP-7', 'New comment on OP-7'],
      ['Alice changed the status of OP-7', 'Status changed on OP-7'],
      ['Date alert on OP-7', 'Date alert on OP-7']
    ]);
  });

  it('Describe_Summary_GoesUnderTheTitle', () => {
    expect(describeProviderEvent({ ...event(1, ''), summary: 'Can you look?' }).body).toBe('Task 1\nCan you look?');
    expect(describeProviderEvent({ ...event(1, ''), taskKey: '' }).title).toBe('Alice mentioned you on a task');
  });

  it('DescribeForBar_NamesWhoThenWhichTask', () => {
    expect(describeProviderEventForBar(event(1, ''))).toEqual({ title: 'Alice', body: 'OP-1 Task 1' });
    expect(describeProviderEventForBar({ ...event(1, '', 'date_alert'), actorName: undefined }).title).toBe('Date alerts');
  });

  it('Summarize_CountsByKindInPanelOrder', () => {
    const events = [event(1, '', 'date_alert'), event(2, '', 'status_changed'), event(3, '', 'status_changed')];

    expect(summarizeProviderEvents(events, 'OpenProject')).toEqual({
      title: '3 updates in OpenProject',
      body: '2 status changes, 1 date alert'
    });
  });
});
