import React, { useEffect, useState } from 'react';
import type { ScheduleSettingsDTO, WeekChangeDTO, WorklogDTO } from '../../shared/dtos';
import { addLocalDays, localDateKey } from '../../shared/local-date';
import { checkWeek, describeWeekCheck, WeekIssue } from '../../shared/week-issues';
import type { Span } from '../../shared/day-gaps';
import { formatDayRange, formatHoursMinutes, formatWeekday, ipcErrorMessage } from '../utils/formatters';
import { useInterruptionsToPlace } from './InterruptionsToPlace';
import { PlaceInterruptionsDialog } from './PlaceInterruptionsDialog';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';

/** Everything the check reads of a week, and when: the gaps of today end there. */
interface WeekRead {
  monday: string;
  revision: number;
  entries: WorklogDTO[];
  schedule: ScheduleSettingsDTO | null;
  running: Span | null;
  changes: WeekChangeDTO[] | null;
  lastWeekClosed: string | null;
  readAtMs: number;
}

async function readWeek(monday: string, revision: number): Promise<WeekRead> {
  const api = window.electronAPI;
  const [entries, schedule, session, changes, lastWeekClosed] = await Promise.all([
    api.getWorklogsRange(monday, addLocalDays(monday, 6)),
    // A part that cannot be read leaves its item out rather than the whole check.
    api.getScheduleSettings().catch(() => null),
    api.getCurrentSession().catch(() => null),
    api.getWeekChanges(monday).catch(() => null),
    api.getLastWeekClosed().catch(() => null)
  ]);
  const readAtMs = Date.now();
  const running = session ? { startMs: Date.parse(session.startTimeUtc), endMs: readAtMs } : null;
  return { monday, revision, entries, schedule, running, changes, lastWeekClosed, readAtMs };
}

export interface CheckWeekDialogProps {
  /** The Monday of the week checked. */
  monday: string;
  onClose: () => void;
  /** Opens a day in History: where its gaps are filled and its entries corrected. */
  onOpenDay: (dateKey: string) => void;
  onExport: () => void;
}

/**
 * Check my week (S15b, P9d): every problem of the week in one list, each
 * with its fix -- Place… opens Place interruptions (S12b), Send now sends
 * again what the provider refused, and Open <day> or Fix… opens that day in
 * History, where entries are corrected. The list is `shared/week-issues.ts`;
 * this reads the week and draws it. Opened from History's week, and from the
 * notice of a week just closed.
 *
 * Mounted only while open, so each opening reads the week afresh.
 */
export const CheckWeekDialog: React.FC<CheckWeekDialogProps> = ({ monday, onClose, onOpenDay, onExport }) => {
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<WeekRead | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const waiting = useInterruptionsToPlace();
  const { providerName } = useProviderCapabilities();
  const provider = providerName || 'your provider';

  useEffect(() => {
    let current = true;
    readWeek(monday, revision).then(
      week => { if (current) setRead(week); },
      err => {
        console.error('[CheckWeekDialog] Could not read the week of', monday, err);
        if (current) setFailed(ipcErrorMessage(err));
      }
    );
    return () => { current = false; };
  }, [monday, revision]);

  const loading = !read || read.monday !== monday || read.revision !== revision;
  const dayKeys = Array.from({ length: 7 }, (_, i) => addLocalDays(monday, i));
  const inWeek = new Set(dayKeys);
  const weekWaiting = waiting.filter(item => inWeek.has(localDateKey(new Date(item.startedAtUtc))));
  const check = read
    ? checkWeek({
      dayKeys,
      entries: read.entries,
      toPlace: weekWaiting,
      schedule: read.schedule,
      running: read.running,
      changes: read.changes,
      nowMs: read.readAtMs,
      providerName: provider,
      dayName: key => formatWeekday(key, 'long'),
      clock: ms => formatHoursMinutes(new Date(ms))
    })
    : null;
  const logged = read ? read.entries.reduce((sum, e) => sum + e.durationSeconds, 0) : 0;
  // Monday to Friday, or to the weekend's last day with time, as the sheet shows it.
  const worked = new Set(read?.entries.map(e => localDateKey(new Date(e.startedAtUtc))) ?? []);
  const lastShown = [6, 5].map(i => dayKeys[i]).find(key => worked.has(key)) ?? dayKeys[4];

  const sendNow = () => {
    setNote(null);
    window.electronAPI.retryFailedWorklogs().then(
      ({ requeued }) => {
        setNote({ ok: true, text: requeued ? `Sent again: ${requeued === 1 ? '1 entry' : `${requeued} entries`}.` : 'Nothing was waiting to send again.' });
        setRevision(r => r + 1);
      },
      err => setNote({ ok: false, text: `Not sent: ${ipcErrorMessage(err)}` })
    );
  };

  const fixButton = (issue: WeekIssue) => {
    const button = 'shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border-dark text-text-primary hover:text-white hover:border-focus';
    switch (issue.fix.kind) {
      case 'place':
        return <button type="button" className={button} onClick={() => setPlacing(true)}>Place…</button>;
      case 'send-now':
        return <button type="button" className={button} onClick={sendNow}>Send now</button>;
      case 'open-day': {
        const { dateKey, label } = issue.fix;
        return <button type="button" className={button} onClick={() => onOpenDay(dateKey)}>{label}</button>;
      }
      default:
        return null;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
        <div
          role="dialog"
          aria-label="Check my week"
          className="w-full max-w-xl max-h-[85vh] bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col"
          onKeyDown={e => { if (e.key === 'Escape' && !placing) onClose(); }}
        >
          <div className="px-5 pt-4 pb-3 border-b border-border-dark">
            <h3 className="text-sm font-bold text-white">Check my week · {formatDayRange(monday, lastShown)}</h3>
            <p className="text-xs text-text-secondary mt-1">
              {failed ? `Could not read the week: ${failed}` : check ? describeWeekCheck(logged, check) : 'Reading the week…'}
            </p>
          </div>

          <ul aria-label="Things to look at" aria-busy={loading} className="overflow-y-auto px-5 divide-y divide-border-dark">
            {check?.issues.map(issue => (
              <li key={`${issue.kind}:${issue.title}:${issue.details[0]}`} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="text-sm font-semibold text-white">
                    {issue.kind === 'to-place' && <span aria-hidden className="text-accent-amber">⚡ </span>}
                    <span>{issue.title}</span>
                  </div>
                  {issue.details.map(line => <div key={line} className="text-xs text-text-secondary">{line}</div>)}
                </div>
                {fixButton(issue)}
              </li>
            ))}
            {check?.closed && !check.issues.some(i => i.kind === 'closed-change') && (
              <li className="py-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-accent-green">✓ No change to a closed week</div>
                  <div className="text-xs text-text-secondary">Nothing your manager saw has moved.</div>
                </div>
              </li>
            )}
          </ul>

          {note && <p role={note.ok ? 'status' : 'alert'} className={`px-5 text-xs ${note.ok ? 'text-text-secondary' : 'text-accent-red'}`}>{note.text}</p>}

          <div className="flex justify-between gap-2 px-5 py-3 border-t border-border-dark">
            <button type="button" onClick={onExport} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus">
              Export CSV
            </button>
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-dark-900 hover:bg-primary/90">
              Done
            </button>
          </div>
        </div>
      </div>
      {placing && weekWaiting.length > 0 && (
        <PlaceInterruptionsDialog
          waiting={weekWaiting}
          providerName={providerName}
          lastWeekClosed={read?.lastWeekClosed ?? null}
          onClose={() => {
            setPlacing(false);
            setRevision(r => r + 1);
          }}
          onError={message => setNote({ ok: false, text: message })}
        />
      )}
    </>
  );
};
