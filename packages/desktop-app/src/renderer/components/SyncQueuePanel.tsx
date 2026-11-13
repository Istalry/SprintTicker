import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, Loader2 } from 'lucide-react';
import { SettingButton } from './SettingRow';
import { SyncQueueItemDTO, SyncQueueSnapshotDTO } from '../../shared/dtos';
import { countOf, formatClockTime, formatHoursAndMinutes } from '../utils/formatters';

/**
 * What the worklog sync queue holds, and why anything in it has not arrived.
 *
 * Built after a debugging session that should not have been one. Two worklogs
 * never reached Jira, and finding out why meant running the app from a
 * terminal and reading three hundred lines of console: one had been logged
 * against an issue since deleted (`404`), the other was shorter than the
 * minute Jira can store (`400`). Both reasons were already recorded on the
 * rows themselves, in `lastError` and `retryCount`, and nothing displayed them
 * -- so a worklog that failed was indistinguishable from one never queued.
 *
 * Durations are shown as MM:SS rather than the "0h 02m" used elsewhere. A
 * sub-minute row is precisely the kind this panel exists to explain, and
 * rounding it to "0h 00m" would hide the evidence.
 */
/**
 * A snapshot and the moment it was read. A row's "next attempt" is judged
 * against that moment rather than the clock at render: nothing re-renders the
 * panel as time passes, so the read is the only instant the rows describe.
 */
interface QueueRead {
  snapshot: SyncQueueSnapshotDTO;
  readAtMs: number;
}

export const SyncQueuePanel: React.FC = () => {
  const [read, setRead] = useState<QueueRead | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A promise chain rather than an async body: the effect below calls this,
  // and state set in an async function's body reads to the hooks linter as set
  // synchronously in the effect.
  const refresh = useCallback((): Promise<void> => {
    if (!window.electronAPI?.getSyncQueue) return Promise.resolve();
    return window.electronAPI.getSyncQueue().then(
      snapshot => setRead({ snapshot, readAtMs: Date.now() }),
      err => setNotice(err instanceof Error ? err.message : 'Could not read the sync queue.')
    );
  }, []);

  useEffect(() => {
    void refresh();

    // A completed sync is the moment the queue changes, and the main process
    // already broadcasts it. Polling here would be a second timer over the
    // same event.
    if (!window.electronAPI?.onProjectsUpdated) return undefined;
    return window.electronAPI.onProjectsUpdated(() => void refresh());
  }, [refresh]);

  const runSyncNow = async (): Promise<void> => {
    setBusy('sync');
    setNotice(null);
    try {
      const result = await window.electronAPI.syncProviderNow();
      // `status` carries the reason a sync did nothing -- not_configured is the
      // common one, and silently showing "0 pending" for it is how the queue
      // came to look healthy while nothing was being delivered.
      setNotice(
        result.status === 'synced'
          ? `Synced ${countOf(result.projects, 'project')} and ${countOf(result.tasks, 'task')}.`
          : `Sync ${result.status}${result.reason ? `: ${result.reason}` : ''}`
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'The sync failed to start.');
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const retryFailed = async (): Promise<void> => {
    setBusy('retry');
    setNotice(null);
    try {
      const { requeued } = await window.electronAPI.retryFailedWorklogs();
      setNotice(
        requeued > 0
          ? `${countOf(requeued, 'entry', 'entries')} queued again and being sent.`
          : 'Nothing had failed, so there was nothing to retry.'
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'The retry failed to start.');
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const snapshot = read?.snapshot;
  const counts = snapshot?.counts;
  const items = snapshot?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {counts ? (
          <p className="text-xs text-text-secondary">
            <span className="text-text-primary">{counts.pending}</span> waiting ·{' '}
            <span className="text-text-primary">{counts.syncing}</span> sending ·{' '}
            <span className={counts.failed > 0 ? 'text-accent-red' : 'text-text-primary'}>{counts.failed}</span> failed ·{' '}
            <span className="text-text-primary">{counts.synced}</span> sent
          </p>
        ) : <span />}
        <div className="flex gap-2">
          <SettingButton onClick={() => void runSyncNow()} disabled={busy !== null}>
            {busy === 'sync' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Sync now
          </SettingButton>
          <SettingButton onClick={() => void retryFailed()} disabled={busy !== null || (counts?.failed ?? 0) === 0}>
            {busy === 'retry' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            Retry failed
          </SettingButton>
        </div>
      </div>

      {notice && <p role="status" className="text-xs text-text-secondary">{notice}</p>}

      {items.length === 0 ? (
        <p className="text-xs text-text-secondary">Nothing outstanding: every entry recorded has been sent.</p>
      ) : (
        <ul className="divide-y divide-border-dark rounded-lg border border-border-dark bg-dark-900">
          {items.map(item => (
            <QueueRow key={item.id} item={item} maxAttempts={snapshot?.maxAttempts ?? 0} readAtMs={read?.readAtMs ?? 0} />
          ))}
        </ul>
      )}
    </div>
  );
};

const STATUS_TONE: Record<SyncQueueItemDTO['status'], string> = {
  PENDING: 'text-text-primary border-focus',
  SYNCING: 'text-text-secondary border-border-dark',
  SYNCED: 'text-accent-green border-accent-green',
  FAILED: 'text-accent-red border-accent-red'
};

const QueueRow: React.FC<{ item: SyncQueueItemDTO; maxAttempts: number; readAtMs: number }> = ({
  item,
  maxAttempts,
  readAtMs
}) => {
  const waitingUntil = item.nextAttemptAtUtc ? new Date(item.nextAttemptAtUtc) : null;
  const stillWaiting = waitingUntil !== null && waitingUntil.getTime() > readAtMs;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_TONE[item.status]}`}>
            {/* Refused is FAILED that no retry sends (P11c): Today offers Move or Keep off. */}
            {item.refused ? 'REFUSED' : item.status}
          </span>
          {item.operation !== 'CREATE' && (
            // A correction or deletion of a worklog already sent, so the
            // row is not read as the same time being sent twice.
            <span className="text-xs text-accent-amber">
              {item.operation === 'UPDATE' ? 'Correction' : 'Deletion'}
            </span>
          )}
          <span className="text-sm font-mono text-text-primary truncate">{item.taskKey}</span>
          <span className="text-xs font-mono text-text-secondary">{formatHoursAndMinutes(item.durationSeconds)}</span>
          <span className="text-xs text-text-secondary truncate">{item.providerId}</span>
        </div>
        <span className="text-xs text-text-secondary whitespace-nowrap">
          {/* Reading "attempt 8 of 8" is what tells the user the retry budget is
              spent, rather than leaving them to wonder if it is still trying. */}
          attempt {item.retryCount} of {maxAttempts}
        </span>
      </div>

      {item.lastError && (
        // The provider's own words. "Provider reported failure" was what this
        // used to amount to, and it said nothing about whether the user or the
        // network had to change.
        <p className="text-xs text-accent-red mt-2 break-words">{item.lastError}</p>
      )}

      {stillWaiting && waitingUntil && (
        <p className="text-xs font-mono text-text-secondary mt-1">
          Next attempt at {formatClockTime(waitingUntil)}
        </p>
      )}
    </li>
  );
};
