import React, { useState } from 'react';
import { AlertTriangle, Link2, ListTodo, Pause, Play, Square, X, Zap } from 'lucide-react';
import { useSession } from '../hooks/useSession';
import { useScreenIcon } from '../hooks/useScreenIcon';
import { ScreenIcon } from './ScreenIcon';
import { formatSeconds } from '../utils/formatters';
import { finishNeedsConfirmation, taskLeftLabel } from '../../shared/task-left';
import { isAdHocSession } from '../../shared/interruption';
import { SessionTitle } from './SessionTitle';
import { useUndo } from './UndoBar';
import { Verb } from '../../shared/words';

/**
 * The always-on-top mini timer: what the BUSY Bar shows, on screen.
 *
 * One row in a frameless 360x56 window. The whole row drags the window except
 * the buttons, which opt out -- a button inside a drag region swallows its
 * clicks as the start of a drag. Picking a task opens the dashboard's picker,
 * which has the room this window does not.
 *
 * The timer counts seconds here, unlike the bar, where each change is an
 * upload: on screen a second costs nothing.
 *
 * The icon is the bar's: whatever holds it -- the session, a compile, a
 * notification, Lunch -- so someone without one sees what it would say. It
 * leaves the row to the session; the screen's own text is its tooltip.
 */
export const MiniBar: React.FC = () => {
  const { session, pause, resume, complete, discard, interrupt } = useSession();
  // A stop from here leaves the row empty: Undo takes its place for the hold.
  const undo = useUndo();
  const screenIcon = useScreenIcon();
  const api = window.electronAPI;
  /**
   * Stop opens the three ways to end a session, in place of the buttons:
   * the window is one row, with no room for a dialog. It used to log the time
   * and nothing else, so finishing a task or throwing away a session started
   * by mistake meant opening the dashboard.
   */
  const [ending, setEndingFor] = useState<{ sessionId: string; step: 'choose' | 'discard' | 'finish' } | null>(null);
  const setEnding = (step: 'choose' | 'discard' | 'finish' | null) =>
    setEndingFor(step && session ? { sessionId: session.sessionId, step } : null);

  const tracking = session?.status === 'TRACKING';
  const paused = session?.status === 'PAUSED';
  const stripe = tracking ? 'bg-accent-green' : paused ? 'bg-accent-amber' : 'bg-border-dark';

  // Failures are reported, not thrown into React: the session itself comes
  // back from main on its own channel, so a failed click leaves the display
  // showing the truth.
  const run = (label: string, action: () => Promise<unknown>) => () => {
    void action().catch(err => console.warn(`[MiniBar] ${label} failed:`, err));
  };

  const button =
    'p-1.5 rounded-md text-text-secondary hover:text-white hover:bg-dark-700 transition-colors [-webkit-app-region:no-drag]';
  const choice =
    'px-1.5 py-1 rounded-md text-[11px] font-bold transition-colors [-webkit-app-region:no-drag]';

  /** Runs an ending and closes the choice, whatever main answers. */
  const end = (label: string, action: () => Promise<unknown>) => () => {
    setEnding(null);
    run(label, action)();
  };

  // Bound to the session it was asked about: one that ended elsewhere -- the
  // bar, the dashboard -- takes the question with it, and the next session
  // does not open on it.
  const choosing = ending && session && ending.sessionId === session.sessionId ? ending.step : null;

  return (
    <div className="h-screen w-screen flex items-center gap-3 pr-2 bg-dark-800 border border-border-dark rounded-lg overflow-hidden select-none [-webkit-app-region:drag]">
      <div className={`self-stretch w-1.5 shrink-0 ${stripe}`} aria-hidden="true" />

      {screenIcon && <ScreenIcon icon={screenIcon} className="w-8 h-8" />}

      <div className="flex-1 min-w-0 leading-tight">
        {session ? (
          <>
            <div className="text-[11px] font-bold text-text-primary truncate flex items-center gap-1">
              {session.taskUnlisted && (
                <span
                  role="img"
                  aria-label={taskLeftLabel(session.taskLeftBecause, session.taskOwnerName)}
                  title={`${taskLeftLabel(session.taskLeftBecause, session.taskOwnerName)}. Time is still logged.`}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0 text-accent-amber" />
                </span>
              )}
              <span className="font-mono truncate">{session.taskKey}</span>
            </div>
            <div className="text-xs text-text-primary truncate [-webkit-app-region:no-drag]">
              <SessionTitle
                session={session}
                className="text-xs text-text-primary truncate"
                inputClassName="w-full bg-dark-900 border border-focus rounded px-1 text-xs text-white focus:outline-none"
              />
            </div>
          </>
        ) : undo.state ? (
          <div className="flex items-center gap-2 [-webkit-app-region:no-drag]" role="status" aria-label="Undo">
            <span className="text-xs text-text-primary truncate">{undo.state.label}</span>
            <button
              type="button"
              onClick={undo.run}
              title={`Sent in ${undo.secondsLeft}s`}
              className="px-1.5 py-0.5 rounded-md text-[11px] font-bold bg-primary text-dark-900 hover:bg-white"
            >
              {Verb.UNDO}
            </button>
          </div>
        ) : (
          <div className="text-xs text-text-secondary">No task running</div>
        )}
      </div>

      <div
        className={`text-lg font-bold font-mono tabular-nums ${tracking ? 'text-white' : 'text-text-secondary'}`}
        aria-label="Elapsed time"
      >
        {formatSeconds(session?.elapsedSeconds ?? 0)}
      </div>

      {choosing === 'choose' && (
        <div className="flex items-center gap-1" role="group" aria-label="End the session">
          <button type="button" title="Stop and log the time; the task stays open" className={`${choice} text-text-primary hover:bg-dark-600`} onClick={end('Stop', () => complete(undefined, false))}>
            Not done
          </button>
          <button type="button" title="Log the time and mark the task done" className={`${choice} text-accent-green hover:bg-accent-green/15`} onClick={finishNeedsConfirmation(session) ? () => setEnding('finish') : end('Finish', () => complete(undefined, true))}>
            Done
          </button>
          <button type="button" title="Keep nothing: no worklog, nothing sent" className={`${choice} text-text-secondary hover:text-accent-red hover:bg-accent-red/15`} onClick={() => setEnding('discard')}>
            Discard
          </button>
          <button type="button" title="Keep the session running" aria-label="Keep the session" className={button} onClick={() => setEnding(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {choosing === 'finish' && (
        <div className="flex items-center gap-1" role="alertdialog" aria-label="Not yours: mark it done anyway?">
          <span className="text-[11px] text-accent-amber font-bold" title="Reassigned, closed or moved since you started it">Not yours. Done?</span>
          <button type="button" title="Mark it done anyway: your completion transition is applied" className={`${choice} bg-accent-green/90 hover:bg-accent-green text-dark-900`} onClick={end('Finish', () => complete(undefined, true))}>
            Yes
          </button>
          <button type="button" title="Back to the choices" className={`${choice} text-text-secondary hover:text-white hover:bg-dark-700`} onClick={() => setEnding('choose')}>
            No
          </button>
        </div>
      )}

      {choosing === 'discard' && (
        <div className="flex items-center gap-1" role="alertdialog" aria-label="Discard the session?">
          <span className="text-[11px] text-accent-red font-bold">Discard?</span>
          <button type="button" title="Throw the session away: nothing kept, nothing sent" className={`${choice} bg-accent-red/90 hover:bg-accent-red text-white`} onClick={end('Discard', discard)}>
            Yes
          </button>
          <button type="button" title="Keep the session" className={`${choice} text-text-secondary hover:text-white hover:bg-dark-700`} onClick={() => setEnding('choose')}>
            No
          </button>
        </div>
      )}

      {!choosing && (
        <div className="flex items-center">
          {tracking && (
            <button type="button" title="Pause" aria-label="Pause" className={button} onClick={run('Pause', pause)}>
              <Pause className="w-4 h-4" />
            </button>
          )}
          {paused && (
            <button type="button" title="Resume" aria-label="Resume" className={button} onClick={run('Resume', resume)}>
              <Play className="w-4 h-4" />
            </button>
          )}
          {session && (
            <button
              type="button"
              title="End the session: not done, done, or discard"
              aria-label="Stop"
              className={button}
              onClick={() => setEnding('choose')}
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          {session && isAdHocSession(session) && (
            <button
              type="button"
              title="Assign this session to a task: all of its time goes there"
              aria-label="Assign to a task"
              className={button}
              onClick={run('Open the assign picker', () => api.openAssignPicker())}
            >
              <Link2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            title="Interrupt: start a timer now, name or assign it afterwards"
            aria-label="Interrupt"
            className={button}
            onClick={run('Interrupt', interrupt)}
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={session ? 'Switch task' : 'Start a task'}
            aria-label={session ? 'Switch task' : 'Start a task'}
            className={button}
            onClick={run('Open the task picker', () => api.openTaskPicker())}
          >
            <ListTodo className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Close the mini timer"
            aria-label="Close the mini timer"
            className={button}
            onClick={run('Close', () => api.toggleMiniWindow())}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
