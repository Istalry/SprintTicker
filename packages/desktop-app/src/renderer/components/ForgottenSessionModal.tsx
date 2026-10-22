import React, { useEffect, useState } from 'react';
import { Moon } from 'lucide-react';
import { ForgottenSessionAction, ForgottenSessionReviewDTO } from '../../shared/dtos';
import { workedSecondsUntil } from '../../shared/session-review';
import { formatDayAndTime, formatDaySplit, formatHoursAndMinutes, formatHoursMinutes } from '../utils/formatters';
import { workedSecondsByLocalDay } from '../../shared/work-split';
import { ConfirmPanel } from './ConfirmPanel';

type EndChoice = 'presence' | 'eod' | 'custom';
type Confirming = 'discard' | 'keep' | 'restart' | null;

/** `YYYY-MM-DDTHH:MM` in local time, as a datetime-local input holds it. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A session left running overnight: when did the work on it stop?
 *
 * Main found it, paused it at the last activity and logged nothing; this asks
 * for the end. Follows main rather than owning the question -- the bar's STOP,
 * a resume, anything done to the session answers it -- and reads it on mount
 * for a window opened after it was asked.
 */
export const ForgottenSessionModal: React.FC = () => {
  const [review, setReview] = useState<ForgottenSessionReviewDTO | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onForgottenReview) return undefined;
    api.getForgottenReview()
      .then(setReview)
      .catch(err => console.warn('[ForgottenSessionModal] Could not read the question:', err));
    return api.onForgottenReview(setReview);
  }, []);

  // Keyed by session, so each question starts on its own defaults.
  return review ? <ForgottenSessionDialog key={review.sessionId} review={review} onAnswered={() => setReview(null)} /> : null;
};

const ForgottenSessionDialog: React.FC<{ review: ForgottenSessionReviewDTO; onAnswered: () => void }> = ({
  review,
  onAnswered
}) => {
  const [choice, setChoice] = useState<EndChoice>('presence');
  const [custom, setCustom] = useState<string>(() => toLocalInput(new Date(review.lastPresenceUtc)));
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once, and again as the custom time changes: the clock is not read
  // during render.
  const [now, setNow] = useState<number>(() => Date.now());

  const start = Date.parse(review.startTimeUtc);
  const lastPresence = new Date(review.lastPresenceUtc);
  const worked = (endUtc: string) => workedSecondsUntil(review.startTimeUtc, endUtc, review.pauses);

  const customDate = new Date(custom);
  const customValid =
    Number.isFinite(customDate.getTime()) && customDate.getTime() > start && customDate.getTime() <= now;
  const endUtc =
    choice === 'presence' ? review.lastPresenceUtc
      : choice === 'eod' ? review.endOfDayUtc
        : customValid ? customDate.toISOString() : null;

  // The days the chosen end files the time under, when there are two.
  const daySplit = endUtc
    ? formatDaySplit(workedSecondsByLocalDay(review.startTimeUtc, endUtc, review.pauses, worked(endUtc)))
    : null;

  const answer = (action: ForgottenSessionAction) => {
    setError(null);
    window.electronAPI.resolveForgottenSession({ action, endUtc: endUtc ?? undefined })
      .then(onAnswered)
      .catch(err => {
        console.warn('[ForgottenSessionModal] Could not answer:', err);
        setError('That did not work. Check the end time and try again.');
      });
  };

  const sinceStart = worked(new Date(now).toISOString());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 font-mono select-none">
      <div
        role="dialog"
        aria-label="A session was left running"
        className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-5"
      >
        <div className="flex items-center space-x-2 border-b border-border-dark pb-3">
          <Moon className="w-4 h-4 text-accent-amber" />
          <h3 className="text-sm font-bold text-white">A session was left running</h3>
        </div>

        {confirming === 'discard' ? (
          <ConfirmPanel
            title="Discard this session?"
            tone="danger"
            message={
              <>
                Everything on <span className="text-accent-blue font-bold">{review.taskKey}</span> since{' '}
                {formatDayAndTime(new Date(start))} is thrown away. Nothing is kept or sent. This cannot be undone.
              </>
            }
            confirmLabel="Discard"
            cancelLabel="Back"
            onConfirm={() => answer('discard')}
            onCancel={() => setConfirming(null)}
          />
        ) : confirming === 'keep' ? (
          <ConfirmPanel
            title="Count it all as work?"
            message={
              <>
                <strong className="text-white">{formatHoursAndMinutes(sinceStart)}</strong> on{' '}
                <span className="text-accent-blue font-bold">{review.taskKey}</span>, up to now, and the session keeps
                running.
              </>
            }
            confirmLabel="I was working"
            cancelLabel="Back"
            onConfirm={() => answer('keep')}
            onCancel={() => setConfirming(null)}
          />
        ) : confirming === 'restart' ? (
          <ConfirmPanel
            title="No longer assigned to you"
            message={
              <>
                <span className="text-accent-blue font-bold">{review.taskKey}</span> left your list: reassigned,
                closed or moved. Its time is logged either way. Start tracking it again anyway?
              </>
            }
            confirmLabel="Restart it"
            cancelLabel="Just stop"
            onConfirm={() => answer('restart')}
            onCancel={() => answer('stop')}
          />
        ) : (
          <>
            <p className="text-xs text-text-secondary leading-relaxed">
              <span className="text-accent-blue font-bold">{review.taskKey}</span> {review.taskTitle} was still running.
              Last activity: <strong className="text-white">{formatDayAndTime(lastPresence)}</strong>. It is paused
              there and nothing is logged yet. When did you stop working on it?
            </p>

            <fieldset className="space-y-2">
              <legend className="sr-only">End of the work</legend>
              <EndOption
                checked={choice === 'presence'}
                onSelect={() => setChoice('presence')}
                label={`At my last activity, ${formatHoursMinutes(lastPresence)}`}
                seconds={worked(review.lastPresenceUtc)}
              />
              {review.endOfDayUtc && (
                <EndOption
                  checked={choice === 'eod'}
                  onSelect={() => setChoice('eod')}
                  label={`At the end of that day, ${formatHoursMinutes(new Date(review.endOfDayUtc))}`}
                  seconds={worked(review.endOfDayUtc)}
                />
              )}
              <EndOption
                checked={choice === 'custom'}
                onSelect={() => setChoice('custom')}
                label="At another time"
                seconds={customValid ? worked(customDate.toISOString()) : null}
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
                    className="mt-2 w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent-blue"
                  />
                )}
                {choice === 'custom' && !customValid && (
                  <span role="alert" className="block mt-1 text-[11px] text-accent-red">
                    Pick a time after the session started, and not in the future.
                  </span>
                )}
              </EndOption>
            </fieldset>

            {daySplit && (
              <p className="text-[11px] text-text-secondary">Across midnight, so filed as {daySplit}.</p>
            )}

            {error && <p role="alert" className="text-xs text-accent-red">{error}</p>}

            <div className="flex flex-wrap gap-2 justify-end pt-1">
              <button
                onClick={() => setConfirming('discard')}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-accent-red hover:bg-accent-red/10 transition-all"
              >
                Discard
              </button>
              <button
                onClick={() => {
                  setNow(Date.now());
                  setConfirming('keep');
                }}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-text-secondary hover:text-white hover:bg-dark-700 transition-all"
              >
                I was working all along
              </button>
              <button
                disabled={!endUtc}
                onClick={() => (review.taskUnlisted ? setConfirming('restart') : answer('restart'))}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-dark-700 hover:bg-dark-600 text-white border border-border-dark disabled:opacity-40 transition-all"
              >
                Log and restart it now
              </button>
              <button
                disabled={!endUtc}
                onClick={() => answer('stop')}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-accent-blue hover:bg-blue-600 text-white disabled:opacity-40 transition-all"
              >
                Log and stop
              </button>
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
  /** What this end would log; null while it is not a valid end. */
  seconds: number | null;
  children?: React.ReactNode;
}> = ({ checked, onSelect, label, seconds, children }) => (
  <div
    className={`rounded-lg border px-3 py-2 ${checked ? 'border-accent-blue bg-accent-blue/10' : 'border-border-dark'}`}
  >
    <label className="flex items-center justify-between cursor-pointer text-xs text-text-primary">
      <span className="flex items-center space-x-2">
        <input type="radio" name="forgotten-end" checked={checked} onChange={onSelect} />
        <span>{label}</span>
      </span>
      {seconds !== null && <span className="text-text-secondary">logs {formatHoursAndMinutes(seconds)}</span>}
    </label>
    {children}
  </div>
);
