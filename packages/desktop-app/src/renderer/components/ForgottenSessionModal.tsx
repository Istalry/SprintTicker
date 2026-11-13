import React, { useRef, useState } from 'react';
import { useModal } from '../hooks/useModal';
import { Moon } from 'lucide-react';
import { ForgottenSessionAction, ForgottenSessionReviewDTO } from '../../shared/dtos';
import { forgottenHeading as headingFor, workedSecondsUntil } from '../../shared/session-review';
import {
  formatDayAndTime,
  formatDaySplit,
  formatHoursAndMinutes,
  formatHoursMinutes,
  formatRelativeDay
} from '../utils/formatters';
import { workedSecondsByLocalDay } from '../../shared/work-split';
import { useForgottenReview } from '../hooks/usePrompts';
import { ConfirmPanel } from './ConfirmPanel';

type EndChoice = 'presence' | 'eod' | 'custom' | 'all-along' | 'discard';

const warn = (what: string) => (err: unknown) => console.warn(`[ForgottenSession] ${what} failed:`, err);

/** `YYYY-MM-DDTHH:MM` in local time, as a datetime-local input holds it. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "MG-12 ran all night", or "SprintTicker closed while MG-12 ran": the dialog's title, the card's and the mini timer's. */
export const forgottenHeading = (review: ForgottenSessionReviewDTO) => headingFor(review.taskKey, review.cause);

/**
 * "Paused at Thu 12 Nov, 18:04, nothing logged": where it stands while it
 * waits. The day is written out: a card can stay up for days, and "yesterday"
 * would go stale on it.
 */
export function forgottenStanding(review: ForgottenSessionReviewDTO): string {
  return `Paused at ${formatDayAndTime(new Date(review.lastPresenceUtc))}, nothing logged`;
}

/** Answer, on a deferred question's card: brings the dialog back, and the window forward. */
export const askAgain = () => {
  window.electronAPI.resolveForgottenSession({ action: 'ask' }).catch(warn('Answer'));
};

/**
 * A session left running overnight (S18): when did the work on it stop?
 *
 * Main found it, paused it at the last activity and logged nothing; this asks
 * for the end. Follows main rather than owning the question -- the bar's STOP,
 * a resume, anything done to the session answers it -- and reads it on mount
 * for a window opened after it was asked. Decide later puts the dialog away
 * and leaves a card on Today and the mini timer (P10b).
 */
export const ForgottenSessionModal: React.FC = () => {
  const [review, setReview] = useForgottenReview();
  if (!review || review.deferred) return null;
  // Keyed by session, so each question starts on its own defaults.
  return <ForgottenSessionDialog key={review.sessionId} review={review} onAnswered={() => setReview(null)} />;
};

/** The question, deferred: a card on Today until it is answered (S18). */
export const ForgottenSessionCard: React.FC = () => {
  const [review] = useForgottenReview();
  if (!review?.deferred) return null;
  const heading = forgottenHeading(review);
  return (
    <section aria-label={heading} className="bg-dark-800 border border-accent-amber/50 rounded-xl p-5 select-none">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Moon className="w-4 h-4 text-accent-amber" aria-hidden="true" />
            <h3 className="text-sm font-bold text-white">{heading}</h3>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {forgottenStanding(review)}. It waits for you to say when you stopped.
          </p>
        </div>
        <button
          type="button"
          onClick={askAgain}
          className="px-4 py-2 bg-primary hover:bg-primary/90 text-dark-900 text-xs font-semibold rounded-lg transition-all"
        >
          Answer
        </button>
      </div>
    </section>
  );
};

const ForgottenSessionDialog: React.FC<{ review: ForgottenSessionReviewDTO; onAnswered: () => void }> = ({
  review,
  onAnswered
}) => {
  const [choice, setChoice] = useState<EndChoice>('presence');
  const [custom, setCustom] = useState<string>(() => toLocalInput(new Date(review.lastPresenceUtc)));
  const [confirming, setConfirming] = useState<'discard' | 'restart' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once, and again as the choice moves: the clock is not read during
  // render, and "all along" counts up to it.
  const [now, setNow] = useState<number>(() => Date.now());

  const start = Date.parse(review.startTimeUtc);
  const lastPresence = new Date(review.lastPresenceUtc);
  const worked = (endUtc: string) => workedSecondsUntil(review.startTimeUtc, endUtc, review.pauses);
  const nowUtc = new Date(now).toISOString();

  const customDate = new Date(custom);
  const customValid =
    Number.isFinite(customDate.getTime()) && customDate.getTime() > start && customDate.getTime() <= now;
  const endUtc =
    choice === 'presence' ? review.lastPresenceUtc
      : choice === 'eod' ? review.endOfDayUtc
        : choice === 'custom' ? (customValid ? customDate.toISOString() : null)
          : choice === 'all-along' ? nowUtc
            : null;

  // The days the chosen end files the time under, when there are two.
  const daySplit = endUtc
    ? formatDaySplit(workedSecondsByLocalDay(review.startTimeUtc, endUtc, review.pauses, worked(endUtc)))
    : null;

  const select = (next: EndChoice) => {
    setChoice(next);
    setNow(Date.now());
  };

  const answer = (action: ForgottenSessionAction, end?: string | null) => {
    setError(null);
    window.electronAPI.resolveForgottenSession({ action, endUtc: end ?? undefined })
      .then(() => {
        if (action !== 'later') onAnswered();
      })
      .catch(err => {
        warn('Answering')(err);
        setError('That did not work. Check the end time and try again.');
      });
  };
  // "All along" ends now: read at the click, not when the choice was made.
  const logAndStop = () => answer('stop', choice === 'all-along' ? new Date().toISOString() : endUtc);

  const heading = forgottenHeading(review);
  const primary = 'px-3 py-2 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-dark-900 disabled:opacity-40 transition-all';
  const secondary = 'px-3 py-2 rounded-lg text-xs font-semibold bg-dark-700 hover:bg-dark-600 text-white border border-border-dark disabled:opacity-40 transition-all';

  const panelRef = useRef<HTMLDivElement | null>(null);
  useModal(panelRef, () => answer('later'));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-5"
      >
        <div className="border-b border-border-dark pb-3">
          <div className="flex items-center space-x-2">
            <Moon className="w-4 h-4 text-accent-amber" aria-hidden="true" />
            <h3 className="text-sm font-bold text-white">{heading}</h3>
          </div>
          <p className="mt-1 text-[11px] text-text-secondary truncate">{review.taskTitle}</p>
        </div>

        {confirming === 'discard' ? (
          <ConfirmPanel
            takeFocus
            title="Discard this time?"
            tone="danger"
            message={
              <>
                Everything on <span className="font-mono text-text-primary font-bold">{review.taskKey}</span> since{' '}
                {formatDayAndTime(new Date(start))} is thrown away. Nothing is kept or sent. This cannot be undone.
              </>
            }
            confirmLabel="Discard"
            cancelLabel="Cancel"
            onConfirm={() => answer('discard')}
            onCancel={() => setConfirming(null)}
          />
        ) : confirming === 'restart' ? (
          <ConfirmPanel
            takeFocus
            title="No longer assigned to you"
            message={
              <>
                <span className="font-mono text-text-primary font-bold">{review.taskKey}</span> left your list: reassigned,
                closed or moved. Its time is logged either way. Start timing it again anyway?
              </>
            }
            confirmLabel="Restart it"
            cancelLabel="Just stop"
            onConfirm={() => answer('restart', endUtc)}
            onCancel={() => answer('stop', endUtc)}
          />
        ) : (
          <>
            <p className="text-xs text-text-secondary leading-relaxed">
              You were last active {formatRelativeDay(lastPresence, new Date(now))} at{' '}
              <strong className="text-white">{formatHoursMinutes(lastPresence)}</strong>. The timer is paused there
              until you say.
            </p>

            <fieldset className="space-y-2">
              <legend className="sr-only">When did you stop?</legend>
              <EndOption
                checked={choice === 'presence'}
                onSelect={() => select('presence')}
                label={`I stopped at ${formatHoursMinutes(lastPresence)}, my last activity`}
                note={`Logs ${formatHoursAndMinutes(worked(review.lastPresenceUtc))}, ${formatRelativeDay(lastPresence, new Date(now))}.`}
              />
              {review.endOfDayUtc && (
                <EndOption
                  checked={choice === 'eod'}
                  onSelect={() => select('eod')}
                  label={`I stopped at the end of my day, ${formatHoursMinutes(new Date(review.endOfDayUtc))}`}
                  note={`Logs ${formatHoursAndMinutes(worked(review.endOfDayUtc))}.`}
                />
              )}
              <EndOption
                checked={choice === 'custom'}
                onSelect={() => select('custom')}
                label="At another time…"
                note={choice === 'custom' && customValid ? `Logs ${formatHoursAndMinutes(worked(customDate.toISOString()))}.` : null}
              >
                {choice === 'custom' && (
                  <input
                    type="datetime-local"
                    aria-label="End time"
                    value={custom}
                    onChange={e => {
                      setCustom(e.target.value);
                      setNow(Date.now());
                    }}
                    className="mt-2 w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-focus"
                  />
                )}
                {choice === 'custom' && !customValid && (
                  <span role="alert" className="block mt-1 text-[11px] text-accent-red">
                    Pick a time after it started, and not in the future.
                  </span>
                )}
              </EndOption>
              <EndOption
                checked={choice === 'all-along'}
                onSelect={() => select('all-along')}
                label="I was working all along"
                note={`Logs ${formatHoursAndMinutes(worked(nowUtc))}, to now — ${review.cause === 'closed' ? 'all the time it was closed' : 'the whole night'}.`}
              />
              <EndOption
                checked={choice === 'discard'}
                onSelect={() => select('discard')}
                label="Discard it"
                note="Nothing kept or sent."
                danger
              />
            </fieldset>

            {daySplit && (
              <p className="text-[11px] text-text-secondary">Across midnight, so filed as {daySplit}.</p>
            )}

            {error && <p role="alert" className="text-xs text-accent-red">{error}</p>}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => answer('later')}
                title="The timer stays paused and nothing is logged; Today and the mini timer keep the question"
                className="px-3 py-2 rounded-lg text-xs font-semibold text-text-secondary hover:text-white hover:bg-dark-700 transition-all"
              >
                Decide later
              </button>
              <span className="flex-1" />
              {choice === 'discard' ? (
                <button
                  type="button"
                  onClick={() => setConfirming('discard')}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-accent-red hover:bg-accent-red/90 text-white transition-all"
                >
                  Discard
                </button>
              ) : (
                <>
                  {choice === 'all-along' ? (
                    <button type="button" onClick={() => answer('keep')} className={secondary}>
                      Keep {review.taskKey} running
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!endUtc}
                      onClick={() => (review.taskUnlisted ? setConfirming('restart') : answer('restart', endUtc))}
                      className={secondary}
                    >
                      Log and restart {review.taskKey}
                    </button>
                  )}
                  <button type="button" disabled={!endUtc} onClick={logAndStop} className={primary}>
                    Log and stop
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const EndOption: React.FC<{
  checked: boolean;
  onSelect: () => void;
  label: string;
  /** What this end would do; null while it is not a valid end. */
  note: string | null;
  danger?: boolean;
  children?: React.ReactNode;
}> = ({ checked, onSelect, label, note, danger = false, children }) => (
  <div className={`rounded-lg border px-3 py-2 ${checked ? 'border-focus bg-select' : 'border-border-dark'}`}>
    <label className="flex items-center justify-between gap-3 cursor-pointer text-xs">
      <span className="flex items-center space-x-2">
        <input type="radio" name="forgotten-end" checked={checked} onChange={onSelect} />
        <span className={danger ? 'text-accent-red' : 'text-text-primary'}>{label}</span>
      </span>
      {note !== null && <span className="text-text-secondary text-right">{note}</span>}
    </label>
    {children}
  </div>
);
