import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StatusPanel } from '../../src/renderer/components/StatusPanel';
import { statusHeaderWord, statusRows, StatusInputs } from '../../src/renderer/utils/status-summary';
import { CONNECTED_DEVICE, installElectronApi } from './electron-api-mock';
import { SyncQueueSnapshotDTO, UpdateStatusDTO } from '../../src/shared/dtos';

const queue = (counts: Partial<SyncQueueSnapshotDTO['counts']>): SyncQueueSnapshotDTO => ({
  counts: { pending: 0, syncing: 0, synced: 0, failed: 0, ...counts },
  items: [],
  maxAttempts: 8
});

const inputs = (over: Partial<StatusInputs> = {}): StatusInputs => ({
  bar: { connected: true, address: '10.0.4.20', pingMs: 6 },
  queue: queue({}),
  update: null,
  providerName: 'Jira',
  ...over
});

const UPDATE: UpdateStatusDTO = {
  status: 'update-available',
  currentVersion: '1.4.0',
  latestVersion: '1.5.0',
  releaseUrl: 'https://example.invalid'
} as UpdateStatusDTO;

/** The header's status entry (S27): one word, the worst row's. */
describe('status summary', () => {
  it('AllFine_ReadsAllGood', () => {
    expect(statusHeaderWord(statusRows(inputs()))).toBe('All good');
  });

  it.each([
    ['EntriesWaiting', inputs({ queue: queue({ pending: 2 }) }), '2 waiting'],
    ['AnEntryRefused', inputs({ queue: queue({ failed: 1, pending: 3 }) }), 'Sending stopped'],
    ['AnUpdate', inputs({ update: UPDATE }), 'Update'],
    ['TheBarGone', inputs({ bar: { connected: false, address: '10.0.4.20', pingMs: 0 } }), 'Bar offline']
  ])('OneProblem_%s_ReadsIt', (_label, given, word) => {
    expect(statusHeaderWord(statusRows(given))).toBe(word);
  });

  it('WaitingAndUpdate_WaitingWins', () => {
    expect(statusHeaderWord(statusRows(inputs({ queue: queue({ syncing: 1 }), update: UPDATE })))).toBe('1 waiting');
  });

  it('BarOfflineAndSendingStopped_SendingStoppedWins', () => {
    // Time not reaching the provider is worse than a bar out.
    const both = inputs({ bar: { connected: false, address: 'x', pingMs: 0 }, queue: queue({ failed: 2 }) });
    expect(statusHeaderWord(statusRows(both))).toBe('Sending stopped');
  });

  it('NoBar_HasNoBarRow', () => {
    expect(statusRows(inputs({ bar: null })).map(row => row.id)).toEqual(['sending']);
  });

  it('Rows_NameTheProvider', () => {
    const rows = statusRows(inputs({ queue: queue({ pending: 1 }), providerName: 'OpenProject' }));
    expect(rows.find(row => row.id === 'sending')?.detail).toMatch(/OpenProject/);
  });
});

describe('StatusPanel', () => {
  it('EntriesWaiting_HeaderSaysSo_AndTryNowSyncs', async () => {
    const bridge = installElectronApi({ getSyncQueue: async () => queue({ pending: 2 }) });
    render(<StatusPanel device={CONNECTED_DEVICE} onOpenSettings={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: /2 waiting/ }));
    const panel = screen.getByRole('dialog', { name: 'Status' });
    expect(within(panel).getByText('2 entries waiting to send')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Try now' }));

    expect(bridge.api.syncProviderNow).toHaveBeenCalledTimes(1);
  });

  it('EntriesRefused_TryNowRetriesThem', async () => {
    const bridge = installElectronApi({ getSyncQueue: async () => queue({ failed: 1 }) });
    render(<StatusPanel device={CONNECTED_DEVICE} onOpenSettings={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: /Sending stopped/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Status' })).getByRole('button', { name: 'Try now' }));

    expect(bridge.api.retryFailedWorklogs).toHaveBeenCalledTimes(1);
  });

  it('Open_ListsWhatTheBarShowedToday', async () => {
    const now = new Date().toISOString();
    installElectronApi({
      getNotificationListenerStatus: async () => ({
        status: { isListening: true, strategy: 'DB_POLLING', hasSqlite3: true, hasNotifDb: true, totalCaptured: 1, totalSuppressed: 0 },
        logs: [
          { timestamp: now, level: 'info', message: 'Poll ok' },
          { timestamp: now, level: 'notification', message: 'Slack: Marc Dubois' }
        ]
      })
    } as never);
    render(<StatusPanel device={CONNECTED_DEVICE} onOpenSettings={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: /All good/ }));

    expect(await screen.findByText('Slack: Marc Dubois')).toBeTruthy();
    expect(screen.queryByText('Poll ok')).toBeNull();
  });
});
