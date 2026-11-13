import React, { useEffect, useRef, useState } from 'react';
import { useMenu } from '../hooks/useMenu';
import { ChevronDown, Square } from 'lucide-react';
import type { ActiveSessionDTO } from '../../shared/dtos';
import { finishNeedsConfirmation } from '../../shared/task-left';
import { Verb } from '../../shared/words';
import { formatDaySplit, formatHoursAndMinutes } from '../utils/formatters';
import { ConfirmPanel } from './ConfirmPanel';

export interface StopMenuProps {
  session: ActiveSessionDTO;
  /** Whether Done is offered: where the provider can move tasks, or for work kept here. */
  offerDone: boolean;
  /** What Done does there, for its line: "Jira moves it to its done state". */
  doneMeans: string;
  /** Stop, or Done with `markDone`. */
  onComplete: (comment?: string, markDone?: boolean) => void;
  /** Ends the session keeping nothing, once asked. */
  onDiscard: () => void;
  /** Played on Done in the window; the bar's scene is the stop's own. */
  onDoneCelebrate?: () => void;
}

/**
 * **■ Stop ▾** (redesign P8a, S11): Stop in one click, the task left open;
 * the ▾ holds ✓ Done and Discard…, each a step away. It replaces "Finish &
 * Log Hours" and the dialog of three choices: the common end is one click,
 * and the two that change more than the time ask first -- Done when the
 * task has left the user's list, Discard always.
 */
export const StopMenu: React.FC<StopMenuProps> = ({ session, offerDone, doneMeans, onComplete, onDiscard, onDoneCelebrate }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useMenu(open, () => setOpen(false), { root: rootRef, menu: menuRef, trigger: triggerRef });
  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => onComplete(undefined, false)}
        title="Stop the timer: the time is logged and sent after 10 s to undo; the task stays open"
        className="flex items-center space-x-2 pl-5 pr-3 py-2.5 rounded-l-lg font-semibold text-sm border bg-dark-700 hover:bg-dark-600 text-white border-border-dark"
      >
        <Square className="w-4 h-4" />
        <span>{Verb.STOP}</span>
      </button>
      <button
        ref={triggerRef}
        type="button"
        aria-label="More ways to stop"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="px-2 py-2.5 rounded-r-lg border border-l-0 bg-dark-700 hover:bg-dark-600 text-white border-border-dark"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <StopMenuPanel
          menuRef={menuRef}
          session={session}
          offerDone={offerDone}
          doneMeans={doneMeans}
          onDone={() => {
            setOpen(false);
            onDoneCelebrate?.();
            onComplete(undefined, true);
          }}
          onStop={() => {
            setOpen(false);
            onComplete(undefined, false);
          }}
          onDiscard={() => {
            setOpen(false);
            onDiscard();
          }}
        />
      )}
    </div>
  );
};

interface PanelProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  session: ActiveSessionDTO;
  offerDone: boolean;
  doneMeans: string;
  onDone: () => void;
  onStop: () => void;
  onDiscard: () => void;
}

/** Mounted only while open, so every opening starts on the two choices, never a question left. */
const StopMenuPanel: React.FC<PanelProps> = ({ menuRef, session, offerDone, doneMeans, onDone, onStop, onDiscard }) => {
  const [asking, setAsking] = useState<'discard' | 'done' | null>(null);
  // Across midnight the time goes in under each day: said before it does.
  const [daySplit, setDaySplit] = useState<string | null>(null);
  useEffect(() => {
    window.electronAPI?.getSessionDays?.()
      .then(days => setDaySplit(formatDaySplit(days)))
      .catch(err => console.warn('[StopMenu] Could not read the session days:', err));
  }, []);

  const logged = formatHoursAndMinutes(session.elapsedSeconds);
  const item = 'w-full text-left px-3 py-2 rounded-lg hover:bg-dark-700';

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Stop"
      className="absolute left-0 top-full mt-2 z-40 w-96 bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-2 text-xs"
    >
      {asking === 'discard' ? (
        <div className="p-2">
          <ConfirmPanel
            title={`${Verb.DISCARD} ${logged}?`}
            tone="danger"
            message={<>Nothing of this session on <span className="font-mono">{session.taskKey}</span> is kept or sent. {Verb.UNDO} stays on the toast for 10 s.</>}
            confirmLabel={`${Verb.DISCARD} ${logged}`}
            cancelLabel="Keep it"
            takeFocus
            onConfirm={onDiscard}
            onCancel={() => setAsking(null)}
          />
        </div>
      ) : asking === 'done' ? (
        <div className="p-2 space-y-3">
          <ConfirmPanel
            title={`${Verb.DONE} — but ${session.taskKey} is no longer yours`}
            message={<>It left your list since you started it: reassigned, or moved. Your {logged} are logged either way. Marking it done moves it to your done status.</>}
            confirmLabel="Mark it done anyway"
            cancelLabel="Cancel"
            takeFocus
            onConfirm={onDone}
            onCancel={() => setAsking(null)}
          />
          <button type="button" onClick={onStop} className="text-text-secondary hover:text-white underline-offset-2 hover:underline">
            {Verb.STOP} instead, leaving it as it is
          </button>
        </div>
      ) : (
        <>
          {offerDone && (
            <button
              type="button"
              role="menuitem"
              onClick={() => (finishNeedsConfirmation(session) ? setAsking('done') : onDone())}
              className={item}
            >
              <span className="font-bold text-accent-green">✓ {Verb.DONE}</span>
              <span className="text-text-secondary"> — logs {logged}, {doneMeans}</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => setAsking('discard')} className={item}>
            <span className="font-bold text-accent-red">{Verb.DISCARD}…</span>
            <span className="text-text-secondary"> — nothing kept or sent</span>
          </button>
          {daySplit && <p className="px-3 pt-1 pb-1 text-[11px] text-text-secondary">Across midnight, so filed as {daySplit}.</p>}
        </>
      )}
    </div>
  );
};
