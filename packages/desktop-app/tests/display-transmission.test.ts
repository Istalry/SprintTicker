import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { AnimationPlayer } from '../src/main/hardware/animation-player';
import { BusyBarDriver, DeviceRequestError } from '../src/main/hardware/busybar-driver';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ActiveSessionDTO } from '../src/shared/dtos';

/**
 * The front display is a rasterised 72x16 PNG, and every transmission is an
 * asset upload followed by a draw -- two HTTP requests. The tracker redrew once
 * a second, from two separate event handlers, with a seconds digit guaranteeing
 * a different frame each time. That is four requests a second, indefinitely, to
 * advance one character.
 */
describe('Display transmission volume', () => {
  let driver: BusyBarDriver;
  let renderer: DisplayRenderer;
  let engine: PriorityPreemptionEngine;

  function session(elapsedSeconds: number, status: ActiveSessionDTO['status'] = 'TRACKING'): ActiveSessionDTO {
    return {
      taskId: 'PROJ-1',
      taskKey: 'PROJ-1',
      taskTitle: 'Write the release notes',
      status,
      elapsedSeconds,
      startedAtUtc: new Date().toISOString()
    } as ActiveSessionDTO;
  }

  beforeEach(() => {
    driver = {
      sendDisplayPayload: vi.fn().mockResolvedValue('drawn'),
      sendPixelFrame: vi.fn().mockResolvedValue('sent'),
      clearDisplay: vi.fn().mockResolvedValue(undefined),
      uploadAsset: vi.fn().mockResolvedValue(undefined),
      getDeviceStatus: vi.fn(() => ({
        connected: true,
        ipAddress: '10.0.4.20',
        webSocketPingMs: 4,
        batteryPercent: 95,
        connectionType: 'usb'
      }))
    } as unknown as BusyBarDriver;

    const store = new Map<string, unknown>();
    const repo = {
      getSetting: vi.fn((key: string, fallback: unknown) => store.get(key) ?? fallback),
      setSetting: vi.fn((key: string, value: unknown) => store.set(key, value))
    } as unknown as SettingsRepository;

    engine = new PriorityPreemptionEngine(repo);
    renderer = new DisplayRenderer(driver);
    renderer.setPriorityEngine(engine);
  });

  it('RenderActiveSession_TicksWithinTheSameMinute_TransmitsOnce', () => {
    // 59 of every 60 ticks now produce a byte-identical frame.
    for (let second = 0; second < 45; second++) {
      renderer.renderActiveSession(session(second));
    }

    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(1);
  });

  it('RenderActiveSession_MinuteRollsOver_TransmitsAgain', () => {
    renderer.renderActiveSession(session(59));
    renderer.renderActiveSession(session(60));

    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(2);
  });

  it('RenderActiveSession_TaskChanges_TransmitsEvenWithinTheSameMinute', () => {
    renderer.renderActiveSession(session(10));
    const renamed = { ...session(11), taskTitle: 'Something else entirely' };
    renderer.renderActiveSession(renamed);

    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(2);
  });

  // The timer is rasterised into the 72x16 pixel canvas, not carried in any
  // payload field, so the observable difference between the two formats is
  // whether one second's worth of change alters the transmitted frame.
  it('RenderActiveSession_Paused_AlsoOmitsSeconds', () => {
    // Not for traffic -- the paused screen is static -- but because the timer
    // shares its row with the STOP/FINISH controls and has 26 pixels, which the
    // 3x5 font fills with six characters. `01:02:05` came out as `01:02:`.
    renderer.renderActiveSession(session(3725, 'PAUSED'));
    renderer.renderActiveSession(session(3726, 'PAUSED'));

    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(1);
  });

  it('RenderActiveSession_Tracking_DoesNotRedrawForASecondAlone', () => {
    renderer.renderActiveSession(session(3725));
    renderer.renderActiveSession(session(3726));

    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(1);
  });

  it('InvalidateFrameCache_AfterAnExternalChange_ForcesTheNextTransmission', () => {
    renderer.renderActiveSession(session(10));
    renderer.invalidateFrameCache();
    renderer.renderActiveSession(session(10));

    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(2);
  });

  it('RenderActiveSession_WhileANotificationHoldsTheDisplay_DoesNotOverwriteIt', () => {
    // The tracker was the one screen outside the priority engine, so the next
    // tick wiped any banner within a second of it appearing.
    renderer.renderNotificationBanner({ title: 'Ops', eventName: 'highNotificationPriority' });
    const callsAfterBanner = (driver.sendPixelFrame as ReturnType<typeof vi.fn>).mock.calls.length;

    renderer.renderActiveSession(session(120));

    expect((driver.sendPixelFrame as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterBanner);
    expect(engine.getActiveLockEventName()).toBe('highNotificationPriority');
  });

  it('RenderActiveSession_PreemptedRepeatedly_DoesNotAccumulateStaleFrames', () => {
    // A tracker frame held for the length of an alert is stale by the time it
    // would replay, so it must be dropped rather than queued.
    renderer.renderNotificationBanner({ title: 'Ops', eventName: 'highNotificationPriority' });
    for (let second = 0; second < 30; second++) {
      renderer.renderActiveSession(session(second));
    }

    const callsBeforeRelease = (driver.sendPixelFrame as ReturnType<typeof vi.fn>).mock.calls.length;
    engine.releaseActiveLock('highNotificationPriority');
    const drained =
      (driver.sendPixelFrame as ReturnType<typeof vi.fn>).mock.calls.length - callsBeforeRelease;

    // At most the single redraw that restoring the context mode performs.
    expect(drained).toBeLessThanOrEqual(1);
  });

  /**
   * Deduplication assumes the device shows the last frame recorded. When a
   * frame did not land, the next identical render has to go out again, or the
   * bar stays wrong until the picture changes -- up to a minute for the timer,
   * never for a static screen. The reset used to hang off a `.catch` on a call
   * that reported refusal by returning `false`, so it never ran.
   */
  describe('a frame that did not land', () => {
    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
    const sendPixelFrame = (): ReturnType<typeof vi.fn> => driver.sendPixelFrame as ReturnType<typeof vi.fn>;

    it('RenderActiveSession_DeviceRefusedTheFrame_RetransmitsTheSameFrame', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      sendPixelFrame().mockRejectedValueOnce(new DeviceRequestError('rejected', 'draw', 500));

      renderer.renderActiveSession(session(10));
      await settle();
      renderer.renderActiveSession(session(10));

      expect(sendPixelFrame()).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('RenderActiveSession_FrameSupersededMidUpload_RetransmitsTheSameFrame', async () => {
      sendPixelFrame().mockResolvedValueOnce('superseded');

      renderer.renderActiveSession(session(10));
      await settle();
      renderer.renderActiveSession(session(10));

      expect(sendPixelFrame()).toHaveBeenCalledTimes(2);
    });

    it('RenderActiveSession_DisplayHeldElsewhere_DoesNotResendEveryRender', async () => {
      // A 409 means another application owns the display. Forgetting the frame
      // would re-upload it on every render for as long as that lasts.
      sendPixelFrame().mockResolvedValue('conflict');

      renderer.renderActiveSession(session(10));
      await settle();
      renderer.renderActiveSession(session(10));

      expect(sendPixelFrame()).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * A finished scene stays on the panel under the next frame and is removed
   * only once that frame has landed. Removed any earlier, the panel empties,
   * which closes the device's screen -- the event that hangs firmware 1.2.4
   * after an image and an animation have shared it.
   */
  describe('a finished scene', () => {
    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
    const sendPixelFrame = (): ReturnType<typeof vi.fn> => driver.sendPixelFrame as ReturnType<typeof vi.fn>;

    it('RenderActiveSession_FrameLanded_RetiresTheSceneAfterIt', async () => {
      const retire = vi.spyOn(AnimationPlayer.prototype, 'retireScene').mockResolvedValue(undefined);

      renderer.renderActiveSession(session(10));
      await settle();

      expect(retire).toHaveBeenCalledTimes(1);
      expect(sendPixelFrame().mock.invocationCallOrder[0]).toBeLessThan(retire.mock.invocationCallOrder[0]);
      retire.mockRestore();
    });

    it.each(['conflict', 'superseded', 'queued'])('RenderActiveSession_FrameCameBack%s_KeepsTheScene', async outcome => {
      // The frame is not on the panel, so nothing covers the scene yet.
      const retire = vi.spyOn(AnimationPlayer.prototype, 'retireScene').mockResolvedValue(undefined);
      sendPixelFrame().mockResolvedValue(outcome);

      renderer.renderActiveSession(session(10));
      await settle();

      expect(retire).not.toHaveBeenCalled();
      retire.mockRestore();
    });

    it('RenderActiveSession_FrameRefused_KeepsTheScene', async () => {
      const retire = vi.spyOn(AnimationPlayer.prototype, 'retireScene').mockResolvedValue(undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      sendPixelFrame().mockRejectedValue(new DeviceRequestError('unreachable', 'draw'));

      renderer.renderActiveSession(session(10));
      await settle();

      expect(retire).not.toHaveBeenCalled();
      retire.mockRestore();
      errorSpy.mockRestore();
    });

    it('RenderActiveSession_WhileTheDevicePlaysAScene_NeitherDrawsNorRetires', async () => {
      const retire = vi.spyOn(AnimationPlayer.prototype, 'retireScene').mockResolvedValue(undefined);
      const active = vi.spyOn(AnimationPlayer.prototype, 'isHardwareAnimationActive').mockReturnValue(true);

      renderer.renderActiveSession(session(10));
      await settle();

      expect(sendPixelFrame()).not.toHaveBeenCalled();
      expect(retire).not.toHaveBeenCalled();
      retire.mockRestore();
      active.mockRestore();
    });
  });
});
