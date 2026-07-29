import React, { useState } from 'react';
import { Play, Pause, RefreshCw, Sparkles, Clock, CheckCircle2, X } from 'lucide-react';
import { ActiveSessionDTO } from '../../shared/dtos';
import { triggerDesktopConfetti } from '../utils/confetti-fx';

interface ActiveTaskHeroCardProps {
  session: ActiveSessionDTO | null;
  onPause: () => void;
  onResume: () => void;
  onComplete: (comment?: string, markDone?: boolean) => void;
  onOpenTaskModal: () => void;
}

export const ActiveTaskHeroCard: React.FC<ActiveTaskHeroCardProps> = ({
  session,
  onPause,
  onResume,
  onComplete,
  onOpenTaskModal
}) => {
  const [isFinishModalOpen, setIsFinishModalOpen] = useState<boolean>(false);

  const formatSeconds = (totalSec: number): string => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFinishOption = (markDone: boolean) => {
    setIsFinishModalOpen(false);
    if (markDone) {
      triggerDesktopConfetti();
      if (window.electronAPI?.triggerConfettiBurst) {
        window.electronAPI.triggerConfettiBurst().catch(err =>
          console.warn('[Confetti] Hardware trigger warning:', err)
        );
      }
    }
    onComplete(undefined, markDone);
  };

  return (
    <>
      <section className="bg-dark-800 rounded-xl border border-border-dark p-6 space-y-6 shadow-xl select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="bg-accent-blue/20 text-accent-blue px-3 py-1 rounded-md text-xs font-mono font-bold">
              CURRENT SESSION
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold font-mono ${
                session?.status === 'TRACKING'
                  ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                  : session?.status === 'PAUSED'
                  ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30'
                  : 'bg-dark-700 text-text-secondary border border-border-dark'
              }`}
            >
              ● {session?.status || 'IDLE'}
            </span>
          </div>
          <span className="text-xs font-mono text-text-secondary">UTC Absolute Timestamp Engine</span>
        </div>

        <div>
          <div className="text-xs font-mono text-text-secondary mb-1">{session?.taskKey || 'NO TASK SELECTED'}</div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            {session?.taskTitle || 'No Active Task Selected'}
          </h2>
        </div>

        <div className="flex items-baseline space-x-4 bg-dark-900 p-4 rounded-lg border border-border-dark">
          <span className="text-xs font-mono text-text-secondary uppercase">Elapsed Time:</span>
          <span className="text-4xl font-extrabold font-mono text-white tracking-widest">
            {formatSeconds(session?.elapsedSeconds || 0)}
          </span>
        </div>

        <div className="flex items-center space-x-3 pt-2">
          {session?.status === 'TRACKING' ? (
            <button
              onClick={onPause}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-accent-amber hover:bg-amber-600 text-dark-900 transition-all shadow-md"
            >
              <Pause className="w-4 h-4" />
              <span>Pause</span>
            </button>
          ) : (
            <button
              onClick={onResume}
              disabled={!session}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-md ${
                session
                  ? 'bg-accent-green hover:bg-emerald-600 text-dark-900'
                  : 'bg-dark-700 text-text-secondary cursor-not-allowed'
              }`}
            >
              <Play className="w-4 h-4" />
              <span>Resume</span>
            </button>
          )}

          <button
            onClick={() => setIsFinishModalOpen(true)}
            disabled={!session}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm border transition-all ${
              session
                ? 'bg-dark-700 hover:bg-dark-700/80 text-white border-border-dark'
                : 'bg-dark-700/50 text-text-secondary border-border-dark/50 cursor-not-allowed'
            }`}
          >
            <Sparkles className="w-4 h-4 text-accent-green" />
            <span>Finish & Log Hours</span>
          </button>

          <button
            onClick={onOpenTaskModal}
            className="flex items-center space-x-2 px-5 py-2.5 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue rounded-lg font-semibold text-sm border border-accent-blue/30 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Switch / New Task</span>
          </button>
        </div>
      </section>

      {/* Finish Session Confirmation Modal */}
      {isFinishModalOpen && session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 font-mono select-none">
          <div className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-border-dark pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-accent-green" />
                <h3 className="text-sm font-bold text-white">
                  Finish Work Session [{session.taskKey}]
                </h3>
              </div>
              <button
                onClick={() => setIsFinishModalOpen(false)}
                className="text-text-secondary hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              Select task status upon logging <strong className="text-white">{formatSeconds(session.elapsedSeconds)}</strong> for:
              <br />
              <span className="text-accent-blue font-bold">{session.taskTitle}</span>
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleFinishOption(false)}
                className="w-full flex items-center justify-between p-4 bg-dark-700/60 hover:bg-dark-700 border border-border-dark hover:border-accent-blue/40 rounded-xl text-left transition-all group"
              >
                <div className="space-y-1">
                  <div className="text-xs font-bold text-accent-blue flex items-center space-x-2">
                    <Clock className="w-4 h-4" />
                    <span>Remain &apos;In Progress&apos;</span>
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    Log logged hours, stop tracking, and keep task open for further work.
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleFinishOption(true)}
                className="w-full flex items-center justify-between p-4 bg-accent-green/10 hover:bg-accent-green/20 border border-accent-green/30 hover:border-accent-green/60 rounded-xl text-left transition-all group"
              >
                <div className="space-y-1">
                  <div className="text-xs font-bold text-accent-green flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Mark Task as &apos;Done&apos; 🎉</span>
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    Log logged hours, mark task complete, and trigger celebration FX!
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsFinishModalOpen(false)}
                className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
