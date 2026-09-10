import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnimationPlayer } from '../src/main/hardware/animation-player';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
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
      sendPixelFrame: vi.fn().mockResolvedValue(true),
      uploadAsset: vi.fn().mockResolvedValue(true),
      sendDisplayPayload: vi.fn().mockResolvedValue(true),
      clearDisplay: vi.fn().mockResolvedValue(true)
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
   * streaming PNGs at it. The device can refuse, and it refuses by answering
   * `false` -- `uploadAsset` and `sendDisplayPayload` never throw for it. The
   * original code chained `.then().catch()`, so a refusal ran the success path
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
      (driver.uploadAsset as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await player.play('hw_anim');
      await settle();

      // The behaviour that matters: something still reaches the bar.
      expect(driver.sendPixelFrame).toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('would not store hw_anim.anim'));
    });

    it('Play_DeviceStoresTheFileButRefusesToDrawIt_FallsBackToStreamingFrames', async () => {
      withAnimFile();
      (driver.sendDisplayPayload as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await player.play('hw_anim');
      await settle();

      expect(driver.sendPixelFrame).toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('refused to draw it'));
    });

    it('Play_UploadRejected_ReportsTheSizeThatWasRejected', async () => {
      // The size is the first thing worth knowing when a device refuses a file,
      // and nothing recorded it before -- these animations are 0.8-1.3 MB
      // against a 5s upload timeout.
      withAnimFile();
      (driver.uploadAsset as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      await player.play('hw_anim');
      await settle();

      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/\(\d+ bytes\)/));
    });

    it('Play_BeforeDrawingTheAnimation_ClearsTheStalePixelFrameOffTheDisplay', async () => {
      // Measured on firmware 1.2.3: a draw merges by element id instead of
      // replacing the element set, and the full-panel `px_matrix_img` that
      // `sendPixelFrame` leaves behind composites ABOVE `hardware_anim` in
      // either order. So an upload and a draw that both succeed still show a
      // black bar until the image is removed. Reproduced against a real device
      // before this test was written.
      withAnimFile();

      await player.play('hw_anim');
      await settle();

      expect(driver.clearDisplay).toHaveBeenCalled();
      const clearedAt = (driver.clearDisplay as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const drewAt = (driver.sendDisplayPayload as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      expect(clearedAt).toBeLessThan(drewAt);
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
  });
});
