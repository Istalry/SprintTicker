import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TASK_VISIBILITY, TaskVisibility } from '../../shared/task-visibility';

/**
 * Which tasks the lists show besides the user's own, as main stores it.
 *
 * Shared by the Projects tab and the task picker, and read by the bar's own
 * picker, so it lives in main and every copy follows the broadcast, as
 * `useOnlyProjectsWithTasks` does.
 */
export const useTaskVisibility = (): [TaskVisibility, (visibility: TaskVisibility) => void] => {
  const [visibility, setVisibilityState] = useState<TaskVisibility>({ ...DEFAULT_TASK_VISIBILITY });

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getTaskVisibility) return undefined;
    let live = true;
    api
      .getTaskVisibility()
      .then(value => {
        if (live) setVisibilityState(value);
      })
      .catch(err => console.warn('[useTaskVisibility] Could not read the setting:', err));
    const unsubscribe = api.onTaskVisibility?.(value => setVisibilityState(value));
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  const setVisibility = useCallback((value: TaskVisibility) => {
    // Shown at once; main's answer and its broadcast confirm it.
    setVisibilityState(value);
    window.electronAPI
      ?.setTaskVisibility?.(value)
      .then(stored => setVisibilityState(stored))
      .catch(err => console.warn('[useTaskVisibility] Could not save the setting:', err));
  }, []);

  return [visibility, setVisibility];
};
