import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Repeat, AlertTriangle, Zap, Link2, Square, Undo2, History } from 'lucide-react';
import { ActiveSessionDTO, TaskDTO } from '../../shared/dtos';
import { triggerDesktopConfetti } from '../utils/confetti-fx';
import { formatSeconds } from '../utils/formatters';
import { taskLeftLabel } from '../../shared/task-left';
import { hasTaskPage } from '../../shared/task-page';
import { ADHOC_PROJECT_ID } from '../../shared/adhoc-project';
import { OWN_PROJECT_PROVIDER_ID } from '../../shared/local-provider';
import { sendDestinationName } from '../../shared/provider-names';
import { TaskPageButton } from './TaskPageButton';
import { SessionTitle } from './SessionTitle';
import { InterruptionDetails } from './InterruptionDetails';
import { StopMenu } from './StopMenu';
import { isAdHocSession } from '../../shared/interruption';
import { StateWord, Verb } from '../../shared/words';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';

interface ActiveTaskHeroCardProps {
  session: ActiveSessionDTO | null;
  onPause: () => void;
  onResume: () => void;
  onComplete: (comment?: string, markDone?: boolean) => void;
  /** Ends the session keeping nothing; Stop ▾ has had it confirmed. */
  onDiscard: () => void;
  onOpenTaskModal: () => void;
  /** Interrupt: a timer at once, the task running waits paused. During one, Another. */
  onInterrupt: () => void;
  /** Ends the interruption and goes back to the task it interrupted, as it was. */
  onBack?: () => void;
  /** Ends the interruption; it waits to be placed. */
  onStopInterruption?: () => void;
  /** Opens the task picker to assign the open ad-hoc session to a task. */
  onAssign?: () => void;
  /** Switches back to the task before this one, in one press. */
  onPrevious?: (task: TaskDTO) => void;
}

/**
 * The task before the running one, for "Previous task: PF-31". Read again
 * whenever the running task changes; none while nothing runs.
 */
function usePreviousTask(taskId: string | null): TaskDTO | null {
  const [previous, setPrevious] = useState<{ for: string; task: TaskDTO | null } | null>(null);
  useEffect(() => {
    const read = window.electronAPI?.getPreviousTask;
    if (!taskId || !read) return undefined;
    let live = true;
    read().then(
      task => { if (live) setPrevious({ for: taskId, task }); },
      err => console.warn('[ActiveTaskHeroCard] Could not read the previous task:', err)
    );
    return () => { live = false; };
  }, [taskId]);
  // An answer for another task is stale: derived, not cleared in the effect.
  return previous && previous.for === taskId ? previous.task : null;
}

const BUTTON = 'flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all';
const PRIMARY_GREEN = `${BUTTON} bg-accent-green hover:bg-accent-green/90 text-dark-900 shadow-md`;
const PLAIN = `${BUTTON} border bg-dark-700 hover:bg-dark-600 text-white border-border-dark`;
const AMBER = `${BUTTON} bg-accent-amber/10 hover:bg-accent-amber/20 text-accent-amber border border-accent-amber/30`;

/**
 * The session card on Today (redesign P8a, S5 and S9): what runs, its time,
 * and the one row of verbs the glossary gives the state -- Pause or Resume,
 * ■ Stop ▾, ⚡ Interrupt, ⇄ Switch task and "Previous task"; during an
 * interruption, Back, Switch task, Stop and Another.
 */
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
  onStopInterruption,
  onPrevious
}) => {
  const { capabilities, providerName } = useProviderCapabilities();
  // Stop and Discard take away the button that had the focus: Start, which
  // replaces them, takes it -- only after an end asked here, never one from
  // the bar or the deck (REVIEW-2026-11 A4).
  const startRef = useRef<HTMLButtonElement | null>(null);
  const endedHere = useRef(false);
  useEffect(() => {
    if (session || !endedHere.current) return;
    endedHere.current = false;
    startRef.current?.focus();
  }, [session]);
  // An interruption is timed apart from the task it interrupted, which waits
  // paused (P6): its controls are Back, Stop and Another, never Pause or Done.
  const interruption = session?.interruption ?? null;
  const previous = usePreviousTask(session && !interruption ? session.taskId : null);

  // The provider this session's time goes to, not the active one (C2).
  const destination = session ? sendDestinationName(session.providerId, providerName) : null;
  const keptHere = session ? isAdHocSession(session) || session.providerId === OWN_PROJECT_PROVIDER_ID || destination === null : false;
  // Done where the provider can move tasks, and for work kept here, where it
  // marks the task done locally. Unknown capabilities still offer it: the
  // provider's own refusal is the fallback, never a hidden Done.
  const offerDone = keptHere || capabilities?.canTransition !== false;
  const doneMeans = keptHere ? 'and marks it done here' : `and ${destination} moves it to its done state`;
  const sendLine = !session
    ? null
    : keptHere
    ? 'kept on this computer, never sent'
    : `sent to ${destination} when you stop, after 10 s to undo`;

  const timer = (
    <div className="text-4xl font-extrabold font-mono text-white tracking-widest" aria-label="Elapsed time">
      {formatSeconds(session?.elapsedSeconds || 0)}
    </div>
  );

  const state = !session ? StateWord.NOTHING_TIMING : session.status === 'TRACKING' ? StateWord.RUNNING : StateWord.PAUSED;

  return (
    <section className="bg-dark-800 rounded-xl border border-border-dark p-6 space-y-5 shadow-xl select-none">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${
              session?.status === 'TRACKING'
                ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                : session
                ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30'
                : 'bg-dark-700 text-text-secondary border border-border-dark'
            }`}
          >
            ● {state}
          </span>
          {session && (
            <span className="flex items-center gap-1 text-text-secondary min-w-0">
              {interruption ? <span className="text-accent-amber">⚡ Interruption</span> : <span className="font-mono">{session.taskKey}</span>}
              {!interruption && hasTaskPage(session.isAdHoc ? ADHOC_PROJECT_ID : session.projectId, session.providerId) && (
                <TaskPageButton taskId={session.taskId} taskKey={session.taskKey} />
              )}
            </span>
          )}
        </div>
        {sendLine && !interruption && <span className="text-text-secondary truncate">{sendLine}</span>}
      </div>

      {interruption ? (
        <InterruptionDetails key={interruption.id} interruption={interruption} timer={timer} />
      ) : (
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          {session ? (
            <SessionTitle
              session={session}
              className="text-xl font-bold text-white tracking-tight"
              inputClassName="w-full bg-dark-900 border border-focus rounded-lg px-3 py-1 text-xl font-bold text-white focus:outline-none font-sans"
            />
          ) : (
            'What are you working on?'
          )}
        </h2>
        {session?.unsorted && (
          <div className="mt-1 text-xs text-accent-amber">
            Interruption: name it, or {Verb.PLACE.toLowerCase()} it on a task so {destination ?? 'your provider'} gets its time.
          </div>
        )}
        {session?.taskUnlisted && (
          <div
            role="status"
            className="mt-2 inline-flex items-center space-x-2 px-3 py-1 rounded-md bg-accent-amber/10 border border-accent-amber/30 text-accent-amber text-xs"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{taskLeftLabel(session.taskLeftBecause, session.taskOwnerName, destination)} — time is still logged</span>
          </div>
        )}
      </div>
      )}

      {!interruption && timer}

      <div className="flex flex-wrap items-center gap-3">
        {/* Idle, the one thing to do is start: Resume and Stop had nothing to act on. */}
        {!session ? (
          <>
            <button ref={startRef} type="button" onClick={onOpenTaskModal} className={PRIMARY_GREEN}>
              <Play className="w-4 h-4" />
              <span>{Verb.START} a task</span>
            </button>
            <button
              type="button"
              onClick={onInterrupt}
              title="Start a timer now, and place its time afterwards"
              className={AMBER}
            >
              <Zap className="w-4 h-4" />
              <span>{Verb.INTERRUPT}</span>
            </button>
          </>
        ) : interruption ? (
          <>
            {interruption.interruptedSessionId && onBack && (
              <button
                type="button"
                onClick={onBack}
                title={`End the interruption and go back to ${interruption.interruptedTaskKey}`}
                className={PRIMARY_GREEN}
              >
                <Undo2 className="w-4 h-4" />
                <span>{Verb.BACK} to {interruption.interruptedTaskKey}</span>
              </button>
            )}
            {/* No Switch here: choosing a task does nothing during an
                interruption -- it ends first (the user's choice, 2026-11-12). */}
            {onStopInterruption && (
              <button
                type="button"
                onClick={onStopInterruption}
                title="End the interruption; place it on a task afterwards"
                className={PLAIN}
              >
                <Square className="w-4 h-4" />
                <span>{Verb.STOP}</span>
              </button>
            )}
            <button type="button" onClick={onInterrupt} title="End this interruption and start the next one" className={AMBER}>
              <Zap className="w-4 h-4" />
              <span>{Verb.ANOTHER}</span>
            </button>
          </>
        ) : (
          <>
            {session.status === 'TRACKING' ? (
              <button type="button" onClick={onPause} className={`${BUTTON} bg-accent-amber hover:bg-accent-amber/90 text-dark-900 shadow-md`}>
                <Pause className="w-4 h-4" />
                <span>{Verb.PAUSE}</span>
              </button>
            ) : (
              <button type="button" onClick={onResume} className={PRIMARY_GREEN}>
                <Play className="w-4 h-4" />
                <span>{Verb.RESUME}</span>
              </button>
            )}
            <StopMenu
              session={session}
              offerDone={offerDone}
              doneMeans={doneMeans}
              onComplete={(comment, markDone) => { endedHere.current = true; onComplete(comment, markDone); }}
              onDiscard={() => { endedHere.current = true; onDiscard(); }}
              // The bar's DONE! is played by `session:complete` itself, once
              // the session has stopped; asking for it here too started it twice.
              onDoneCelebrate={triggerDesktopConfetti}
            />
            <button
              type="button"
              onClick={onInterrupt}
              title="Start a timer now; the task waits paused, and you place the time afterwards"
              className={AMBER}
            >
              <Zap className="w-4 h-4" />
              <span>{Verb.INTERRUPT}</span>
            </button>
            <button type="button" onClick={onOpenTaskModal} className={PLAIN}>
              <Repeat className="w-4 h-4" />
              <span>{Verb.SWITCH} task</span>
            </button>
            {previous && onPrevious && (
              <button
                type="button"
                onClick={() => onPrevious(previous)}
                title={`${Verb.SWITCH} back to ${previous.key} ${previous.title}`}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-text-secondary hover:text-white"
              >
                <History className="w-4 h-4" />
                <span>{Verb.PREVIOUS} task: <span className="font-mono">{previous.key}</span></span>
              </button>
            )}
            {onAssign && isAdHocSession(session) && (
              <button
                type="button"
                onClick={onAssign}
                title="Put its time on a task: all of it goes there"
                className={PLAIN}
              >
                <Link2 className="w-4 h-4" />
                <span>{Verb.PLACE}…</span>
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
};
