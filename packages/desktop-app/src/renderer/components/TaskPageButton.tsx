import React from 'react';
import { ExternalLink } from 'lucide-react';

interface TaskPageButtonProps {
  taskId: string;
  /** The key, for the label a screen reader says. */
  taskKey: string;
  className?: string;
}

/**
 * Opens a task's page on its provider, in the browser. The window names the
 * task and main builds the URL from the provider's own site, so nothing the
 * renderer holds decides what is opened. Shown only where `hasTaskPage` says
 * there is a page.
 */
export const TaskPageButton: React.FC<TaskPageButtonProps> = ({ taskId, taskKey, className = '' }) => (
  <button
    type="button"
    aria-label={`Open ${taskKey} on its provider`}
    title="Open on the provider, in the browser"
    onClick={() => {
      window.electronAPI
        ?.openTaskPage?.(taskId)
        .then(opened => {
          if (!opened) console.warn(`[TaskPageButton] ${taskKey} has no page to open.`);
        })
        .catch(err => console.warn(`[TaskPageButton] Could not open ${taskKey}:`, err));
    }}
    className={`p-1 text-text-secondary hover:text-accent-blue hover:bg-dark-700 rounded transition-colors ${className}`}
  >
    <ExternalLink className="w-3.5 h-3.5" />
  </button>
);
