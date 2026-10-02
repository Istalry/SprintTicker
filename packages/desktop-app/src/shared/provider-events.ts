/**
 * Events from the task provider -- assigned, mentioned, commented -- and what
 * the user chose to be told about.
 *
 * Shared because the renderer edits the settings and main acts on them; the
 * defaults and limits must be one copy, or the panel shows one interval while
 * main polls at another (CLAUDE.md §3).
 */

export type ProviderEventKind = 'assigned' | 'mentioned' | 'commented' | 'status_changed' | 'date_alert';

/** In the order the settings panel lists them. */
export const PROVIDER_EVENT_KINDS: readonly ProviderEventKind[] = [
  'assigned',
  'mentioned',
  'commented',
  'status_changed',
  'date_alert'
];

export const PROVIDER_EVENT_KIND_LABELS: Record<ProviderEventKind, string> = {
  assigned: 'Assigned to me',
  mentioned: 'Mentions',
  commented: 'Comments',
  status_changed: 'Status changes',
  date_alert: 'Date alerts'
};

export interface ProviderEventDTO {
  /** Unique within its provider; repeated polls deduplicate on it. */
  id: string;
  providerId: string;
  kind: ProviderEventKind;
  /** The key the app shows for the task, `OP-142` or `PROJ-7`. */
  taskKey: string;
  taskTitle: string;
  /** Absent when no person caused it, as for a date alert. */
  actorName?: string;
  /** A comment excerpt or similar, when the provider has one. */
  summary?: string;
  /** The task in the provider's web UI. Opened only if http(s). */
  url?: string;
  /** The provider's own clock. The poll cursor advances on it, never on ours. */
  occurredAtUtc: string;
}

export interface ProviderEventSettingsDTO {
  /** Poll the provider at all. */
  enabled: boolean;
  pollIntervalSeconds: number;
  /** A Windows toast for each event. */
  showToasts: boolean;
  /** A banner on the BUSY Bar, when one is in use. */
  showOnBar: boolean;
  kinds: Record<ProviderEventKind, boolean>;
}

/** Providers that can report events. A test holds it to the adapters. */
export const PROVIDERS_WITH_EVENTS: readonly string[] = ['openproject', 'jira'];

/**
 * The kinds a provider can produce, where that is not all of them. Jira has
 * no date alerts, and a checkbox for one would be a setting that does nothing.
 */
const PROVIDER_EVENT_KINDS_BY_PROVIDER: Readonly<Record<string, readonly ProviderEventKind[]>> = {
  jira: ['assigned', 'mentioned', 'commented', 'status_changed']
};

/** The kinds the settings panel offers for a provider, in panel order. */
export function providerEventKindsFor(providerId: string): readonly ProviderEventKind[] {
  return PROVIDER_EVENT_KINDS_BY_PROVIDER[providerId] ?? PROVIDER_EVENT_KINDS;
}

export const PROVIDER_EVENT_SETTINGS_KEY = 'provider_event_settings';
/** Per provider: the newest event time seen, on the provider's clock. */
export const PROVIDER_EVENT_CURSORS_KEY = 'provider_event_cursors';
/** Where the OpenProject poller kept its switch and interval before this. */
export const LEGACY_MESSAGING_SETTINGS_KEY = 'messaging_settings';

export const DEFAULT_PROVIDER_EVENT_POLL_SECONDS = 60;
export const MIN_PROVIDER_EVENT_POLL_SECONDS = 30;
export const MAX_PROVIDER_EVENT_POLL_SECONDS = 3600;
/** The first poll waits this long, so it does not compete with startup's sync. */
export const PROVIDER_EVENT_FIRST_POLL_DELAY_MS = 5000;
/** Beyond this many in one poll, one summary toast replaces them. */
export const MAX_INDIVIDUAL_PROVIDER_TOASTS = 3;
/** Event ids remembered for deduplication before the oldest are forgotten. */
export const PROVIDER_EVENT_SEEN_LIMIT = 500;
/** A comment excerpt in a toast: two lines, not the comment. */
export const PROVIDER_EVENT_SUMMARY_MAX_CHARS = 140;

export const DEFAULT_PROVIDER_EVENT_SETTINGS: ProviderEventSettingsDTO = {
  enabled: true,
  pollIntervalSeconds: DEFAULT_PROVIDER_EVENT_POLL_SECONDS,
  showToasts: true,
  showOnBar: true,
  kinds: {
    assigned: true,
    mentioned: true,
    commented: true,
    status_changed: true,
    date_alert: true
  }
};

/** The two fields of the old OpenProject poller's settings that carry over. */
export interface LegacyMessagingSettings {
  enableOpenProjectNotifications?: unknown;
  openProjectPollingIntervalSeconds?: unknown;
}

/**
 * Reads stored settings into a complete, valid set.
 *
 * Anything missing or malformed takes its default, and the interval is
 * clamped: a zero would poll in a tight loop. With nothing stored yet, the old
 * OpenProject poller's switch and interval are the defaults, so a user who
 * had turned it off is not opted back in by an upgrade.
 */
export function normaliseProviderEventSettings(
  stored: unknown,
  legacy?: LegacyMessagingSettings | null
): ProviderEventSettingsDTO {
  const raw = (stored && typeof stored === 'object' ? stored : null) as Partial<Record<keyof ProviderEventSettingsDTO, unknown>> | null;
  const defaults = DEFAULT_PROVIDER_EVENT_SETTINGS;

  const legacyEnabled = typeof legacy?.enableOpenProjectNotifications === 'boolean'
    ? legacy.enableOpenProjectNotifications
    : defaults.enabled;
  const legacyInterval = typeof legacy?.openProjectPollingIntervalSeconds === 'number'
    ? legacy.openProjectPollingIntervalSeconds
    : defaults.pollIntervalSeconds;

  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const storedKinds = (raw?.kinds && typeof raw.kinds === 'object' ? raw.kinds : {}) as Partial<Record<ProviderEventKind, unknown>>;
  const kinds = {} as Record<ProviderEventKind, boolean>;
  for (const kind of PROVIDER_EVENT_KINDS) {
    kinds[kind] = bool(storedKinds[kind], defaults.kinds[kind]);
  }

  return {
    enabled: bool(raw?.enabled, raw ? defaults.enabled : legacyEnabled),
    pollIntervalSeconds: clampPollInterval(
      typeof raw?.pollIntervalSeconds === 'number' ? raw.pollIntervalSeconds : legacyInterval
    ),
    showToasts: bool(raw?.showToasts, defaults.showToasts),
    showOnBar: bool(raw?.showOnBar, defaults.showOnBar),
    kinds
  };
}

function clampPollInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_PROVIDER_EVENT_POLL_SECONDS;
  return Math.min(MAX_PROVIDER_EVENT_POLL_SECONDS, Math.max(MIN_PROVIDER_EVENT_POLL_SECONDS, Math.round(seconds)));
}

/** Which destinations a test notification was sent to. */
export interface ProviderEventTestResultDTO {
  toast: boolean;
  bar: boolean;
}

export interface ProviderEventText {
  title: string;
  body: string;
}

/** A toast's text: a sentence, since a toast has the room for one. */
export function describeProviderEvent(event: ProviderEventDTO): ProviderEventText {
  const actor = event.actorName?.trim();
  const key = event.taskKey || 'a task';
  let title: string;
  switch (event.kind) {
    case 'assigned':
      title = actor ? `${actor} assigned you ${key}` : `${key} was assigned to you`;
      break;
    case 'mentioned':
      title = actor ? `${actor} mentioned you on ${key}` : `You were mentioned on ${key}`;
      break;
    case 'commented':
      title = actor ? `${actor} commented on ${key}` : `New comment on ${key}`;
      break;
    case 'status_changed':
      title = actor ? `${actor} changed the status of ${key}` : `Status changed on ${key}`;
      break;
    case 'date_alert':
      title = `Date alert on ${key}`;
      break;
  }
  const body = event.summary ? `${event.taskTitle}\n${event.summary}` : event.taskTitle;
  return { title, body };
}

/**
 * The bar's text: who, then which task. Its first row holds a dozen
 * characters, so the sentence a toast uses would be cut after the name.
 */
export function describeProviderEventForBar(event: ProviderEventDTO): ProviderEventText {
  const title = event.actorName?.trim() || PROVIDER_EVENT_KIND_LABELS[event.kind];
  return { title, body: [event.taskKey, event.taskTitle].filter(Boolean).join(' ') };
}

const KIND_NOUNS: Record<ProviderEventKind, [string, string]> = {
  assigned: ['assignment', 'assignments'],
  mentioned: ['mention', 'mentions'],
  commented: ['comment', 'comments'],
  status_changed: ['status change', 'status changes'],
  date_alert: ['date alert', 'date alerts']
};

/** One notice for a burst: how many, and of what. */
export function summarizeProviderEvents(events: readonly ProviderEventDTO[], providerName: string): ProviderEventText {
  const counts = new Map<ProviderEventKind, number>();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  const parts = PROVIDER_EVENT_KINDS
    .filter(kind => counts.has(kind))
    .map(kind => {
      const count = counts.get(kind)!;
      return `${count} ${KIND_NOUNS[kind][count === 1 ? 0 : 1]}`;
    });
  return { title: `${events.length} updates in ${providerName}`, body: parts.join(', ') };
}
