import React, { useEffect, useState } from 'react';
import { ResumePromptDTO } from '../../shared/dtos';
import { ConfirmPanel } from './ConfirmPanel';

const MS_PER_MINUTE = 60_000;

/**
 * "Resume it anyway?", asked when lunch or the stand-up ends and the task it
 * stopped has left the user's lists meanwhile -- reassigned, closed or moved.
 * It is not restarted without asking. After an interruption it is asked every
 * time: "Back to your task?".
 *
 * Follows main rather than owning the question: the bar asks it too, and an
 * answer there closes it here. Read once on mount as well, for a window opened
 * after the question was asked.
 */
export const ResumeAfterLunchPrompt: React.FC = () => {
  const [prompt, setPrompt] = useState<ResumePromptDTO | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onResumePrompt) return undefined;
    api.getResumePrompt()
      .then(setPrompt)
      .catch(err => console.warn('[ResumeAfterLunchPrompt] Could not read the question:', err));
    return api.onResumePrompt(setPrompt);
  }, []);

  if (!prompt) return null;
  const standup = prompt.after === 'standup';
  // After Lunch or Away the task is paused, not stopped (P8b).
  const held = prompt.held === true;
  const breakName = prompt.after === 'away' ? 'Away' : 'Lunch';
  const task = (
    <>
      <span className="font-mono text-text-primary font-bold">{prompt.taskKey}</span>
      {prompt.taskTitle && <> ({prompt.taskTitle})</>}
    </>
  );

  const answer = (resume: boolean, addGapMinutes?: number, workedThrough?: boolean) => {
    setPrompt(null);
    window.electronAPI.answerResumePrompt(resume, addGapMinutes, workedThrough)
      .catch(err => console.warn('[ResumeAfterLunchPrompt] Could not answer:', err));
  };
  // The minutes since the interruption ended, read at the click: Back then
  // counts them as work on the task, which waited paused through them.
  const endedAt = prompt.interruptionEndedAtUtc ? Date.parse(prompt.interruptionEndedAtUtc) : NaN;
  const answerWithGap = () => answer(true, Math.max(0, Math.round((Date.now() - endedAt) / MS_PER_MINUTE)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
        <ConfirmPanel
          title={
            held ? 'Back at your desk?'
              : prompt.after === 'interruption' ? 'Back to your task?' : standup ? 'Resume after the stand-up?' : 'Resume after lunch?'
          }
          message={
            held ? (
              <>
                {task} is paused, as it was: {breakName} is not timed, and nothing was sent.
                {prompt.unlisted && <> It is no longer assigned to you: it was reassigned, closed or moved meanwhile.</>}
              </>
            ) : prompt.after === 'interruption' ? (
              <>
                {task} waited paused through the interruption.
                {prompt.unlisted && <> It is no longer assigned to you: it was reassigned, closed or moved meanwhile.</>}
                {' '}Resume tracking it?
              </>
            ) : (
              <>
                {standup ? 'The stand-up' : 'Lunch'} stopped {task}, and it is no longer assigned to you: it was
                reassigned, closed or moved {standup ? 'meanwhile' : 'over the break'}. Resume tracking it anyway?
              </>
            )
          }
          confirmLabel={held ? `Resume ${prompt.taskKey}` : 'Resume it'}
          cancelLabel={held ? 'Not now' : 'Leave it'}
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
        {held && (
          <div className="flex justify-end pt-3">
            <button
              type="button"
              onClick={() => answer(true, undefined, true)}
              title={`Resume it, and count the ${breakName.toLowerCase()} as work on it: the pause is taken back`}
              className="text-xs text-text-secondary hover:text-white underline-offset-2 hover:underline"
            >
              I worked through it
            </button>
          </div>
        )}
        {prompt.after === 'interruption' && !Number.isNaN(endedAt) && (
          <div className="flex justify-end pt-3">
            <button
              type="button"
              onClick={answerWithGap}
              title="Resume it, and count the time since the interruption ended as work on it"
              className="text-xs text-text-secondary hover:text-white underline-offset-2 hover:underline"
            >
              Resume, and count the time since as work
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
