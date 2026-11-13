import { OWN_PROJECT_PROVIDER_ID, UNKNOWN_PROJECT_PROVIDER_ID } from './local-provider';

/**
 * What the user calls each provider, decided once.
 *
 * The screens write "Jira" for whichever provider the user has; the app
 * writes that provider's own name in its place. Before this file the name
 * was spelled wherever it was needed, and four spellings shipped at once:
 * "Jira Cloud" on the adapter, "Jira" in Settings, "Ad-Hoc / Custom Local
 * Fallback" in the provider list and "Jira or OpenProject" in four views,
 * whichever provider was in use.
 */

/** The ids the adapters register under (`ITaskProvider.providerId`). */
export const ProviderId = {
  JIRA: 'jira',
  OPENPROJECT: 'openproject',
  /** The local fallback: nothing leaves the machine. */
  ADHOC: 'adhoc'
} as const;

/** Union of the provider id strings above. */
export type ProviderIdValue = (typeof ProviderId)[keyof typeof ProviderId];

/** Where time on the app's own projects stays: here. */
const ON_THIS_COMPUTER = 'This computer';

const KNOWN_NAMES: Readonly<Record<string, string>> = {
  [ProviderId.JIRA]: 'Jira',
  [ProviderId.OPENPROJECT]: 'OpenProject',
  [ProviderId.ADHOC]: ON_THIS_COMPUTER,
  [OWN_PROJECT_PROVIDER_ID]: ON_THIS_COMPUTER
};

/** Said when the provider is not known, so a sentence still reads. */
export const UNNAMED_PROVIDER = 'your provider';

/**
 * The name the app writes for a provider: "Jira", "OpenProject", or, for a
 * server on the SprintTicker Provider API, the name the user gave it -- or
 * the server's own when they gave none (`serverName`).
 *
 * The ad-hoc fallback and the app's own projects read "This computer", which
 * is where their time stays. `local`, the column's old default, means "not
 * known" (`local-provider.ts`), so it reads {@link UNNAMED_PROVIDER}; so does
 * an empty id.
 */
export function providerDisplayName(providerId: string | null | undefined, serverName?: string): string {
  const id = (providerId ?? '').trim();
  const known = KNOWN_NAMES[id];
  if (known) return known;
  const custom = (serverName ?? '').trim();
  if (custom) return custom;
  if (!id || id === UNKNOWN_PROJECT_PROVIDER_ID) return UNNAMED_PROVIDER;
  return id;
}

/**
 * Where a session's time goes, by name: the provider recorded on the session
 * when it started (CLAUDE.md §7), never the one active now -- the session
 * card said "sent to This computer" for an OpenProject task once the user
 * had chosen no account (REVIEW-2026-11 C2). `local`, the old default, means
 * *not known*, and keeps the active provider. Null when the time stays here.
 */
export function sendDestinationName(sessionProviderId: string | null | undefined, activeProviderName: string): string | null {
  const id = (sessionProviderId ?? '').trim();
  const name = id && id !== UNKNOWN_PROJECT_PROVIDER_ID ? providerDisplayName(id) : activeProviderName.trim() || UNNAMED_PROVIDER;
  return name === ON_THIS_COMPUTER ? null : name;
}

/** The providers the user can choose, in the order the choice lists them. */
export const SELECTABLE_PROVIDERS: readonly ProviderIdValue[] = [ProviderId.OPENPROJECT, ProviderId.JIRA, ProviderId.ADHOC];

/** {@link SELECTABLE_PROVIDERS} with their names, for a provider choice. */
export function selectableProviders(): { id: ProviderIdValue; name: string }[] {
  return SELECTABLE_PROVIDERS.map(id => ({ id, name: providerDisplayName(id) }));
}
