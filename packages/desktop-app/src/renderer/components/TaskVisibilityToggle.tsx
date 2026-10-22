import React from 'react';
import { User } from 'lucide-react';
import { TaskVisibility, ownerLabel } from '../../shared/task-visibility';
import { TaskDTO } from '../../shared/dtos';
import { TaskOwnership } from '../../shared/task-ownership';

interface TaskVisibilityToggleProps {
  visibility: TaskVisibility;
  onChange: (visibility: TaskVisibility) => void;
  /** How many tasks of the list on screen the setting hides, when there is one. */
  hiddenCount?: number;
}

/**
 * The two switches for whose tasks the lists show, as the Projects tab and the
 * task picker both show them. Beside the list's count of what they hide, so a
 * short list does not read as tasks lost.
 */
export const TaskVisibilityToggle: React.FC<TaskVisibilityToggleProps> = ({ visibility, onChange, hiddenCount = 0 }) => (
  <div
    className="flex items-center gap-3 text-xs text-text-secondary select-none"
    title="Your own tasks are always listed. The bar's own picker follows the same setting."
  >
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        checked={visibility.unassigned}
        onChange={e => onChange({ ...visibility, unassigned: e.target.checked })}
        className="accent-accent-blue"
      />
      <span>Unassigned</span>
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        checked={visibility.others}
        onChange={e => onChange({ ...visibility, others: e.target.checked })}
        className="accent-accent-blue"
      />
      <span>Teammates&apos;</span>
    </label>
    {hiddenCount > 0 && <span className="text-text-secondary/70">({hiddenCount} hidden)</span>}
  </div>
);

/** Whose a task is, beside its key; nothing for the user's own. */
export const TaskOwnerBadge: React.FC<{ task: Pick<TaskDTO, 'ownership' | 'assigneeName'> }> = ({ task }) => {
  const label = ownerLabel(task);
  if (!label) return null;
  const free = task.ownership === TaskOwnership.UNASSIGNED;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${
        free ? 'text-accent-amber border-accent-amber/40 bg-accent-amber/10' : 'text-accent-purple border-accent-purple/40 bg-accent-purple/10'
      }`}
      data-testid="task-owner"
    >
      <User className="w-3 h-3" />
      {label}
    </span>
  );
};
