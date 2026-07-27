import { useState, useEffect } from 'react';
import { ActiveSessionDTO } from '../../shared/dtos';

/**
 * Custom React hook subscribing to active time-tracking session state and local stopwatch ticking.
 */
export function useSession() {
  const [session, setSession] = useState<ActiveSessionDTO | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // 1. Initial fetch
    if (window.electronAPI) {
      window.electronAPI.getCurrentSession().then(curr => {
        setSession(curr);
        setLoading(false);
      }).catch(err => {
        console.error('[useSession] Failed to fetch current session:', err);
        setLoading(false);
      });

      // 2. Subscribe to Main process IPC updates
      const unsubscribe = window.electronAPI.onSessionUpdated((updatedSession) => {
        setSession(updatedSession);
      });

      return () => unsubscribe();
    } else {
      setLoading(false);
    }
  }, []);

  // Local 1-second interval to update elapsed seconds UI when TRACKING
  useEffect(() => {
    if (!session || session.status !== 'TRACKING') return;

    const timer = setInterval(() => {
      setSession(prev => {
        if (!prev || prev.status !== 'TRACKING') return prev;
        return {
          ...prev,
          elapsedSeconds: prev.elapsedSeconds + 1
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.status, session?.sessionId]);

  const pause = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.pauseSession();
      setSession(res);
    }
  };

  const resume = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.resumeSession();
      setSession(res);
    }
  };

  const complete = async (comment?: string) => {
    if (window.electronAPI) {
      const res = await window.electronAPI.completeSession(comment);
      setSession(null);
      return res;
    }
    return { success: false, loggedSeconds: 0 };
  };

  const startTask = async (taskId: string, isAdHoc?: boolean, customTitle?: string) => {
    if (window.electronAPI) {
      const res = await window.electronAPI.startTask(taskId, isAdHoc, customTitle);
      setSession(res);
      return res;
    }
    return null;
  };

  return {
    session,
    loading,
    pause,
    resume,
    complete,
    startTask
  };
}
