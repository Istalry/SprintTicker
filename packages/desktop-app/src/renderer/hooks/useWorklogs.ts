import { useState, useEffect, useCallback } from 'react';
import { WorklogDTO } from '../../shared/dtos';

/**
 * Custom React hook managing real-time state synchronization for today's worklogs.
 */
export const useWorklogs = () => {
  const [worklogs, setWorklogs] = useState<WorklogDTO[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchWorklogs = useCallback(async () => {
    if (window.electronAPI?.getTodaysWorklogs) {
      try {
        setIsLoading(true);
        const data = await window.electronAPI.getTodaysWorklogs();
        if (Array.isArray(data)) {
          setWorklogs(data);
        }
      } catch (err) {
        console.error('[useWorklogs] Error fetching today\'s worklogs:', err);
      } finally {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchWorklogs();

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
