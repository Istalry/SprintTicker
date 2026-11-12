import React, { useEffect, useRef, useState } from 'react';
import { useSession } from '../hooks/useSession';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { TaskPicker } from './TaskPicker';
import { PlaceInterruptionsDialog } from './PlaceInterruptionsDialog';
import { useInterruptionsToPlace } from './InterruptionsToPlace';
import { pickTask } from '../utils/pick-task';
import type { PickerWindowMode } from '../../shared/picker-window';

interface PickerWindowProps {
  /** From the window's hash (`readPickerWindowHash`). */
  mode: PickerWindowMode;
  /** For `place-ended`: the interruptions to list (`readPickerWindowIds`). */
  ids?: readonly string[];
}

/**
 * After a Stop (2026-11-12): the run's interruptions still to place, each
 * named and placed on its own row. Closes once none of them waits -- placed
 * here, or in the dashboard meanwhile.
 */
const PlaceEndedWindow: React.FC<{ ids: readonly string[] }> = ({ ids }) => {
  const all = useInterruptionsToPlace();
  const { providerName, capabilities } = useProviderCapabilities();
  const [lastWeekClosed, setLastWeekClosed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The list arrives after the first render: only an emptied list closes.
  const seen = useRef(false);
  const waiting = all.filter(item => ids.includes(item.id));

  useEffect(() => {
    let current = true;
    window.electronAPI?.getLastWeekClosed?.().then(
      monday => { if (current) setLastWeekClosed(monday); },
      err => console.warn('[PlaceWindow] Could not read the last week closed:', err)
    );
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (waiting.length > 0) seen.current = true;
    else if (seen.current) window.close();
  }, [waiting.length]);

  if (waiting.length === 0) return null;
  return (
    <>
      <PlaceInterruptionsDialog
        asWindow
        waiting={waiting}
        providerName={providerName}
        localOnly={capabilities?.providerId === 'adhoc'}
        lastWeekClosed={lastWeekClosed}
        onClose={() => window.close()}
        onError={setError}
      />
      {error && <p role="alert" className="fixed bottom-2 left-4 text-xs text-accent-red">Not done: {error}</p>}
    </>
  );
};

/**
 * The task picker as its own small window (redesign P7b), opened from the
 * tray, the mini timer and the deck. The same picker as the window's: Start
 * when nothing runs, Switch while something does, Assign for the ad-hoc
 * session. It closes its window after a pick, on Escape or ✕, and main
 * closes it when it loses the focus.
 */
export const PickerWindow: React.FC<PickerWindowProps> = ({ mode, ids = [] }) => {
  if (mode === 'place-ended') return <PlaceEndedWindow ids={ids} />;
  return <TaskPickerWindow mode={mode} />;
};

const TaskPickerWindow: React.FC<{ mode: Exclude<PickerWindowMode, 'place-ended'> }> = ({ mode }) => {
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
      onPick={picked => {
        picking.current = true;
        void pickTask(placing ? 'place' : mode === 'place' ? 'start' : mode, session, picked, startTask).finally(close);
      }}
    />
  );
};
