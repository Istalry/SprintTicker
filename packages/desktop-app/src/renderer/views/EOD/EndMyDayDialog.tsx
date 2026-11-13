import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useModal } from '../../hooks/useModal';
import { Moon, X } from 'lucide-react';
import type { ActiveSessionDTO, ScheduleSettingsDTO, WorklogDTO } from '../../../shared/dtos';
import { localDateKey, localMidnight } from '../../../shared/local-date';
import { endOfDayFigures, EndOfDayFigures } from '../../../shared/day-summary';
import { dayGaps, gapSeconds, Span, spanOf, workingWindow } from '../../../shared/day-gaps';
import { OWN_PROJECT_PROVIDER_ID } from '../../../shared/local-provider';
import { formatHoursAndMinutes, formatHoursMinutes, formatLongDay, ipcErrorMessage } from '../../utils/formatters';
import { InterruptionsToPlace, useInterruptionsToPlace } from '../../components/InterruptionsToPlace';
import { syncBadgeLabel } from '../../components/SyncBadge';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';

/** Later (S17): the wrap-up asks again after this long. */
export const END_DAY_LATER_MINUTES = 15;

export interface EndMyDayDialogProps {
  isOpen: boolean;
  /** Closed for today: the prompt is not asked again. */
  onClose: () => void;
  /** Remind me: asked again in `END_DAY_LATER_MINUTES`. */
  onLater: (minutes: number) => void;
  /** The day was ended; Undo is the window's bar now. */
  onEnded: () => void;
  /** Check them…: today's gaps, in History. */
  onCheckGaps: () => void;
}

interface DayRead {
  entries: WorklogDTO[];
  session: ActiveSessionDTO | null;
  schedule: ScheduleSettingsDTO | null;
  readAtMs: number;
}

async function readToday(): Promise<DayRead> {
  const api = window.electronAPI;
  const [entries, session, schedule] = await Promise.all([
    api.getWorklogsByDate(localDateKey()),
    api.getCurrentSession().catch(() => null),
    api.getScheduleSettings().catch(() => null)
  ]);
  return {
    entries: [...entries].sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc)),
    session,
    schedule,
    readAtMs: Date.now()
  };
}

/** "End my day · send 1h 45m · 45m left to place": exactly what it does. */
export function endDayButtonLabel(figures: EndOfDayFigures): string {
  return [
    'End my day',
    figures.toSendSeconds > 0 ? `send ${formatHoursAndMinutes(figures.toSendSeconds)}` : null,
    figures.toPlaceSeconds > 0 ? `${formatHoursAndMinutes(figures.toPlaceSeconds)} left to place` : null
  ].filter(Boolean).join(' · ');
}

/**
 * End my day (S17, P10a), which replaced the wrap-up wizard. Every entry of
 * the day is listed, nothing folded, with where it stands; the interruptions
 * still to place, one menu per row; the day's untracked gaps as a hint only;
 * and a button that says what it sends. Ending stops the session through
 * `stopForWrapUp` with ten seconds to undo. Shutting down is a separate,
 * explicit choice, never ticked for you, and main runs it only once Undo
 * has passed and the queue has answered.
 *
 * The bar and the deck keep their two-press confirm (START, then START);
 * the window's button is one click. Mounted only while open.
 */
export const EndMyDayDialog: React.FC<EndMyDayDialogProps> = props =>
  props.isOpen ? <EndMyDay {...props} /> : null;

const EndMyDay: React.FC<EndMyDayDialogProps> = ({ onClose, onLater, onEnded, onCheckGaps }) => {
  const [day, setDay] = useState<DayRead | null>(null);
  const [revision, setRevision] = useState(0);
  const [shutdown, setShutdown] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gapsSkipped, setGapsSkipped] = useState(false);
  const waiting = useInterruptionsToPlace();
  const { providerName } = useProviderCapabilities();
  const provider = providerName || 'your provider';

  useEffect(() => {
    let current = true;
    readToday().then(
      read => { if (current) setDay(read); },
      err => console.warn('[EndMyDay] Could not read the day:', err)
    );
    return () => { current = false; };
  }, [revision]);

  // A placed interruption, or an entry changed elsewhere, changes the day.
  useEffect(() => window.electronAPI?.onInterruptionsUpdated?.(() => setRevision(r => r + 1)), []);
  useEffect(() => window.electronAPI?.onWorklogsUpdated?.(() => setRevision(r => r + 1)), []);

  const end = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    window.electronAPI.triggerEodWrapUp({ shouldShutdown: shutdown }).then(
      () => onEnded(),
      err => {
        setError(ipcErrorMessage(err));
        setBusy(false);
      }
    );
  }, [busy, shutdown, onEnded]);

  // The bar's buttons, as main decoded them: only the wrap-up's own actions,
  // which come only while the bar shows its prompt. Read as raw keys, two
  // STARTs meant for the bar's picker once ended the day, shutdown and all.
  useEffect(() => window.electronAPI?.onHardwareInputEvent?.(event => {
    if (event.actionAssigned === 'DISMISS_EOD_WRAP_UP') onClose();
    else if (event.actionAssigned === 'CONFIRM_EOD_WRAP_UP_STEP_1') setArmed(true);
    else if (event.actionAssigned === 'EXECUTE_EOD_WRAP_UP') end();
  }), [end, onClose]);

  const session = day?.session ?? null;
  const running = session
    ? {
      elapsedSeconds: session.elapsedSeconds,
      interruption: Boolean(session.interruption),
      sendable: !session.isAdHoc && session.providerId !== OWN_PROJECT_PROVIDER_ID
    }
    : null;
  const figures = endOfDayFigures(day?.entries ?? [], running, waiting.reduce((sum, w) => sum + w.durationSeconds, 0));
  const summary = [
    `${formatHoursAndMinutes(figures.loggedSeconds)} logged`,
    figures.sentSeconds > 0 ? `${formatHoursAndMinutes(figures.sentSeconds)} sent to ${provider}` : null,
    figures.toSendSeconds > 0 ? `${formatHoursAndMinutes(figures.toSendSeconds)} to send` : null,
    figures.toPlaceSeconds > 0 ? `${formatHoursAndMinutes(figures.toPlaceSeconds)} to place` : null
  ].filter(Boolean).join(' · ');

  // Gaps up to now in today's working hours: a hint, never a reason to stop.
  const today = localDateKey();
  const window_ = day?.schedule ? workingWindow(localMidnight(today), day.schedule) : null;
  const covered: Span[] = [
    ...(day?.entries ?? []).map(spanOf),
    ...waiting.map(w => ({ startMs: Date.parse(w.startedAtUtc), endMs: Date.parse(w.endedAtUtc) })),
    ...(session && day ? [{ startMs: Date.parse(session.startTimeUtc), endMs: day.readAtMs }] : [])
  ];
  const gaps = window_ && day ? dayGaps(window_, covered, day.readAtMs) : [];
  const clock = (ms: number) => formatHoursMinutes(new Date(ms));

  const runningWhat = !session
    ? null
    : session.interruption
      ? 'running · stops, then waits to be placed'
      : running?.sendable
        ? `running · stops, stays open, and is sent`
        : 'running · stops, kept in SprintTicker';
  const stops = session && !session.interruption ? session.taskKey : null;

  const panelRef = useRef<HTMLDivElement | null>(null);
  useModal(panelRef, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="End my day" className="w-full max-w-2xl max-h-[90vh] bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-border-dark">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Moon className="w-4 h-4 text-text-primary" />
              End my day — {formatLongDay(today)}
            </h3>
            <p className="text-xs text-text-secondary">{day ? summary : 'Reading the day…'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-text-secondary hover:text-white rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <InterruptionsToPlace
            compact
          />

          <table aria-label="Today's entries" className="w-full text-xs">
            <thead>
              <tr className="text-text-secondary border-b border-border-dark">
                <th className="py-1.5 text-left font-semibold">Task</th>
                <th className="py-1.5 text-right font-semibold">Time</th>
                <th className="py-1.5 pl-4 text-left font-semibold">{provider}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark">
              {day?.entries.map(entry => (
                <tr key={entry.id}>
                  <td className="py-1.5 pr-3 text-text-primary">
                    <span className="font-mono font-bold">{entry.taskKey ?? entry.taskId}</span>{' '}
                    <span className="text-text-secondary">{entry.taskTitle}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono text-white">{formatHoursAndMinutes(entry.durationSeconds)}</td>
                  <td className="py-1.5 pl-4 text-text-secondary">{entry.syncState ? syncBadgeLabel(entry) : ''}</td>
                </tr>
              ))}
              {session && (
                <tr>
                  <td className="py-1.5 pr-3 text-text-primary">
                    <span className="font-mono font-bold">{session.interruption ? <span aria-hidden="true">⚡</span> : session.taskKey}</span>{' '}
                    <span className="text-text-secondary">{session.interruption ? session.interruption.title : session.taskTitle}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono text-accent-green">{formatHoursAndMinutes(session.elapsedSeconds)}</td>
                  <td className="py-1.5 pl-4 text-accent-green">{runningWhat}</td>
                </tr>
              )}
              {day && day.entries.length === 0 && !session && (
                <tr><td colSpan={3} className="py-3 text-center text-text-secondary">Nothing logged today.</td></tr>
              )}
            </tbody>
          </table>

          {gaps.length > 0 && !gapsSkipped && (
            <div role="note" className="flex items-start justify-between gap-3 bg-dark-900/60 border border-border-dark rounded-lg p-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-white">
                  {gaps.length === 1 ? '1 gap not timed' : `${gaps.length} gaps not timed`} today ({formatHoursAndMinutes(gapSeconds(gaps))})
                </div>
                <div className="text-text-secondary">
                  {gaps.map(g => `${clock(g.startMs)}–${clock(g.endMs)}`).join(', ')} · only a hint: a gap never stops you ending the day.
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setGapsSkipped(true)} className="px-2 py-1 text-text-secondary hover:text-white">Skip</button>
                <button type="button" onClick={onCheckGaps} className="px-2 py-1 rounded border border-border-dark text-text-primary hover:text-white hover:border-focus">Check them…</button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-text-secondary leading-relaxed">
            {stops ? <>Ending your day stops <span className="font-mono">{stops}</span> (it stays open in {provider}) and sends </> : 'Ending your day sends '}
            everything on a task after the 10 s undo, like any send. Anything {provider} refuses stays here, and tomorrow says so.
          </p>

          <label className="flex items-start gap-3 p-3 bg-dark-900/60 rounded-lg border border-border-dark cursor-pointer text-xs">
            <input type="checkbox" checked={shutdown} onChange={e => setShutdown(e.target.checked)} className="mt-0.5 w-4 h-4" />
            <span className="text-text-primary">
              <span className="font-semibold text-white">Then shut down the PC</span>, once the undo has passed and {provider} has
              answered (30 s to cancel).
            </span>
          </label>

          {error && <p role="alert" className="text-xs text-accent-red">Not ended: {error}</p>}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border-dark">
          <button
            type="button"
            onClick={() => onLater(END_DAY_LATER_MINUTES)}
            data-autofocus
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-border-dark text-text-secondary hover:text-white"
          >
            Remind me in {END_DAY_LATER_MINUTES} min
          </button>
          <button
            type="button"
            onClick={end}
            disabled={busy || !day}
            className="px-5 py-2 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-dark-900"
          >
            {armed ? 'Press Pause on the bar again to end the day' : endDayButtonLabel(figures)}
          </button>
        </div>
      </div>
    </div>
  );
};
