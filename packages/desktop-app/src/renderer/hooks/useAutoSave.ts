import { useEffect, useRef, useState } from 'react';
import {
  AutoSaveScheduler,
  AutoSaveStatus,
  AUTO_SAVE_CONFIRMATION_MS
} from './auto-save-scheduler';

/**
 * Persists a settings panel as it is edited, replacing an explicit Save button.
 *
 * `loaded` must be the panel's own "stored settings have been read" flag. Until
 * it is true nothing is written, which is what stops a panel from saving its
 * defaults over the user's configuration during the gap between mount and load.
 * See {@link AutoSaveScheduler}, where that logic lives and is tested.
 *
 * `values` is compared shallowly on every render, so it should be a flat array
 * of the fields the panel owns.
 */
export function useAutoSave(
  save: () => void | Promise<void>,
  values: readonly unknown[],
  loaded: boolean
): AutoSaveStatus {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');

  // Held in a ref so a new closure on every render does not rebuild the
  // scheduler and lose its baseline.
  const saveRef = useRef(save);
  saveRef.current = save;

  const schedulerRef = useRef<AutoSaveScheduler | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = new AutoSaveScheduler({
      save: () => saveRef.current(),
      onStatusChange: setStatus
    });
  }

  // Deliberately every render: the scheduler compares against its baseline, so
  // an unchanged render costs a shallow array comparison and writes nothing.
  useEffect(() => {
    schedulerRef.current?.sync(values, loaded);
  });

  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => {
      // Flush before disposing. Switching panels within the debounce window is
      // ordinary behaviour, and dropping the edit there would be exactly the
      // data loss that removing the Save button was supposed to prevent.
      scheduler?.flush();
      scheduler?.dispose();
    };
  }, []);

  useEffect(() => {
    if (status !== 'saved') return undefined;
    const timer = setTimeout(() => setStatus('idle'), AUTO_SAVE_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return status;
}
