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
  return (
    <TaskPicker
      isOpen
      asWindow
      onClose={() => { if (!picking.current) close(); }}
      mode={mode === 'assign' ? 'assign' : session ? 'switch' : 'start'}
      takeAlongOf={mode !== 'assign' && session?.interruption
        ? { title: session.interruption.title, seconds: session.elapsedSeconds }
        : null}
      onPick={picked => {
        picking.current = true;
        void pickTask(mode, session, picked, startTask).finally(close);
      }}
    />
  );
};
