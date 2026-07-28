import React, { useState, useEffect } from 'react';
import { X, Moon, CheckCircle2, Power, BellOff, Clock } from 'lucide-react';

interface EodWrapUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmEod: (options?: { shouldShutdown?: boolean }) => Promise<void>;
  onSnooze?: (minutes?: number) => Promise<void>;
}

export const EodWrapUpModal: React.FC<EodWrapUpModalProps> = ({
  isOpen,
  onClose,
  onConfirmEod,
  onSnooze
}) => {
  const [executing, setExecuting] = useState<boolean>(false);
  const [unitySaved, setUnitySaved] = useState<boolean>(false);
  const [shouldShutdown, setShouldShutdown] = useState<boolean>(false);
  const [completed, setCompleted] = useState<boolean>(false);
  const [summary, setSummary] = useState<{ totalSeconds: number; tasksCount: number; items: Array<{ key: string; title: string; durationSeconds: number }> }>({
    totalSeconds: 0,
    tasksCount: 0,
    items: []
  });

  useEffect(() => {
    if (isOpen && window.electronAPI?.getDailyWorklogSummary) {
      const todayStr = new Date().toISOString().split('T')[0];
      window.electronAPI.getDailyWorklogSummary(todayStr).then(setSummary);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExecuteEod = async () => {
    setExecuting(true);
    try {
      // 1. Issue RPC save scenes request to Unity Editors (ports 8081-8089 for multi-instance support)
      try {
        let anySaved = false;
        const ports = [8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089];

        await Promise.all(
          ports.map(async (port) => {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 1500);

              const response = await fetch(`http://localhost:${port}/antigravity/save-scenes/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal
              });
              clearTimeout(timeoutId);

              if (response.ok) anySaved = true;
            } catch {
              // Silently ignore inactive ports
            }
          })
        );

        setUnitySaved(anySaved);
      } catch {
        console.log('[EOD] Unity Editor not active or plugin uninstalled, skipping scene save.');
        setUnitySaved(false);
      }

      // 2. Stop active tracking session, finalize worklogs & trigger shutdown if enabled
      await onConfirmEod({ shouldShutdown });
      setExecuting(false);
      setCompleted(true);
    } catch (err) {
      console.error('[EOD] Error during EOD sequence:', err);
      setExecuting(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none font-mono">
      <div className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-dark bg-dark-700/50">
          <div className="flex items-center space-x-2">
            <Moon className="w-5 h-5 text-accent-purple" />
            <h3 className="text-md font-bold text-white font-mono">End-of-Day Wrap-Up Wizard</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-dark-700 rounded-md text-text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {!completed ? (
            <>
              <p className="text-xs text-text-secondary">
                Executing EOD wrap-up will automatically finalize your active session, log pending hours, save open Unity scenes & VS Code files, and prepare your workstation for shutdown.
              </p>

              {/* Today's Work Summary Breakdown */}
              <div className="bg-dark-900/80 border border-border-dark rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-border-dark pb-2">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-white">
                    <Clock className="w-4 h-4 text-accent-blue" />
                    <span>Today&apos;s Tracked Work Summary</span>
                  </div>
                  <span className="text-xs font-bold text-accent-green bg-accent-green/10 border border-accent-green/30 px-2 py-0.5 rounded">
                    Total: {formatDuration(summary.totalSeconds)}
                  </span>
                </div>

                {summary.items.length > 0 ? (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                    {summary.items.map(item => (
                      <div key={item.key} className="flex items-center justify-between text-xs py-1 px-2 bg-dark-800/60 rounded border border-border-dark">
                        <div className="flex items-center space-x-2 truncate">
                          <span className="text-accent-blue font-bold">{item.key}:</span>
                          <span className="text-text-primary truncate">{item.title}</span>
                        </div>
                        <span className="text-text-secondary font-bold ml-2">{formatDuration(item.durationSeconds)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-text-secondary italic">No active session worklogs recorded today yet.</div>
                )}
              </div>

              {/* Checklist */}
              <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between text-text-primary">
                  <span>1. Stop Active Session & Log Hours</span>
                  <span className="text-accent-green">✓ Ready</span>
                </div>
                <div className="flex items-center justify-between text-text-primary">
                  <span>2. RPC Save Open Unity Scenes</span>
                  <span className="text-accent-blue">http://localhost:8081</span>
                </div>
                <div className="flex items-center justify-between text-text-primary">
                  <span>3. VS Code File Auto-Save</span>
                  <span className="text-accent-purple">saveAll CLI</span>
                </div>
                <div className="flex items-center justify-between text-text-primary">
                  <span>4. Worklog Sync Queue Submission</span>
                  <span className="text-accent-green">✓ Auto</span>
                </div>
              </div>

              {/* Shutdown Checkbox Option */}
              <label className="flex items-center space-x-3 p-3 bg-dark-900/60 rounded-lg border border-border-dark cursor-pointer hover:bg-dark-700/50 transition-colors">
                <input
                  type="checkbox"
                  checked={shouldShutdown}
                  onChange={e => setShouldShutdown(e.target.checked)}
                  className="w-4 h-4 rounded text-accent-purple focus:ring-accent-purple bg-dark-800 border-border-dark"
                />
                <div className="flex items-center space-x-2 text-xs font-bold text-white">
                  <Power className="w-4 h-4 text-accent-red" />
                  <span>Shutdown computer after completion (30s timer)</span>
                </div>
              </label>
            </>
          ) : (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-accent-green mx-auto animate-bounce" />
              <h4 className="text-lg font-bold text-white font-mono">Day Complete!</h4>
              <p className="text-xs text-text-secondary">
                {shouldShutdown
                  ? 'All active task hours logged. Computer shutdown scheduled in 30 seconds.'
                  : unitySaved
                  ? 'All active task hours logged to Jira and open Unity scenes saved.'
                  : 'All active task hours logged. Unity scene save skipped gracefully.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-dark bg-dark-700/30">
          {!completed ? (
            <>
              {onSnooze ? (
                <button
                  onClick={() => onSnooze(15)}
                  className="flex items-center space-x-1.5 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  <span>Snooze 15m</span>
                </button>
              ) : <div />}

              <div className="flex items-center space-x-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-dark-700 hover:bg-dark-700/80 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteEod}
                  disabled={executing}
                  className="px-5 py-2 bg-accent-purple hover:bg-purple-600 text-white text-xs font-semibold rounded-lg shadow-md transition-all"
                >
                  {executing ? 'Executing...' : 'Execute Wrap-Up Now'}
                </button>
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                onClick={onClose}
                className="px-5 py-2 bg-accent-green hover:bg-emerald-600 text-dark-900 text-xs font-semibold rounded-lg shadow-md transition-all"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
