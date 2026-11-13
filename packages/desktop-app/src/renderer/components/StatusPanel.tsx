import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMenu } from '../hooks/useMenu';
import { ChevronDown, CircleCheck, CircleAlert, Clock3, Download } from 'lucide-react';
import { DeviceStatusDTO, NotificationLogEntryDTO, SyncQueueSnapshotDTO, UpdateStatusDTO } from '../../shared/dtos';
import { StatusRow, statusHeaderWord, statusRows, worstRow } from '../utils/status-summary';
import { formatClockTime } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { useSyncHealth } from '../hooks/usePrompts';
import { SettingsGroupId } from '../views/Settings/settings-groups';

/** How many mirrored notifications "What you missed" lists. */
const MISSED_SHOWN = 5;

interface StatusPanelProps {
  device: DeviceStatusDTO;
  /** Opens Settings at the group where a row is fixed. */
  onOpenSettings: (group: SettingsGroupId) => void;
}

/**
 * The header's status entry and its panel (S27): one word for the worst of
 * the bar, the entries waiting to send and the update, and a panel saying
 * what is wrong and where to fix it. It replaces the badge whose tooltip
 * pointed at "the sync queue in Settings".
 */
export const StatusPanel: React.FC<StatusPanelProps> = ({ device, onOpenSettings }) => {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<SyncQueueSnapshotDTO | null>(null);
  const [update, setUpdate] = useState<UpdateStatusDTO | null>(null);
  const [missed, setMissed] = useState<NotificationLogEntryDTO[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const { providerName } = useProviderCapabilities();
  const health = useSyncHealth();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const readQueue = useCallback((): void => {
    window.electronAPI?.getSyncQueue?.()
      .then(setQueue, err => console.warn('[StatusPanel] Could not read the queue:', err));
  }, []);

  // The queue changes when a sync completes and when time is logged; main
  // broadcasts both, so nothing here polls.
  useEffect(() => {
    readQueue();
    const api = window.electronAPI;
    const offSync = api?.onProjectsUpdated?.(() => readQueue());
    const offLogs = api?.onWorklogsUpdated?.(() => readQueue());
    const offUpdate = api?.onUpdateStatus?.(setUpdate);
    return () => {
      offSync?.();
      offLogs?.();
      offUpdate?.();
    };
  }, [readQueue]);

  // Read when the panel opens: the log is main's, and only worth reading then.
  useEffect(() => {
    if (!open || !window.electronAPI?.getNotificationListenerStatus) return;
    window.electronAPI.getNotificationListenerStatus()
      .then(
        ({ logs }) => setMissed(logs.filter(entry => entry.level === 'notification').slice(-MISSED_SHOWN).reverse()),
        err => console.warn('[StatusPanel] Could not read the notifications:', err)
      );
  }, [open]);

  // Closes on a click outside or Escape, as a menu does, and takes the
  // focus when it opens (REVIEW-2026-11 A5).
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useMenu(open, () => setOpen(false), { root: rootRef, menu: panelRef, trigger: triggerRef });

  const rows = statusRows({
    bar: device.enabled ? { connected: device.connected, address: device.ipAddress, pingMs: device.webSocketPingMs } : null,
    queue,
    update,
    providerName,
    accountNotSetUp: health?.state === 'not-configured'
  });
  const worst = worstRow(rows);
  const word = statusHeaderWord(rows);

  const tryNow = (): void => {
    setNotice(null);
    const api = window.electronAPI;
    if (!api) return;
    const run = queue && queue.counts.failed > 0 ? api.retryFailedWorklogs().then(() => undefined) : api.syncProviderNow().then(() => undefined);
    run
      .then(() => readQueue())
      .catch(err => setNotice(err instanceof Error ? err.message : `Could not reach ${providerName}.`));
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Status: the bar, entries waiting to send, updates"
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
          worst?.severity === 'problem'
            ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
            : worst?.severity === 'waiting'
              ? 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber'
              : 'border-border-dark bg-dark-700 text-text-primary hover:bg-dark-600'
        }`}
      >
        {worst ? <CircleAlert className="h-3.5 w-3.5 shrink-0" /> : <CircleCheck className="h-3.5 w-3.5 shrink-0" />}
        <span className="whitespace-nowrap">{word}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Status"
          className="absolute right-0 top-full z-40 mt-2 w-96 space-y-3 rounded-xl border border-border-dark bg-dark-800 p-4 shadow-2xl"
        >
          <h3 className="text-sm font-semibold text-text-primary">Status</h3>
          <ul className="space-y-2">
            {rows.map(row => (
              <StatusRowItem key={row.id} row={row} onTryNow={tryNow} onOpenSettings={onOpenSettings} />
            ))}
          </ul>
          {notice && <p role="alert" className="text-xs text-accent-red">{notice}</p>}

          <div className="space-y-1.5 border-t border-border-dark pt-3">
            <h4 className="text-xs font-semibold text-text-secondary">What you missed</h4>
            {missed.length === 0 ? (
              <p className="text-xs text-text-muted">Nothing was shown on the bar today.</p>
            ) : (
              <ul className="space-y-1">
                {missed.map(entry => (
                  <li key={`${entry.timestamp}-${entry.message}`} className="flex gap-2 text-xs text-text-primary">
                    <span className="shrink-0 font-mono text-text-muted">{formatClockTime(new Date(entry.timestamp))}</span>
                    <span className="min-w-0 truncate">{entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const StatusRowItem: React.FC<{
  row: StatusRow;
  onTryNow: () => void;
  onOpenSettings: (group: SettingsGroupId) => void;
}> = ({ row, onTryNow, onOpenSettings }) => {
  const tone =
    row.severity === 'problem' ? 'text-accent-red' : row.severity === 'waiting' ? 'text-accent-amber' : 'text-text-primary';
  const Icon = row.severity === 'ok' ? CircleCheck : row.id === 'update' ? Download : row.severity === 'waiting' ? Clock3 : CircleAlert;
  return (
    <li className="flex items-start gap-2.5 rounded-lg bg-dark-900 p-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-semibold ${tone}`}>{row.title}</div>
        <div className="text-xs text-text-secondary">{row.detail}</div>
      </div>
      {row.id === 'sending' && row.severity !== 'ok' && (
        <button type="button" onClick={onTryNow} className="shrink-0 rounded border border-border-dark px-2 py-1 text-xs text-text-primary hover:bg-dark-700">
          Try now
        </button>
      )}
      {row.id === 'bar' && row.severity !== 'ok' && (
        <button type="button" onClick={() => onOpenSettings('devices')} className="shrink-0 rounded border border-border-dark px-2 py-1 text-xs text-text-primary hover:bg-dark-700">
          Open
        </button>
      )}
    </li>
  );
};
