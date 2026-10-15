import React, { useEffect, useState } from 'react';
import { ResumePromptDTO } from '../../shared/dtos';
import { ConfirmPanel } from './ConfirmPanel';

/**
 * "Resume it anyway?", asked when lunch or the stand-up ends and the task it
 * stopped has left the user's lists meanwhile -- reassigned, closed or moved.
 * It is not restarted without asking.
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

  const answer = (resume: boolean) => {
    setPrompt(null);
    window.electronAPI.answerResumePrompt(resume)
      .catch(err => console.warn('[ResumeAfterLunchPrompt] Could not answer:', err));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 font-mono select-none">
      <div className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
        <ConfirmPanel
          title={standup ? 'Resume after the stand-up?' : 'Resume after lunch?'}
          message={
            <>
              {standup ? 'The stand-up' : 'Lunch'} stopped <span className="text-accent-blue font-bold">{prompt.taskKey}</span>
              {prompt.taskTitle && <> ({prompt.taskTitle})</>}, and it is no longer assigned to you: it was
              reassigned, closed or moved {standup ? 'meanwhile' : 'over the break'}. Resume tracking it anyway?
            </>
          }
          confirmLabel="Resume it"
          cancelLabel="Leave it"
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
      </div>
    </div>
  );
};
