import { useCallback, useEffect, useState } from 'react';
import { ONLY_PROJECTS_WITH_TASKS_DEFAULT } from '../../shared/project-filter';

/**
 * The "only my projects" switch, as main stores it.
 *
 * Shared by the Projects tab and the task picker, and read by the bar's own
 * picker, so it lives in main and every copy follows the broadcast: flipped
 * in the picker, the Projects tab behind it changes too.
 */
export const useOnlyProjectsWithTasks = (): [boolean, (enabled: boolean) => void] => {
  const [enabled, setEnabledState] = useState<boolean>(ONLY_PROJECTS_WITH_TASKS_DEFAULT);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getOnlyProjectsWithTasks) return undefined;
    let live = true;
    api
      .getOnlyProjectsWithTasks()
      .then(value => {
        if (live) setEnabledState(value);
      })
      .catch(err => console.warn('[useOnlyProjectsWithTasks] Could not read the setting:', err));
    const unsubscribe = api.onOnlyProjectsWithTasks?.(value => setEnabledState(value));
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    // Shown at once; main's answer and its broadcast confirm it.
    setEnabledState(value);
    window.electronAPI
      ?.setOnlyProjectsWithTasks?.(value)
      .then(stored => setEnabledState(stored))
      .catch(err => console.warn('[useOnlyProjectsWithTasks] Could not save the setting:', err));
  }, []);

  return [enabled, setEnabled];
};
