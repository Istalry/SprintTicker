import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { PriorityRule } from '../src/shared/dtos';

describe('PriorityPreemptionEngine Unit Tests', () => {
  let mockSettingsRepo: { getSetting: ReturnType<typeof vi.fn>; setSetting: ReturnType<typeof vi.fn> };
  let engine: PriorityPreemptionEngine;

  beforeEach(() => {
    mockSettingsRepo = {
      getSetting: vi.fn().mockReturnValue(null),
      setSetting: vi.fn()
    };
    engine = new PriorityPreemptionEngine(mockSettingsRepo as unknown as SettingsRepository);
  });

  it('Constructor_NullSettingsRepo_ThrowsArgumentNullException', () => {
    // Act & Assert
    expect(() => new PriorityPreemptionEngine(null as unknown as SettingsRepository)).toThrowError(
      'Argument cannot be null or undefined: settingsRepo'
    );
  });

  it('GetUserMode_DefaultState_ReturnsWorkMode', () => {
    // Act & Assert
    expect(engine.getUserMode()).toBe('WORK');
  });

  it('SetUserMode_ValidMode_UpdatesModeState', () => {
    // Act
    engine.setUserMode('LUNCH');

    // Assert
    expect(engine.getUserMode()).toBe('LUNCH');
  });

  it('EvaluateRequest_HigherPriorityOverActiveLock_PreemptsAndReturnsShouldRenderTrue', () => {
    // Act - First request grants lock (Priority 80)
    const firstRes = engine.evaluateRequest('unityCompilingPriority', 80);
    expect(firstRes.shouldRender).toBe(true);

    // Act - Second request with higher priority (Priority 100) preempts
    const secondRes = engine.evaluateRequest('unityBuildFailurePriority', 100);

    // Assert
    expect(secondRes.shouldRender).toBe(true);
    expect(secondRes.evaluatedPriority).toBe(100);
  });

  it('EvaluateRequest_LowerPriorityUnderActiveLock_QueuesNotificationIfConfigured', () => {
    // Arrange
    const renderCb = vi.fn();

    // Act - Grant high priority lock
    engine.evaluateRequest('unityBuildFailurePriority', 100);

    // Lower priority request with QUEUE action
    const lowerRes = engine.evaluateRequest('standupPromptPriority', 70, renderCb);

    // Assert
    expect(lowerRes.shouldRender).toBe(false);
    expect(renderCb).not.toHaveBeenCalled();
  });

  it('EvaluateRequest_LunchModeMessagingAlert_SuppressesNotification', () => {
    // Arrange
    engine.setUserMode('LUNCH');

    // Act
    const res = engine.evaluateRequest('messagingPriority');

    // Assert
    expect(res.shouldRender).toBe(false);
    expect(res.action).toBe('SUPPRESS');
  });

  it('ReleaseActiveLock_LockHeld_ClearsLockAndDrainsQueue', () => {
    // Arrange
    const queuedCb = vi.fn();
    engine.evaluateRequest('unityBuildFailurePriority', 100);
    engine.evaluateRequest('standupPromptPriority', 70, queuedCb);

    // Act
    engine.releaseActiveLock('unityBuildFailurePriority');

    // Assert
    expect(queuedCb).toHaveBeenCalledTimes(1);
  });

  it('SaveRules_ValidArray_PersistsToSettingsRepo', () => {
    // Arrange
    const customRules: PriorityRule[] = [
      { id: 'custom', eventName: 'customEvent', priority: 95, actionOnWork: 'DISPLAY', actionOnLunch: 'SUPPRESS', actionOnAway: 'SUPPRESS' }
    ];

    // Act
    engine.saveRules(customRules);

    // Assert
    expect(mockSettingsRepo.setSetting).toHaveBeenCalledWith('priority_rules', { rules: customRules });
  });

  it('DismissNotification_ActiveNotificationPresent_DismissesAndReturnsTrue', () => {
    // Arrange
    engine.evaluateRequest('messagingPriority');
    expect(engine.hasActiveNotification()).toBe(true);

    // Act
    const result = engine.dismissNotification();

    // Assert
    expect(result).toBe(true);
    expect(engine.hasActiveNotification()).toBe(false);
  });

  it('EvaluateRequest_SameNotificationRaisedTwiceUnderDifferentNames_IsRefusedBySelf', () => {
    // This is why one notification must produce exactly one evaluation. The
    // listener raised a high-priority alert correctly at 70; the banner then
    // re-derived `messagingPriority` and raised it again at 65, which the lock
    // the first call had just taken refused. The alert never drew, and the
    // release timer lived inside the render that never ran, so the lock stayed.
    const first = engine.evaluateRequest('highNotificationPriority');
    const second = engine.evaluateRequest('messagingPriority', undefined, () => undefined);

    expect(first.shouldRender).toBe(true);
    expect(second.shouldRender).toBe(false);
    expect(engine.getActiveLockEventName()).toBe('highNotificationPriority');
  });

  it('GetEventPriority_KnownEvent_ReadsTheRuleWithoutTakingTheLock', () => {
    // The banner needs the number for its rear-panel text. Asking through
    // `evaluateRequest` is what caused the second acquisition above.
    const priority = engine.getEventPriority('highNotificationPriority');

    expect(priority).toBe(70);
    expect(engine.getActiveLockEventName()).toBeNull();
  });

  it('GetEventPriority_UnknownEvent_FallsBackToTheDefault', () => {
    expect(engine.getEventPriority('menuPriority')).toBe(50);
  });
});

/**
 * The engine's rules as behaviour. Each test states what the display must do,
 * with the matrix spelled out in the test rather than borrowed from the
 * shipped defaults -- the ranking is the user's configuration (CLAUDE.md §5),
 * so a test that leaned on today's defaults would pin a choice, not a rule.
 */
describe('PriorityPreemptionEngine behaviour', () => {
  type Actions = Pick<PriorityRule, 'actionOnWork' | 'actionOnLunch' | 'actionOnAway'>;
  const rule = (eventName: string, priority: number, actions: Partial<Actions> = {}): PriorityRule => ({
    id: eventName,
    eventName,
    priority,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'SUPPRESS',
    ...actions
  });

  const engineWith = (stored: unknown) => {
    const repo = { getSetting: vi.fn().mockReturnValue(stored), setSetting: vi.fn() };
    return new PriorityPreemptionEngine(repo as unknown as SettingsRepository);
  };

  const MATRIX = {
    rules: [
      rule('lunchModePriority', 90, { actionOnLunch: 'DISPLAY' }),
      rule('highNotificationPriority', 70, { actionOnLunch: 'QUEUE' }),
      rule('messagingPriority', 65),
      rule('unityCompilingPriority', 60)
    ]
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('user mode', () => {
    it('SetUserMode_Empty_Throws', () => {
      expect(() => engineWith(MATRIX).setUserMode('' as never)).toThrow('mode');
    });

    it('SetUserMode_BackToWork_ReleasesTheBreakAndReplaysWhatWaited', () => {
      // Lunch holds the display; an alert the matrix queues during lunch must
      // come out when work resumes, not be lost with the lunch screen.
      const engine = engineWith(MATRIX);
      engine.setUserMode('LUNCH');
      engine.evaluateRequest('lunchModePriority');
      const replay = vi.fn();
      const queued = engine.evaluateRequest('highNotificationPriority', undefined, replay);

      engine.setUserMode('WORK');

      expect(queued.action).toBe('QUEUE');
      expect(replay).toHaveBeenCalledTimes(1);
      expect(engine.getActiveLockEventName()).toBe('highNotificationPriority');
    });

    it('SetUserMode_BackToWork_LeavesANonBreakLockAlone', () => {
      const engine = engineWith(MATRIX);
      engine.evaluateRequest('unityCompilingPriority');

      engine.setUserMode('WORK');

      expect(engine.getActiveLockEventName()).toBe('unityCompilingPriority');
    });

    it('OnUserModeChanged_RealChangeOnly_NotifiesOnce', () => {
      const engine = engineWith(MATRIX);
      const listener = vi.fn();
      engine.onUserModeChanged(listener);

      engine.setUserMode('AWAY');
      engine.setUserMode('AWAY');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('AWAY');
    });

    it('OnUserModeChanged_Unsubscribed_HearsNothingMore', () => {
      const engine = engineWith(MATRIX);
      const listener = vi.fn();
      const unsubscribe = engine.onUserModeChanged(listener);

      unsubscribe();
      engine.setUserMode('LUNCH');

      expect(listener).not.toHaveBeenCalled();
    });

    it('OnUserModeChanged_NotAFunction_IsIgnored', () => {
      const engine = engineWith(MATRIX);
      engine.onUserModeChanged('nope' as never);

      expect(() => engine.setUserMode('LUNCH')).not.toThrow();
    });
  });

  describe('stored rules', () => {
    it('GetRules_LegacyFlatScores_AppliesThemToTheDefaults', () => {
      // Before the matrix, only numbers were stored, keyed by event name.
      const rules = engineWith({ messagingPriority: 42, highNotificationPriority: 'high' }).getRules();

      expect(rules.find(r => r.eventName === 'messagingPriority')?.priority).toBe(42);
      expect(rules.find(r => r.eventName === 'highNotificationPriority')?.priority).toBe(70);
    });

    it('GetRules_StoredBeforeAnEventExisted_GainsItsDefaultRule', () => {
      const rules = engineWith({ rules: [rule('messagingPriority', 10)] }).getRules();

      expect(rules.find(r => r.eventName === 'messagingPriority')?.priority).toBe(10);
      expect(rules.some(r => r.eventName === 'activeTrackerPriority')).toBe(true);
    });

    it('GetRules_ObsoleteBreakPrompt_IsDropped', () => {
      const rules = engineWith({ rules: [rule('breakPromptPriority', 80)] }).getRules();

      expect(rules.some(r => r.eventName === 'breakPromptPriority')).toBe(false);
    });

    it('SaveRules_NotAnArray_Throws', () => {
      expect(() => engineWith(null).saveRules(null as never)).toThrow('rules must be a valid array');
    });

    it('EvaluateRequest_RuleStoredWithoutModeActions_DisplaysAtWorkAndSuppressesOnBreaks', () => {
      // Rules written before the per-mode actions existed have none of them.
      const legacy = { rules: [{ id: 'messagingPriority', eventName: 'messagingPriority', priority: 65 }] };
      const engine = engineWith(legacy);

      expect(engine.evaluateRequest('messagingPriority').action).toBe('DISPLAY');
      engine.releaseActiveLock('messagingPriority');
      engine.setUserMode('LUNCH');
      expect(engine.evaluateRequest('messagingPriority').action).toBe('SUPPRESS');
      engine.setUserMode('AWAY');
      expect(engine.evaluateRequest('messagingPriority').action).toBe('SUPPRESS');
    });
  });

  describe('evaluation', () => {
    it('EvaluateRequest_EmptyEventName_Throws', () => {
      expect(() => engineWith(MATRIX).evaluateRequest('')).toThrow('eventName');
    });

    it('GetEventPriority_EmptyEventName_Throws', () => {
      expect(() => engineWith(MATRIX).getEventPriority('')).toThrow('eventName');
    });

    it('EvaluateRequest_UnknownEvent_DisplaysAtTheDefaultPriority', () => {
      const result = engineWith(MATRIX).evaluateRequest('somethingNew');

      expect(result).toEqual({ shouldRender: true, action: 'DISPLAY', evaluatedPriority: 50 });
    });

    it('EvaluateRequest_ExplicitPriority_OverridesTheRule', () => {
      expect(engineWith(MATRIX).evaluateRequest('messagingPriority', 99).evaluatedPriority).toBe(99);
    });

    it('EvaluateRequest_QueuedWithoutCallback_LeavesNothingToReplay', () => {
      // A caller that repeats itself -- the session tracker -- passes no
      // callback so it is not replayed; it must not take the display either.
      const engine = engineWith(MATRIX);
      engine.setUserMode('LUNCH');

      const result = engine.evaluateRequest('highNotificationPriority');
      engine.setUserMode('WORK');

      expect(result.shouldRender).toBe(false);
      expect(engine.getActiveLockEventName()).toBeNull();
    });

    it('EvaluateRequest_OutrankedWithoutCallback_IsNotReplayed', () => {
      const engine = engineWith(MATRIX);
      engine.evaluateRequest('highNotificationPriority');

      const result = engine.evaluateRequest('unityCompilingPriority');
      engine.releaseActiveLock('highNotificationPriority');

      expect(result.shouldRender).toBe(false);
      expect(engine.getActiveLockEventName()).toBeNull();
    });

    it('EvaluateRequest_EqualPriority_TakesTheDisplay', () => {
      const engine = engineWith(MATRIX);
      engine.evaluateRequest('messagingPriority');

      expect(engine.evaluateRequest('unityCompilingPriority', 65).shouldRender).toBe(true);
    });
  });

  describe('lock release', () => {
    it('ReleaseActiveLock_SomeoneElsesName_KeepsTheLock', () => {
      const engine = engineWith(MATRIX);
      engine.evaluateRequest('highNotificationPriority');

      engine.releaseActiveLock('messagingPriority');

      expect(engine.getActiveLockEventName()).toBe('highNotificationPriority');
    });

    it('ReleaseActiveLock_NothingWaiting_HandsTheDisplayBackToTheMode', () => {
      const engine = engineWith(MATRIX);
      const renderer = { setContextMode: vi.fn() };
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('unityCompilingPriority');
      engine.setUserMode('AWAY');

      engine.releaseActiveLock('unityCompilingPriority');

      expect(renderer.setContextMode).toHaveBeenCalledWith('AWAY');
    });

    it('ReleaseActiveLock_SomethingWaiting_ReplaysItInsteadOfTheMode', () => {
      // With exactly one alert waiting, the mode used to be restored straight
      // over the replay -- idle, that restore is a clearDisplay.
      const engine = engineWith(MATRIX);
      const renderer = { setContextMode: vi.fn() };
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('highNotificationPriority');
      const replay = vi.fn();
      engine.evaluateRequest('messagingPriority', undefined, replay);

      engine.releaseActiveLock('highNotificationPriority');

      expect(replay).toHaveBeenCalledTimes(1);
      expect(renderer.setContextMode).not.toHaveBeenCalled();
    });

    it('DismissNotification_Ceremony_StaysUnlessForced', () => {
      // A stand-up prompt waits for an answer; a stray dismiss must not eat it.
      const engine = engineWith(null);
      engine.evaluateRequest('standupPromptPriority');

      expect(engine.dismissNotification()).toBe(false);
      expect(engine.getActiveLockEventName()).toBe('standupPromptPriority');
      expect(engine.dismissNotification(true)).toBe(true);
      expect(engine.getActiveLockEventName()).toBeNull();
    });

    it('DismissNotification_NothingShowing_ReturnsFalse', () => {
      const engine = engineWith(MATRIX);
      engine.evaluateRequest('unityCompilingPriority');

      expect(engine.dismissNotification()).toBe(false);
      expect(engine.getActiveLockEventName()).toBe('unityCompilingPriority');
    });
  });

  describe('hand-back options', () => {
    it('ReleaseActiveLock_HandBackFalse_LeavesTheModeToTheCaller', () => {
      // The idle screen giving up the tracker's lock is itself what handing
      // back would draw: a second render would be a second clear.
      const engine = engineWith(MATRIX);
      const renderer = { setContextMode: vi.fn() };
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('activeTrackerPriority', 45);

      engine.releaseActiveLock('activeTrackerPriority', { handBack: false });

      expect(engine.getActiveLockEventName()).toBeNull();
      expect(renderer.setContextMode).not.toHaveBeenCalled();
    });
  });

  describe('preempted screens', () => {
    const rendererThatResumes = (answer = true) => ({ setContextMode: vi.fn(), resumeScreen: vi.fn(() => answer) });

    it('ReleaseActiveLock_PreemptedScreenStillGoing_ResumesItInsteadOfTheMode', () => {
      // A build under a banner: the banner's end used to go to the idle
      // clock with the build still running and its lock gone.
      const engine = engineWith(MATRIX);
      const renderer = rendererThatResumes();
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('unityCompilingPriority');
      engine.evaluateRequest('highNotificationPriority');

      engine.releaseActiveLock('highNotificationPriority');

      expect(renderer.resumeScreen).toHaveBeenCalledWith('unityCompilingPriority');
      expect(engine.getActiveLockEventName()).toBe('unityCompilingPriority');
      expect(renderer.setContextMode).not.toHaveBeenCalled();
    });

    it('ReleaseActiveLock_PreemptedScreenEndedWhileCovered_DoesNotComeBack', () => {
      const engine = engineWith(MATRIX);
      const renderer = rendererThatResumes();
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('unityCompilingPriority');
      engine.evaluateRequest('highNotificationPriority');

      engine.releaseActiveLock('unityCompilingPriority');
      engine.releaseActiveLock('highNotificationPriority');

      expect(renderer.resumeScreen).not.toHaveBeenCalled();
      expect(renderer.setContextMode).toHaveBeenCalledTimes(1);
      expect(engine.getActiveLockEventName()).toBeNull();
    });

    it('ReleaseActiveLock_RendererCannotRedrawIt_HandsBackToTheMode', () => {
      const engine = engineWith(MATRIX);
      const renderer = rendererThatResumes(false);
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('unityCompilingPriority');
      engine.evaluateRequest('highNotificationPriority');

      engine.releaseActiveLock('highNotificationPriority');

      expect(engine.getActiveLockEventName()).toBeNull();
      expect(renderer.setContextMode).toHaveBeenCalledTimes(1);
    });

    it('ReleaseActiveLock_SeveralSetAside_ResumesTheMostImportantFirst', () => {
      const engine = engineWith(MATRIX);
      const renderer = rendererThatResumes();
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('unityCompilingPriority');
      engine.evaluateRequest('messagingPriority');
      engine.evaluateRequest('highNotificationPriority');

      engine.releaseActiveLock('highNotificationPriority');
      expect(engine.getActiveLockEventName()).toBe('messagingPriority');
      engine.releaseActiveLock('messagingPriority');
      expect(engine.getActiveLockEventName()).toBe('unityCompilingPriority');
    });

    it('ReleaseActiveLock_TrackerWasCovered_LeavesItToTheMode', () => {
      // The tracker is the mode's own screen: setContextMode draws it, with
      // the session as it is now rather than as it was when covered.
      const engine = engineWith(MATRIX);
      const renderer = rendererThatResumes();
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('activeTrackerPriority', 45);
      engine.evaluateRequest('messagingPriority');

      engine.releaseActiveLock('messagingPriority');

      expect(renderer.resumeScreen).not.toHaveBeenCalled();
      expect(renderer.setContextMode).toHaveBeenCalledWith('WORK');
    });

    it('ReleaseActiveLock_AQueuedAlertWaits_ReplaysItBeforeAnyResume', () => {
      const engine = engineWith(MATRIX);
      const renderer = rendererThatResumes();
      engine.setRenderer(renderer as never);
      engine.evaluateRequest('unityCompilingPriority');
      engine.evaluateRequest('highNotificationPriority');
      const replay = vi.fn();
      engine.evaluateRequest('messagingPriority', undefined, replay);

      engine.releaseActiveLock('highNotificationPriority');

      expect(replay).toHaveBeenCalledTimes(1);
      expect(renderer.resumeScreen).not.toHaveBeenCalled();
      engine.releaseActiveLock('messagingPriority');
      expect(renderer.resumeScreen).toHaveBeenCalledWith('unityCompilingPriority');
    });
  });

  describe('background screens', () => {
    it('ReleaseActiveLock_BackgroundStateRegistered_OffersItTheDisplayBeforeTheMode', () => {
      const engine = engineWith(MATRIX);
      const renderer = { setContextMode: vi.fn(), resumeScreen: vi.fn(() => true) };
      engine.setRenderer(renderer as never);
      const reclaim = vi.fn(() => { engine.evaluateRequest('unityCompilingPriority'); });
      engine.addBackgroundScreen(['unityCompilingPriority'], reclaim);
      engine.evaluateRequest('unityCompilingPriority');
      engine.evaluateRequest('highNotificationPriority');

      engine.releaseActiveLock('highNotificationPriority');

      // Reclaimed as it is now, never resumed as it was: not set aside.
      expect(renderer.resumeScreen).not.toHaveBeenCalled();
      expect(reclaim).toHaveBeenCalledTimes(1);
      expect(engine.getActiveLockEventName()).toBe('unityCompilingPriority');
      expect(renderer.setContextMode).not.toHaveBeenCalled();
    });

    it('ReleaseActiveLock_BackgroundHasNothingToShow_HandsBackToTheMode', () => {
      const engine = engineWith(MATRIX);
      const renderer = { setContextMode: vi.fn() };
      engine.setRenderer(renderer as never);
      const reclaim = vi.fn();
      engine.addBackgroundScreen(['unityCompilingPriority'], reclaim);
      engine.evaluateRequest('messagingPriority');

      engine.releaseActiveLock('messagingPriority');

      expect(reclaim).toHaveBeenCalledTimes(1);
      expect(renderer.setContextMode).toHaveBeenCalledTimes(1);
    });

    it('AddBackgroundScreen_Unregistered_IsNoLongerOffered', () => {
      const engine = engineWith(MATRIX);
      const reclaim = vi.fn();
      const unregister = engine.addBackgroundScreen(['unityCompilingPriority'], reclaim);
      unregister();
      engine.evaluateRequest('messagingPriority');

      engine.releaseActiveLock('messagingPriority');

      expect(reclaim).not.toHaveBeenCalled();
    });

    it('AddBackgroundScreen_NoLocksOrNoReclaim_Throws', () => {
      const engine = engineWith(MATRIX);
      expect(() => engine.addBackgroundScreen([], vi.fn())).toThrow();
      expect(() => engine.addBackgroundScreen(['x'], null as unknown as () => void)).toThrow();
    });
  });

  describe('replay queue', () => {
    const queueBehindLunch = (engine: PriorityPreemptionEngine, order: string[], name: string, priority: number) =>
      engine.evaluateRequest(name, priority, () => order.push(name));

    it('DrainQueue_SeveralWaiting_ReplaysTheHighestFirstThenTheOldest', () => {
      vi.useFakeTimers();
      const engine = engineWith(MATRIX);
      const order: string[] = [];
      engine.evaluateRequest('lunchModePriority', 100);
      queueBehindLunch(engine, order, 'olderLow', 40);
      vi.advanceTimersByTime(10);
      queueBehindLunch(engine, order, 'high', 80);
      vi.advanceTimersByTime(10);
      queueBehindLunch(engine, order, 'newerLow', 40);

      engine.releaseActiveLock('lunchModePriority');
      engine.releaseActiveLock('high');
      engine.releaseActiveLock('olderLow');

      expect(order).toEqual(['high', 'olderLow', 'newerLow']);
    });

    it('DrainQueue_AlertOlderThanAMinute_IsDropped', () => {
      // A notification replayed long after it arrived is noise, not news.
      vi.useFakeTimers();
      const engine = engineWith(MATRIX);
      const order: string[] = [];
      engine.evaluateRequest('lunchModePriority', 100);
      queueBehindLunch(engine, order, 'stale', 60);

      vi.advanceTimersByTime(60_000);
      engine.releaseActiveLock('lunchModePriority');

      expect(order).toEqual([]);
      expect(engine.getActiveLockEventName()).toBeNull();
    });

    it('DrainQueue_MoreThanTwentyWaiting_DropsTheOldest', () => {
      vi.useFakeTimers();
      const engine = engineWith(MATRIX);
      const order: string[] = [];
      engine.evaluateRequest('lunchModePriority', 100);
      for (let i = 0; i < 21; i++) {
        queueBehindLunch(engine, order, `alert${i}`, 40);
        vi.advanceTimersByTime(1);
      }

      engine.releaseActiveLock('lunchModePriority');
      for (let i = 0; i < 21; i++) engine.releaseActiveLock(`alert${i}`);

      expect(order).toHaveLength(20);
      expect(order[0]).toBe('alert1');
    });
  });
});
