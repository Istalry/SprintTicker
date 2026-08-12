import React, { useEffect } from 'react';
import { X, Clock, BellOff } from 'lucide-react';

interface StandupPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSnooze: (minutes?: number) => Promise<void>;
}

export const StandupPromptModal: React.FC<StandupPromptModalProps> = ({
  isOpen,
  onClose,
  onSnooze
}) => {
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        onClose();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none font-mono">
      <div className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-dark bg-dark-700/50">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-accent-blue" />
            <h3 className="text-md font-bold text-white font-mono">Daily Stand-Up Meeting</h3>
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
          <p className="text-xs text-text-secondary leading-relaxed">
            Your scheduled Daily Stand-Up is starting now. Your current active task will keep tracking normally.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-dark bg-dark-700/30">
          <button
            onClick={() => onSnooze(10)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all"
          >
            <BellOff className="w-3.5 h-3.5" />
            <span>Snooze 10m</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="flex items-center space-x-1.5 px-4 py-2 bg-accent-blue hover:bg-blue-600 text-white text-xs font-semibold rounded-lg shadow-md transition-all"
            >
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
