import React from 'react';
import { Check, CloudOff, Loader2 } from 'lucide-react';
import { AutoSaveStatus } from '../hooks/auto-save-scheduler';
import { useAnnounce } from './LiveAnnouncer';

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
  // "Saved" is said through the window's region (A14): the indicator swaps
  // elements, which a screen reader does not read. A failure is an alert.
  useAnnounce(status === 'saved' ? status : null, 'Saved.');
  if (status === 'error') {
    return (
      <div role="alert" className="flex items-center space-x-2 px-3 py-2 text-xs rounded-lg bg-accent-red/10 border border-accent-red/30 text-accent-red">
        <CloudOff className="w-4 h-4" />
        <span>Not saved. Change it again to retry; if it still fails, restart SprintTicker.</span>
      </div>
    );
  }

  if (status === 'saving' || status === 'pending') {
    return (
      <div className="flex items-center space-x-2 px-3 py-2 text-xs text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Saving…</span>
      </div>
    );
  }

  if (status === 'saved') {
    return (
      <div className="flex items-center space-x-2 px-3 py-2 text-xs text-accent-green">
        <Check className="w-4 h-4" />
        <span>Saved</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-2 px-3 py-2 text-xs text-text-secondary">
      <span>{idleLabel}</span>
    </div>
  );
};
