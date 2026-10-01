import React from 'react';
import { ListTodo, Pause, Play, Square, X } from 'lucide-react';
import { useSession } from '../hooks/useSession';
import { formatSeconds } from '../utils/formatters';

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
 */
export const MiniBar: React.FC = () => {
  const { session, pause, resume, complete } = useSession();
  const api = window.electronAPI;

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

  return (
    <div className="h-screen w-screen flex items-center gap-3 pr-2 bg-dark-800 border border-border-dark rounded-lg overflow-hidden select-none font-mono [-webkit-app-region:drag]">
      <div className={`self-stretch w-1.5 shrink-0 ${stripe}`} aria-hidden="true" />

      <div className="flex-1 min-w-0 leading-tight">
        {session ? (
          <>
            <div className="text-[11px] font-bold text-accent-blue truncate">{session.taskKey}</div>
            <div className="text-xs text-text-primary truncate" title={session.taskTitle}>{session.taskTitle}</div>
          </>
        ) : (
          <div className="text-xs text-text-secondary">No task running</div>
        )}
      </div>

      <div
        className={`text-lg font-bold tabular-nums ${tracking ? 'text-white' : 'text-text-secondary'}`}
        aria-label="Elapsed time"
      >
        {formatSeconds(session?.elapsedSeconds ?? 0)}
      </div>

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
            title="Stop and log the time"
            aria-label="Stop"
            className={button}
            onClick={run('Stop', () => complete(undefined, false))}
          >
            <Square className="w-4 h-4" />
          </button>
        )}
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
    </div>
  );
};
