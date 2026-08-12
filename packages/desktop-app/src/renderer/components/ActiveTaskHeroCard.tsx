import React, { useState } from 'react';
import { Play, Pause, RefreshCw, Sparkles } from 'lucide-react';
import { ActiveSessionDTO } from '../../shared/dtos';
import { triggerDesktopConfetti } from '../utils/confetti-fx';
import { formatSeconds } from '../utils/formatters';
import { FinishSessionModal } from './FinishSessionModal';

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

      <FinishSessionModal 
        isOpen={isFinishModalOpen} 
        session={session} 
        onClose={() => setIsFinishModalOpen(false)} 
        onFinishOption={handleFinishOption} 
      />
    </>
  );
};
