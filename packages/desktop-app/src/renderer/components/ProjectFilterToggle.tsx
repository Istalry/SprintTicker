import React from 'react';

interface ProjectFilterToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** How many projects the switch is hiding right now. */
  hiddenCount: number;
}

/**
 * The "only projects with tasks" switch, as the Projects tab and the task
 * picker both show it. It says how many projects it hides, so a short list
 * does not read as projects lost.
 */
export const ProjectFilterToggle: React.FC<ProjectFilterToggleProps> = ({ enabled, onChange, hiddenCount }) => (
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
  </label>
);
