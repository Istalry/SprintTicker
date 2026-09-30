import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WindowsNotificationListenerService } from '../src/main/services/windows-notification-listener-service';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { AppIconResolver } from '../src/main/services/app-icon-resolver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { createDefaultNotificationSettings } from '../src/shared/notification-defaults';

/** Stands in for powershell.exe: the test writes what the real script would print. */
class FakePowerShell extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn();
}

const spawner = vi.hoisted(() => ({
  processes: [] as unknown[],
  make: null as null | (() => unknown),
  failWith: null as Error | null
}));

vi.mock('child_process', () => ({
  spawn: () => {
    if (spawner.failWith) throw spawner.failWith;
    const proc = spawner.make!();
    spawner.processes.push(proc);
    return proc;
  }
}));

spawner.make = () => new FakePowerShell();

/**
 * What the listener does with the PowerShell poller once it is running.
 *
 * This process is the single source of every Windows notification the bar
 * shows, and its failures are silent -- the app keeps reporting a healthy
 * start. So these pin the parts that decide whether a notification reaches
 * the bar at all: reading the poller's output, and bringing the poller back
 * when it dies. None of them starts PowerShell; `spawn` is replaced above.
 */
describe('WindowsNotificationListenerService process', () => {
  let scriptDir: string;
  let store: Map<string, unknown>;
  let engine: PriorityPreemptionEngine;
  let renderer: DisplayRenderer;
  let service: WindowsNotificationListenerService;
  let originalPlatform: PropertyDescriptor | undefined;

  const latest = () => spawner.processes[spawner.processes.length - 1] as FakePowerShell;
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const say = async (line: unknown) => {
    latest().stdout.write((typeof line === 'string' ? line : JSON.stringify(line)) + '\n');
    await flush();
  };
  const messages = () => service.getLogEntries().map(e => e.message);

  const makeService = (withRenderer = true) =>
    new WindowsNotificationListenerService(
      { getSetting: (k: string, d: unknown) => store.get(k) ?? d, setSetting: (k: string, v: unknown) => store.set(k, v) } as unknown as SettingsRepository,
      engine,
      withRenderer ? renderer : undefined,
      new AppIconResolver(async () => '', async () => null),
      scriptDir
    );

  beforeEach(() => {
    spawner.processes.length = 0;
    spawner.failWith = null;
    scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-listener-'));
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    store = new Map();
    const settingsRepo = { getSetting: vi.fn().mockReturnValue(null), setSetting: vi.fn() };
    engine = new PriorityPreemptionEngine(settingsRepo as unknown as SettingsRepository);
    const driver = {
      sendDisplayPayload: vi.fn().mockResolvedValue('drawn'),
      sendPixelFrame: vi.fn().mockResolvedValue('sent'),
      clearDisplay: vi.fn().mockResolvedValue(undefined),
      uploadAsset: vi.fn().mockResolvedValue(undefined),
      drawOverlay: vi.fn().mockResolvedValue('drawn'),
      removeDisplayElements: vi.fn().mockResolvedValue(undefined),
      getDeviceStatus: vi.fn(() => ({ connected: true }))
    } as unknown as BusyBarDriver;
    renderer = new DisplayRenderer(driver);
    renderer.setPriorityEngine(engine);
    service = makeService();
  });

  afterEach(() => {
    service.stopListening();
    renderer.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    fs.rmSync(scriptDir, { recursive: true, force: true });
  });

  describe('starting', () => {
    it('StartListening_NotWindows_StartsNothing', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      service.startListening();

      expect(spawner.processes).toHaveLength(0);
      expect(service.getListenerStatus().isListening).toBe(false);
    });

    it('StartListening_DisabledInSettings_StartsNothing', () => {
      store.set('windows_notification_settings', { ...createDefaultNotificationSettings(), enableListener: false });

      service.startListening();

      expect(spawner.processes).toHaveLength(0);
      expect(service.getListenerStatus().isListening).toBe(false);
    });

    it('StartListening_AlreadyListening_DoesNotStartASecondPoller', () => {
      service.startListening();
      service.startListening();

      expect(spawner.processes).toHaveLength(1);
    });

    it('StartListening_SpawnThrows_ReportsItAndIsNotListening', () => {
      spawner.failWith = new Error('spawn ENAMETOOLONG');

      service.startListening();

      const status = service.getListenerStatus();
      expect(status.isListening).toBe(false);
      expect(status.errorMessage).toBe('spawn ENAMETOOLONG');
      expect(messages().some(m => m.includes('Failed to launch'))).toBe(true);
    });
  });

  describe('reading the poller', () => {
    beforeEach(() => service.startListening());

    it('StatusLine_DbPollingActive_ReportsTheStrategy', async () => {
      await say({ type: 'status', message: 'DB polling active (sqlite3=x, db=y)' });

      const status = service.getListenerStatus();
      expect(status.strategy).toBe('DB_POLLING');
      expect(status.hasSqlite3).toBe(true);
      expect(status.hasNotifDb).toBe(true);
    });

    it('StatusLine_WatermarkInitialized_RecordsAPoll', async () => {
      await say({ type: 'status', message: 'Watermark initialized at ArrivalTime=1' });

      expect(service.getListenerStatus().lastPollTimestamp).not.toBeNull();
    });

    it.each([
      ['NO_SQLITE3', 'hasSqlite3'],
      ['NO_WPNDB', 'hasNotifDb']
    ] as const)('ErrorLine_%s_ReportsWhatIsMissing', async (code, flag) => {
      await say({ type: 'status', message: 'DB polling active' });

      await say({ type: 'error', code, message: 'not found' });

      const status = service.getListenerStatus();
      expect(status[flag]).toBe(false);
      expect(status.errorMessage).toBe(`${code}: not found`);
    });

    it('NotificationLine_ShownSource_ReachesTheBarAndIsCounted', async () => {
      await say({ id: 'n1', appId: 'com.squirrel.Discord.Discord', appName: 'Discord', title: 'Alice', body: 'secret plans' });

      expect(engine.getActiveLockEventName()).toBe('messagingPriority');
      expect(service.getListenerStatus().totalCaptured).toBe(1);
    });

    it('NotificationLine_Logged_KeepsTheMessageTextOut', async () => {
      // The log is copied into the diagnostics bundle users attach to bug
      // reports; message content never belongs there.
      await say({ id: 'n1', appId: 'discord', appName: 'Discord', title: 'Alice', body: 'secret plans' });

      expect(messages().join('\n')).not.toContain('secret plans');
    });

    it('NotificationLine_DontShowSource_IsCountedAsSuppressed', async () => {
      store.set('windows_notification_settings', {
        ...createDefaultNotificationSettings(),
        sourceRules: [{ appId: 'teams', appName: 'Teams', iconId: 'bell', priorityMode: 'DONT_SHOW' }]
      });

      await say({ id: 'n2', appId: 'teams', appName: 'Teams', title: 'Standup', body: 'now' });

      expect(engine.getActiveLockEventName()).toBeNull();
      expect(service.getListenerStatus().totalSuppressed).toBe(1);
      expect(messages().some(m => m.startsWith('Suppressed:'))).toBe(true);
    });

    it('OutputLine_NotJson_IsIgnored', async () => {
      await say('WARNING: something PowerShell printed');
      await say('{ not json');

      const status = service.getListenerStatus();
      expect(status.totalCaptured + status.totalSuppressed).toBe(0);
      expect(service.getListenerStatus().isListening).toBe(true);
    });

    it('Stderr_Output_IsLoggedAsAWarning', async () => {
      latest().stderr.write('Access denied\n');
      await flush();

      expect(service.getLogEntries().some(e => e.level === 'warn' && e.message === 'PS stderr: Access denied')).toBe(true);
    });
  });

  describe('recovering', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      service.startListening();
    });

    it('Exit_Unexpected_RestartsThePollerAfterABackoff', () => {
      latest().emit('exit', 1);
      expect(service.getListenerStatus().isListening).toBe(false);
      expect(service.getListenerStatus().strategy).toBe('NONE');

      vi.advanceTimersByTime(1999);
      expect(spawner.processes).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(spawner.processes).toHaveLength(2);
      expect(service.getListenerStatus().isListening).toBe(true);
    });

    it('Exit_EveryTime_DoublesTheWaitThenGivesUp', () => {
      // A poller that cannot start is not relaunched twice a second forever.
      const waits = [2000, 4000, 8000, 16000, 32000];
      for (const wait of waits) {
        latest().emit('exit', 1);
        vi.advanceTimersByTime(wait);
      }
      expect(spawner.processes).toHaveLength(6);

      latest().emit('exit', 1);
      vi.advanceTimersByTime(120_000);

      expect(spawner.processes).toHaveLength(6);
      expect(messages().some(m => m.includes('giving up'))).toBe(true);
    });

    it('Exit_AfterItDeliveredANotification_StartsTheBackoffAgain', async () => {
      latest().emit('exit', 1);
      vi.advanceTimersByTime(2000);
      latest().emit('exit', 1);
      vi.advanceTimersByTime(4000);
      // Up long enough to deliver: it has recovered, not crash-looped.
      await say({ id: 'n1', appId: 'discord', appName: 'Discord', title: 'Hi', body: 'there' });

      latest().emit('exit', 1);
      vi.advanceTimersByTime(2000);

      expect(spawner.processes).toHaveLength(4);
    });

    it('StopListening_WithARestartPending_CancelsIt', () => {
      latest().emit('exit', 1);

      service.stopListening();
      vi.advanceTimersByTime(60_000);

      expect(spawner.processes).toHaveLength(1);
    });

    it('StopListening_TheKillEndsTheProcess_DoesNotRestartIt', () => {
      // kill() makes the real process exit, and that exit arrives through the
      // same handler as a crash. A deliberate stop must stay stopped.
      const poller = latest();

      service.stopListening();
      poller.emit('exit', 1);
      vi.advanceTimersByTime(60_000);

      expect(spawner.processes).toHaveLength(1);
    });

    it('StopListening_Running_KillsThePoller', () => {
      const poller = latest();

      service.stopListening();

      expect(poller.kill).toHaveBeenCalled();
      expect(service.getListenerStatus().isListening).toBe(false);
    });
  });

  describe('handling a notification', () => {
    it('HandleNotification_NoAppIdentity_IsNotShown', () => {
      expect(service.handleNotification({ id: 'x', title: 'T', body: 'B', timestampUtc: '' } as never)).toBe(false);
    });

    it('HandleNotification_ListenerDisabled_IsNotShown', () => {
      store.set('windows_notification_settings', { ...createDefaultNotificationSettings(), enableListener: false });

      expect(service.handleNotification({ id: 'x', appId: 'discord', title: 'T', body: 'B', timestampUtc: '' })).toBe(false);
    });

    it('HandleNotification_NoRenderer_IsNotShown', () => {
      const headless = makeService(false);

      expect(headless.handleNotification({ id: 'x', appId: 'discord', title: 'T', body: 'B', timestampUtc: '' })).toBe(false);
    });

    it('SaveSettings_Null_Throws', () => {
      expect(() => service.saveSettings(null as never)).toThrow('settings');
    });
  });

  describe('log', () => {
    it('OnLog_Unsubscribed_HearsNothingMore', () => {
      const listener = vi.fn();
      const unsubscribe = service.onLog(listener);

      unsubscribe();
      service.startListening();

      expect(listener).not.toHaveBeenCalled();
    });

    it('GetLogEntries_ManyEntries_KeepsTheLatestTwoHundred', () => {
      for (let i = 0; i < 205; i++) service.simulateNotification('discord', 'Discord', `t${i}`, 'b');

      const entries = service.getLogEntries();
      expect(entries).toHaveLength(200);
      expect(entries[entries.length - 1].message).toContain('SIMULATED');
    });
  });
});
