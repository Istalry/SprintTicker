import { app, powerSaveBlocker } from 'electron';
import fs from 'fs';
import path from 'path';
import { BusyBarDriver } from './busybar-driver';

interface AnimationData {
  name: string;
  fps: number;
  frames: Buffer[];
  animBuffer?: Buffer;
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
  private onFrameCallback?: (frameBuffer: Buffer, frameIndex: number) => void;
  private loop: boolean = true;
  private _powerSaveBlockerId: number | null = null;

  constructor(driver: BusyBarDriver, animationsDir?: string) {
    this.driver = driver;
    // Default to the repository root Animations folder in dev, or resources/Animations when packaged
    this.animationsDir = animationsDir || (app?.isPackaged 
      ? path.join(process?.resourcesPath || '', 'Animations') 
      : path.resolve(__dirname, '../../../../Animations'));
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
      let targetDir = path.join(this.animationsDir, animName);
      if (!fs.existsSync(targetDir)) {
        console.warn(`[AnimationPlayer] Animation directory not found: ${targetDir}`);
        return null;
      }

      // If the directory contains a nested directory of the exact same name (common from zip extraction), use it instead
      const nestedDir = path.join(targetDir, animName);
      if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
        targetDir = nestedDir;
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

      let animBuffer: Buffer | undefined;
      const animFilePath = path.join(targetDir, `${animName}.anim`);
      if (fs.existsSync(animFilePath)) {
        animBuffer = fs.readFileSync(animFilePath);
      }

      const animData: AnimationData = { name: animName, fps, frames, animBuffer };
      this.animations.set(animName, animData);
      console.log(`[AnimationPlayer] Loaded animation '${animName}' with ${frames.length} frames at ${fps} fps${animBuffer ? ' (Hardware Accelerated)' : ''}`);
      
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
  public async play(animName: string, options?: { loop?: boolean; onFrame?: (frameBuffer: Buffer, frameIndex: number) => void }): Promise<void> {
    if (this.currentAnimation === animName && this.isPlaying) {
      // If we are already playing, just update the options
      if (options) {
        if (options.loop !== undefined) this.loop = options.loop;
        if (options.onFrame !== undefined) this.onFrameCallback = options.onFrame;
      }
      return;
    }

    this.stop();
    this.currentAnimation = animName;
    if (options) {
      this.loop = options.loop !== undefined ? options.loop : true;
      if (options.onFrame !== undefined) this.onFrameCallback = options.onFrame;
    } else {
      this.loop = true;
      this.onFrameCallback = undefined;
    }
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

    if (this._powerSaveBlockerId === null) {
      this._powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(`[AnimationPlayer] Started power save blocker (ID: ${this._powerSaveBlockerId}) to prevent app suspension during animation.`);
    }

    const frameIntervalMs = Math.floor(1000 / animData.fps);

    if (animData.animBuffer) {
      // Hardware accelerated playback
      this.driver.uploadAsset('busybar_desktop', `${animName}.anim`, animData.animBuffer).then(() => {
        if (!this.isPlaying || this.currentAnimation !== animName) return; // aborted
        this.driver.sendDisplayPayload({
          application_name: 'busybar_desktop',
          priority: 95,
          led_notification_color: this.getLedColorCallback ? this.getLedColorCallback() : undefined,
          elements: [{
            id: 'hardware_anim',
            type: 'animation',
            path: `${animName}.anim`,
            x: 0,
            y: 0,
            display: 'front',
            loop: this.loop,
            section: 'default'
          }]
        }).catch(err => console.error(`[AnimationPlayer] Hardware anim start failed:`, err));
      }).catch(err => console.error(`[AnimationPlayer] Hardware anim upload failed:`, err));
    }

    // Initial draw immediately
    this.drawCurrentFrame();

    this.intervalId = setInterval(() => {
      if (!this.loop && this.frameIndex >= animData.frames.length - 1) {
        this.stop();
        return;
      }
      this.frameIndex = (this.frameIndex + 1) % animData.frames.length;
      this.drawCurrentFrame();
    }, frameIntervalMs);
  }

  /**
   * Stop the currently playing animation.
   */
  public stop(): void {
    if (this._powerSaveBlockerId !== null && powerSaveBlocker.isStarted(this._powerSaveBlockerId)) {
      powerSaveBlocker.stop(this._powerSaveBlockerId);
      console.log(`[AnimationPlayer] Stopped power save blocker (ID: ${this._powerSaveBlockerId}).`);
      this._powerSaveBlockerId = null;
    }

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

    // Only stream to hardware if we lack the native .anim file (Fallback mode)
    if (!animData.animBuffer) {
      const ledColor = this.getLedColorCallback ? this.getLedColorCallback() : undefined;
      
      // We send the PNG buffer directly to the hardware using an image element payload.
      // The driver uploads the frame and executes POST /api/display/draw
      this.driver.sendPixelFrame(
        frameBuffer,
        ledColor,
        'busybar_desktop',
        'anim_frame.png',
        95
      ).catch(err => console.error(`[AnimationPlayer] Frame draw failed:`, err));
    }

    if (this.onFrameCallback) {
      this.onFrameCallback(frameBuffer, this.frameIndex);
    }
  }
}
