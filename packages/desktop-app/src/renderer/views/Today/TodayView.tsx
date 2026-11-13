import React, { useState } from 'react';
import { ActiveSessionDTO, TaskDTO, WorklogDTO } from '../../../shared/dtos';
import { ActiveTaskHeroCard } from '../../components/ActiveTaskHeroCard';
import { PickerMode } from '../../hooks/useModals';
import { useCeremonyPrompt, useMorning, useReminder, useUserMode } from '../../hooks/usePrompts';
import { MorningCard } from '../../components/MorningCard';
import { TaskLeftCard } from '../../components/TaskLeftCard';
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
  onBack?: () => void;
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
  onBack,
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
  const leaveAway = () => {
    setMode('WORK');
    window.electronAPI.setUserMode('WORK').catch(err => console.warn('[TodayView] Leaving Away failed:', err));
  };
  return (
  <div className="space-y-6">
    {/* The page's own heading (A20): its cards are h3 under it. */}
    <h2 className="sr-only">Today</h2>
    <ForgottenSessionCard />
    {device && onOpenSettings && <StatusCards device={device} onOpenSettings={onOpenSettings} />}
    {morning && !session && <MorningCard morning={morning} now={openedAt} onOpenPicker={() => onOpenPicker('start')} onPutAway={putMorningAway} />}
    {ceremony?.type === 'STANDUP' && <StandupCard prompt={ceremony} session={session} />}
    {ceremony?.type === 'LUNCH' && <LunchQuestionCard prompt={ceremony} />}
    <ResumeAfterLunchPrompt />
    <BreakCard mode={mode} session={session} onLeaveAway={leaveAway} />
    {reminder && <ReminderCard reminder={reminder} openPicker={() => onOpenPicker('start')} onAnswered={() => setReminder(null)} />}

    {session?.taskUnlisted && !session.interruption && (
      <TaskLeftCard key={`${session.sessionId}-${session.taskLeftBecause ?? 'reassigned'}`} session={session} onSwitch={() => onOpenPicker('start')} />
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
      onBack={onBack}
      onStopInterruption={onStopInterruption}
      onPrevious={onPrevious}
    />

    <InterruptionsToPlace />

    <TodayEntries session={session} worklogs={worklogs} />
  </div>
  );
};
