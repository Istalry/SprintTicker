import React from 'react';
import { Check, CloudOff, Loader2 } from 'lucide-react';
import { AutoSaveStatus } from '../hooks/auto-save-scheduler';

export interface AutoSaveIndicatorProps {
  status: AutoSaveStatus;
  /** Shown in the idle state, so a panel with no button still explains itself. */
  idleLabel?: string;
}

/**
 * Replaces the Save button on an auto-saving panel.
 *
 * Something has to occupy that role. Removing the button and showing nothing
 * leaves the user unable to tell a saved change from a lost one -- and unlike a
 * button there is nothing to press again, so a failure has to be visible.
 */
export const AutoSaveIndicator: React.FC<AutoSaveIndicatorProps> = ({
  status,
  idleLabel = 'Changes save automatically'
}) => {
  if (status === 'error') {
    return (
      <div className="flex items-center space-x-2 px-3 py-2 text-xs font-mono rounded-lg bg-red-900/20 border border-red-900/50 text-red-300">
        <CloudOff className="w-4 h-4" />
        <span>Could not save — see the console for details</span>
      </div>
    );
  }

  if (status === 'saving' || status === 'pending') {
    return (
      <div className="flex items-center space-x-2 px-3 py-2 text-xs font-mono text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Saving…</span>
      </div>
    );
  }

  if (status === 'saved') {
    return (
      <div className="flex items-center space-x-2 px-3 py-2 text-xs font-mono text-accent-green">
        <Check className="w-4 h-4" />
        <span>Saved</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 px-3 py-2 text-xs font-mono text-text-secondary opacity-70">
      <span>{idleLabel}</span>
    </div>
  );
};
