import React from 'react';
import { ActiveSessionDTO, TaskDTO, WorklogDTO } from '../../../shared/dtos';
import { ActiveTaskHeroCard } from '../../components/ActiveTaskHeroCard';
import { PickerMode } from '../../hooks/useModals';
import { useCeremonyPrompt, useReminder, useUserMode } from '../../hooks/usePrompts';
import { ReminderCard } from '../../components/ReminderPrompt';
import { BreakCard, LunchQuestionCard, StandupCard } from '../../components/PromptCards';
import { ResumeAfterLunchPrompt } from '../../components/ResumeAfterLunchPrompt';
import { InterruptionsToPlace } from '../../components/InterruptionsToPlace';
import { TodayEntries } from '../../components/TodayEntries';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';
import { keepOffLabel } from '../../../shared/words';

interface TodayViewProps {
  session: ActiveSessionDTO | null;
  worklogs: WorklogDTO[];
  onPause: () => void;
  onResume: () => void;
  onComplete: (comment?: string, markDone?: boolean) => void;
  onDiscard: () => void;
  onInterrupt: () => void;
  onBack?: () => void;
  onStopInterruption?: () => void;
  onOpenPicker: (mode: PickerMode) => void;
  /** Switches back to the task before, in one press. */
  onPrevious?: (task: TaskDTO) => void;
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
  onBack,
  onStopInterruption,
  onOpenPicker,
  onPrevious
}) => {
  const ceremony = useCeremonyPrompt();
  const [reminder, setReminder] = useReminder();
  const [mode, setMode] = useUserMode();
  const { providerName } = useProviderCapabilities();
  const provider = providerName || 'The provider';
  const toPlaceHint = `${provider} gets this time once it is on a task. ${keepOffLabel(providerName)} keeps one in your history, never sent. Tick some to place them together.`;
  const leaveAway = () => {
    setMode('WORK');
    window.electronAPI.setUserMode('WORK').catch(err => console.warn('[TodayView] Leaving Away failed:', err));
  };
  return (
  <div className="space-y-6">
    {ceremony?.type === 'STANDUP' && <StandupCard prompt={ceremony} session={session} />}
    {ceremony?.type === 'LUNCH' && <LunchQuestionCard prompt={ceremony} />}
    <ResumeAfterLunchPrompt />
    <BreakCard mode={mode} session={session} onLeaveAway={leaveAway} />
    {reminder && <ReminderCard reminder={reminder} openPicker={() => onOpenPicker('start')} onAnswered={() => setReminder(null)} />}

    <ActiveTaskHeroCard
      session={session}
      onPause={onPause}
      onResume={onResume}
      onComplete={onComplete}
      onDiscard={onDiscard}
      onOpenTaskModal={() => onOpenPicker('start')}
      onAssign={() => onOpenPicker('assign')}
      onInterrupt={onInterrupt}
      onBack={onBack}
      onStopInterruption={onStopInterruption}
      onPrevious={onPrevious}
    />

    <InterruptionsToPlace hint={toPlaceHint} />

    <TodayEntries session={session} worklogs={worklogs} />
  </div>
  );
};
