import { PriorityRule, PriorityMatrixConfig, UserMode, PriorityAction } from '../../shared/dtos';
import { SettingsRepository } from '../db/repositories/settings-repository';

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
 * Abstraction for the Priority Preemption Engine service.
 */
export interface IPriorityPreemptionEngine {
  getUserMode(): UserMode;
  setUserMode(mode: UserMode): void;
  getRules(): PriorityRule[];
  saveRules(rules: PriorityRule[]): void;
  evaluateRequest(eventName: string, requestedPriority?: number, renderCallback?: () => void): PreemptionEvaluationResult;
  releaseActiveLock(eventName: string): void;
  drainQueue(): void;
  hasActiveNotification(): boolean;
  dismissNotification(): boolean;
}

/**
 * Service that evaluates incoming display events against a priority preemption matrix,
 * manages context-aware mode suppression (Work, Lunch, Away), and replays non-expired queued alerts.
 */
export class PriorityPreemptionEngine implements IPriorityPreemptionEngine {
  private static readonly DEFAULT_QUEUE_EXPIRATION_MS = 60000; // 60 seconds TTL for queued alerts
  private static readonly DB_SETTINGS_KEY = 'priority_rules';

  private readonly _settingsRepo: SettingsRepository;
  private _userMode: UserMode = 'WORK';
  private _activeLockEventName: string | null = null;
  private _activeLockPriority = 0;
  private _notificationQueue: QueuedNotificationRequest[] = [];

  private static readonly DEFAULT_RULES: PriorityRule[] = [
    {
      id: 'unity_exception',
      eventName: 'unityBuildFailurePriority',
      priority: 100,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'DISPLAY',
      actionOnAway: 'DISPLAY'
    },
    {
      id: 'high_notification',
      eventName: 'highNotificationPriority',
      priority: 95,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'DISPLAY',
      actionOnAway: 'DISPLAY'
    },
    {
      id: 'unity_playmode',
      eventName: 'unityPlayModePriority',
      priority: 90,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'SUPPRESS',
      actionOnAway: 'DISPLAY'
    },
    {
      id: 'unity_compiling',
      eventName: 'unityCompilingPriority',
      priority: 80,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'SUPPRESS',
      actionOnAway: 'SUPPRESS'
    },
    {
      id: 'away_mode',
      eventName: 'awayModePriority',
      priority: 75,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'SUPPRESS',
      actionOnAway: 'DISPLAY'
    },
    {
      id: 'standup_prompt',
      eventName: 'standupPromptPriority',
      priority: 70,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'QUEUE',
      actionOnAway: 'QUEUE'
    },
    {
      id: 'lunch_mode',
      eventName: 'lunchModePriority',
      priority: 65,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'DISPLAY',
      actionOnAway: 'SUPPRESS'
    },
    {
      id: 'messaging_alert',
      eventName: 'messagingPriority',
      priority: 40,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'SUPPRESS',
      actionOnAway: 'SUPPRESS'
    },
    {
      id: 'active_tracker',
      eventName: 'activeTrackerPriority',
      priority: 20,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'DISPLAY',
      actionOnAway: 'DISPLAY'
    }
  ];

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
    let loadedRules: PriorityRule[] = [];

    if (!raw) {
      loadedRules = PriorityPreemptionEngine.DEFAULT_RULES;
    } else if (Array.isArray(raw.rules)) {
      loadedRules = raw.rules as PriorityRule[];
    } else {
      loadedRules = PriorityPreemptionEngine.DEFAULT_RULES.map(rule => {
        const score = typeof raw[rule.eventName] === 'number' ? raw[rule.eventName] : rule.priority;
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
    const priority = requestedPriority ?? matchedRule?.priority ?? 50;
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
  public releaseActiveLock(eventName: string): void {
    if (this._activeLockEventName === eventName) {
      this._activeLockEventName = null;
      this._activeLockPriority = 0;
      this.drainQueue();
      if (this._notificationQueue.length === 0 && this._renderer) {
        this._renderer.setContextMode(this._userMode);
      }
    }
  }

  /// <summary>
  /// Checks whether a notification alert is currently holding an active display lock.
  /// </summary>
  public hasActiveNotification(): boolean {
    return (
      this._activeLockEventName === 'messagingPriority' ||
      this._activeLockEventName === 'highNotificationPriority'
    );
  }

  /// <summary>
  /// Dismisses any active notification alert, restoring background display context.
  /// Returns true if a notification was active and dismissed.
  /// </summary>
  public dismissNotification(): boolean {
    if (this.hasActiveNotification()) {
      const activeEvt = this._activeLockEventName!;
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
      id: `${eventName}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      eventName,
      priority,
      renderCallback,
      timestampMs: Date.now()
    };
    this._notificationQueue.push(item);
  }
}

class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}

class ArgumentException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentException';
  }
}
