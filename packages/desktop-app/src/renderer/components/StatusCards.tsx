import React, { useCallback, useEffect, useState } from 'react';
import { CircleAlert, Download, Plug, RefreshCw, UserRound, WifiOff } from 'lucide-react';
import { DeviceStatusDTO, WorklogDTO } from '../../shared/dtos';
import { refusalReason } from '../../shared/refused-entry';
import { keepOffLabel, Verb } from '../../shared/words';
import { useEntryActions } from './EntryActions';
import { NoticeKind, NoticesDTO, releasePageOf } from '../../shared/sync-health';
import { ProviderId, providerDisplayName } from '../../shared/provider-names';
import { formatHoursAndMinutes, formatHoursMinutes, countOf } from '../utils/formatters';
import { useSyncHealth } from '../hooks/usePrompts';
import { useSyncQueue, waitingText } from '../hooks/useSyncQueue';
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

/** The entries their provider refused for good (P11c), read again when time is logged or changed. */
function useRefused(): { refused: WorklogDTO[]; read: () => void } {
  const [refused, setRefused] = useState<WorklogDTO[]>([]);
  const read = useCallback(() => {
    window.electronAPI?.getRefusedWorklogs?.().then(setRefused, warn('Reading the refused entries'));
  }, []);
  useEffect(() => {
    read();
    const off = window.electronAPI?.onWorklogsUpdated?.(() => read());
    return () => { off?.(); };
  }, [read]);
  return { refused, read };
}

/**
 * S31's states on Today (redesign P11b), each a card saying what still works,
 * so nobody stops timing because something else is down: the first sync,
 * the provider not answering or refusing the token, no network, the bar
 * unplugged, an update just installed, no account yet -- and one entry the
 * provider refused (P11c), with Move and Keep off. The header's status
 * entry (S27) keeps the details; these say it where the user looks.
 */
export const StatusCards: React.FC<{
  device: DeviceStatusDTO;
  onOpenSettings: (group: SettingsGroupId) => void;
}> = ({ device, onOpenSettings }) => {
  const health = useSyncHealth();
  const online = useOnline();
  const queue = useSyncQueue();
  const { capabilities } = useProviderCapabilities();
  const [notices, setNotices] = useState<NoticesDTO | null>(null);
  const { refused, read: readRefused } = useRefused();
  const entries = useEntryActions([], readRefused);

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

  if (refused.length > 0) {
    const one = refused.length === 1;
    cards.push(
      <StatusCard key="refused-entries" tone="danger" icon={CircleAlert}
        title={`${provider} refused ${countOf(refused.length, 'entry', 'entries')}`}>
        <ul className="space-y-1.5">
          {refused.map(log => {
            const key = log.taskKey ?? log.taskId;
            return (
              <li key={log.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-mono text-text-primary">{key}</span>
                  {`, ${formatHoursAndMinutes(log.durationSeconds)}: ${refusalReason(log.refusal)}.`}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className={quiet} aria-label={`${Verb.MOVE} ${key}`} onClick={() => entries.run(log, 'move')}>
                    {`↳ ${Verb.MOVE}…`}
                  </button>
                  <button type="button" className={quiet} aria-label={`${keepOffLabel(provider)}: ${key}`} onClick={() => entries.run(log, 'keep-off')}>
                    {keepOffLabel(provider)}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <span className="block mt-1">
          {one ? 'It stays here, unsent, and the week lists it.' : 'They stay here, unsent, and the week lists them.'}
        </span>
        {entries.moveError && <span role="alert" className="block mt-1 text-accent-red">{entries.moveError}</span>}
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

  return (
    <>
      {cards.length > 0 && <div className="space-y-3">{cards}</div>}
      {entries.dialogs}
    </>
  );
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
