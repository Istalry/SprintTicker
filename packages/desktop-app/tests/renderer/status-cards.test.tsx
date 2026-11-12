import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StatusCards, BAR_UNPLUGGED_GRACE_MS } from '../../src/renderer/components/StatusCards';
import { DeviceStatusDTO, SyncQueueItemDTO } from '../../src/shared/dtos';
import { SyncHealthDTO } from '../../src/shared/sync-health';
import { installElectronApi } from './electron-api-mock';

const BAR_UP = { enabled: true, connected: true, ipAddress: '10.0.4.20', connectionType: 'usb' } as DeviceStatusDTO;
const health = (over: Partial<SyncHealthDTO>): SyncHealthDTO => ({
  state: 'ok', providerId: 'jira', sinceUtc: null, lastSyncedAtUtc: null, progress: null, ...over
});
const row = (minutes: number, status: SyncQueueItemDTO['status'] = 'PENDING'): SyncQueueItemDTO => ({
  id: `q${minutes}`, providerId: 'jira', taskId: 't', taskKey: 'MG-12', durationSeconds: minutes * 60, startedAtUtc: '2026-11-12T09:00:00Z',
  comment: '', status, operation: 'CREATE', retryCount: 0, nextAttemptAtUtc: null, lastError: null
});
const queue = (items: SyncQueueItemDTO[]) => ({ counts: { pending: items.length, syncing: 0, synced: 0, failed: 0 }, items, maxAttempts: 8 });

const show = (overrides: Record<string, unknown> = {}, device: DeviceStatusDTO = BAR_UP) => {
  const bridge = installElectronApi(overrides);
  const onOpenSettings = vi.fn();
  render(<StatusCards device={device} onOpenSettings={onOpenSettings} />);
  return { bridge, onOpenSettings };
};
const card = (name: string | RegExp) => screen.findByRole('region', { name });

/** S31's states on Today (P11b): each says what still works. */
describe('Status cards', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('AllGood_ShowsNothing', async () => {
    show();
    await act(async () => undefined);

    expect(screen.queryByRole('region')).toBeNull();
  });

  it('FirstSync_SaysHowFarItGot_AndThatOwnTasksWorkNow', async () => {
    show({ getSyncHealth: vi.fn().mockResolvedValue(health({ state: 'first-sync', progress: { done: 6, total: 15 } })) });

    const first = await card('First sync');

    expect(within(first).getByRole('status').textContent).toBe('Fetching your tasks from Jira… 6 of 15 projects');
    expect(within(first).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('6');
    expect(first.textContent).toMatch(/You can start a task of your own now/);
  });

  it('NotAnswering_SaysSince_WhatWaits_AndTriesAgain', async () => {
    const since = new Date(2026, 10, 12, 10, 42).toISOString();
    const { bridge } = show({
      getSyncHealth: vi.fn().mockResolvedValue(health({ state: 'unreachable', sinceUtc: since })),
      getSyncQueue: vi.fn().mockResolvedValue(queue([row(30), row(45)]))
    });

    const notAnswering = await card(/^Jira is not answering · since 10:42$/);
    await vi.waitFor(() => expect(notAnswering.textContent).toMatch(/Timing works; 2 entries wait and go out when it answers\./));
    fireEvent.click(within(notAnswering).getByRole('button', { name: 'Try now' }));

    expect(bridge.api.syncProviderNow).toHaveBeenCalledTimes(1);
  });

  it('TokenRefused_SaysWhatWaits_AndOpensTheAccount', async () => {
    const { onOpenSettings } = show({
      getSyncHealth: vi.fn().mockResolvedValue(health({ state: 'refused' })),
      getSyncQueue: vi.fn().mockResolvedValue(queue([row(60), row(45, 'FAILED'), row(20)]))
    });

    const refused = await card('Jira refused your token');
    await vi.waitFor(() => expect(refused.textContent).toMatch(/3 entries \(2h 05m\) wait/));
    fireEvent.click(within(refused).getByRole('button', { name: 'Enter a new one' }));

    expect(onOpenSettings).toHaveBeenCalledWith('account');
  });

  it('NoNetwork_SaysTheListsAge_InsteadOfNotAnswering', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    show({
      getSyncHealth: vi.fn().mockResolvedValue(health({ state: 'unreachable', lastSyncedAtUtc: new Date(2026, 10, 12, 9, 12).toISOString() }))
    });

    expect((await card('No network')).textContent).toMatch(/Timing works\. The task list is from 09:12\. Nothing is lost\./);
    expect(screen.queryByRole('region', { name: /not answering/ })).toBeNull();
  });

  it('BarUnplugged_OnlyAfterTheGrace', async () => {
    vi.useFakeTimers();
    show({}, { ...BAR_UP, connected: false });
    await act(async () => undefined);
    expect(screen.queryByRole('region', { name: 'BUSY Bar unplugged' })).toBeNull();

    await act(async () => { vi.advanceTimersByTime(BAR_UNPLUGGED_GRACE_MS); });

    expect(screen.getByRole('region', { name: 'BUSY Bar unplugged' }).textContent).toMatch(/Your timer keeps running here/);
  });

  it('NoBarMode_NeverSaysUnplugged', async () => {
    vi.useFakeTimers();
    show({}, { ...BAR_UP, enabled: false, connected: false });

    await act(async () => { vi.advanceTimersByTime(BAR_UNPLUGGED_GRACE_MS * 2); });

    expect(screen.queryByRole('region', { name: 'BUSY Bar unplugged' })).toBeNull();
  });

  it('Updated_WhatsNew_OpensTheRelease_AndIsSeen', async () => {
    const { bridge } = show({ getNotices: vi.fn().mockResolvedValue({ updatedTo: '1.5.0', noAccountDismissed: true }) });

    fireEvent.click(within(await card('Updated to 1.5.0')).getByRole('button', { name: "What's new" }));

    expect(bridge.api.openReleasePage).toHaveBeenCalledWith('https://github.com/Istalry/SprintTicker/releases/tag/v1.5.0');
    expect(bridge.api.dismissNotice).toHaveBeenCalledWith('updated');
  });

  it('NoAccount_ConnectOrNotNow', async () => {
    const { bridge, onOpenSettings } = show({
      getProviderCapabilities: vi.fn().mockResolvedValue({ providerId: 'adhoc', canAssign: false, canTransition: false, canFindWorklog: false, canFetchByKey: false, hasHolidays: false }),
      getNotices: vi.fn().mockResolvedValue({ updatedTo: null, noAccountDismissed: false })
    });

    const noAccount = await card('No account yet');
    fireEvent.click(within(noAccount).getByRole('button', { name: 'Connect one' }));
    fireEvent.click(within(noAccount).getByRole('button', { name: 'Not now' }));

    expect(onOpenSettings).toHaveBeenCalledWith('account');
    expect(bridge.api.dismissNotice).toHaveBeenCalledWith('no-account');
  });
});
