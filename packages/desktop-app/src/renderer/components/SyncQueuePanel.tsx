import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, AlertCircle, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { SyncQueueItemDTO, SyncQueueSnapshotDTO } from '../../shared/dtos';
import { formatSeconds } from '../utils/formatters';

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
export const SyncQueuePanel: React.FC = () => {
  const [snapshot, setSnapshot] = useState<SyncQueueSnapshotDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.electronAPI?.getSyncQueue) return;
    try {
      setSnapshot(await window.electronAPI.getSyncQueue());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not read the sync queue.');
    }
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
          ? `Synced ${result.projects} project(s) and ${result.tasks} task(s).`
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
          ? `Requeued ${requeued} worklog(s) and attempted delivery.`
          : 'Nothing was parked, so there was nothing to retry.'
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'The retry failed to start.');
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const counts = snapshot?.counts;
  const items = snapshot?.items ?? [];

  return (
    <div className="bg-dark-800 border border-border-dark rounded-xl p-6 mt-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold font-mono text-white">Worklog Sync Queue</h3>
          <p className="text-xs text-text-secondary mt-1">
            Time recorded locally and waiting to reach the provider. A row here has not arrived yet.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void runSyncNow()}
            disabled={busy !== null}
            className="flex items-center gap-2 bg-dark-900 border border-border-dark hover:border-accent-blue disabled:opacity-50 rounded-lg px-3 py-2 text-xs font-mono text-white"
          >
            {busy === 'sync' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Sync Now
          </button>
          <button
            type="button"
            onClick={() => void retryFailed()}
            disabled={busy !== null || (counts?.failed ?? 0) === 0}
            className="flex items-center gap-2 bg-dark-900 border border-border-dark hover:border-accent-amber disabled:opacity-50 rounded-lg px-3 py-2 text-xs font-mono text-white"
          >
            {busy === 'retry' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            Retry Failed
          </button>
        </div>
      </div>

      {counts && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Tally label="Pending" value={counts.pending} icon={<Clock size={13} />} tone="text-accent-blue" />
          <Tally label="Sending" value={counts.syncing} icon={<Loader2 size={13} />} tone="text-text-secondary" />
          <Tally label="Failed" value={counts.failed} icon={<AlertCircle size={13} />} tone="text-accent-red" />
          <Tally label="Delivered" value={counts.synced} icon={<CheckCircle2 size={13} />} tone="text-accent-green" />
        </div>
      )}

      {notice && (
        <p className="text-xs font-mono text-text-secondary bg-dark-900 border border-border-dark rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-text-secondary font-mono py-2">
          Nothing outstanding — every recorded worklog has been delivered.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <QueueRow key={item.id} item={item} maxAttempts={snapshot?.maxAttempts ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
};

const Tally: React.FC<{ label: string; value: number; icon: React.ReactNode; tone: string }> = ({
  label,
  value,
  icon,
  tone
}) => (
  <div className="bg-dark-900 border border-border-dark rounded-lg px-3 py-2">
    <div className={`flex items-center gap-1.5 text-xs font-mono ${tone}`}>
      {icon}
      {label}
    </div>
    <div className="text-lg font-mono text-white mt-0.5">{value}</div>
  </div>
);

const STATUS_TONE: Record<SyncQueueItemDTO['status'], string> = {
  PENDING: 'text-accent-blue border-accent-blue',
  SYNCING: 'text-text-secondary border-border-dark',
  SYNCED: 'text-accent-green border-accent-green',
  FAILED: 'text-accent-red border-accent-red'
};

const QueueRow: React.FC<{ item: SyncQueueItemDTO; maxAttempts: number }> = ({ item, maxAttempts }) => {
  const waitingUntil = item.nextAttemptAtUtc ? new Date(item.nextAttemptAtUtc) : null;
  const stillWaiting = waitingUntil !== null && waitingUntil.getTime() > Date.now();

  return (
    <div className="bg-dark-900 border border-border-dark rounded-lg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${STATUS_TONE[item.status]}`}>
            {item.status}
          </span>
          <span className="text-sm font-mono text-white truncate">{item.taskKey}</span>
          <span className="text-xs font-mono text-text-secondary">{formatSeconds(item.durationSeconds)}</span>
          <span className="text-xs font-mono text-text-secondary truncate">{item.providerId}</span>
        </div>
        <span className="text-xs font-mono text-text-secondary whitespace-nowrap">
          {/* Reading "attempt 8 of 8" is what tells the user the retry budget is
              spent, rather than leaving them to wonder if it is still trying. */}
          attempt {item.retryCount} of {maxAttempts}
        </span>
      </div>

      {item.lastError && (
        // The provider's own words. "Provider reported failure" was what this
        // used to amount to, and it said nothing about whether the user or the
        // network had to change.
        <p className="text-xs font-mono text-accent-red mt-2 break-words">{item.lastError}</p>
      )}

      {stillWaiting && waitingUntil && (
        <p className="text-xs font-mono text-text-secondary mt-1">
          Next attempt at {waitingUntil.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
};
