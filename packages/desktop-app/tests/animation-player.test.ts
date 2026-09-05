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
      sendDisplayPayload: vi.fn().mockResolvedValue(true)
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
});
