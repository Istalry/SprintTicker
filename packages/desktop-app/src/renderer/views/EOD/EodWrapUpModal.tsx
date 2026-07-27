import React, { useState } from 'react';
import { X, Moon, CheckCircle2, AlertCircle } from 'lucide-react';

interface EodWrapUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmEod: () => Promise<void>;
}

export const EodWrapUpModal: React.FC<EodWrapUpModalProps> = ({
  isOpen,
  onClose,
  onConfirmEod
}) => {
  const [executing, setExecuting] = useState<boolean>(false);
  const [unitySaved, setUnitySaved] = useState<boolean>(false);
  const [completed, setCompleted] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleExecuteEod = async () => {
    setExecuting(true);
    try {
      // 1. Issue RPC save scenes request to Unity Editor (with 2000ms timeout & error suppression)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch('http://localhost:8081/antigravity/save-scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) setUnitySaved(true);
      } catch {
        console.log('[EOD] Unity Editor not active or plugin uninstalled, skipping scene save.');
        setUnitySaved(false);
      }

      // 2. Stop active tracking session & finalize worklogs
      await onConfirmEod();
      setExecuting(false);
      setCompleted(true);
    } catch (err) {
      console.error('[EOD] Error during EOD sequence:', err);
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col">
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
        <div className="p-6 space-y-4">
          {!completed ? (
            <>
              <p className="text-xs text-text-secondary">
                Executing EOD wrap-up will automatically finalize your active session, log pending hours, save open Unity scenes, and prepare your workstation for shutdown.
              </p>

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
                  <span>3. Worklog Sync Queue Submission</span>
                  <span className="text-accent-green">✓ Auto</span>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-accent-green mx-auto animate-bounce" />
              <h4 className="text-lg font-bold text-white font-mono">Day Complete!</h4>
              <p className="text-xs text-text-secondary">
                {unitySaved
                  ? 'All active task hours logged to Jira and open Unity scenes saved.'
                  : 'All active task hours logged. Unity scene save skipped gracefully.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-border-dark bg-dark-700/30">
          {!completed ? (
            <>
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
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-5 py-2 bg-accent-green hover:bg-emerald-600 text-dark-900 text-xs font-semibold rounded-lg shadow-md transition-all"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
