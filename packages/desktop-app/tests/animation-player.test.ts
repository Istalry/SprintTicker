import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnimationPlayer } from '../src/main/hardware/animation-player';
import { BusyBarDriver, DeviceRequestError } from '../src/main/hardware/busybar-driver';
import { FRONT_ELEMENT_IDS, FRONT_LAYER_Z } from '../src/shared/device-constants';
import fs from 'fs';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  powerSaveBlocker: {
    start: vi.fn().mockReturnValue(123),
    stop: vi.fn(),
    isStarted: vi.fn().mockReturnValue(true)
  }
}));

// Declared explicitly rather than left to automocking. Under vitest 1 the
// automock of 'fs' produced a `promises` namespace; under vitest 5 it does not,
// and `vi.spyOn(fs.promises, ...)` failed with "could not find an object to spy
// upon". Naming the surface the module under test actually uses makes the mock
// independent of how thorough automocking happens to be.
vi.mock('fs', () => {
  const mock = {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      readdir: vi.fn(),
      readFile: vi.fn()
    }
  };
  return { ...mock, default: mock };
});
vi.mock('path', async () => {
  const actual = await vi.importActual('path') as Record<string, unknown>;
  return {
    ...actual,
    default: actual
  };
});

describe('AnimationPlayer Unit Tests', () => {
  let driver: BusyBarDriver;
  let player: AnimationPlayer;

  beforeEach(() => {
    vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false } as unknown as fs.Stats);

    // Frame loading is asynchronous so it does not block the main process, but
    // each test still describes the filesystem through the synchronous mocks.
    // Bridging here keeps those descriptions as the single source of truth.
    vi.spyOn(fs.promises, 'readdir').mockImplementation(
      async (dir: never) => fs.readdirSync(dir) as never
    );
    vi.spyOn(fs.promises, 'readFile').mockImplementation(
      async (file: never) => fs.readFileSync(file) as never
    );

    driver = {
      sendPixelFrame: vi.fn().mockResolvedValue('sent'),
      uploadAsset: vi.fn().mockResolvedValue(undefined),
      sendDisplayPayload: vi.fn().mockResolvedValue('drawn'),
      clearDisplay: vi.fn().mockResolvedValue('cleared'),
      removeDisplayElements: vi.fn().mockResolvedValue(undefined),
      shownElementIds: vi.fn().mockReturnValue([])
    } as unknown as BusyBarDriver;
    player = new AnimationPlayer(driver, '/mock/animations');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    player.stop();
  });

  it('AnimationPlayer_Play_NonExistentAnimation_DoesNothing', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    
    await player.play('invalid_anim');
    
    expect(player.isAnimationPlaying()).toBe(false);
    expect(player.getCurrentAnimation()).toBeNull();
  });

  it('AnimationPlayer_Play_ValidAnimationWithMeta_PlaysAtCorrectFps', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p: unknown) => {
      if (String(p).endsWith('.anim')) return false;
      return true;
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((p: unknown) => {
      if (String(p).includes('meta.json')) {
        return JSON.stringify({ fps: 20 });
      }
      return Buffer.from('mock_png_data');
    });
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['frame_0.png', 'frame_1.png'] as never);
    
    player.setLedColorCallback(() => '#FFFFFF');
    await player.play('test_anim');
    
    expect(player.isAnimationPlaying()).toBe(true);
    expect(player.getCurrentAnimation()).toBe('test_anim');
    
    // Initial frame draw
    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(1);
    
    // Advance time by 50ms (1000 / 20fps)
    vi.advanceTimersByTime(50);
    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(2);
    
    // Play again should do nothing if same animation
    await player.play('test_anim');
    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(2);
  });

  it('AnimationPlayer_Play_InvalidMetaJson_DefaultsTo10Fps', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p: unknown) => {
      if (String(p).endsWith('.anim')) return false;
      return true;
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((p: unknown) => {
      if (String(p).includes('meta.json')) {
        throw new Error('Parse error');
      }
      return Buffer.from('mock_png_data');
    });
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['frame_1.png', 'frame_2.png'] as never);
    
    await player.play('test_anim2');
    
    // Should default to 10 FPS, meaning 100ms interval
    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(2);
  });

  it('AnimationPlayer_Play_NoFramesFound_ReturnsEarly', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ fps: 10 }));
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['not_a_frame.txt'] as never);
    
    await player.play('test_anim3');
    
    expect(player.isAnimationPlaying()).toBe(false);
  });

  it('AnimationPlayer_LoadError_ReturnsNull', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('Disk error');
    });
    
    await player.play('test_anim4');
    
    expect(player.isAnimationPlaying()).toBe(false);
  });

  it('AnimationPlayer_DrawCurrentFrame_SendsFrameViaDriver', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p: unknown) => {
      if (String(p).endsWith('.anim')) return false;
      return true;
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((p: unknown) => {
      if (String(p).includes('meta.json')) return JSON.stringify({ fps: 10 });
      return Buffer.from(`mock_${p}`);
    });
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['frame_0.png'] as never);
    
    driver.sendPixelFrame = vi.fn().mockRejectedValue(new Error('Network fail'));
    
    await player.play('test_anim5');
    
    // It should not crash on reject, just console.error
    expect(driver.sendPixelFrame).toHaveBeenCalledTimes(1);
  });

  it('AnimationPlayer_DrawCurrentFrame_NoData_DoesNotThrow', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p: unknown) => {
      if (String(p).endsWith('.anim')) return false;
      return true;
    });
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['frame_0.png'] as never);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('data'));
    
    const playPromise = player.play('anim');
    player.stop(); // Stop before play finishes
    await playPromise;

    expect(player.isAnimationPlaying()).toBe(false);
  });

  /**
   * Hardware playback hands the whole `.anim` to the device instead of
   * streaming PNGs at it. The device can refuse. The driver used to report
   * that by answering `false` rather than throwing, and the original code
   * chained `.then().catch()`, so a refusal ran the success path
   * and fired no handler: the bar stayed blank, the on-screen emulator animated
   * correctly off `onFrameCallback`, and the log said only that the animation
   * had loaded. These pin the difference.
   */
  describe('hardware .anim playback', () => {
    const withAnimFile = (): void => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['frame_0.png', 'frame_1.png'] as never);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p: unknown) => {
        if (String(p).includes('meta.json')) return JSON.stringify({ fps: 20 });
        return Buffer.from('mock_binary');
      });
    };

    /** What the driver throws when the device says no. */
    const refused = (operation: string): DeviceRequestError => new DeviceRequestError('rejected', operation, 400);

    /** Lets the fire-and-forget upload chain settle under fake timers. */
    const settle = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(1);
    };

    it('Play_DeviceAcceptsAnimFile_StreamsNoFramesAtTheHardware', async () => {
      withAnimFile();

      await player.play('hw_anim');
      await settle();

      expect(driver.uploadAsset).toHaveBeenCalledWith(
        expect.any(String),
        'hw_anim.anim',
        expect.anything()
      );
      // The device owns playback; streaming as well would be two sources
      // drawing the same element.
      expect(driver.sendPixelFrame).not.toHaveBeenCalled();
    });

    it('Play_DeviceWillNotStoreTheAnimFile_FallsBackToStreamingFrames', async () => {
      withAnimFile();
      (driver.uploadAsset as ReturnType<typeof vi.fn>).mockRejectedValue(refused('asset upload'));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await player.play('hw_anim');
      await settle();

      // The behaviour that matters: something still reaches the bar.
      expect(driver.sendPixelFrame).toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('would not store hw_anim.anim'));
    });

    it('Play_DeviceStoresTheFileButRefusesToDrawIt_FallsBackToStreamingFrames', async () => {
      withAnimFile();
      (driver.sendDisplayPayload as ReturnType<typeof vi.fn>).mockRejectedValue(refused('display payload'));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await player.play('hw_anim');
      await settle();

      expect(driver.sendPixelFrame).toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('refused to draw it'));
    });

    it('Play_DisplayHeldAtHigherPriority_StreamsFramesUntilReleased', async () => {
      // A 409 is not a refusal, but the animation element was never placed.
      // Streaming keeps offering frames, so one lands once the display is free.
      withAnimFile();
      (driver.sendDisplayPayload as ReturnType<typeof vi.fn>).mockResolvedValue('conflict');
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await player.play('hw_anim');
      await settle();

      expect(driver.sendPixelFrame).toHaveBeenCalled();
      expect(player.isHardwareAnimationActive()).toBe(false);
    });

    it('Play_UploadRejected_ReportsTheSizeThatWasRejected', async () => {
      // The size is the first thing worth knowing when a device refuses a file,
      // and nothing recorded it before -- these animations are 0.8-1.3 MB
      // against a 5s upload timeout.
      withAnimFile();
      (driver.uploadAsset as ReturnType<typeof vi.fn>).mockRejectedValue(refused('asset upload'));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await player.play('hw_anim');
      await settle();

      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/\(\d+ bytes\)/));
    });

    it('IsHardwareAnimationActive_WhileDevicePlaysTheFile_ReportsTrue', async () => {
      // DisplayRenderer reads this to stop itself drawing over the animation.
      withAnimFile();

      await player.play('hw_anim');
      await settle();
      expect(player.isHardwareAnimationActive()).toBe(true);

      player.stop();
      expect(player.isHardwareAnimationActive()).toBe(false);
    });

    /** A 60 fps scene of `count` frames, with a .anim the device takes. */
    const withSixtyFpsScene = (count: number): void => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(
        Array.from({ length: count }, (_, i) => `frame_${String(i).padStart(5, '0')}.png`) as never
      );
      vi.spyOn(fs, 'readFileSync').mockImplementation((p: unknown) => {
        if (String(p).includes('meta.json')) return JSON.stringify({ fps: 60 });
        return Buffer.from('mock_binary');
      });
    };

    it('Play_DevicePlaysAnimFile_PreviewKeepsTimeWithTheDevice', async () => {
      // The preview ticks at 15 fps. Stepping one frame per tick through a
      // 60 fps scene ran it at a quarter of the device's speed.
      withSixtyFpsScene(240);
      const shown: number[] = [];

      await player.play('hw_anim', { onFrame: (_frame, index) => shown.push(index) });
      await vi.advanceTimersByTimeAsync(1000);

      expect(shown.at(-1)).toBeGreaterThanOrEqual(56);
      expect(shown.at(-1)).toBeLessThanOrEqual(64);
    });

    it('Play_OneShotOnTheDevice_PreviewEndsOnTheLastFrameAndStops', async () => {
      // The device holds a one-shot's last frame; the preview must end on the
      // same pose rather than stepping past it.
      withSixtyFpsScene(30);
      const shown: number[] = [];

      await player.play('hw_anim', { loop: false, onFrame: (_frame, index) => shown.push(index) });
      await vi.advanceTimersByTimeAsync(2000);

      expect(shown.at(-1)).toBe(29);
      expect(player.isAnimationPlaying()).toBe(false);
    });

    it('Stop_AfterHardwarePlayback_LetsTheNextAnimationStreamFrames', async () => {
      // The flag describes one playback. Left set, a following animation with
      // no .anim of its own would have its streaming suppressed by state
      // belonging to the previous one, and show nothing.
      withAnimFile();
      await player.play('hw_anim');
      await settle();
      player.stop();

      vi.spyOn(fs, 'existsSync').mockImplementation((p: unknown) => !String(p).endsWith('.anim'));
      (driver.sendPixelFrame as ReturnType<typeof vi.fn>).mockClear();

      await player.play('software_anim');
      await settle();

      expect(driver.sendPixelFrame).toHaveBeenCalled();
    });

    /**
     * The screen must never be emptied on the way into or out of a scene.
     *
     * Emptying the device's element set closes its screen, and on firmware
     * 1.2.4 closing it after an image and an animation have shared it hangs the
     * bar within a few cycles (measured 2026-09-30). Starting a scene used to
     * clear the display first -- from a frame with an animated icon on it,
     * which is precisely that pattern. The scene now goes in underneath the
     * frame and the frame comes out afterwards; on the way back, the renderer's
     * next frame covers the scene before `retireScene` removes it.
     */
    describe('make before break', () => {
      const mocked = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;
      const absent = (): DeviceRequestError => new DeviceRequestError('rejected', 'remove', 400);
      const unreachable = (): DeviceRequestError => new DeviceRequestError('unreachable', 'remove');
      const sceneElement = (call = 0): Record<string, unknown> =>
        (mocked(driver.sendDisplayPayload).mock.calls[call][0].elements as Array<Record<string, unknown>>)[0];
      const removals = (): string[][] => mocked(driver.removeDisplayElements).mock.calls.map(call => call[1] as string[]);

      /** Plays a scene the device accepts, then stops it with a frame shown above. */
      const playThenStop = async (name = 'hw_anim'): Promise<void> => {
        await player.play(name);
        await settle();
        player.stop();
        mocked(driver.shownElementIds).mockReturnValue([FRONT_ELEMENT_IDS.FRAME, FRONT_ELEMENT_IDS.SCENE]);
      };

      it('Play_StartingAScene_NeverClearsTheDisplay', async () => {
        withAnimFile();

        await player.play('hw_anim');
        await settle();

        expect(driver.clearDisplay).not.toHaveBeenCalled();
        expect(player.isHardwareAnimationActive()).toBe(true);
      });

      it('Play_StartingAScene_DrawsItUnderTheFrameBeforeRemovingTheFrame', async () => {
        withAnimFile();

        await player.play('hw_anim');
        await settle();

        expect(sceneElement()).toMatchObject({ id: FRONT_ELEMENT_IDS.SCENE, type: 'animation', z_index: FRONT_LAYER_Z.SCENE });
        expect(FRONT_LAYER_Z.SCENE).toBeLessThan(FRONT_LAYER_Z.FRAME);
        expect(removals()).toEqual([[FRONT_ELEMENT_IDS.FRAME]]);
        const drewAt = mocked(driver.sendDisplayPayload).mock.invocationCallOrder[0];
        const removedAt = mocked(driver.removeDisplayElements).mock.invocationCallOrder[0];
        expect(drewAt).toBeLessThan(removedAt);
      });

      it('Play_NoFrameOnTheDevice_ReadsTheRemovalRefusalAsAlreadyGone', async () => {
        // A scene following a scene, or a panel the idle clock released.
        withAnimFile();
        mocked(driver.removeDisplayElements).mockRejectedValue(absent());

        await player.play('hw_anim');
        await settle();

        expect(player.isHardwareAnimationActive()).toBe(true);
        expect(driver.sendPixelFrame).not.toHaveBeenCalled();
      });

      it('Play_FrameCouldNotBeRemoved_FallsBackToStreamingFrames', async () => {
        // The scene is on the device but hidden under an opaque frame: without
        // streaming the bar would show the previous screen for the whole break.
        withAnimFile();
        mocked(driver.removeDisplayElements).mockRejectedValue(unreachable());
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        await player.play('hw_anim');
        await settle();

        expect(player.isHardwareAnimationActive()).toBe(false);
        expect(driver.sendPixelFrame).toHaveBeenCalled();
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('could not be removed'));
      });

      it('Play_FrameRemovalFailsWithAnotherRefusal_DoesNotTreatItAsGone', async () => {
        // Only 400 means "not there". A 500 says nothing about the frame.
        withAnimFile();
        mocked(driver.removeDisplayElements).mockRejectedValue(new DeviceRequestError('rejected', 'remove', 500));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await player.play('hw_anim');
        await settle();

        expect(player.isHardwareAnimationActive()).toBe(false);
        expect(driver.sendPixelFrame).toHaveBeenCalled();
      });

      it.each([
        ['held at a higher priority', (): void => void mocked(driver.sendDisplayPayload).mockResolvedValue('conflict')],
        ['refused', (): void => void mocked(driver.sendDisplayPayload).mockRejectedValue(refused('display payload'))],
        ['not stored', (): void => void mocked(driver.uploadAsset).mockRejectedValue(refused('asset upload'))]
      ])('Play_SceneWas%s_LeavesTheFrameInPlace', async (_case, arrange) => {
        // Removing the frame with no scene under it would empty the panel.
        withAnimFile();
        arrange();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        await player.play('hw_anim');
        await settle();

        expect(driver.removeDisplayElements).not.toHaveBeenCalled();
        expect(driver.sendPixelFrame).toHaveBeenCalled();
      });

      it('Play_StoppedDuringTheUpload_DrawsNothing', async () => {
        withAnimFile();
        let finishUpload: () => void = () => undefined;
        mocked(driver.uploadAsset).mockReturnValue(new Promise<void>(resolve => (finishUpload = resolve)));

        await player.play('hw_anim');
        player.stop();
        finishUpload();
        await settle();

        expect(driver.sendDisplayPayload).not.toHaveBeenCalled();
        expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      });

      it('Play_StoppedWhileTheSceneWasBeingDrawn_LeavesTheNextFrameAlone', async () => {
        // The renderer is about to put the next screen's frame down; removing
        // "the frame" now would take that one instead.
        withAnimFile();
        let finishDraw: (outcome: string) => void = () => undefined;
        mocked(driver.sendDisplayPayload).mockReturnValue(new Promise(resolve => (finishDraw = resolve)));

        await player.play('hw_anim');
        await settle();
        player.stop();
        finishDraw('drawn');
        await settle();

        expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      });

      it('RetireScene_WhileTheSceneIsPlaying_DoesNothing', async () => {
        withAnimFile();
        await player.play('hw_anim');
        await settle();
        mocked(driver.shownElementIds).mockReturnValue([FRONT_ELEMENT_IDS.FRAME, FRONT_ELEMENT_IDS.SCENE]);
        mocked(driver.removeDisplayElements).mockClear();

        await player.retireScene();

        expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      });

      it('RetireScene_AfterStopWithAFrameAboveIt_RemovesOnlyTheScene', async () => {
        withAnimFile();
        await playThenStop();
        mocked(driver.removeDisplayElements).mockClear();

        await player.retireScene();

        expect(removals()).toEqual([[FRONT_ELEMENT_IDS.SCENE]]);
      });

      it('RetireScene_NothingElseOnThePanel_KeepsTheScene', async () => {
        // Removing it would empty the screen -- the close this all avoids.
        withAnimFile();
        await playThenStop();
        mocked(driver.shownElementIds).mockReturnValue([FRONT_ELEMENT_IDS.SCENE]);
        mocked(driver.removeDisplayElements).mockClear();

        await player.retireScene();

        expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      });

      it('RetireScene_NoSceneEverDrawn_MakesNoRequest', async () => {
        mocked(driver.shownElementIds).mockReturnValue([FRONT_ELEMENT_IDS.FRAME]);

        await player.retireScene();

        expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      });

      it('RetireScene_CalledTwice_RemovesTheSceneOnce', async () => {
        withAnimFile();
        await playThenStop();
        mocked(driver.removeDisplayElements).mockClear();

        await player.retireScene();
        await player.retireScene();

        expect(driver.removeDisplayElements).toHaveBeenCalledTimes(1);
      });

      it('RetireScene_SceneAlreadyGone_ForgetsIt', async () => {
        withAnimFile();
        await playThenStop();
        mocked(driver.removeDisplayElements).mockClear();
        mocked(driver.removeDisplayElements).mockRejectedValueOnce(absent());

        await player.retireScene();
        await player.retireScene();

        expect(driver.removeDisplayElements).toHaveBeenCalledTimes(1);
      });

      it('RetireScene_DeviceUnreachable_TriesAgainWithTheNextFrame', async () => {
        withAnimFile();
        await playThenStop();
        mocked(driver.removeDisplayElements).mockClear();
        mocked(driver.removeDisplayElements).mockRejectedValueOnce(unreachable());
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await player.retireScene();
        await player.retireScene();

        expect(driver.removeDisplayElements).toHaveBeenCalledTimes(2);
        expect(warned).toHaveBeenCalledWith(expect.stringContaining('Could not remove the finished scene'));
      });

      it('RetireScene_RacingANewScene_RemovesTheOldOneBeforeTheNewOneIsDrawn', async () => {
        // Both use the same element id. A removal landing after the new draw
        // would take the new scene down, with its frame already gone.
        withAnimFile();
        await playThenStop('first');
        mocked(driver.removeDisplayElements).mockClear();
        mocked(driver.sendDisplayPayload).mockClear();
        let finishRemoval: () => void = () => undefined;
        mocked(driver.removeDisplayElements).mockReturnValueOnce(new Promise<void>(resolve => (finishRemoval = resolve)));

        const retiring = player.retireScene();
        await player.play('second');
        await settle();
        expect(driver.sendDisplayPayload).not.toHaveBeenCalled();

        finishRemoval();
        await retiring;
        await settle();

        expect(driver.sendDisplayPayload).toHaveBeenCalledTimes(1);
        expect(sceneElement()).toMatchObject({ path: 'second.anim' });
        expect(removals()[0]).toEqual([FRONT_ELEMENT_IDS.SCENE]);
      });

      it('RetireScene_AfterANewSceneStarted_LeavesTheNewScene', async () => {
        withAnimFile();
        await playThenStop('first');
        await player.play('second');
        await settle();
        mocked(driver.removeDisplayElements).mockClear();

        await player.retireScene();

        expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      });

      it('Play_SameSceneStillOnTheDevice_DrawsItWithoutUploadingOverIt', async () => {
        // The device answers 508 to an upload over an .anim it is playing.
        withAnimFile();
        await playThenStop();

        await player.play('hw_anim');
        await settle();

        expect(driver.uploadAsset).toHaveBeenCalledTimes(1);
        expect(driver.sendDisplayPayload).toHaveBeenCalledTimes(2);
        expect(player.isHardwareAnimationActive()).toBe(true);
      });

      it('Play_ReusedSceneRefusedBecauseTheDeviceLostIt_UploadsAgainAndDraws', async () => {
        // A bar that rebooted keeps no assets; the copy we counted on is gone.
        withAnimFile();
        await playThenStop();
        mocked(driver.sendDisplayPayload).mockRejectedValueOnce(refused('display payload'));

        await player.play('hw_anim');
        await settle();

        expect(driver.uploadAsset).toHaveBeenCalledTimes(2);
        expect(driver.sendDisplayPayload).toHaveBeenCalledTimes(3);
        expect(player.isHardwareAnimationActive()).toBe(true);
      });

      it('Play_ReusedSceneRefusedTwice_FallsBackToStreamingFrames', async () => {
        withAnimFile();
        await playThenStop();
        mocked(driver.sendDisplayPayload).mockRejectedValue(refused('display payload'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await player.play('hw_anim');
        await settle();

        expect(driver.uploadAsset).toHaveBeenCalledTimes(2);
        expect(player.isHardwareAnimationActive()).toBe(false);
        expect(driver.sendPixelFrame).toHaveBeenCalled();
      });

      it('Play_AfterTheSceneWasRetired_UploadsItAgain', async () => {
        withAnimFile();
        await playThenStop();
        await player.retireScene();

        await player.play('hw_anim');
        await settle();

        expect(driver.uploadAsset).toHaveBeenCalledTimes(2);
      });

      it('Play_ADifferentScene_UploadsIt', async () => {
        withAnimFile();
        await playThenStop('first');

        await player.play('second');
        await settle();

        expect(mocked(driver.uploadAsset).mock.calls.map(call => call[1])).toEqual(['first.anim', 'second.anim']);
      });
    });
  });
});
