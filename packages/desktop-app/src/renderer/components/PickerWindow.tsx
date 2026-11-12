import React, { useRef } from 'react';
import { useSession } from '../hooks/useSession';
import { TaskPicker } from './TaskPicker';
import { pickTask } from '../utils/pick-task';
import type { PickerWindowMode } from '../../shared/picker-window';

interface PickerWindowProps {
  /** From the window's hash (`readPickerWindowHash`). */
  mode: PickerWindowMode;
}

/**
 * The task picker as its own small window (redesign P7b), opened from the
 * tray, the mini timer and the deck. The same picker as the window's: Start
 * when nothing runs, Switch while something does, Assign for the ad-hoc
 * session. It closes its window after a pick, on Escape or ✕, and main
 * closes it when it loses the focus.
 */
export const PickerWindow: React.FC<PickerWindowProps> = ({ mode }) => {
  const { session, loading, startTask } = useSession();
  // The picker closes itself right after a pick; the window waits for main
  // to have answered the pick instead.
  const picking = useRef(false);
  // Waits for the session: Start and Switch differ in title and rows.
  if (loading) return null;

  const close = (): void => window.close();
  // ↳ from the mini timer (P12d): which task the running interruption is for.
  const placing = mode === 'place' && session?.interruption ? session.interruption : null;
  return (
    <TaskPicker
      isOpen
      asWindow
      onClose={() => { if (!picking.current) close(); }}
      mode={placing ? 'place' : mode === 'assign' ? 'assign' : session ? 'switch' : 'start'}
      title={placing ? `Which task is "${placing.title}" for?` : undefined}
      subtitle={placing ? 'The timer keeps running; its time goes there when it ends.' : undefined}
      takeAlongOf={mode === 'start' && session?.interruption
        ? { title: session.interruption.title, seconds: session.elapsedSeconds }
        : null}
      onPick={picked => {
        picking.current = true;
        void pickTask(placing ? 'place' : mode === 'place' ? 'start' : mode, session, picked, startTask).finally(close);
      }}
    />
  );
};
