import { describe, it, expect, beforeEach, vi } from 'vitest';
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
