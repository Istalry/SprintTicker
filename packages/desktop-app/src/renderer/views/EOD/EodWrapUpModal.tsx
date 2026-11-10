import React, { useState, useEffect } from 'react';
import { X, Moon, CheckCircle2, Power, BellOff, Clock, Zap } from 'lucide-react';
import { localDateKey } from '../../../shared/local-date';
import { formatHoursAndMinutes } from '../../utils/formatters';
import { InlineRename } from '../../components/InlineRename';

interface EodWrapUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmEod: (options?: { shouldShutdown?: boolean }) => Promise<void>;
  onSnooze?: (minutes?: number) => Promise<void>;
}

/**
 * Each opening mounts the dialog afresh. It used to stay mounted and reset
 * only the confirm step on close, in an effect -- so a wrap-up completed one
 * evening still showed as completed when the prompt came back the next.
 */
export const EodWrapUpModal: React.FC<EodWrapUpModalProps> = props =>
  props.isOpen ? <EodWrapUpDialog {...props} /> : null;

const EodWrapUpDialog: React.FC<EodWrapUpModalProps> = ({
  onClose,
  onConfirmEod,
  onSnooze
}) => {
  const [executing, setExecuting] = useState<boolean>(false);
  const [shouldShutdown, setShouldShutdown] = useState<boolean>(false);
  const [completed, setCompleted] = useState<boolean>(false);
  const [confirmStep, setConfirmStep] = useState<number>(0);
  const [summary, setSummary] = useState<{ totalSeconds: number; tasksCount: number; items: Array<{ taskId?: string; key: string; title: string; durationSeconds: number; unsorted?: true }> }>({
    totalSeconds: 0,
    tasksCount: 0,
    items: []
  });
  // Bumped after naming an interruption, so the day is read again.
  const [revision, setRevision] = useState(0);
  // Today's interruptions not yet named, listed before the day closes.
  const toSort = summary.items.filter(item => item.unsorted && item.taskId);

  useEffect(() => {
    if (window.electronAPI?.getDailyWorklogSummary) {
      const todayStr = localDateKey();
      window.electronAPI.getDailyWorklogSummary(todayStr).then(setSummary, err => console.warn('[EodWrapUpModal] Failed to read the day:', err));
    }
  }, [revision]);

  useEffect(() => {
    if (window.electronAPI?.getScheduleSettings) {
      window.electronAPI.getScheduleSettings().then((sched) => {
        if (sched) {
          const isShutdownDefault = sched.shutdownByDefault ?? sched.eodShutdownByDefault ?? false;
          setShouldShutdown(Boolean(isShutdownDefault));
        }
      }).catch((err) => {
        console.warn('[EodWrapUpModal] Failed to load schedule settings for shutdown default:', err);
      });
    }
  }, []);

  const handleExecuteEod = React.useCallback(async () => {
    if (executing || completed) return;
    setExecuting(true);
    try {
      if (window.electronAPI?.triggerEodWrapUp) {
        await window.electronAPI.triggerEodWrapUp({ shouldShutdown });
      }
      await onConfirmEod({ shouldShutdown });
      setExecuting(false);
      setCompleted(true);
    } catch (err) {
      console.error('[EOD] Error during EOD sequence:', err);
      setExecuting(false);
    }
  }, [executing, completed, shouldShutdown, onConfirmEod]);

  // The bar's buttons, as main decoded them. Only the wrap-up's own actions
  // count, never the raw key: those come only while the bar shows the wrap-up
  // prompt. When it shows something else -- the dialog opened before the
  // prompt was drawn, or a higher-priority screen holds the bar -- START has
  // already paused the session or opened the task picker there, and reading
  // the key here as well made two STARTs a wrap-up, with a shutdown behind it,
  // that the user had pressed for something else.
  useEffect(() => {
    if (completed || executing) return;

    if (window.electronAPI?.onHardwareInputEvent) {
      const unsubscribe = window.electronAPI.onHardwareInputEvent((event) => {
        if (event.actionAssigned === 'DISMISS_EOD_WRAP_UP') {
          onClose(); // This completely dismisses the EOD prompt for the day
        } else if (event.actionAssigned === 'CONFIRM_EOD_WRAP_UP_STEP_1') {
          // Main counts its own two presses. If a click has already armed the
          // dialog, this START is the confirmation its button asks for.
          if (confirmStep === 1) {
            void handleExecuteEod();
          } else {
            setConfirmStep(1);
          }
        } else if (event.actionAssigned === 'EXECUTE_EOD_WRAP_UP') {
          void handleExecuteEod();
        }
      });
      return () => unsubscribe();
    }
    // React accepts an undefined cleanup; state it explicitly for noImplicitReturns.
    return undefined;
  }, [completed, executing, confirmStep, handleExecuteEod, onClose]);

  const formatDuration = formatHoursAndMinutes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-dark bg-dark-700/50">
          <div className="flex items-center space-x-2">
            <Moon className="w-5 h-5 text-text-primary" />
            <h3 className="text-md font-bold text-white">End-of-Day Wrap-Up Wizard</h3>
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
                Executing EOD wrap-up will automatically finalize your active session, log pending hours, save open VS Code files, and prepare your workstation for shutdown.
              </p>

              {/* Today's Work Summary Breakdown */}
              <div className="bg-dark-900/80 border border-border-dark rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-border-dark pb-2">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-white">
                    <Clock className="w-4 h-4 text-text-primary" />
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
                          <span className="font-mono text-text-primary font-bold">{item.key}:</span>
                          <span className="text-text-primary truncate">{item.title}</span>
                        </div>
                        <span className="font-mono text-text-secondary font-bold ml-2">{formatDuration(item.durationSeconds)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-text-secondary italic">No active session worklogs recorded today yet.</div>
                )}
              </div>

              {toSort.length > 0 && (
                <section aria-label="Interruptions to sort" className="bg-accent-amber/5 border border-accent-amber/30 rounded-lg p-4 space-y-2">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-white">
                    <Zap className="w-4 h-4 text-accent-amber" />
                    <span>Interruptions to sort ({toSort.length})</span>
                  </div>
                  <p className="text-[11px] text-text-secondary">Name them while you remember what they were. Their time stays in SprintTicker.</p>
                  {toSort.map(item => (
                    <div key={item.taskId} className="flex items-center justify-between text-xs py-1 px-2 bg-dark-800/60 rounded border border-border-dark">
                      <InlineRename
                        title={item.title}
                        ownerId={item.taskId!}
                        onRename={name => window.electronAPI.renameAdHocTask(item.taskId!, name).then(() => setRevision(r => r + 1))}
                        className="text-text-primary"
                        inputClassName="flex-1 bg-dark-900 border border-focus rounded px-2 py-0.5 text-white outline-none"
                      />
                      <span className="font-mono text-text-secondary font-bold ml-2">{formatDuration(item.durationSeconds)}</span>
                    </div>
                  ))}
                </section>
              )}

              {/* Checklist */}
              <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-2 text-xs">
                <div className="flex items-center justify-between text-text-primary">
                  <span>1. Stop Active Session & Log Hours</span>
                  <span className="text-accent-green">✓ Ready</span>
                </div>
                <div className="flex items-center justify-between text-text-primary">
                  <span>2. VS Code File Auto-Save</span>
                  <span className="text-text-primary">saveAll CLI</span>
                </div>
                <div className="flex items-center justify-between text-text-primary">
                  <span>3. Worklog Sync Queue Submission</span>
                  <span className="text-accent-green">✓ Auto</span>
                </div>
              </div>

              {/* Shutdown Checkbox Option */}
              <label className="flex items-center space-x-3 p-3 bg-dark-900/60 rounded-lg border border-border-dark cursor-pointer hover:bg-dark-700/50 transition-colors">
                <input
                  type="checkbox"
                  checked={shouldShutdown}
                  onChange={e => setShouldShutdown(e.target.checked)}
                  className="w-4 h-4 rounded text-text-primary focus:ring-focus bg-dark-800 border-border-dark"
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
              <h4 className="text-lg font-bold text-white">Day Complete!</h4>
              <p className="text-xs text-text-secondary">
                {shouldShutdown
                  ? 'All active task hours logged. Computer shutdown scheduled in 30 seconds.'
                  : 'All active task hours logged.'}
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
                onClick={() => {
                  if (confirmStep === 0) {
                    setConfirmStep(1);
                    if (window.electronAPI?.updateCeremonyPrompt) {
                      window.electronAPI.updateCeremonyPrompt('EOD', 'Press START to Confirm');
                    }
                  } else {
                    handleExecuteEod();
                  }
                }}
                  disabled={executing}
                  className={`px-5 py-2 text-xs font-semibold rounded-lg shadow-md transition-all ${
                    confirmStep === 1 
                      ? 'bg-accent-red hover:bg-accent-red/90 text-white animate-pulse' 
                      : 'bg-primary hover:bg-primary/90 text-dark-900'
                  }`}
                >
                  {executing ? 'Executing...' : confirmStep === 1 ? 'Press START (or click) to Confirm' : 'Execute Wrap-Up Now'}
                </button>
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                onClick={onClose}
                className="px-5 py-2 bg-accent-green hover:bg-accent-green/90 text-dark-900 text-xs font-semibold rounded-lg shadow-md transition-all"
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
