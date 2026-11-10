import { ProviderId } from './provider-names';
import { UNKNOWN_PROJECT_PROVIDER_ID } from './local-provider';

/**
 * What a star is attached to (migration 14).
 *
 * A provider's task by its provider and key, so the star outlives the row:
 * the sync retires a task that leaves the user's scope and fetches it again
 * under the same key when it comes back. An ad-hoc task by its id, because
 * every ad-hoc task shows the same configured key (`MISC-1`), and starring
 * one by key would star them all.
 */
export interface StarIdentity {
  providerId: string;
  taskKey: string;
}

/**
 * The identity a task is starred under. `projectProviderId` is its project's
 * provider, or undefined when the project has no row.
 */
export function starIdentity(
  task: { id: string; key: string },
  projectProviderId: string | undefined,
  isAdHoc: boolean
): StarIdentity {
  if (isAdHoc) return { providerId: ProviderId.ADHOC, taskKey: task.id };
  return { providerId: projectProviderId || UNKNOWN_PROJECT_PROVIDER_ID, taskKey: task.key };
}
