import React from 'react';
import { Monitor } from 'lucide-react';
import type { ProjectDTO } from '../../shared/dtos';
import { projectMarkOf } from '../../shared/project-mark';
import { providerDisplayName } from '../../shared/provider-names';

/**
 * Beside a project's name where another of the same name lives elsewhere
 * (LOCAL-WORK-AND-CALENDAR.md §3): a computer for the user's own, the
 * provider's name for the online one. Words for the screen reader, never
 * colour alone; nothing where no name collides.
 */
export const ProjectMark: React.FC<{ project: ProjectDTO; projects: readonly ProjectDTO[] }> = ({ project, projects }) => {
  const mark = projectMarkOf(project, projects);
  if (mark === 'computer') {
    return (
      <span className="relative inline-flex items-center text-text-secondary" title="Kept on this computer">
        <Monitor className="w-3 h-3" aria-hidden="true" />
        <span className="sr-only">on this computer</span>
      </span>
    );
  }
  if (mark === 'provider') {
    return <span className="text-[11px] font-normal text-text-secondary">{providerDisplayName(project.providerId)}</span>;
  }
  return null;
};
