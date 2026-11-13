import React, { useEffect, useId, useState } from 'react';
import { Verb } from '../../shared/words';
import { useResumePrompt } from '../hooks/usePrompts';

const MS_PER_MINUTE = 60_000;

/** How often "add the 6 min" is counted again. */
const GAP_TICK_MS = 15_000;

const quiet = 'px-3 py-2 rounded-lg text-xs font-semibold text-text-secondary hover:text-white hover:bg-dark-700 transition-all';
const secondary = 'px-3 py-2 rounded-lg text-xs font-semibold bg-dark-700 hover:bg-dark-600 text-white border border-border-dark transition-all';
const primary = 'px-3 py-2 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-dark-900 transition-all';

/**
 * A card on Today (redesign P8c): "Back at your desk?" after Lunch or Away,
 * "Back to MG-12?" after an interruption, and "Resume MG-12?" when the
 * stand-up's task left the user's lists. It used to be a dialog over the
 * window, which main brought forward to ask; a question no longer takes the
 * focus, so it waits here, on the mini timer, and in a toast while the window
 * is hidden.
 *
 * The answers are the glossary's (P15a3, REVIEW-2026-11 C1/W1): after an
 * interruption **↩ Back**, **↩ Back, add the 6 min** and **Not now** --
 * never Resume, which is a pause's word -- as the mini timer and the bar say
 * them; every answer a button.
 *
 * Follows main rather than owning the question: the bar asks it too, and an
 * answer there closes it here.
 */
export const ResumeAfterLunchPrompt: React.FC = () => {
  const [prompt, setPrompt] = useResumePrompt();
  const titleId = useId();
  // The minutes since the interruption ended, counted again now and then.
  const [now, setNow] = useState(() => Date.now());
  const counting = prompt?.after === 'interruption' && Boolean(prompt.interruptionEndedAtUtc);
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), GAP_TICK_MS);
    return () => clearInterval(timer);
  }, [counting]);

  if (!prompt) return null;
  const key = prompt.taskKey;
  // After Lunch or Away the task is paused, not stopped (P8b).
  const held = prompt.held === true;
  const breakName = prompt.after === 'away' ? 'Away' : 'Lunch';
  const task = (
    <>
      <span className="font-mono text-text-primary font-bold">{key}</span>
      {prompt.taskTitle && <> ({prompt.taskTitle})</>}
    </>
  );
  const unlisted = prompt.unlisted && <> It is no longer assigned to you: it was reassigned, closed or moved meanwhile.</>;

  const answer = (resume: boolean, addGapMinutes?: number, workedThrough?: boolean) => {
    setPrompt(null);
    window.electronAPI.answerResumePrompt(resume, addGapMinutes, workedThrough)
      .catch(err => console.warn('[ResumeAfterLunchPrompt] Could not answer:', err));
  };
  const endedAt = prompt.interruptionEndedAtUtc ? Date.parse(prompt.interruptionEndedAtUtc) : NaN;
  const gap = Number.isNaN(endedAt) ? 0 : Math.max(0, Math.round((now - endedAt) / MS_PER_MINUTE));
  // Read again at the click: Back then counts the minutes as work on the
  // task, which waited paused through them.
  const answerWithGap = () => answer(true, Math.max(0, Math.round((Date.now() - endedAt) / MS_PER_MINUTE)));

  let title: string;
  let message: React.ReactNode;
  let buttons: React.ReactNode;
  if (held) {
    title = 'Back at your desk?';
    message = <>{task} is paused, as it was: {breakName} is not timed, and nothing was sent.{unlisted}</>;
    buttons = (
      <>
        <button type="button" className={quiet} onClick={() => answer(false)}>{Verb.NOT_NOW}</button>
        <button type="button" className={secondary} onClick={() => answer(true, undefined, true)}
          title={`Resume it, and count the ${breakName.toLowerCase()} as work on it: the pause is taken back`}>
          I worked through it
        </button>
        <button type="button" className={primary} onClick={() => answer(true)}>▶ {Verb.RESUME} {key}</button>
      </>
    );
  } else if (prompt.after === 'interruption') {
    title = `${Verb.BACK} to ${key}?`;
    message = <>{task} waited, paused, through the interruption.{unlisted}</>;
    buttons = (
      <>
        <button type="button" className={quiet} onClick={() => answer(false)}>{Verb.NOT_NOW}</button>
        {gap > 0 && (
          <button type="button" className={secondary} onClick={answerWithGap}
            title={`Back to ${key}, and count the ${gap} min since the interruption ended as work on it`}>
            ↩ {Verb.BACK}, add the {gap} min
          </button>
        )}
        <button type="button" className={primary} onClick={() => answer(true)}>↩ {Verb.BACK} to {key}</button>
      </>
    );
  } else {
    const standup = prompt.after === 'standup';
    title = `${Verb.RESUME} ${key}?`;
    message = (
      <>
        {standup ? 'The stand-up' : 'Lunch'} stopped {task}, and it is no longer assigned to you: it was
        reassigned, closed or moved {standup ? 'meanwhile' : 'over the break'}.
      </>
    );
    buttons = (
      <>
        <button type="button" className={quiet} onClick={() => answer(false)}>{Verb.NOT_NOW}</button>
        <button type="button" className={primary} onClick={() => answer(true)}>▶ {Verb.RESUME} {key} anyway</button>
      </>
    );
  }

  return (
    <section aria-labelledby={titleId} className="select-none bg-dark-800 border border-accent-amber/50 rounded-xl p-5 space-y-3">
      <h3 id={titleId} className="text-sm font-bold text-white">{title}</h3>
      <p className="text-xs text-text-secondary leading-relaxed">{message}</p>
      <div className="flex flex-wrap justify-end gap-2">{buttons}</div>
    </section>
  );
};
