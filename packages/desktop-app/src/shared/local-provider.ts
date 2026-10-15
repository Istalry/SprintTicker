/**
 * Which provider a project row came from, for the two values that name none.
 *
 * Main and the renderer both write project rows, so the values live here once.
 */

/**
 * A project created in SprintTicker, not synced. Its tasks exist nowhere
 * else, so time on them is kept in local history and no status change is sent
 * anywhere.
 */
export const OWN_PROJECT_PROVIDER_ID = 'sprintticker';

/**
 * Not known: the column's default, and so what every OpenProject project held
 * until the adapter started naming itself, as well as what a project created
 * here held before {@link OWN_PROJECT_PROVIDER_ID} existed. The two cannot be
 * told apart in an existing database, so a session on such a project keeps
 * the old rule -- its time goes to the active provider -- and the next sync
 * overwrites the value on every project the provider still lists.
 */
export const UNKNOWN_PROJECT_PROVIDER_ID = 'local';
