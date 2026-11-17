import React from 'react';
import { BellRing } from 'lucide-react';
import { ReminderDTO } from '../../shared/dtos';
import { useAnnounce } from './LiveAnnouncer';

const warn = (what: string) => (err: unknown) => console.warn(`[ReminderPrompt] ${what} failed:`, err);

export interface ReminderAction {
  label: string;
  /** The recommended answer: drawn as the primary button. */
  primary?: boolean;
  title?: string;
  run: () => void;
}

export interface ReminderView {
  heading: string;
  question: string;
  actions: ReminderAction[];
}

/**
 * What a reminder says and offers (S25), for Today's card and the mini
 * timer's row alike. The quiet answer -- Not now, Still paused, Still on it,
 * Still in it -- dismisses it for this occurrence; the other acts through
 * the commands every surface uses, and the reminder goes with the state.
 *
 * `openPicker` is the surface's own: Today opens its picker, the mini timer
 * the picker window.
 */
export function reminderView(reminder: ReminderDTO, openPicker: () => void, onAnswered: () => void): ReminderView {
  const api = window.electronAPI;
  const dismiss = (label: string): ReminderAction => ({
    label,
    run: () => {
      onAnswered();
      api.dismissReminder(reminder.id).catch(warn(label));
    }
  });
  const act = (label: string, run: () => Promise<unknown>, title?: string): ReminderAction => ({
    label,
    primary: true,
    title,
    run: () => {
      onAnswered();
      run().catch(warn(label));
    }
  });
  switch (reminder.kind) {
    case 'nothing-timing':
      return {
        heading: `Nothing timing for ${reminder.minutes} min`,
        question: 'Did you mean to stop?',
        actions: [
          dismiss('Not now'),
          {
            label: '▶ Start a task…',
            primary: true,
            run: () => {
              onAnswered();
              api.dismissReminder(reminder.id).catch(warn('Start a task'));
              openPicker();
            }
          }
        ]
      };
    case 'long-pause':
      return {
        heading: `${reminder.minutes} min paused on ${reminder.taskKey ?? 'your task'}`,
        question: 'Still paused?',
        actions: [dismiss('Still paused'), act('▶ Resume', () => api.resumeSession(), `Resume ${reminder.taskKey ?? 'it'}`)]
      };
    case 'interruption-running':
      return {
        heading: `${reminder.minutes} min on "${reminder.name ?? 'the interruption'}"`,
        question: 'Still on it?',
        actions: [
          dismiss('Still on it'),
          reminder.heldTaskKey
            ? act(`↩ Back to ${reminder.heldTaskKey}`, () => api.backFromInterruption())
            : act('■ Stop', () => api.stopInterruption(), 'End the interruption; place it on a task afterwards')
        ]
      };
    case 'standup-running':
      return {
        heading: `${reminder.minutes} min in the stand-up`,
        question: 'Still in it?',
        actions: [
          dismiss('Still in it'),
          act('End stand-up', () => api.completeSession(undefined, false), 'Stop the stand-up; the task before it starts again')
        ]
      };
    case 'time-away':
      // The task kept timing (2026-11-17): keeping it is the quiet answer,
      // and only the user gives the time to something else.
      return {
        heading: `Away ${reminder.minutes} min`,
        question: `Was it on ${reminder.taskKey ?? 'your task'}?`,
        actions: [
          dismiss(`Keep it on ${reminder.taskKey ?? 'the task'}`),
          act('⚡ Something else…', () => api.giveAwayTime(reminder.id), 'Make the time away an interruption, then place it on a task or keep it off')
        ]
      };
  }
}

const primaryClass = 'px-4 py-2 bg-primary hover:bg-primary/90 text-dark-900 text-xs font-semibold rounded-lg transition-all';
const secondaryClass = 'px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all';

/** A reminder on Today (P8d): asked once, kept until answered or the state ends. */
export const ReminderCard: React.FC<{ reminder: ReminderDTO; openPicker: () => void; onAnswered: () => void }> = ({
  reminder,
  openPicker,
  onAnswered
}) => {
  const view = reminderView(reminder, openPicker, onAnswered);
  useAnnounce(reminder.id, `${view.heading}. ${view.question}`);
  return (
    <section aria-label={view.question} className="bg-dark-800 border border-accent-amber/50 rounded-xl p-5 space-y-3 select-none">
      <div className="flex items-center gap-2">
        <BellRing className="w-4 h-4 text-accent-amber" />
        <h3 className="text-sm font-bold text-white">{view.heading}</h3>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">{view.question}</p>
        <div className="flex gap-2">
          {view.actions.map(a => (
            <button key={a.label} type="button" title={a.title} className={a.primary ? primaryClass : secondaryClass} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
