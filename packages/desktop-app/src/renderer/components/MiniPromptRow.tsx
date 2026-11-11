import React from 'react';
import { CeremonyPromptDTO, ReminderDTO, ResumePromptDTO } from '../../shared/dtos';
import { reminderView } from './ReminderPrompt';

const MS_PER_MINUTE = 60_000;

const choice =
  'px-1 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors [-webkit-app-region:no-drag]';
const quiet = `${choice} text-text-secondary hover:text-white hover:bg-dark-700`;
const main = `${choice} bg-primary text-dark-900 hover:bg-white`;

const warn = (what: string) => (err: unknown) => console.warn(`[MiniPromptRow] ${what} failed:`, err);

interface MiniPromptRowProps {
  resume: ResumePromptDTO | null;
  ceremony: CeremonyPromptDTO | null;
  /** An interruption is running: joining the stand-up ends it (S25). */
  inInterruption?: boolean;
  /** A "still...?" reminder (P8d), shown when nothing else is asked. */
  reminder?: ReminderDTO | null;
  /** Hides the question at once on an answer, before main confirms. */
  onAnswered: () => void;
}

/**
 * A question on the mini timer (S25), in place of the session's row until it
 * is answered: the stand-up, "Back at your desk?", "Back to MG-12?". The
 * questions no longer bring the dashboard forward (P8c), so the always-on-top
 * row is where they are seen while the user works. The answers are Today's.
 */
export const MiniPromptRow: React.FC<MiniPromptRowProps> = ({ resume, ceremony, inInterruption = false, reminder = null, onAnswered }) => {
  const api = window.electronAPI;
  const answer = (yes: boolean, gap?: number, workedThrough?: boolean) => () => {
    onAnswered();
    api.answerResumePrompt(yes, gap, workedThrough).catch(warn('Answering'));
  };

  let heading: string;
  let question: string;
  let buttons: React.ReactNode;
  if (resume) {
    const key = resume.taskKey;
    if (resume.held) {
      // 360 px: the key goes in the heading, so the buttons fit beside it.
      heading = `${resume.after === 'away' ? 'Away' : 'Lunch'} over · ${key}`;
      question = 'Back at your desk?';
      buttons = (
        <>
          <button type="button" className={quiet} onClick={answer(false)}>Not now</button>
          <button type="button" className={quiet} title="Count the break as work: the pause is taken back" onClick={answer(true, undefined, true)}>
            Worked through
          </button>
          <button type="button" className={main} title={`Resume ${key}`} onClick={answer(true)}>▶ Resume</button>
        </>
      );
    } else if (resume.after === 'interruption') {
      const endedAt = resume.interruptionEndedAtUtc ? Date.parse(resume.interruptionEndedAtUtc) : NaN;
      const gapNow = () => Math.max(0, Math.round((Date.now() - endedAt) / MS_PER_MINUTE));
      heading = 'Nothing timing';
      question = `Back to ${key}?`;
      buttons = (
        <>
          <button type="button" className={quiet} onClick={answer(false)}>Not now</button>
          {!Number.isNaN(endedAt) && (
            <button type="button" className={quiet} title="Resume it, and count the time since the interruption ended as work"
              onClick={() => answer(true, gapNow())()}>
              Back +time
            </button>
          )}
          <button type="button" className={main} onClick={answer(true)}>↩ Back</button>
        </>
      );
    } else {
      heading = `Resume ${key}?`;
      question = 'It is no longer assigned to you';
      buttons = (
        <>
          <button type="button" className={quiet} onClick={answer(false)}>Leave it</button>
          <button type="button" className={main} onClick={answer(true)}>Resume</button>
        </>
      );
    }
  } else if (ceremony?.type === 'LUNCH') {
    heading = 'Lunch time · in an interruption';
    question = `Start lunch? It ends "${ceremony.endsInterruption ?? 'the interruption'}"`;
    buttons = (
      <>
        <button type="button" className={quiet} onClick={() => { onAnswered(); api.answerLunchQuestion(false).catch(warn('Not now')); }}>Not now</button>
        <button type="button" className={main} onClick={() => { onAnswered(); api.answerLunchQuestion(true).catch(warn('Start lunch')); }}>Start lunch</button>
      </>
    );
  } else if (ceremony?.type === 'STANDUP') {
    heading = `Stand-up at ${ceremony.at}`;
    question = inInterruption ? 'Join? It ends the interruption' : 'Your task keeps running until you Join';
    buttons = (
      <>
        <button type="button" className={quiet} onClick={() => { onAnswered(); api.cancelStandupPrompt().catch(warn('Skip')); }}>Skip</button>
        <button type="button" className={main} onClick={() => { onAnswered(); api.joinStandup().catch(warn('Join')); }}>Join</button>
      </>
    );
  } else if (reminder) {
    const view = reminderView(reminder, () => { api.openTaskPicker().catch(warn('Opening the picker')); }, onAnswered);
    heading = view.heading;
    question = view.question;
    buttons = (
      <>
        {view.actions.map(a => (
          <button key={a.label} type="button" title={a.title} className={a.primary ? main : quiet} onClick={a.run}>{a.label}</button>
        ))}
      </>
    );
  } else {
    return null;
  }

  return (
    <div role="alertdialog" aria-label={question} className="flex flex-1 min-w-0 items-center gap-2">
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[11px] font-bold text-accent-amber truncate">{heading}</div>
        <div className="text-[11px] text-text-primary truncate" title={question}>{question}</div>
      </div>
      <div className="flex items-center gap-1">{buttons}</div>
    </div>
  );
};
