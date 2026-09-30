import { useState, useEffect, useCallback } from 'react';
import { WorklogDTO } from '../../shared/dtos';

/** Today's worklogs, or null when there is nothing to show for the read. */
async function readTodaysWorklogs(): Promise<WorklogDTO[] | null> {
  if (!window.electronAPI?.getTodaysWorklogs) return null;
  try {
    const data = await window.electronAPI.getTodaysWorklogs();
    return Array.isArray(data) ? data : null;
  } catch (err) {
    console.error('[useWorklogs] Error fetching today\'s worklogs:', err);
    return null;
  }
}

/**
 * Custom React hook managing real-time state synchronization for today's worklogs.
 */
export const useWorklogs = () => {
  const [worklogs, setWorklogs] = useState<WorklogDTO[]>([]);
  // Without the bridge there is nothing to wait for.
  const [isLoading, setIsLoading] = useState<boolean>(() => Boolean(window.electronAPI?.getTodaysWorklogs));

  // State is set only once the read has answered, never before it: a
  // synchronous setState in the effect that starts the read renders twice for
  // nothing (react-hooks/set-state-in-effect).
  const applyWorklogs = useCallback((data: WorklogDTO[] | null) => {
    if (data) setWorklogs(data);
    setIsLoading(false);
  }, []);

  const fetchWorklogs = useCallback(() => readTodaysWorklogs().then(applyWorklogs), [applyWorklogs]);

  useEffect(() => {
    void fetchWorklogs();

    if (window.electronAPI?.onWorklogsUpdated) {
      const unsubscribe = window.electronAPI.onWorklogsUpdated(updatedList => {
        if (Array.isArray(updatedList)) {
          setWorklogs(updatedList);
        }
      });
      return () => unsubscribe();
    }
    return undefined;
  }, [fetchWorklogs]);

  return { worklogs, fetchWorklogs, isLoading };
};
