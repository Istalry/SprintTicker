import React from 'react';
import { Clock, CheckCircle2, X, Sparkles } from 'lucide-react';
import { ActiveSessionDTO } from '../../shared/dtos';
import { formatSeconds } from '../utils/formatters';

interface FinishSessionModalProps {
  isOpen: boolean;
  session: ActiveSessionDTO | null;
  onClose: () => void;
  onFinishOption: (markDone: boolean) => void;
}

export const FinishSessionModal: React.FC<FinishSessionModalProps> = ({
  isOpen,
  session,
  onClose,
  onFinishOption
}) => {
  if (!isOpen || !session) return null;

  return (
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
            onClick={onClose}
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
            onClick={() => onFinishOption(false)}
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
            onClick={() => onFinishOption(true)}
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
            onClick={onClose}
            className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
