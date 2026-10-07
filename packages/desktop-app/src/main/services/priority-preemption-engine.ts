import { PriorityRule, PriorityMatrixConfig, UserMode, PriorityAction, ArgumentNullException, ArgumentException } from '../../shared/dtos';
import { ACTIVE_TRACKER_EVENT, DEFAULT_PRIORITY_RULES } from '../../shared/priority-defaults';
import { SettingsRepository } from '../db/repositories/settings-repository';
import type { DisplayRenderer } from '../hardware/display-renderer';

/**
 * Encapsulates a queued display notification request waiting to be replayed.
 */
export interface QueuedNotificationRequest {
  id: string;
  eventName: string;
  priority: number;
  renderCallback: () => void;
  timestampMs: number;
}

/**
 * Result of evaluating an incoming display request against the priority preemption matrix.
 */
export interface PreemptionEvaluationResult {
  shouldRender: boolean;
  action: PriorityAction;
  evaluatedPriority: number;
}

/**
 * The two priority classes a notification can be raised under.
 *
 * `NotificationPriorityMode` on a source rule picks one of these; what each one
 * then does during Lunch and Away is the user's choice in the priority panel
 * (`actionOnWork` / `actionOnLunch` / `actionOnAway`). Nothing here decides
 * whether a given app is "important" -- that is configuration, not code.
 *
 * Named rather than derived: `renderNotificationBanner` used to recompute this
 * from a numeric threshold (`priority >= 90`), which no notification rule ever
 * meets. A high-priority alert was therefore raised twice -- once correctly at
 * 70, then again as `messagingPriority` at 65, which the first request's own
 * lock refused. The banner never drew and the lock was never released.
 */
export type NotificationEventName = 'highNotificationPriority' | 'messagingPriority';

export interface ReleaseOptions {
  /**
   * Whether freeing the lock hands the display back to the user's mode
   * (`setContextMode`). True by default. False for a caller that is itself
   * drawing what comes next -- the idle screen giving up the tracker's lock --
   * where handing back would render it a second time.
   */
  handBack?: boolean;
}

/**
 * Abstraction for the Priority Preemption Engine service.
 */
export interface IPriorityPreemptionEngine {
  getUserMode(): UserMode;
  setUserMode(mode: UserMode): void;
  getRules(): PriorityRule[];
  saveRules(rules: PriorityRule[]): void;
  evaluateRequest(eventName: string, requestedPriority?: number, renderCallback?: () => void): PreemptionEvaluationResult;
  releaseActiveLock(eventName: string, options?: ReleaseOptions): void;
  drainQueue(): void;
  hasActiveNotification(): boolean;
  dismissNotification(forceCeremonyDismissal?: boolean): boolean;
  getActiveLockEventName(): string | null;
  getEventPriority(eventName: string): number;
  addBackgroundScreen(eventNames: readonly string[], reclaim: () => void): () => void;
}

/**
 * Service that evaluates incoming display events against a priority preemption matrix,
 * manages context-aware mode suppression (Work, Lunch, Away), and replays non-expired queued alerts.
 */
export class PriorityPreemptionEngine implements IPriorityPreemptionEngine {
  private static readonly DEFAULT_QUEUE_EXPIRATION_MS = 60000; // 60 seconds TTL for queued alerts
  private static readonly DB_SETTINGS_KEY = 'priority_rules';
  /** Priority assumed for an event with no configured rule. */
  private static readonly DEFAULT_EVENT_PRIORITY = 50;
  /** Ceiling on replayable alerts; the oldest are dropped past this. */
  private static readonly MAX_QUEUED_REQUESTS = 20;
  /** Ceiling on screens set aside by a preemption; the oldest are dropped past this. */
  private static readonly MAX_SUSPENDED = 10;
  /**
   * Locks never set aside: the user's own screens, which `setContextMode`
   * draws whenever the display comes back to the mode.
   */
  private static readonly NOT_SUSPENDED = new Set([ACTIVE_TRACKER_EVENT, 'lunchModePriority', 'awayModePriority']);
  /**
   * Whoever owns a state that outlives any one event -- an editor compiling,
   * in Play Mode -- and redraws it whenever the display is free. Their locks
   * are not set aside on preemption: the screen to come back to is whatever
   * that state is by then, not what it was when it was covered.
   */
  private _background: Array<{ eventNames: ReadonlySet<string>; reclaim: () => void }> = [];

  private readonly _settingsRepo: SettingsRepository;
  private _userMode: UserMode = 'WORK';
  private _activeLockEventName: string | null = null;
  private _activeLockPriority = 0;
  private _notificationQueue: QueuedNotificationRequest[] = [];
  /**
   * Screens a higher priority took the display from, still going on beneath
   * it: a build under a banner, Play Mode under a stand-up prompt. The queue
   * replays requests that were *refused*; nothing used to remember a screen
   * that had been *preempted*, so when the banner ended the display went to
   * the idle clock with the build still running and its lock gone. Released
   * while hidden, a screen leaves this list; otherwise the release of what
   * covered it brings it back.
   */
  private _suspended: Array<{ eventName: string; priority: number }> = [];

  private static readonly DEFAULT_RULES: PriorityRule[] = DEFAULT_PRIORITY_RULES.map(rule => ({
    ...rule
  }));

  constructor(settingsRepo: SettingsRepository) {
    if (!settingsRepo) {
      throw new ArgumentNullException('settingsRepo');
    }
    this._settingsRepo = settingsRepo;
  }

  private _userModeChangeSubscribers: ((mode: UserMode) => void)[] = [];

  /// <summary>
  /// Subscribes a listener to user context mode transitions (e.g. WORK, LUNCH, AWAY).
  /// </summary>
  public onUserModeChanged(callback: (mode: UserMode) => void): () => void {
    if (typeof callback === 'function') {
      this._userModeChangeSubscribers.push(callback);
    }
    return () => {
      this._userModeChangeSubscribers = this._userModeChangeSubscribers.filter(cb => cb !== callback);
    };
  }

  /// <summary>
  /// Retrieves the current active user context mode (WORK, LUNCH, or AWAY).
  /// </summary>
  public getUserMode(): UserMode {
    return this._userMode;
  }

  /// <summary>
  /// Updates the active user context mode and drains pending non-expired queued alerts if returning to WORK mode.
  /// </summary>
  public setUserMode(mode: UserMode): void {
    if (!mode) {
      throw new ArgumentNullException('mode');
    }
    const previous = this._userMode;
    this._userMode = mode;
    if (mode === 'WORK') {
      if (this._activeLockEventName === 'awayModePriority' || this._activeLockEventName === 'lunchModePriority') {
        this.releaseActiveLock(this._activeLockEventName);
      }
      this.drainQueue();
    }
    if (previous !== mode) {
      this._userModeChangeSubscribers.forEach(cb => cb(mode));
    }
  }

  /// <summary>
  /// Retrieves configured priority rules from SQLite repository or returns default preemption rules.
  /// </summary>
  public getRules(): PriorityRule[] {
    const raw = this._settingsRepo.getSetting<Record<string, unknown> | null>(PriorityPreemptionEngine.DB_SETTINGS_KEY, null);
    let loadedRules: PriorityRule[];

    if (!raw) {
      loadedRules = PriorityPreemptionEngine.DEFAULT_RULES;
    } else if (Array.isArray(raw.rules)) {
      loadedRules = raw.rules as PriorityRule[];
    } else {
      loadedRules = PriorityPreemptionEngine.DEFAULT_RULES.map(rule => {
        const stored = raw[rule.eventName];
        const score = typeof stored === 'number' ? stored : rule.priority;
        return { ...rule, priority: score };
      });
    }

    // Ensure all default rules are present and filter out obsolete breakPromptPriority
    const merged = [...loadedRules].filter(r => r.eventName !== 'breakPromptPriority' && r.id !== 'break_prompt');
    PriorityPreemptionEngine.DEFAULT_RULES.forEach(defaultRule => {
      if (!merged.some(r => r.eventName === defaultRule.eventName || r.id === defaultRule.id)) {
        merged.push(defaultRule);
      }
    });

    return merged;
  }

  /// <summary>
  /// Persists updated priority matrix rules to SQLite storage.
  /// </summary>
  public saveRules(rules: PriorityRule[]): void {
    if (!rules || !Array.isArray(rules)) {
      throw new ArgumentException('rules must be a valid array of PriorityRule objects.');
    }
    const config: PriorityMatrixConfig = { rules };
    this._settingsRepo.setSetting(PriorityPreemptionEngine.DB_SETTINGS_KEY, config);
  }

  /// <summary>
  /// Evaluates an incoming display event request against the active priority lock and user mode rules.
  /// </summary>
  public evaluateRequest(
    eventName: string,
    requestedPriority?: number,
    renderCallback?: () => void
  ): PreemptionEvaluationResult {
    if (!eventName) {
      throw new ArgumentNullException('eventName');
    }

    const rules = this.getRules();
    const matchedRule = rules.find(r => r.eventName === eventName || r.id === eventName);
    const priority =
      requestedPriority ?? matchedRule?.priority ?? PriorityPreemptionEngine.DEFAULT_EVENT_PRIORITY;
    const action = this.resolveModeAction(matchedRule);

    if (action === 'SUPPRESS') {
      return { shouldRender: false, action: 'SUPPRESS', evaluatedPriority: priority };
    }

    if (action === 'QUEUE') {
      if (renderCallback) {
        this.enqueueRequest(eventName, priority, renderCallback);
      }
      return { shouldRender: false, action: 'QUEUE', evaluatedPriority: priority };
    }

    if (this._activeLockEventName && priority < this._activeLockPriority) {
      if (renderCallback) {
        this.enqueueRequest(eventName, priority, renderCallback);
      }
      return { shouldRender: false, action, evaluatedPriority: priority };
    }

    // High priority preemption granted
    this.suspendActiveFor(eventName);
    this._activeLockEventName = eventName;
    this._activeLockPriority = priority;
    return { shouldRender: true, action, evaluatedPriority: priority };
  }

  private _renderer?: DisplayRenderer;

  public setRenderer(renderer: DisplayRenderer): void {
    this._renderer = renderer;
  }

  /// <summary>
  /// Releases the active display lock for the specified event name and attempts to replay any queued alerts.
  /// </summary>
  public releaseActiveLock(eventName: string, options: ReleaseOptions = {}): void {
    if (this._activeLockEventName !== eventName) {
      // A screen that ended while something covered it: nothing to bring back.
      this._suspended = this._suspended.filter(entry => entry.eventName !== eventName);
      return;
    }
    this._activeLockEventName = null;
    this._activeLockPriority = 0;
    this.drainQueue();
    if (this._activeLockEventName === null) this.resumeSuspended();
    if (this._activeLockEventName === null) this.offerToBackground();
    // Hand the display back to the mode only if no queued alert, set-aside
    // screen or background state took it.
    // This used to test the queue's length, but drainQueue removes the alert
    // it replays: with one alert waiting, the queue was empty by the time of
    // the test, so the alert drew and the mode was restored over it in the
    // same call. Idle with the firmware clock enabled, that restore is a
    // clearDisplay, which wiped the replayed alert the instant it appeared.
    if (this._activeLockEventName === null && this._renderer && options.handBack !== false) {
      this._renderer.setContextMode(this._userMode);
    }
  }

  /// <summary>
  /// Retrieves the event name of the currently active display priority lock, or null if none.
  /// </summary>
  public getActiveLockEventName(): string | null {
    return this._activeLockEventName;
  }

  /// <summary>
  /// Reads the configured priority of an event without acquiring the display lock.
  /// </summary>
  /// <remarks>
  /// Callers that need the number for display purposes -- the rear-panel preview
  /// text, for instance -- must use this rather than `evaluateRequest`, which has
  /// the side effect of taking the lock. Two evaluations for one notification is
  /// how the banner ended up holding a lock it never released.
  /// </remarks>
  public getEventPriority(eventName: string): number {
    if (!eventName) {
      throw new ArgumentNullException('eventName');
    }
    const matchedRule = this.getRules().find(r => r.eventName === eventName || r.id === eventName);
    return matchedRule?.priority ?? PriorityPreemptionEngine.DEFAULT_EVENT_PRIORITY;
  }

  /// <summary>
  /// Checks whether a notification alert is currently holding an active display lock.
  /// </summary>
  public hasActiveNotification(): boolean {
    return (
      this._activeLockEventName === 'messagingPriority' ||
      this._activeLockEventName === 'highNotificationPriority' ||
      this._activeLockEventName === 'standupPromptPriority' ||
      this._activeLockEventName === 'eodWrapUpPriority'
    );
  }

  /// <summary>
  /// Dismisses any active notification alert, restoring background display context.
  /// Returns true if a notification was active and dismissed.
  /// </summary>
  public dismissNotification(forceCeremonyDismissal: boolean = false): boolean {
    if (this.hasActiveNotification()) {
      const activeEvt = this._activeLockEventName!;
      if (!forceCeremonyDismissal && (activeEvt === 'standupPromptPriority' || activeEvt === 'eodWrapUpPriority')) {
        return false;
      }
      this.releaseActiveLock(activeEvt);
      return true;
    }
    return false;
  }

  /// <summary>
  /// Replays non-expired queued alerts in order of highest priority and freshness.
  /// </summary>
  public drainQueue(): void {
    const now = Date.now();
    // Prune expired notifications (>60 seconds old)
    this._notificationQueue = this._notificationQueue.filter(
      item => now - item.timestampMs < PriorityPreemptionEngine.DEFAULT_QUEUE_EXPIRATION_MS
    );

    if (this._notificationQueue.length === 0 || this._activeLockEventName !== null) {
      return;
    }

    // Sort descending by priority, then ascending by timestamp
    this._notificationQueue.sort((a, b) => b.priority - a.priority || a.timestampMs - b.timestampMs);

    const nextItem = this._notificationQueue.shift();
    if (nextItem && typeof nextItem.renderCallback === 'function') {
      this._activeLockEventName = nextItem.eventName;
      this._activeLockPriority = nextItem.priority;
      nextItem.renderCallback();
    }
  }

  /// <summary>
  /// Registers a state that reclaims the display whenever it frees, under the
  /// given locks. `reclaim` takes it through `evaluateRequest` as any screen
  /// does, or leaves it alone. Returns the unregistration.
  /// </summary>
  public addBackgroundScreen(eventNames: readonly string[], reclaim: () => void): () => void {
    if (!eventNames || eventNames.length === 0) throw new ArgumentException('eventNames must name at least one lock.');
    if (!reclaim) throw new ArgumentNullException('reclaim');
    const entry = { eventNames: new Set(eventNames), reclaim };
    this._background.push(entry);
    return () => {
      this._background = this._background.filter(other => other !== entry);
    };
  }

  private offerToBackground(): void {
    for (const entry of [...this._background]) {
      entry.reclaim();
      if (this._activeLockEventName !== null) return;
    }
  }

  /** Sets the active holder aside when `eventName` takes the display from it. */
  private suspendActiveFor(eventName: string): void {
    const holder = this._activeLockEventName;
    if (holder === null || holder === eventName || PriorityPreemptionEngine.NOT_SUSPENDED.has(holder)) return;
    if (this._background.some(entry => entry.eventNames.has(holder))) return;
    this._suspended = this._suspended.filter(entry => entry.eventName !== holder && entry.eventName !== eventName);
    this._suspended.push({ eventName: holder, priority: this._activeLockPriority });
    while (this._suspended.length > PriorityPreemptionEngine.MAX_SUSPENDED) this._suspended.shift();
  }

  /**
   * Gives the free display back to the most important screen set aside, the
   * latest first among equals. One the renderer cannot redraw -- it never
   * drew one under that lock -- is dropped, and the next tried.
   */
  private resumeSuspended(): void {
    while (this._suspended.length > 0 && this._activeLockEventName === null) {
      let best = 0;
      for (let i = 1; i < this._suspended.length; i++) {
        if (this._suspended[i].priority >= this._suspended[best].priority) best = i;
      }
      const [entry] = this._suspended.splice(best, 1);
      this._activeLockEventName = entry.eventName;
      this._activeLockPriority = entry.priority;
      if (this._renderer?.resumeScreen?.(entry.eventName)) return;
      this._activeLockEventName = null;
      this._activeLockPriority = 0;
    }
  }

  private resolveModeAction(rule?: PriorityRule): PriorityAction {
    if (!rule) return 'DISPLAY';
    switch (this._userMode) {
      case 'LUNCH':
        return rule.actionOnLunch ?? 'SUPPRESS';
      case 'AWAY':
        return rule.actionOnAway ?? 'SUPPRESS';
      case 'WORK':
      default:
        return rule.actionOnWork ?? 'DISPLAY';
    }
  }

  private enqueueRequest(eventName: string, priority: number, renderCallback: () => void): void {
    const item: QueuedNotificationRequest = {
      // `slice`, not the deprecated `substr` (audit F-36). Note the second
      // argument changed meaning: substr(2, 4) took a length, slice(2, 6) takes
      // an end index. Both yield the same four characters.
      id: `${eventName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      eventName,
      priority,
      renderCallback,
      timestampMs: Date.now()
    };
    this._notificationQueue.push(item);

    // The queue exists to replay alerts that arrived while something more
    // important held the display, and alerts are rare. A caller that repeats --
    // the session tracker ticks once a second -- should pass `queueOnPreempt:
    // false` instead of relying on this, but an unbounded queue is a memory leak
    // waiting for the next such caller.
    while (this._notificationQueue.length > PriorityPreemptionEngine.MAX_QUEUED_REQUESTS) {
      this._notificationQueue.shift();
    }
  }
}
