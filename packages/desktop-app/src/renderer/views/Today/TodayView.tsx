import React, { useState } from 'react';
import { ActiveSessionDTO, TaskDTO, WorklogDTO } from '../../../shared/dtos';
import { ActiveTaskHeroCard } from '../../components/ActiveTaskHeroCard';
import { PickerMode } from '../../hooks/useModals';
import { useCeremonyPrompt, useForgottenReview, useMorning, useReminder, useResumePrompt, useUserMode } from '../../hooks/usePrompts';
import { MorningCard } from '../../components/MorningCard';
import { TaskLeftCard, wasKept } from '../../components/TaskLeftCard';
import { ReminderCard } from '../../components/ReminderPrompt';
import { BreakCard, LunchQuestionCard, StandupCard } from '../../components/PromptCards';
import { ResumeAfterLunchPrompt } from '../../components/ResumeAfterLunchPrompt';
import { ForgottenSessionCard } from '../../components/ForgottenSessionModal';
import { StatusCards } from '../../components/StatusCards';
import { DeviceStatusDTO } from '../../../shared/dtos';
import { SettingsGroupId } from '../Settings/settings-groups';
import { InterruptionsToPlace } from '../../components/InterruptionsToPlace';
import { TodayEntries } from '../../components/TodayEntries';

interface TodayViewProps {
  session: ActiveSessionDTO | null;
  worklogs: WorklogDTO[];
  onPause: () => void;
  onResume: () => void;
  onComplete: (comment?: string, markDone?: boolean) => void;
  onDiscard: () => void;
  onInterrupt: () => void;
  onStopInterruption?: () => void;
  onOpenPicker: (mode: PickerMode) => void;
  /** Switches back to the task before, in one press. */
  onPrevious?: (task: TaskDTO) => void;
  /** The bar's status, for S31's "unplugged" card; absent, no card is drawn for it. */
  device?: DeviceStatusDTO;
  /** Where S31's cards send the user to fix things. */
  onOpenSettings?: (group: SettingsGroupId) => void;
}

/**
 * Today (S4, S5, S6): the questions waiting on the user, the task running,
 * the interruptions to place, from any day, and today's entries. The questions are cards here, never dialogs that
 * take the window (P8c): the stand-up, Lunch or Away, and "Back at your
 * desk?".
 */
export const TodayView: React.FC<TodayViewProps> = ({
  session,
  worklogs,
  onPause,
  onResume,
  onComplete,
  onDiscard,
  onInterrupt,
  onStopInterruption,
  onOpenPicker,
  onPrevious,
  device,
  onOpenSettings
}) => {
  const ceremony = useCeremonyPrompt();
  const [reminder, setReminder] = useReminder();
  const [mode, setMode] = useUserMode();
  const [morning, putMorningAway] = useMorning();
  // When Today opened: the morning card's "in 22 minutes" counts from it.
  const [openedAt] = useState(() => new Date());
  const [resume] = useResumePrompt();
  const [forgotten] = useForgottenReview();
  // Bumped when the task-left card is put away, so the next question shows.
  const [, setKeptCount] = useState(0);
  const leaveAway = () => {
    setMode('WORK');
    window.electronAPI.setUserMode('WORK').catch(err => console.warn('[TodayView] Leaving Away failed:', err));
  };
  // One question at a time, the most urgent first (REVIEW-2026-11 C5, the
  // user's choice, 2026-11-13): stacked, three amber cards contradicted each
  // other -- two Resume buttons -- and pushed the session's controls down.
  const questions: React.ReactNode[] = [];
  if (forgotten?.deferred) questions.push(<ForgottenSessionCard key="forgotten" />);
  // The ones with a time first: the stand-up and lunch's question will not
  // wait; Back to MG-12? does (second pass, N5).
  if (ceremony?.type === 'STANDUP') questions.push(<StandupCard key="standup" prompt={ceremony} session={session} />);
  if (ceremony?.type === 'LUNCH') questions.push(<LunchQuestionCard key="lunch" prompt={ceremony} />);
  if (resume) questions.push(<ResumeAfterLunchPrompt key="resume" />);
  if (mode !== 'WORK') questions.push(<BreakCard key="break" mode={mode} session={session} onLeaveAway={leaveAway} />);
  if (session?.taskUnlisted && !session.interruption && !wasKept(session)) {
    questions.push(
      <TaskLeftCard key={`${session.sessionId}-${session.taskLeftBecause ?? 'reassigned'}`} session={session}
        onSwitch={() => onOpenPicker('start')} onKept={() => setKeptCount(n => n + 1)} />
    );
  }
  if (reminder) questions.push(<ReminderCard key="reminder" reminder={reminder} openPicker={() => onOpenPicker('start')} onAnswered={() => setReminder(null)} />);
  const [first, ...rest] = questions;
  const more = rest.length;
  return (
  <div className="space-y-6">
    {/* The page's own heading (A20): its cards are h3 under it. */}
    <h2 className="sr-only">Today</h2>
    {device && onOpenSettings && <StatusCards device={device} onOpenSettings={onOpenSettings} />}
    {morning && !session && <MorningCard morning={morning} now={openedAt} onOpenPicker={() => onOpenPicker('start')} onPutAway={putMorningAway} />}
    {first}
    {more > 0 && (
      <p className="-mt-3 text-xs text-text-secondary">{more === 1 ? '1 more question' : `${more} more questions`} after this one</p>
    )}

    <ActiveTaskHeroCard
      session={session}
      onPause={onPause}
      onResume={onResume}
      onComplete={onComplete}
      onDiscard={onDiscard}
      onOpenTaskModal={() => onOpenPicker('start')}
      onAssign={() => onOpenPicker('assign')}
      onInterrupt={onInterrupt}
      onStopInterruption={onStopInterruption}
      onPrevious={onPrevious}
    />

    <InterruptionsToPlace />

    <TodayEntries session={session} worklogs={worklogs} />
  </div>
  );
};
