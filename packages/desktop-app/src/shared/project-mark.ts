import type { ProjectDTO } from './dtos';
import { OWN_PROJECT_PROVIDER_ID } from './local-provider';
import { sameOwnName } from './own-work';

/**
 * What tells a project apart from another of the same name: `computer` for
 * the user's own, kept on this computer, `provider` for the online one. Null
 * where no other project shares its name -- the mark is shown only where
 * names collide (LOCAL-WORK-AND-CALENDAR.md §3, the user's answer,
 * 2026-11-24). A project of one kind beside another of the same kind gets
 * none: the mark names where a project lives, and both live there.
 */
export function projectMarkOf(project: ProjectDTO, projects: readonly ProjectDTO[]): 'computer' | 'provider' | null {
  const own = project.providerId === OWN_PROJECT_PROVIDER_ID;
  const collides = projects.some(
    other => other.id !== project.id && (other.providerId === OWN_PROJECT_PROVIDER_ID) !== own && sameOwnName(other.name, project.name)
  );
  if (!collides) return null;
  return own ? 'computer' : 'provider';
}
