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
      id: 'unity_compiling',
      eventName: 'unityCompilingPriority',
      priority: 80,
      actionOnWork: 'DISPLAY',
      actionOnLunch: 'SUPPRESS',
      actionOnAway: 'SUPPRESS'
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
    this._userMode = mode;
    if (mode === 'WORK') {
      this.drainQueue();
    }
  }

  /// <summary>
  /// Retrieves configured priority rules from SQLite repository or returns default preemption rules.
  /// </summary>
  public getRules(): PriorityRule[] {
    const raw = this._settingsRepo.getSetting<Record<string, unknown> | null>(PriorityPreemptionEngine.DB_SETTINGS_KEY, null);
    if (!raw) {
      return PriorityPreemptionEngine.DEFAULT_RULES;
    }
    if (Array.isArray(raw.rules)) {
      return raw.rules;
    }
    // Handle legacy Record<string, number> fallback
    return PriorityPreemptionEngine.DEFAULT_RULES.map(rule => {
      const score = typeof raw[rule.eventName] === 'number' ? raw[rule.eventName] : rule.priority;
      return { ...rule, priority: score };
    });
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

    if (this._activeLockEventName && priority < this._activeLockPriority) {
      if (action !== 'SUPPRESS' && renderCallback) {
        this.enqueueRequest(eventName, priority, renderCallback);
      }
      return { shouldRender: false, action, evaluatedPriority: priority };
    }

    // High priority preemption granted
    this._activeLockEventName = eventName;
    this._activeLockPriority = priority;
    return { shouldRender: true, action, evaluatedPriority: priority };
  }

  /// <summary>
  /// Releases the active display lock for the specified event name and attempts to replay any queued alerts.
  /// </summary>
  public releaseActiveLock(eventName: string): void {
    if (this._activeLockEventName === eventName) {
      this._activeLockEventName = null;
      this._activeLockPriority = 0;
      this.drainQueue();
    }
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
