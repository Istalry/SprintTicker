import { ArgumentNullException } from '../../shared/dtos';
import {
  LEGACY_MESSAGING_SETTINGS_KEY,
  LegacyMessagingSettings,
  MAX_INDIVIDUAL_PROVIDER_TOASTS,
  PROVIDER_EVENT_CURSORS_KEY,
  PROVIDER_EVENT_FIRST_POLL_DELAY_MS,
  PROVIDER_EVENT_SEEN_LIMIT,
  PROVIDER_EVENT_SETTINGS_KEY,
  ProviderEventDTO,
  ProviderEventKind,
  ProviderEventSettingsDTO,
  ProviderEventTestResultDTO,
  ProviderEventText,
  describeProviderEvent,
  describeProviderEventForBar,
  normaliseProviderEventSettings,
  summarizeProviderEvents
} from '../../shared/provider-events';
import { ITaskProvider } from '../providers/task-provider-interface';
import { ToastPresenter } from './toast-presenter';

export interface SettingsStore {
  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;
}

export interface ProviderEventBanner {
  appName: string;
  title: string;
  body: string;
}

/** The BUSY Bar, as far as provider events are concerned. */
export interface ProviderEventBar {
  /** False in no-bar mode: then nothing is sent, not even a queued frame. */
  isEnabled(): boolean;
  show(banner: ProviderEventBanner, providerId: string): void;
}

export interface ProviderEventServiceDeps {
  getActiveProvider: () => ITaskProvider | null | undefined;
  settings: SettingsStore;
  toasts: ToastPresenter;
  bar?: ProviderEventBar;
  now?: () => Date;
}

export type ProviderEventPollOutcome =
  | 'disabled'
  | 'unsupported'
  | 'busy'
  | 'baseline'
  | 'failed'
  | 'nothing_new'
  | 'delivered';

const TEST_EVENT: ProviderEventDTO = {
  id: 'test',
  providerId: 'test',
  kind: 'mentioned',
  taskKey: 'TEST-1',
  taskTitle: 'This is what a notification from your provider looks like',
  actorName: 'SprintTicker',
  occurredAtUtc: new Date(0).toISOString()
};

/**
 * Tells the user what happened on their tasks in Jira or OpenProject: a
 * Windows toast, and a banner on the bar when there is one.
 *
 * It polls the active provider and keeps a cursor per provider: the newest
 * event time it has seen, **on the provider's clock**. Comparing the server's
 * timestamps with this machine's would lose events to clock skew, which is not
 * hypothetical here -- the bar itself ran half a minute behind its host.
 * Only the very first poll uses our clock, to start "from now" instead of
 * replaying a history the user has already read.
 *
 * A failed poll does not move the cursor, so the next one picks up what it
 * missed. A burst becomes one summary instead of a wall of toasts.
 *
 * The bar is reached here, once, rather than by letting the Windows listener
 * mirror the toast: that listener skips this app's own notifications by
 * design, and one event must take the display lock once (CLAUDE.md §5).
 */
export class ProviderEventService {
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private firstPoll: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly seen = new Set<string>();

  constructor(private readonly deps: ProviderEventServiceDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    if (!deps.getActiveProvider) throw new ArgumentNullException('deps.getActiveProvider');
    if (!deps.settings) throw new ArgumentNullException('deps.settings');
    if (!deps.toasts) throw new ArgumentNullException('deps.toasts');
    this.now = deps.now ?? (() => new Date());
  }

  /** Starts polling per the settings, replacing any schedule already running. */
  public start(): void {
    this.stop();
    const settings = this.getSettings();
    if (!settings.enabled) return;

    const tick = (): void => {
      this.poll().catch(err => console.warn('[ProviderEvents] Poll failed:', err));
    };
    this.firstPoll = setTimeout(tick, PROVIDER_EVENT_FIRST_POLL_DELAY_MS);
    this.timer = setInterval(tick, settings.pollIntervalSeconds * 1000);
  }

  public stop(): void {
    if (this.firstPoll) clearTimeout(this.firstPoll);
    if (this.timer) clearInterval(this.timer);
    this.firstPoll = null;
    this.timer = null;
  }

  public getSettings(): ProviderEventSettingsDTO {
    const stored = this.deps.settings.getSetting<unknown>(PROVIDER_EVENT_SETTINGS_KEY, null);
    const legacy = this.deps.settings.getSetting<LegacyMessagingSettings | null>(LEGACY_MESSAGING_SETTINGS_KEY, null);
    return normaliseProviderEventSettings(stored, legacy);
  }

  /** Stores the settings, normalised, and reschedules. Answers what was stored. */
  public saveSettings(settings: ProviderEventSettingsDTO): ProviderEventSettingsDTO {
    if (!settings) throw new ArgumentNullException('settings');
    const normalised = normaliseProviderEventSettings(settings);
    this.deps.settings.setSetting(PROVIDER_EVENT_SETTINGS_KEY, normalised);
    // Off forgets the cursors, so switching back on starts from that moment
    // as the panel promises, rather than replaying everything in between.
    if (!normalised.enabled) this.deps.settings.setSetting(PROVIDER_EVENT_CURSORS_KEY, {});
    this.start();
    return normalised;
  }

  /** One poll of the active provider. Public so a test, or a button, can run one. */
  public async poll(): Promise<ProviderEventPollOutcome> {
    const settings = this.getSettings();
    if (!settings.enabled) return 'disabled';

    const provider = this.deps.getActiveProvider();
    if (!provider?.getEventsSince) return 'unsupported';
    if (this.polling) return 'busy';

    this.polling = true;
    try {
      const since = this.readCursors()[provider.providerId];
      if (!since) {
        this.writeCursor(provider.providerId, this.now().toISOString());
        return 'baseline';
      }

      let events: ProviderEventDTO[];
      try {
        events = await provider.getEventsSince(since);
      } catch (err) {
        // One line, not a stack: this runs every minute against a server
        // that may simply be down, and a trace per poll buries everything
        // else in the log.
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`[ProviderEvents] ${provider.providerName} events unavailable: ${detail}`);
        return 'failed';
      }

      const fresh = this.takeFresh(provider.providerId, since, events);
      const wanted = fresh.filter(event => settings.kinds[event.kind]);
      if (wanted.length === 0) return 'nothing_new';

      this.deliver(provider, wanted, settings);
      return 'delivered';
    } finally {
      this.polling = false;
    }
  }

  /** Shows a sample through the destinations the settings have switched on. */
  public sendTest(): ProviderEventTestResultDTO {
    const settings = this.getSettings();
    const provider = this.deps.getActiveProvider();
    const providerName = provider?.providerName ?? 'SprintTicker';
    const toast = settings.showToasts
      ? this.deps.toasts.show(describeProviderEvent(TEST_EVENT))
      : false;
    const bar = settings.showOnBar && this.barAvailable();
    if (bar) {
      this.deps.bar!.show({ appName: providerName, ...describeProviderEventForBar(TEST_EVENT) }, provider?.providerId ?? 'test');
    }
    return { toast, bar };
  }

  /**
   * The events newer than the cursor and not seen before, oldest first; and
   * the cursor moved to the newest of them. Events of a kind the user
   * filtered out still move it: they were seen, just not wanted.
   */
  private takeFresh(providerId: string, since: string, events: ProviderEventDTO[]): ProviderEventDTO[] {
    const sinceMs = Date.parse(since);
    let newest = sinceMs;
    const fresh: Array<{ event: ProviderEventDTO; at: number }> = [];

    for (const event of events) {
      const at = Date.parse(event.occurredAtUtc);
      if (Number.isNaN(at) || at <= sinceMs) continue;
      newest = Math.max(newest, at);
      if (this.seen.has(event.id)) continue;
      this.remember(event.id);
      fresh.push({ event, at });
    }

    if (newest > sinceMs) this.writeCursor(providerId, new Date(newest).toISOString());
    return fresh.sort((a, b) => a.at - b.at).map(entry => entry.event);
  }

  private deliver(provider: ITaskProvider, events: ProviderEventDTO[], settings: ProviderEventSettingsDTO): void {
    const burst = events.length > MAX_INDIVIDUAL_PROVIDER_TOASTS;
    const summary = summarizeProviderEvents(events, provider.providerName);

    // Kinds and counts only: titles and names are other people's content,
    // and the console goes into the diagnostics bundle.
    console.log(`[ProviderEvents] ${provider.providerName}: ${describeCounts(events)}`);

    if (settings.showToasts) {
      if (burst) {
        this.deps.toasts.show({ ...summary, url: provider.getEventsInboxUrl?.() ?? undefined });
      } else {
        for (const event of events) {
          this.deps.toasts.show({ ...describeProviderEvent(event), url: event.url });
        }
      }
    }

    // One banner per poll whatever the count. Several in a row would each
    // replace the last before it could be read.
    if (settings.showOnBar && this.barAvailable()) {
      const text: ProviderEventText = events.length === 1
        ? describeProviderEventForBar(events[0])
        : { title: `${events.length} updates`, body: summary.body };
      this.deps.bar!.show({ appName: provider.providerName, ...text }, provider.providerId);
    }
  }

  private barAvailable(): boolean {
    return Boolean(this.deps.bar?.isEnabled());
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > PROVIDER_EVENT_SEEN_LIMIT) {
      // A Set iterates in insertion order, so this forgets the oldest.
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  private readCursors(): Record<string, string> {
    const stored = this.deps.settings.getSetting<Record<string, string> | null>(PROVIDER_EVENT_CURSORS_KEY, null);
    return stored && typeof stored === 'object' ? stored : {};
  }

  private writeCursor(providerId: string, value: string): void {
    this.deps.settings.setSetting(PROVIDER_EVENT_CURSORS_KEY, { ...this.readCursors(), [providerId]: value });
  }
}

function describeCounts(events: readonly ProviderEventDTO[]): string {
  const counts = new Map<ProviderEventKind, number>();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${count} ${kind}`).join(', ');
}
