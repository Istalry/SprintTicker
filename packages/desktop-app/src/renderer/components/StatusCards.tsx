import React, { useCallback, useEffect, useState } from 'react';
import { CircleAlert, Download, Plug, RefreshCw, UserRound, WifiOff } from 'lucide-react';
import { DeviceStatusDTO, SyncQueueSnapshotDTO } from '../../shared/dtos';
import { NoticeKind, NoticesDTO, releasePageOf } from '../../shared/sync-health';
import { ProviderId, providerDisplayName } from '../../shared/provider-names';
import { formatHoursAndMinutes, formatHoursMinutes, countOf } from '../utils/formatters';
import { useSyncHealth } from '../hooks/usePrompts';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { SettingsGroupId } from '../views/Settings/settings-groups';

const warn = (what: string) => (err: unknown) => console.warn(`[StatusCards] ${what} failed:`, err);

/**
 * How long the bar may be gone before Today says so: at start, and through a
 * re-dial, the driver reports it disconnected for a moment.
 */
export const BAR_UNPLUGGED_GRACE_MS = 10_000;

type Tone = 'danger' | 'waiting' | 'neutral';
const BORDER: Record<Tone, string> = {
  danger: 'border-accent-red/50',
  waiting: 'border-accent-amber/50',
  neutral: 'border-border-dark'
};
const ICON: Record<Tone, string> = { danger: 'text-accent-red', waiting: 'text-accent-amber', neutral: 'text-text-secondary' };
const primary = 'px-3 py-1.5 bg-primary hover:bg-primary/90 text-dark-900 text-xs font-semibold rounded-lg transition-all';
const quiet = 'px-3 py-1.5 text-text-secondary hover:text-white hover:bg-dark-700 text-xs font-semibold rounded-lg transition-all';

/** True while the machine has a network, as Chromium sees it. */
function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** The queue, read again when time is logged or a sync ends: the entries a card says wait. */
function useQueue(): SyncQueueSnapshotDTO | null {
  const [queue, setQueue] = useState<SyncQueueSnapshotDTO | null>(null);
  const read = useCallback(() => {
    window.electronAPI?.getSyncQueue?.().then(setQueue, warn('Reading the queue'));
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
function waitingText(queue: SyncQueueSnapshotDTO | null, withTime: boolean): string | null {
  if (!queue) return null;
  const waiting = queue.items.filter(item => item.status !== 'SYNCED');
  if (waiting.length === 0) return null;
  const seconds = waiting.filter(item => item.operation === 'CREATE').reduce((sum, item) => sum + item.durationSeconds, 0);
  const count = countOf(waiting.length, 'entry', 'entries');
  return withTime && seconds > 0 ? `${count} (${formatHoursAndMinutes(seconds)})` : count;
}

/**
 * S31's states on Today (redesign P11b), each a card saying what still works,
 * so nobody stops timing because something else is down: the first sync,
 * the provider not answering or refusing the token, no network, the bar
 * unplugged, an update just installed, no account yet. The header's status
 * entry (S27) keeps the details; these say it where the user looks.
 */
export const StatusCards: React.FC<{
  device: DeviceStatusDTO;
  onOpenSettings: (group: SettingsGroupId) => void;
}> = ({ device, onOpenSettings }) => {
  const health = useSyncHealth();
  const online = useOnline();
  const queue = useQueue();
  const { capabilities } = useProviderCapabilities();
  const [notices, setNotices] = useState<NoticesDTO | null>(null);

  useEffect(() => {
    let live = true;
    window.electronAPI?.getNotices?.()
      .then(value => { if (live) setNotices(value); })
      .catch(warn('Reading the notices'));
    return () => { live = false; };
  }, []);

  const dismiss = (kind: NoticeKind) => {
    window.electronAPI.dismissNotice(kind).then(setNotices, warn('Dismissing the notice'));
  };

  const provider = providerDisplayName(health?.providerId || capabilities?.providerId);
  const lastSynced = health?.lastSyncedAtUtc ? formatHoursMinutes(new Date(health.lastSyncedAtUtc)) : null;
  const noAccount =
    capabilities !== null &&
    (capabilities.providerId === ProviderId.ADHOC || health?.state === 'not-configured') &&
    notices?.noAccountDismissed === false;

  const cards: React.ReactNode[] = [];

  if (!online) {
    cards.push(
      <StatusCard key="offline" tone="waiting" icon={WifiOff} title="No network">
        Timing works. {lastSynced ? `The task list is from ${lastSynced}.` : 'The task list is the one you had.'} Nothing is lost.
      </StatusCard>
    );
  } else if (health?.state === 'refused') {
    const waiting = waitingText(queue, true);
    cards.push(
      <StatusCard key="refused" tone="danger" icon={CircleAlert} title={`${provider} refused your token`}
        actions={<button type="button" className={primary} onClick={() => onOpenSettings('account')}>Enter a new one</button>}>
        {`Timing works${waiting ? `; ${waiting} wait` : ''}. The header reads "Sending stopped" until you enter a new token.`}
      </StatusCard>
    );
  } else if (health?.state === 'unreachable') {
    const waiting = waitingText(queue, false);
    const since = health.sinceUtc ? ` · since ${formatHoursMinutes(new Date(health.sinceUtc))}` : '';
    cards.push(
      <StatusCard key="unreachable" tone="waiting" icon={RefreshCw} title={`${provider} is not answering${since}`}
        actions={
          <button type="button" className={primary}
            onClick={() => { window.electronAPI.syncProviderNow().catch(warn('Trying again')); }}>
            Try now
          </button>
        }>
        Timing works{waiting ? `; ${waiting} wait and go out when it answers` : ''}.
      </StatusCard>
    );
  }

  if (health?.state === 'first-sync') {
    const progress = health.progress;
    cards.push(
      <StatusCard key="first-sync" tone="neutral" icon={Download} title="First sync">
        <span role="status">
          Fetching your tasks from {provider}…{progress && progress.total > 0 ? ` ${progress.done} of ${countOf(progress.total, 'project')}` : ''}
        </span>
        {progress && progress.total > 0 && (
          <div role="progressbar" aria-label="First sync" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}
            className="mt-2 h-1 w-full rounded bg-dark-900 overflow-hidden">
            <div className="h-1 bg-primary" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
        )}
        <span className="block mt-1">{`You can start a task of your own now; ${provider}'s tasks appear as they arrive.`}</span>
      </StatusCard>
    );
  }

  if (device.enabled && !device.connected) cards.push(<BarUnplugged key="bar" />);

  if (notices?.updatedTo) {
    const version = notices.updatedTo;
    cards.push(
      <StatusCard key="updated" tone="neutral" icon={Download} title={`Updated to ${version}`}
        actions={
          <>
            <button type="button" className={quiet} onClick={() => dismiss('updated')}>Not now</button>
            <button type="button" className={primary}
              onClick={() => {
                window.electronAPI.openReleasePage(releasePageOf(version)).catch(warn("Opening what's new"));
                dismiss('updated');
              }}>
              {"What's new"}
            </button>
          </>
        }>
        See what changed in this version.
      </StatusCard>
    );
  }

  if (noAccount) {
    cards.push(
      <StatusCard key="no-account" tone="neutral" icon={UserRound} title="No account yet"
        actions={
          <>
            <button type="button" className={quiet} onClick={() => dismiss('no-account')}>Not now</button>
            <button type="button" className={primary} onClick={() => onOpenSettings('account')}>Connect one</button>
          </>
        }>
        Connect Jira or OpenProject in Settings › Account. Your own tasks and their time stay as they are; nothing already
        logged is sent.
      </StatusCard>
    );
  }

  return cards.length > 0 ? <div className="space-y-3">{cards}</div> : null;
};

/**
 * The bar gone for longer than a re-dial. Mounted only while it is gone, so
 * each outage waits out its own grace.
 */
const BarUnplugged: React.FC = () => {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), BAR_UNPLUGGED_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!late) return null;
  return (
    <StatusCard tone="waiting" icon={Plug} title="BUSY Bar unplugged">
      Your timer keeps running here. The bar shows the current screen when it is back.
    </StatusCard>
  );
};

const StatusCard: React.FC<{
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ tone, icon: Icon, title, actions, children }) => (
  <section aria-label={title} className={`bg-dark-800 border ${BORDER[tone]} rounded-xl px-5 py-4 select-none`}>
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 shrink-0 ${ICON[tone]}`} aria-hidden="true" />
          <h3 className="text-sm font-bold text-white">{title}</h3>
        </div>
        <div className="mt-1 text-xs text-text-secondary leading-relaxed">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  </section>
);
