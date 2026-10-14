import React from 'react';

interface ProjectFilterToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** How many projects the switch is hiding right now. */
  hiddenCount: number;
  /** On, but no project has an open task, so every project is listed. */
  nothingAssigned: boolean;
}

/**
 * The "only projects with tasks" switch, as the Projects tab and the task
 * picker both show it. It says how many projects it hides, so a short list
 * does not read as projects lost -- and when it hides nothing because no
 * project has a task, it says that, so a ticked box with the whole list under
 * it does not read as the switch being broken.
 */
export const ProjectFilterToggle: React.FC<ProjectFilterToggleProps> = ({ enabled, onChange, hiddenCount, nothingAssigned }) => (
  <label
    className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none"
    title="Hides projects with no open task. With the default task scope, those are the tasks assigned to you. The bar's own picker follows the same setting."
  >
    <input
      type="checkbox"
      checked={enabled}
      onChange={e => onChange(e.target.checked)}
      className="accent-accent-blue"
    />
    <span>Only projects with tasks</span>
    {enabled && hiddenCount > 0 && (
      <span className="text-text-secondary/70">({hiddenCount} hidden)</span>
    )}
    {enabled && nothingAssigned && (
      <span className="text-text-secondary/70">(none has a task: showing all)</span>
    )}
  </label>
);
