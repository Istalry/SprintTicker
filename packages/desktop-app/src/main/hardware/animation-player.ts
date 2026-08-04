import fs from 'fs';
import path from 'path';
import { BusyBarDriver } from './busybar-driver';

interface AnimationData {
  name: string;
  fps: number;
  frames: Buffer[];
}

/**
 * Service to stream a sequence of PNG frames to the physical BUSY Bar display.
 * Emulates the hardware .anim player by preloading raw PNG sequences and sending them
 * frame-by-frame via the BusyBarDriver.
 */
export class AnimationPlayer {
  private driver: BusyBarDriver;
  private currentAnimation: string | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private animations: Map<string, AnimationData> = new Map();
  private animationsDir: string;
  private frameIndex: number = 0;
  private isPlaying: boolean = false;
  private getLedColorCallback?: () => string | undefined;

  constructor(driver: BusyBarDriver, animationsDir?: string) {
    this.driver = driver;
    // Default to the repository root Animations folder
    this.animationsDir = animationsDir || path.resolve(__dirname, '../../../../../Animations');
  }

  /**
   * Register a callback to dynamically fetch the LED color for each frame
   */
  public setLedColorCallback(cb: () => string | undefined): void {
    this.getLedColorCallback = cb;
  }

  /**
   * Preload an animation from disk into memory.
   * Animation must be a directory containing a nested directory with the same name,
   * containing a meta.json and a sequence of PNG files (frame_0.png, frame_1.png, ...).
   */
  private async loadAnimation(animName: string): Promise<AnimationData | null> {
    if (this.animations.has(animName)) {
      return this.animations.get(animName)!;
    }

    try {
      const targetDir = path.join(this.animationsDir, animName);
      if (!fs.existsSync(targetDir)) {
        console.warn(`[AnimationPlayer] Animation directory not found: ${targetDir}`);
        return null;
      }

      const metaPath = path.join(targetDir, 'meta.json');
      let fps = 10;
      if (fs.existsSync(metaPath)) {
        try {
          const metaStr = fs.readFileSync(metaPath, 'utf8');
          const meta = JSON.parse(metaStr);
          if (meta.fps) {
            fps = Number(meta.fps);
          }
        } catch (e) {
          console.warn(`[AnimationPlayer] Failed to parse meta.json for ${animName}, defaulting to 10 fps`);
        }
      }

      const files = fs.readdirSync(targetDir);
      const frameFiles = files
        .filter(f => f.endsWith('.png'))
        .sort((a, b) => {
          // Sort numerically based on frame_X.png
          const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
          const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
          return numA - numB;
        });

      if (frameFiles.length === 0) {
        console.warn(`[AnimationPlayer] No PNG frames found for animation: ${animName}`);
        return null;
      }

      const frames: Buffer[] = [];
      for (const file of frameFiles) {
        const filePath = path.join(targetDir, file);
        frames.push(fs.readFileSync(filePath));
      }

      const animData: AnimationData = { name: animName, fps, frames };
      this.animations.set(animName, animData);
      console.log(`[AnimationPlayer] Loaded animation '${animName}' with ${frames.length} frames at ${fps} fps`);
      
      return animData;
    } catch (err) {
      console.error(`[AnimationPlayer] Error loading animation ${animName}:`, err);
      return null;
    }
  }

  /**
   * Start playing an animation on the BUSY Bar.
   * Stops any currently playing animation.
   */
  public async play(animName: string): Promise<void> {
    if (this.currentAnimation === animName && this.isPlaying) {
      return; // Already playing this animation
    }

    this.stop();
    this.currentAnimation = animName;
    const animData = await this.loadAnimation(animName);
    if (!animData) {
      if (this.currentAnimation === animName) {
        this.currentAnimation = null;
      }
      return;
    }

    // Check if stop() was called or another animation started while loading
    if (this.currentAnimation !== animName) {
      return;
    }

    this.isPlaying = true;
    this.frameIndex = 0;

    const frameIntervalMs = Math.floor(1000 / animData.fps);

    // Initial draw immediately
    this.drawCurrentFrame();

    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % animData.frames.length;
      this.drawCurrentFrame();
    }, frameIntervalMs);
  }

  /**
   * Stop the currently playing animation.
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPlaying = false;
    this.currentAnimation = null;
  }

  public isAnimationPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentAnimation(): string | null {
    return this.currentAnimation;
  }

  private drawCurrentFrame(): void {
    if (!this.currentAnimation || !this.isPlaying) return;
    
    const animData = this.animations.get(this.currentAnimation);
    if (!animData) return;

    const frameBuffer = animData.frames[this.frameIndex];
    if (!frameBuffer) return;

    const ledColor = this.getLedColorCallback ? this.getLedColorCallback() : undefined;
    
    // We send the PNG buffer directly to the hardware using an image element payload.
    // The driver uploads the frame and executes POST /api/display/draw
    this.driver.sendPixelFrame(
      frameBuffer,
      ledColor,
      'busybar_desktop',
      `anim_${this.frameIndex}.png`,
      95
    ).catch(err => console.error(`[AnimationPlayer] Frame draw failed:`, err));
  }
}
