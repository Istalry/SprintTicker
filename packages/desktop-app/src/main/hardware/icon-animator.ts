import { BusyBarDriver, DEFAULT_DRAW_PRIORITY } from './busybar-driver';
import { describeError, isElementAbsent } from './device-errors';
import { AnimationData } from './animation-sequence';
import { DEVICE_APPLICATION_NAME, FRONT_ELEMENT_IDS, FRONT_LAYER_Z } from '../../shared/device-constants';
import { ArgumentNullException } from '../../shared/dtos';

/** The device element the animated icon is drawn as. One at a time, so one id. */
export const ICON_ELEMENT_ID = FRONT_ELEMENT_IDS.ICON;

/** The slice of the driver this needs, so a test can hand it exactly that. */
export type IconAnimatorDriver = Pick<BusyBarDriver, 'uploadAsset' | 'drawOverlay' | 'removeDisplayElements'>;

export interface IconAnimatorOptions {
  /**
   * Receives the icon's current frame as a 16x16 PNG, or null when there is no
   * animated icon to show. Feeds the on-screen emulator only; the device plays
   * the `.anim` on its own and needs nothing per frame.
   */
  onPreviewFrame?: (frame: Buffer | null) => void;
  /** Injected so tests can step the preview clock. */
  now?: () => number;
}

/**
 * Plays an animated 16x16 icon over the left of the front panel.
 *
 * The screen itself is still one full-panel PNG with the icon's *static*
 * pixels in it. This draws the icon's `.anim` as a separate `animation`
 * element above that, at a higher `z_index`, so:
 *
 * - **the device animates it on its own**, at no HTTP cost per frame, once the
 *   `.anim` is uploaded -- which happens once per connection, not per screen;
 * - **the static icon is the fallback.** Refused, not yet uploaded, removed, or
 *   held off by a 409: in every case the panel still shows the icon, only not
 *   moving. There is no failure here that leaves a hole in the screen, which
 *   is the "keep the working path" rule applied without a second code path.
 *
 * `show()` is called with every frame the renderer transmits and is cheap when
 * nothing changes: the tracker redraws once a second and must not cost a
 * request each time. Device calls are serialised through one loop, because two
 * screens a few milliseconds apart would otherwise race an upload against a
 * removal.
 */
export class IconAnimator {
  /** The emulator needs no more than this; the device plays at the file's own rate. */
  private static readonly PREVIEW_MAX_FPS = 15;

  private desired: string | null = null;
  /** What the device is believed to be showing; null for "no icon element". */
  private drawn: string | null = null;
  private readonly uploaded = new Set<string>();
  /** Icons the device would not take. Not retried until `reset()`. */
  private readonly refused = new Set<string>();
  private readonly sequences = new Map<string, Promise<AnimationData | null>>();
  private pumping = false;
  private dirty = false;
  private previewTimer: NodeJS.Timeout | null = null;
  private previewStartedAt = 0;
  private readonly onPreviewFrame?: (frame: Buffer | null) => void;
  private readonly now: () => number;

  constructor(
    private readonly driver: IconAnimatorDriver,
    private readonly loadSequence: (name: string) => Promise<AnimationData | null>,
    options: IconAnimatorOptions = {}
  ) {
    if (!driver) throw new ArgumentNullException('driver');
    if (!loadSequence) throw new ArgumentNullException('loadSequence');
    this.onPreviewFrame = options.onPreviewFrame;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Asks for `name` to be the animated icon, or for none.
   *
   * Returns at once; the device work happens behind it. A name the device has
   * refused is not retried, and the static icon stands in for it.
   */
  public show(name: string | null): void {
    if (name === this.desired && name === this.drawn) return;
    const changed = name !== this.desired;
    this.desired = name;
    if (changed) this.restartPreview();
    void this.pump();
  }

  /**
   * Forgets what the device holds, after something changed it behind our back:
   * a full clear, a reconnect, a device that may have rebooted and lost its
   * assets. The next `show()` uploads and draws again, and icons refused before
   * get another chance.
   */
  public reset(): void {
    this.drawn = null;
    this.uploaded.clear();
    this.refused.clear();
  }

  public dispose(): void {
    this.stopPreviewTimer();
  }

  /** Test seam: resolves once no device work is pending. */
  public async settled(): Promise<void> {
    while (this.pumping) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      this.dirty = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.dirty = false;
        await this.apply(this.desired);
      } while (this.dirty);
    } catch (err) {
      // `apply` handles every device failure itself; reaching here is a bug in
      // that handling, and it must not become an unhandled rejection.
      console.error('[IconAnimator] Unexpected failure:', err);
    } finally {
      this.pumping = false;
    }
  }

  private async apply(target: string | null): Promise<void> {
    if (target === null) {
      if (this.drawn !== null) await this.remove();
      return;
    }
    if (target === this.drawn || this.refused.has(target)) return;

    const sequence = await this.sequence(target);
    if (this.desired !== target) return;
    if (!sequence?.animBuffer) {
      this.refuse(target, `no ${target}.anim to hand the device`);
      return;
    }

    // Twice at most: an upload we believe landed may be gone -- a device that
    // rebooted keeps no assets -- so a refused draw of a cached upload gets one
    // fresh upload before the icon is written off.
    for (let attempt = 0; attempt < 2; attempt++) {
      const freshUpload = !this.uploaded.has(target);
      if (freshUpload && !(await this.upload(target, sequence.animBuffer))) return;
      if (this.desired !== target) return;

      try {
        const outcome = await this.driver.drawOverlay(DEVICE_APPLICATION_NAME, [this.element(target)], DEFAULT_DRAW_PRIORITY);
        if (outcome === 'conflict') {
          // Another application holds the display; our frame got the same 409.
          // Not refused: the next `show()` tries again.
          console.log(`[IconAnimator] Display held at a higher priority; ${target} stays static for now.`);
          return;
        }
        this.drawn = target;
        console.log(`[IconAnimator] Device is animating ${target}.`);
        return;
      } catch (err) {
        if (freshUpload) {
          this.refuse(target, `device stored ${target}.anim but would not draw it: ${describeError(err)}`);
          return;
        }
        this.uploaded.delete(target);
      }
    }
  }

  private async upload(name: string, anim: Buffer): Promise<boolean> {
    try {
      await this.driver.uploadAsset(DEVICE_APPLICATION_NAME, `${name}.anim`, anim);
      this.uploaded.add(name);
      return true;
    } catch (err) {
      this.refuse(name, `device would not store ${name}.anim (${anim.length} bytes): ${describeError(err)}`);
      return false;
    }
  }

  private async remove(): Promise<void> {
    try {
      await this.driver.removeDisplayElements(DEVICE_APPLICATION_NAME, [ICON_ELEMENT_ID]);
      this.drawn = null;
    } catch (err) {
      // The device answers 400 for an element that is not there -- measured on
      // firmware 1.2.4 -- which is what a clear for the idle clock, or a
      // higher-priority application taking the panel, leaves behind. Gone is
      // what was wanted.
      if (isElementAbsent(err)) {
        this.drawn = null;
        return;
      }
      // Kept as drawn so the next `show(null)` tries again: an icon left
      // animating over the next screen would be showing the wrong thing.
      console.warn(`[IconAnimator] Could not remove the animated icon: ${describeError(err)}`);
    }
  }

  private refuse(name: string, reason: string): void {
    this.refused.add(name);
    console.error(`[IconAnimator] ${reason}. The static icon stays in its place.`);
    // The emulator must not animate an icon the bar is showing static: a
    // preview that disagrees with the hardware is how the dark-bar bug hid.
    if (this.desired === name) {
      this.stopPreviewTimer();
      this.onPreviewFrame?.(null);
    }
  }

  private element(name: string): Record<string, unknown> {
    return {
      id: ICON_ELEMENT_ID,
      type: 'animation',
      path: `${name}.anim`,
      x: 0,
      y: 0,
      display: 'front',
      loop: true,
      section: 'default',
      z_index: FRONT_LAYER_Z.ICON
    };
  }

  private sequence(name: string): Promise<AnimationData | null> {
    let pending = this.sequences.get(name);
    if (!pending) {
      pending = this.loadSequence(name);
      this.sequences.set(name, pending);
    }
    return pending;
  }

  private restartPreview(): void {
    this.stopPreviewTimer();
    if (!this.onPreviewFrame) return;
    const name = this.desired;
    if (name === null || this.refused.has(name)) {
      this.onPreviewFrame(null);
      return;
    }
    this.previewStartedAt = this.now();
    void this.startPreview(name);
  }

  private async startPreview(name: string): Promise<void> {
    const sequence = await this.sequence(name);
    if (this.desired !== name || this.refused.has(name) || !this.onPreviewFrame) return;
    if (!sequence || sequence.frames.length === 0) {
      this.onPreviewFrame(null);
      return;
    }
    const emit = this.onPreviewFrame;
    // By elapsed time rather than one frame per tick, so the preview runs at
    // the animation's real speed however slowly it is sampled.
    const tick = (): void => {
      const elapsed = (this.now() - this.previewStartedAt) / 1000;
      const index = Math.floor(elapsed * sequence.fps) % sequence.frames.length;
      emit(sequence.frames[index]);
    };
    this.stopPreviewTimer();
    tick();
    this.previewTimer = setInterval(tick, Math.floor(1000 / IconAnimator.PREVIEW_MAX_FPS));
    // A preview must not hold the process open at quit.
    this.previewTimer.unref?.();
  }

  private stopPreviewTimer(): void {
    if (this.previewTimer) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
  }
}
