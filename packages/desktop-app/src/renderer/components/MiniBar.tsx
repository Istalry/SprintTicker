import React, { useEffect, useState } from 'react';
import { AlertTriangle, CornerDownRight, History, Link2, ListTodo, Pause, Play, Repeat, Square, X, Zap } from 'lucide-react';
import { useSession } from '../hooks/useSession';
import { useScreenIcon } from '../hooks/useScreenIcon';
import { useToPlaceCount } from '../hooks/useToPlaceCount';
import { ScreenIcon } from './ScreenIcon';
import { formatSeconds } from '../utils/formatters';
import { finishNeedsConfirmation, taskLeftLabel } from '../../shared/task-left';
import { isAdHocSession } from '../../shared/interruption';
import type { InterruptionSource } from '../../shared/interruption';
import type { ActiveSessionDTO, StandupRunningDTO, TaskDTO } from '../../shared/dtos';
import { FlowSettingKey } from '../../shared/flow-settings';
import { formatHoursAndMinutes } from '../../shared/time-format';
import { toPlaceLabel, undoCountdown, Verb } from '../../shared/words';
import { SessionTitle } from './SessionTitle';
import { useUndo } from './UndoBar';
import { STARTED_AGO_CHOICES } from './InterruptionDetails';
import { useCeremonyPrompt, useForgottenReview, useReminder, useResumePrompt } from '../hooks/usePrompts';
import { MiniPromptRow } from './MiniPromptRow';

/** How often, with nothing timing, the mini timer asks whether it is working hours. */
const WORKING_NOW_POLL_MS = 30_000;

/** Where an interruption came from, when it was not this screen: "from the deck". */
const FROM: Partial<Record<InterruptionSource, string>> = {
  bar: 'from the bar',
  deck: 'from the deck',
  shortcut: 'from the shortcut'
};

const warn = (what: string) => (err: unknown) => console.warn(`[MiniBar] ${what} failed:`, err);

/** The task Previous goes back to, read again whenever the session changes. */
function usePreviousTask(sessionId: string | null): TaskDTO | null {
  const [previous, setPrevious] = useState<TaskDTO | null>(null);
  useEffect(() => {
    const read = window.electronAPI?.getPreviousTask;
    if (!read) return undefined;
    let live = true;
    read().then(task => { if (live) setPrevious(task); }, warn('Reading the previous task'));
    return () => { live = false; };
  }, [sessionId]);
  return previous;
}

/** The stand-up, when it is what runs, and where its end goes back to (S25). */
function useStandupRunning(sessionId: string | null): StandupRunningDTO | null {
  const [standup, setStandup] = useState<{ sessionId: string; value: StandupRunningDTO | null } | null>(null);
  useEffect(() => {
    const read = window.electronAPI?.getStandupRunning;
    if (!read || !sessionId) return undefined;
    let live = true;
    read().then(value => { if (live) setStandup({ sessionId, value }); }, warn('Reading the stand-up'));
    return () => { live = false; };
  }, [sessionId]);
  // An answer for a session that has since ended says nothing of this one.
  return standup && standup.sessionId === sessionId ? standup.value : null;
}

/** Whether nothing timing is news: in working hours, it is said loudly (S25). */
function useWorkingNow(idle: boolean): boolean {
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const read = window.electronAPI?.isWorkingNow;
    if (!read || !idle) return undefined;
    let live = true;
    const ask = () => { read().then(now => { if (live) setWorking(now); }, warn('Reading the working hours')); };
    ask();
    const timer = setInterval(ask, WORKING_NOW_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [idle]);
  return idle && working;
}

/** Whether the one-line tour of the buttons was put away; unknown until read. */
function useTourSeen(): [boolean | null, () => void] {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    const read = window.electronAPI?.getFlowSetting;
    if (!read) return undefined;
    let live = true;
    read(FlowSettingKey.MINI_TOUR_SEEN).then(value => { if (live) setSeen(value); }, warn('Reading the tour'));
    return () => { live = false; };
  }, []);
  const putAway = () => {
    setSeen(true);
    window.electronAPI.saveFlowSetting(FlowSettingKey.MINI_TOUR_SEEN, true).catch(warn('Putting the tour away'));
  };
  return [seen, putAway];
}

/** "MG-12 · Rin's now": the task is someone else's, said with the key (S25). */
function notYoursLabel(session: ActiveSessionDTO): string {
  const owner = session.taskOwnerName?.trim();
  if (owner && session.taskLeftBecause !== 'closed' && session.taskLeftBecause !== 'gone') {
    return `${session.taskKey} · ${owner.split(/\s+/)[0]}'s now`;
  }
  return `${session.taskKey} · ${taskLeftLabel(session.taskLeftBecause, session.taskOwnerName)}`;
}

/**
 * The always-on-top mini timer (S25): what the BUSY Bar shows, on screen.
 *
 * One row in a frameless window (`MINI_WINDOW_SIZE`). The whole row drags
 * the window except the buttons, which opt out -- a button inside a drag
 * region swallows its clicks as the start of a drag. Picking a task opens
 * the picker window, which has the room this one does not.
 *
 * Each state of S25 has its row: running, paused, an interruption with its
 * name and, from a device, "started now ▾"; nothing timing (loud in working
 * hours); the stand-up and where it goes back to; someone else's task;
 * stopping, in the devices' order Done / Stop / Discard; the Undo row; and
 * every question main asks, in `MiniPromptRow`.
 *
 * The timer counts seconds here, unlike the bar, where each change is an
 * upload: on screen a second costs nothing.
 *
 * The icon is the bar's: whatever holds it -- the session, a notification,
 * Lunch -- so someone without one sees what it would say.
 */
export const MiniBar: React.FC = () => {
  const { session, pause, resume, complete, discard, interrupt, stopInterruption, startTask } = useSession();
  // During an interruption the task it interrupted waits paused (P6): Back
  // returns to it, Stop ends the interruption alone, and Interrupt is Another.
  const interruption = session?.interruption ?? null;
  const sessionId = session?.sessionId ?? null;
  // A stop from here leaves the row empty: Undo takes its place for the hold.
  const undo = useUndo();
  const screenIcon = useScreenIcon();
  const toPlace = useToPlaceCount();
  const previous = usePreviousTask(sessionId);
  const standup = useStandupRunning(sessionId);
  const workingNow = useWorkingNow(session === null);
  const [tourSeen, putTourAway] = useTourSeen();
  const api = window.electronAPI;
  // A question main is asking takes the row until it is answered (P8c).
  const ceremony = useCeremonyPrompt();
  const [resumePrompt, setResumePrompt] = useResumePrompt();
  const [answeredCeremony, setAnsweredCeremony] = useState<typeof ceremony>(null);
  const [reminder, setReminder] = useReminder();
  // Asked or deferred alike: the dialog is the dashboard's, and Answer brings it.
  const [forgotten] = useForgottenReview();
  const ceremonyAsked = (ceremony?.type === 'STANDUP' || ceremony?.type === 'LUNCH') && ceremony !== answeredCeremony;
  const asking = resumePrompt !== null || ceremonyAsked || forgotten !== null || reminder !== null;
  /**
   * Stop opens the three ways to end a session, in place of the row: the
   * window is one row, with no room for a dialog.
   */
  const [ending, setEndingFor] = useState<{ sessionId: string; step: 'choose' | 'discard' | 'finish' } | null>(null);
  const setEnding = (step: 'choose' | 'discard' | 'finish' | null) =>
    setEndingFor(step && session ? { sessionId: session.sessionId, step } : null);
  // "Started now ▾", per interruption: the next one starts at now again.
  const [startedAgo, setStartedAgo] = useState<{ id: string; minutes: number } | null>(null);

  const tracking = session?.status === 'TRACKING';
  const paused = session?.status === 'PAUSED';
  const amber = asking || paused || interruption !== null || workingNow;
  const stripe = amber ? 'bg-accent-amber' : tracking ? 'bg-accent-green' : 'bg-border-dark';

  // Failures are reported, not thrown into React: the session itself comes
  // back from main on its own channel, so a failed click leaves the display
  // showing the truth.
  const run = (label: string, action: () => Promise<unknown>) => () => {
    void action().catch(warn(label));
  };

  const button =
    'p-1.5 rounded-md text-text-secondary hover:text-white hover:bg-dark-700 transition-colors [-webkit-app-region:no-drag]';
  const choice =
    'px-1.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors [-webkit-app-region:no-drag]';
  const heading = 'text-[11px] font-bold truncate flex items-center gap-1';

  /** Runs an ending and closes the choice, whatever main answers. */
  const end = (label: string, action: () => Promise<unknown>) => () => {
    setEnding(null);
    run(label, action)();
  };

  // Bound to the session it was asked about: one that ended elsewhere -- the
  // bar, the dashboard -- takes the question with it, and the next session
  // does not open on it.
  const choosing = ending && session && ending.sessionId === session.sessionId ? ending.step : null;

  const startedChoice = interruption && startedAgo?.id === interruption.id ? startedAgo.minutes : 0;
  const setStart = (minutes: number) => {
    if (!interruption) return;
    setStartedAgo({ id: interruption.id, minutes });
    api.moveInterruptionStart(new Date(Date.now() - minutes * 60_000).toISOString()).catch(warn('Setting the start'));
  };

  const goPrevious = previous && !interruption && previous.id !== session?.taskId
    ? run(`${Verb.PREVIOUS} task`, () => startTask(previous.id, false, previous.title))
    : null;

  /** The left of the row: what is happening, in a heading and a line. */
  const describe = (): React.ReactNode => {
    if (choosing === 'choose' && session) {
      return (
        <>
          <div className={`${heading} text-text-primary`}>{Verb.STOP} {interruption ? interruption.title : session.taskKey}</div>
          <div className="text-[11px] text-text-secondary truncate">
            {`${Verb.DONE} or ${Verb.STOP} logs ${formatHoursAndMinutes(session.elapsedSeconds)} · ${Verb.DISCARD} keeps nothing`}
          </div>
        </>
      );
    }
    if (!session) {
      if (undo.state) {
        return (
          <div className="flex items-center gap-2 [-webkit-app-region:no-drag]" role="status" aria-label="Undo">
            <span className="text-xs text-text-primary truncate">{undo.state.label}</span>
            <button
              type="button"
              onClick={undo.run}
              title={undoCountdown(undo.state.outcome, undo.secondsLeft)}
              className="px-1.5 py-0.5 rounded-md text-[11px] font-bold bg-primary text-dark-900 hover:bg-white"
            >
              {Verb.UNDO}
            </button>
          </div>
        );
      }
      return (
        <>
          <div className={workingNow ? 'text-sm font-bold text-accent-amber' : 'text-xs text-text-secondary'}>Nothing timing</div>
          {toPlace > 0 && <div className="text-[11px] text-accent-amber truncate"><span aria-hidden="true">⚡</span> {toPlaceLabel(toPlace)}</div>}
        </>
      );
    }
    let top: React.ReactNode;
    if (standup) {
      top = <span className="truncate text-text-primary"><span aria-hidden="true">☷</span> {session.taskTitle}</span>;
    } else if (interruption) {
      const from = FROM[interruption.source];
      top = (
        <span className="min-w-0 text-accent-amber flex items-center gap-1">
          {from && interruption.index === 1 ? (
            // S25's "⚡ from the deck · started now ▾": set when it began, or leave it.
            <>
              <span className="truncate"><span aria-hidden="true">⚡</span> {from} · started</span>
              <select
                aria-label="When it started"
                value={startedChoice}
                onChange={e => setStart(Number(e.target.value))}
                title={interruption.interruptedTaskKey ? `Set it earlier, and those minutes come off ${interruption.interruptedTaskKey}` : undefined}
                className="bg-dark-900 border border-border-field rounded px-0.5 text-[11px] text-white focus:outline-none focus:border-focus [-webkit-app-region:no-drag]"
              >
                {STARTED_AGO_CHOICES.map(m => (
                  <option key={m} value={m}>{m === 0 ? 'now' : `${m} min ago`}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <span className="shrink-0"><span aria-hidden="true">⚡ </span>{interruption.chosenTask ? <><span aria-hidden="true">↳ </span>{interruption.chosenTask.key}</> : 'not placed yet'}</span>
              <span className="text-text-secondary">·</span>
              <span className="text-text-secondary truncate">
                {interruption.interruptedTaskKey ? `during ${interruption.interruptedTaskKey}` : `Interruption ${interruption.index}`}
              </span>
            </>
          )}
        </span>
      );
    } else if (session.taskUnlisted) {
      top = (
        <span className="truncate text-accent-amber flex items-center gap-1" title={`${taskLeftLabel(session.taskLeftBecause, session.taskOwnerName)}. Time is still logged.`}>
          <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="font-mono truncate">{notYoursLabel(session)}</span>
        </span>
      );
    } else if (paused) {
      top = <span className="truncate text-accent-amber"><span aria-hidden="true">❚❚</span> Paused · <span className="font-mono">{session.taskKey}</span></span>;
    } else {
      top = <span className="font-mono truncate text-text-primary">{session.taskKey}</span>;
    }
    return (
      <>
        <div className={heading}>{top}</div>
        <div className="text-xs text-text-primary truncate [-webkit-app-region:no-drag]">
          {standup ? (
            <span className="text-text-secondary">
              {standup.returnsToKey ? `then back to ${standup.returnsToKey}, as it was` : 'nothing to go back to after it'}
            </span>
          ) : tourSeen === false ? (
            <span className="flex items-center gap-2 text-[11px] text-text-secondary">
              <span className="truncate">pause · stop · interrupt · switch · previous · hide →</span>
              <button type="button" className="shrink-0 underline hover:text-white" onClick={putTourAway}>Got it</button>
            </span>
          ) : (
            <SessionTitle
              session={session}
              className="text-xs text-text-primary truncate"
              inputClassName="w-full bg-dark-900 border border-focus rounded px-1 text-xs text-white focus:outline-none"
            />
          )}
        </div>
      </>
    );
  };

  const close = (
    <button
      type="button"
      title="Hide the mini timer; nothing stops"
      aria-label="Close the mini timer"
      className={button}
      onClick={run('Close', () => api.toggleMiniWindow())}
    >
      <X className="w-4 h-4" />
    </button>
  );

  const interruptButton = (
    <button
      type="button"
      title={interruption
        ? `${Verb.ANOTHER}: end this interruption and start the next one`
        : `${Verb.INTERRUPT}: start a timer now; the task waits paused`}
      aria-label={interruption ? Verb.ANOTHER : Verb.INTERRUPT}
      className={button}
      onClick={run('Interrupt', () => interrupt('mini'))}
    >
      <Zap className="w-4 h-4" />
    </button>
  );

  const switchButton = (
    <button
      type="button"
      title={session ? `${Verb.SWITCH} task` : `${Verb.START} a task`}
      aria-label={session ? 'Switch task' : 'Start a task'}
      className={button}
      onClick={run('Open the task picker', () => api.openTaskPicker())}
    >
      {/* ⇄ for Switch, as on every surface (C16). */}
      {session ? <Repeat className="w-4 h-4" /> : <ListTodo className="w-4 h-4" />}
    </button>
  );

  const previousButton = goPrevious && previous && (
    <button
      type="button"
      title={`${Verb.PREVIOUS} task: ${previous.key}`}
      aria-label={`${Verb.PREVIOUS} task: ${previous.key}`}
      className={button}
      onClick={goPrevious}
    >
      <History className="w-4 h-4" />
    </button>
  );

  /** The buttons of the state, in S25's order. */
  const buttons = (): React.ReactNode => {
    if (!session) {
      return (
        <>
          <button
            type="button"
            title={`${Verb.START} a task`}
            aria-label="Start a task"
            className={`${choice} bg-primary text-dark-900 hover:bg-white`}
            onClick={run('Open the task picker', () => api.openTaskPicker())}
          >
            ▶ {Verb.START}…
          </button>
          {interruptButton}
          {previousButton}
          {close}
        </>
      );
    }
    if (standup) {
      return (
        <>
          <button
            type="button"
            title={standup.returnsToKey ? `Stop the stand-up; ${standup.returnsToKey} starts again` : 'Stop the stand-up'}
            className={`${choice} bg-primary text-dark-900 hover:bg-white`}
            onClick={run('End stand-up', () => complete(undefined, false))}
          >
            End stand-up
          </button>
          {interruptButton}
          {close}
        </>
      );
    }
    if (interruption) {
      return (
        <>
          {/* Paused and stopped as a task is (2026-11-16); Stop takes the
              held task up again, so Back has no button of its own. */}
          {tracking ? (
            <button type="button" title={Verb.PAUSE} aria-label={Verb.PAUSE} className={button} onClick={run('Pause', pause)}>
              <Pause className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" title={Verb.RESUME} aria-label={Verb.RESUME} className={button} onClick={run('Resume', resume)}>
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            title="Which task is it for? Its time goes there when it ends"
            aria-label="Place it on a task"
            className={button}
            onClick={run('Open the place picker', () => api.openPlacePicker())}
          >
            <CornerDownRight className="w-4 h-4" />
          </button>
          {/* No ⇄: choosing a task does nothing during an interruption (2026-11-12). */}
          {interruptButton}
          <button
            type="button"
            title={interruption.interruptedSessionId
              ? `End the interruption and go back to ${interruption.interruptedTaskKey}; place it on a task afterwards`
              : 'End the interruption; place it on a task afterwards'}
            aria-label={Verb.STOP}
            className={button}
            onClick={run('Stop the interruption', stopInterruption)}
          >
            <Square className="w-4 h-4" />
          </button>
          {close}
        </>
      );
    }
    return (
      <>
        {toPlace > 0 && (
          <span className="px-1 text-[11px] font-bold text-accent-amber whitespace-nowrap" title={`${toPlaceLabel(toPlace)}: on Today`}>
            <span aria-hidden="true">⚡</span>{toPlace}<span className="sr-only"> to place</span>
          </span>
        )}
        {tracking ? (
          <button type="button" title={Verb.PAUSE} aria-label={Verb.PAUSE} className={button} onClick={run('Pause', pause)}>
            <Pause className="w-4 h-4" />
          </button>
        ) : (
          <button type="button" title={Verb.RESUME} aria-label={Verb.RESUME} className={button} onClick={run('Resume', resume)}>
            <Play className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          title={`${Verb.DONE}, ${Verb.STOP} or ${Verb.DISCARD}`}
          aria-label={Verb.STOP}
          className={button}
          onClick={() => setEnding('choose')}
        >
          <Square className="w-4 h-4" />
        </button>
        {interruptButton}
        {switchButton}
        {previousButton}
        {isAdHocSession(session) && (
          <button
            type="button"
            title="Put its time on a task: all of it goes there"
            aria-label="Place on a task"
            className={button}
            onClick={run('Open the assign picker', () => api.openAssignPicker())}
          >
            <Link2 className="w-4 h-4" />
          </button>
        )}
        {close}
      </>
    );
  };

  return (
    <div className="h-screen w-screen flex items-center gap-3 pr-2 bg-dark-800 border border-border-dark rounded-lg overflow-hidden select-none [-webkit-app-region:drag]">
      <div className={`self-stretch w-1.5 shrink-0 ${stripe}`} aria-hidden="true" />

      {screenIcon && <ScreenIcon icon={screenIcon} className="w-8 h-8" />}

      {asking && !choosing ? (
        <MiniPromptRow
          resume={resumePrompt}
          ceremony={ceremonyAsked ? ceremony : null}
          inInterruption={Boolean(session?.interruption)}
          forgotten={forgotten}
          reminder={reminder}
          onAnswered={() => {
            if (resumePrompt) setResumePrompt(null);
            else if (ceremonyAsked) setAnsweredCeremony(ceremony);
            else if (!forgotten) setReminder(null);
          }}
        />
      ) : (
        <>
          <div className="flex-1 min-w-0 leading-tight">{describe()}</div>

          {/* The tour takes the timer's room for the one first open: the words need it. */}
          {session && !choosing && tourSeen !== false && (
            <div
              role="timer"
              className={`text-lg font-bold font-mono tabular-nums ${tracking ? 'text-white' : 'text-text-secondary'}`}
              aria-label="Elapsed time"
            >
              {formatSeconds(session.elapsedSeconds)}
            </div>
          )}

          {choosing === 'choose' && session && (
            // The devices' order (S28, S29): Done, Stop, Discard.
            <div className="flex items-center gap-1" role="group" aria-label="End the timer">
              <button type="button" title="Log the time and mark the task done" className={`${choice} text-accent-green hover:bg-accent-green/15`} onClick={finishNeedsConfirmation(session) ? () => setEnding('finish') : end('Finish', () => complete(undefined, true))}>
                {Verb.DONE}
              </button>
              <button type="button" title="Log the time; the task stays open" className={`${choice} bg-primary text-dark-900 hover:bg-white`} onClick={end('Stop', () => complete(undefined, false))}>
                {Verb.STOP}
              </button>
              <button type="button" title="Keep nothing: no entry, nothing sent" className={`${choice} text-text-secondary hover:text-accent-red hover:bg-accent-red/15`} onClick={() => setEnding('discard')}>
                {Verb.DISCARD}…
              </button>
              <button type="button" title="Keep timing" aria-label="Keep timing" className={button} onClick={() => setEnding(null)}
                // The choices replace the button that asked for them: the
                // safe one takes the focus (REVIEW-2026-11 A4).
                autoFocus>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {choosing === 'finish' && (
            <div className="flex items-center gap-1" role="alertdialog" aria-label="Not yours: mark it done anyway?">
              <span className="text-[11px] text-accent-amber font-bold" title="Reassigned, closed or moved since you started it">Not yours. {Verb.DONE}?</span>
              <button type="button" title="Mark it done anyway: it moves to your done status" className={`${choice} bg-accent-green/90 hover:bg-accent-green text-dark-900`} onClick={end('Finish', () => complete(undefined, true))}>
                Yes
              </button>
              <button type="button" title="Back to the choices" className={`${choice} text-text-secondary hover:text-white hover:bg-dark-700`} onClick={() => setEnding('choose')} autoFocus>
                No
              </button>
            </div>
          )}

          {choosing === 'discard' && (
            <div className="flex items-center gap-1" role="alertdialog" aria-label="Discard this time?">
              <span className="text-[11px] text-accent-red font-bold">{Verb.DISCARD}?</span>
              <button type="button" title="Throw this time away: nothing kept, nothing sent" className={`${choice} bg-accent-red-fill hover:bg-accent-red-fill-hover text-white`} onClick={end('Discard', discard)}>
                Yes
              </button>
              <button type="button" title="Keep it" className={`${choice} text-text-secondary hover:text-white hover:bg-dark-700`} onClick={() => setEnding('choose')} autoFocus>
                No
              </button>
            </div>
          )}

          {!choosing && <div className="flex items-center">{buttons()}</div>}
        </>
      )}
    </div>
  );
};
