import { useCallback, useEffect, useState } from 'react';
import { SyncQueueSnapshotDTO } from '../../shared/dtos';
import { countOf, formatHoursAndMinutes } from '../utils/formatters';

/**
 * The queue, read again when time is logged or a sync ends: the entries a
 * card or Settings' refused-token banner says wait.
 */
export function useSyncQueue(): SyncQueueSnapshotDTO | null {
  const [queue, setQueue] = useState<SyncQueueSnapshotDTO | null>(null);
  const read = useCallback(() => {
    window.electronAPI?.getSyncQueue?.().then(setQueue, (err: unknown) => console.warn('[useSyncQueue] Reading the queue failed:', err));
  }, []);
  useEffect(() => {
    read();
    const api = window.electronAPI;
    const offLogs = api?.onWorklogsUpdated?.(() => read());
    const offSync = api?.onProjectsUpdated?.(() => read());
    return () => {
      offLogs?.();
      offSync?.();
    };
  }, [read]);
  return queue;
}

/** "2 entries" or "3 entries (2h 05m)": what waits to be sent, new entries counted by their time. */
export function waitingText(queue: SyncQueueSnapshotDTO | null, withTime: boolean): string | null {
  if (!queue) return null;
  // A refused entry does not wait: no retry sends it (P11c).
  const waiting = queue.items.filter(item => item.status !== 'SYNCED' && !item.refused);
  if (waiting.length === 0) return null;
  const seconds = waiting.filter(item => item.operation === 'CREATE').reduce((sum, item) => sum + item.durationSeconds, 0);
  const count = countOf(waiting.length, 'entry', 'entries');
  return withTime && seconds > 0 ? `${count} (${formatHoursAndMinutes(seconds)})` : count;
}
