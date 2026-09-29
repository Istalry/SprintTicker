import { powerSaveBlocker } from 'electron';
import { BusyBarDriver } from './busybar-driver';
import { describeError, DrawOutcome } from './device-errors';
import { DEVICE_APPLICATION_NAME } from '../../shared/device-constants';
import { AnimationData, defaultAnimationsDir, loadAnimationSequence } from './animation-sequence';

/**
 * Service to stream a sequence of PNG frames to the physical BUSY Bar display.
 * Emulates the hardware .anim player by preloading raw PNG sequences and sending them
 * frame-by-frame via the BusyBarDriver.
 */
export class AnimationPlayer {
  /**
   * How many decoded animations may stay resident.
   *
   * The three shipped animations total 8.6 MB of PNG frames -- lunch alone is
   * 540 of them -- and every one ever played was kept for the life of the
   * process.
   * Only one plays at a time; a second slot means switching back and forth
   * between two screens does not re-read either from disk.
   */
  private static readonly MAX_CACHED_ANIMATIONS = 2;

  /**
   * Ceiling on the preview tick while the device plays an animation itself.
   *
   * With a native `.anim` the device animates at full rate on its own; this
   * interval then exists only to drive the on-screen emulator, which does not
   * need 60 updates a second.
   */
  private static readonly HARDWARE_PREVIEW_MAX_FPS = 15;

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
  /**
   * Whether the device is playing the `.anim` itself.
   *
   * Gates hardware frame streaming: while the device owns playback, streaming
   * PNGs at it as well would be two sources drawing the same element. But the
   * flag has to be able to go *false* again, because the upload can be refused
   * and there is no exception to catch when it is -- `uploadAsset` and
   * `sendDisplayPayload` both answer with `false`. Before this existed, a
   * refused upload left the bar blank with the frame-streaming path disabled
   * and nothing logged: the on-screen emulator animated correctly the whole
   * time, because it is fed by `onFrameCallback` and never touches the device.
   */
  private hardwareAnimActive: boolean = false;

  constructor(driver: BusyBarDriver, animationsDir?: string) {
    this.driver = driver;
    this.animationsDir = animationsDir || defaultAnimationsDir();
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
    const cached = this.animations.get(animName);
    if (cached) {
      // Re-insert so this counts as the most recently used.
      this.cacheAnimation(animName, cached);
      return cached;
    }

    // Another animation was requested while this one was loading.
    const animData = await loadAnimationSequence(
      this.animationsDir,
      animName,
      () => this.currentAnimation !== null && this.currentAnimation !== animName
    );
    if (animData) this.cacheAnimation(animName, animData);
    return animData;
  }

  /**
   * Stores a decoded animation, evicting the least recently used if needed.
   *
   * A `Map` preserves insertion order, so re-inserting on a hit is enough to
   * make the first key the oldest.
   */
  private cacheAnimation(animName: string, animData: AnimationData): void {
    this.animations.delete(animName);
    this.animations.set(animName, animData);

    while (this.animations.size > AnimationPlayer.MAX_CACHED_ANIMATIONS) {
      const oldest = this.animations.keys().next().value;
      // Never evict what is on screen, however long ago it started.
      if (oldest === undefined || oldest === this.currentAnimation) break;
      this.animations.delete(oldest);
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

    // Held only while this process is the one producing frames, and only for an
    // animation that ends. A looping idle animation -- the lunch screen, the
    // away screen while the machine is locked -- used to hold it for the entire
    // break, which is precisely when the machine should be allowed to sleep.
    // With a native `.anim` the device animates on its own and nothing here
    // needs to stay awake at all.
    const needsPowerBlocker = !animData.animBuffer && !this.loop;
    if (needsPowerBlocker && this._powerSaveBlockerId === null) {
      this._powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(
        `[AnimationPlayer] Started power save blocker (ID: ${this._powerSaveBlockerId}) for '${animName}'.`
      );
    }

    // With hardware playback this interval only advances the on-screen preview,
    // so it does not have to keep up with the device.
    const effectiveFps = animData.animBuffer
      ? Math.min(animData.fps, AnimationPlayer.HARDWARE_PREVIEW_MAX_FPS)
      : animData.fps;
    const frameIntervalMs = Math.max(1, Math.floor(1000 / effectiveFps));

    if (animData.animBuffer) {
      // Optimistic: streaming is suppressed while the device is expected to own
      // playback, and `startHardwareAnimation` clears this if it turns out not
      // to. Starting false instead would double-draw for the length of an
      // upload, which for these files is most of a second.
      this.hardwareAnimActive = true;
      // Every device call inside handles its own failure; this catch is for a
      // bug in that handling, which would otherwise be an unhandled rejection.
      this.startHardwareAnimation(animName, animData).catch(err =>
        console.error(`[AnimationPlayer] Starting ${animName}.anim failed unexpectedly:`, err)
      );
    }

    // Initial draw immediately
    this.drawCurrentFrame();

    this.startFrameInterval(animData, frameIntervalMs);
  }

  /**
   * Hands the `.anim` to the device and checks that it actually took it.
   *
   * The driver used to answer `false` rather than throw, so the previous
   * `.then(...).catch(...)` chain could not see a rejected upload: `then` ran
   * regardless and asked the device to draw an asset it had never stored, and
   * neither `catch` ever fired. The result was a blank bar, a correctly
   * animating on-screen emulator, and a log containing one line saying the
   * animation had loaded -- indistinguishable from success. The driver now
   * throws, and each step below is awaited on its own so the log names the one
   * that failed.
   *
   * Falls back to streaming PNG frames, which is the same path animations
   * without a `.anim` already use, so a device that will not take the file is
   * degraded rather than silent.
   */
  private async startHardwareAnimation(animName: string, animData: AnimationData): Promise<void> {
    const buffer = animData.animBuffer;
    if (!buffer) return;
    const bytes = buffer.length;
    // Superseded while a request was in flight; the newer animation owns the
    // display and must not be torn down by this one's fallback.
    const superseded = (): boolean => !this.isPlaying || this.currentAnimation !== animName;

    try {
      await this.driver.uploadAsset(DEVICE_APPLICATION_NAME, `${animName}.anim`, buffer);
    } catch (err) {
      if (superseded()) return;
      console.error(
        `[AnimationPlayer] Device would not store ${animName}.anim (${bytes} bytes): ${describeError(err)}. ` +
          'Falling back to streaming frames.'
      );
      this.fallBackToFrameStreaming(animData);
      return;
    }
    if (superseded()) return;

    // Remove whatever this application already has on the front display before
    // handing it the animation.
    //
    // Measured on firmware 1.2.3, and the reason a correct upload and a correct
    // draw still produced a black bar: a draw MERGES by element id rather than
    // replacing the element set, and `px_matrix_img` -- the full-panel PNG
    // `sendPixelFrame` draws -- composites ABOVE `hardware_anim` whichever
    // order the two arrive in. So the previous screen's frame, or the blank one
    // `DisplayRenderer` sends after clearing its canvas, stays on top of the
    // animation forever. Drawing the animation second does not help; only
    // removing the image does.
    //
    // So a failed clear is a failed start, not a detail: the animation would
    // be drawn underneath an opaque frame and the bar would stay black.
    try {
      await this.driver.clearDisplay(DEVICE_APPLICATION_NAME);
    } catch (err) {
      if (superseded()) return;
      console.error(
        `[AnimationPlayer] Could not clear the display before playing ${animName}.anim: ${describeError(err)}. ` +
          'Falling back to streaming frames.'
      );
      this.fallBackToFrameStreaming(animData);
      return;
    }
    if (superseded()) return;

    let outcome: DrawOutcome;
    try {
      outcome = await this.driver.sendDisplayPayload({
        application_name: DEVICE_APPLICATION_NAME,
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
      });
    } catch (err) {
      if (superseded()) return;
      console.error(
        `[AnimationPlayer] Device stored ${animName}.anim (${bytes} bytes) but refused to draw it: ${describeError(err)}. ` +
          'Falling back to streaming frames.'
      );
      this.fallBackToFrameStreaming(animData);
      return;
    }
    if (superseded()) return;

    if (outcome === 'conflict') {
      // Not a refusal: something with a higher priority holds the display, so
      // the animation element was never placed. Streaming keeps offering frames
      // and one lands as soon as the display is released, where a one-shot
      // draw that lost the race would leave the bar without the animation for
      // the rest of the break.
      console.log(
        `[AnimationPlayer] Display is held at a higher priority; streaming ${animName} frames until it is released.`
      );
      this.fallBackToFrameStreaming(animData);
      return;
    }

    console.log(`[AnimationPlayer] Device is playing ${animName}.anim (${bytes} bytes).`);
  }

  /**
   * Drops to PNG streaming after the device declined the `.anim`.
   *
   * The interval is rebuilt at the animation's real frame rate: the running one
   * is capped to `HARDWARE_PREVIEW_MAX_FPS` because it was only feeding the
   * on-screen preview, and leaving it there would play the fallback on the bar
   * at a quarter speed for no reason.
   */
  private fallBackToFrameStreaming(animData: AnimationData): void {
    this.hardwareAnimActive = false;
    this.startFrameInterval(animData, Math.max(1, Math.floor(1000 / animData.fps)));
    this.drawCurrentFrame();
  }

  /** Restarts the frame timer, replacing any timer already running. */
  private startFrameInterval(animData: AnimationData, frameIntervalMs: number): void {
    if (this.intervalId) clearInterval(this.intervalId);
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
    // Cleared with the rest of the playback state: left set, the next animation
    // without a .anim would have its frame streaming suppressed by a flag
    // describing the previous one.
    this.hardwareAnimActive = false;
  }

  /**
   * Whether the device is currently playing a `.anim` on the front display.
   *
   * `DisplayRenderer` reads this to keep `transmitFrame` from drawing a
   * `px_matrix_img` over the animation -- see the comment in
   * `startHardwareAnimation` for why that image always wins.
   */
  public isHardwareAnimationActive(): boolean {
    return this.hardwareAnimActive;
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

    // Stream to hardware unless the device is genuinely playing the .anim
    // itself. Keyed on the flag rather than on `animBuffer` alone, because
    // having the file says nothing about whether the device accepted it.
    if (!animData.animBuffer || !this.hardwareAnimActive) {
      const ledColor = this.getLedColorCallback ? this.getLedColorCallback() : undefined;
      
      // We send the PNG buffer directly to the hardware using an image element payload.
      // The driver uploads the frame and executes POST /api/display/draw.
      // Not awaited: the next tick sends the next frame regardless, so a
      // refused one is only worth a log line.
      void this.driver.sendPixelFrame(
        frameBuffer,
        ledColor,
        DEVICE_APPLICATION_NAME,
        'anim_frame.png',
        95
      ).catch(err => console.error(`[AnimationPlayer] Frame draw failed:`, err));
    }

    if (this.onFrameCallback) {
      this.onFrameCallback(frameBuffer, this.frameIndex);
    }
  }
}
