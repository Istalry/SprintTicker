import React, { useState } from 'react';
import { Play, Pause, RefreshCw, Sparkles, AlertTriangle, Zap, Link2, Square, Undo2 } from 'lucide-react';
import { ActiveSessionDTO } from '../../shared/dtos';
import { triggerDesktopConfetti } from '../utils/confetti-fx';
import { formatSeconds } from '../utils/formatters';
import { FinishSessionModal } from './FinishSessionModal';
import { taskLeftLabel } from '../../shared/task-left';
import { hasTaskPage } from '../../shared/task-page';
import { ADHOC_PROJECT_ID } from '../../shared/adhoc-project';
import { TaskPageButton } from './TaskPageButton';
import { SessionTitle } from './SessionTitle';
import { isAdHocSession } from '../../shared/interruption';
import { Verb } from '../../shared/words';

interface ActiveTaskHeroCardProps {
  session: ActiveSessionDTO | null;
  onPause: () => void;
  onResume: () => void;
  onComplete: (comment?: string, markDone?: boolean) => void;
  /** Ends the session keeping nothing; the Finish dialog has had it confirmed. */
  onDiscard: () => void;
  onOpenTaskModal: () => void;
  /** Interrupt: a timer at once, the task running waits paused. During one, Another. */
  onInterrupt: () => void;
  /** Ends the interruption and resumes the task it interrupted. */
  onBack?: () => void;
  /** Ends the interruption; it waits to be placed. */
  onStopInterruption?: () => void;
  /** Opens the task picker to assign the open ad-hoc session to a task. */
  onAssign?: () => void;
}

export const ActiveTaskHeroCard: React.FC<ActiveTaskHeroCardProps> = ({
  session,
  onPause,
  onResume,
  onComplete,
  onDiscard,
  onOpenTaskModal,
  onInterrupt,
  onAssign,
  onBack,
  onStopInterruption
}) => {
  const [isFinishModalOpen, setIsFinishModalOpen] = useState<boolean>(false);
  // An interruption is timed apart from the task it interrupted, which waits
  // paused (P6): its controls are Back, Stop and Another, never Pause or Finish.
  const interruption = session?.interruption ?? null;

  const handleFinishOption = (markDone: boolean) => {
    setIsFinishModalOpen(false);
    // The bar's DONE! is played by `session:complete` itself, once a session
    // has actually stopped. Asking for it here as well started the scene
    // twice -- two uploads for one finish.
    if (markDone) {
      triggerDesktopConfetti();
    }
    onComplete(undefined, markDone);
  };

  return (
    <>
      <section className="bg-dark-800 rounded-xl border border-border-dark p-6 space-y-6 shadow-xl select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="bg-select text-text-primary px-3 py-1 rounded-md text-xs font-bold">
              CURRENT SESSION
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                session?.status === 'TRACKING'
                  ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                  : session?.status === 'PAUSED'
                  ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30'
                  : 'bg-dark-700 text-text-secondary border border-border-dark'
              }`}
            >
              ● {session?.status || 'IDLE'}
            </span>
          </div>
        </div>

        <div>
          {session && (
            <div className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <span className="font-mono">{session.taskKey}</span>
              {hasTaskPage(session.isAdHoc ? ADHOC_PROJECT_ID : session.projectId, session.providerId) && (
                <TaskPageButton taskId={session.taskId} taskKey={session.taskKey} />
              )}
            </div>
          )}
          <h2 className="text-xl font-bold text-white tracking-tight">
            {session ? (
              <SessionTitle
                session={session}
                className="text-xl font-bold text-white tracking-tight"
                inputClassName="w-full bg-dark-900 border border-focus rounded-lg px-3 py-1 text-xl font-bold text-white focus:outline-none font-sans"
              />
            ) : (
              'No task running'
            )}
          </h2>
          {interruption ? (
            <div className="mt-1 text-xs text-accent-amber">
              {interruption.interruptedTaskKey
                ? `Interruption ${interruption.index} during ${interruption.interruptedTaskKey}, which waits paused. Place it on a task when it ends.`
                : `Interruption ${interruption.index}. Place it on a task when it ends.`}
            </div>
          ) : session?.unsorted && (
            <div className="mt-1 text-xs text-accent-amber">
              Interruption -- name it, or assign it to a task so its time reaches your provider.
            </div>
          )}
          {session?.taskUnlisted && (
            <div
              role="status"
              className="mt-2 inline-flex items-center space-x-2 px-3 py-1 rounded-md bg-accent-amber/10 border border-accent-amber/30 text-accent-amber text-xs"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{taskLeftLabel(session.taskLeftBecause, session.taskOwnerName)} -- time is still logged</span>
            </div>
          )}
        </div>

        <div className="flex items-baseline space-x-4 bg-dark-900 p-4 rounded-lg border border-border-dark">
          <span className="text-xs text-text-secondary">Elapsed Time:</span>
          <span className="text-4xl font-extrabold font-mono text-white tracking-widest">
            {formatSeconds(session?.elapsedSeconds || 0)}
          </span>
        </div>

        <div className="flex items-center space-x-3 pt-2">
          {/* Idle, the one thing to do is start: Resume and Finish had nothing to act on. */}
          {!session ? (
            <button
              onClick={onOpenTaskModal}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-accent-green hover:bg-accent-green/90 text-dark-900 transition-all shadow-md"
            >
              <Play className="w-4 h-4" />
              <span>Start a Task</span>
            </button>
          ) : interruption ? (
            <>
              {interruption.interruptedSessionId && onBack && (
                <button
                  onClick={onBack}
                  title={`End the interruption and resume ${interruption.interruptedTaskKey}`}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-accent-green hover:bg-accent-green/90 text-dark-900 transition-all shadow-md"
                >
                  <Undo2 className="w-4 h-4" />
                  <span>{Verb.BACK} to {interruption.interruptedTaskKey}</span>
                </button>
              )}
              {onStopInterruption && (
                <button
                  onClick={onStopInterruption}
                  title="End the interruption; place it on a task afterwards"
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm border transition-all bg-dark-700 hover:bg-dark-700/80 text-white border-border-dark"
                >
                  <Square className="w-4 h-4" />
                  <span>{Verb.STOP}</span>
                </button>
              )}
            </>
          ) : session.status === 'TRACKING' ? (
            <button
              onClick={onPause}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-accent-amber hover:bg-accent-amber/90 text-dark-900 transition-all shadow-md"
            >
              <Pause className="w-4 h-4" />
              <span>Pause</span>
            </button>
          ) : (
            <button
              onClick={onResume}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-md bg-accent-green hover:bg-accent-green/90 text-dark-900"
            >
              <Play className="w-4 h-4" />
              <span>Resume</span>
            </button>
          )}

          {session && !interruption && (
            <button
              onClick={() => setIsFinishModalOpen(true)}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm border transition-all bg-dark-700 hover:bg-dark-700/80 text-white border-border-dark"
            >
              <Sparkles className="w-4 h-4 text-accent-green" />
              <span>Finish & Log Hours</span>
            </button>
          )}

          <button
            onClick={onInterrupt}
            title={interruption
              ? 'End this interruption and start the next one'
              : 'Start a timer now; the task waits paused, and you place the time afterwards'}
            className="flex items-center space-x-2 px-5 py-2.5 bg-accent-amber/10 hover:bg-accent-amber/20 text-accent-amber rounded-lg font-semibold text-sm border border-accent-amber/30 transition-all"
          >
            <Zap className="w-4 h-4" />
            <span>{interruption ? Verb.ANOTHER : Verb.INTERRUPT}</span>
          </button>

          {session && onAssign && isAdHocSession(session) && (
            <button
              onClick={onAssign}
              title="Move this session to a task: all of its time goes there"
              className="flex items-center space-x-2 px-5 py-2.5 bg-dark-700 hover:bg-dark-700/80 text-white rounded-lg font-semibold text-sm border border-border-dark transition-all"
            >
              <Link2 className="w-4 h-4" />
              <span>Assign to Task</span>
            </button>
          )}

          {session && (
            <button
              onClick={onOpenTaskModal}
              className="flex items-center space-x-2 px-5 py-2.5 bg-select hover:bg-dark-600 text-text-primary rounded-lg font-semibold text-sm border border-focus/30 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Switch Task</span>
            </button>
          )}
        </div>
      </section>

      <FinishSessionModal
        isOpen={isFinishModalOpen}
        session={session}
        onClose={() => setIsFinishModalOpen(false)}
        onFinishOption={handleFinishOption}
        onDiscard={() => {
          setIsFinishModalOpen(false);
          onDiscard();
        }}
      />
    </>
  );
};
