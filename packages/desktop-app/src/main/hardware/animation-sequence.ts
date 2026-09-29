import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * Reading an animation off disk, shared by the full-screen `AnimationPlayer`
 * and the 16x16 `IconAnimator`.
 *
 * Both read the same layout -- `Animations/<name>/<name>/`, PNG frames, a
 * `meta.json` and optionally `<name>.anim` -- and a second copy of this code
 * would be the duplicated-constant hazard in another shape: the day one of them
 * learned a new rule about frame names, the other would silently sort frames
 * the old way.
 */
export interface AnimationData {
  name: string;
  fps: number;
  /** PNG-encoded frames, in play order. */
  frames: Buffer[];
  /** The compiled `.anim`, when there is one; the device plays it itself. */
  animBuffer?: Buffer;
}

/** Frames read concurrently while loading. */
const FRAME_READ_CONCURRENCY = 16;

/** What a sequence without a readable `meta.json` is played at. */
const DEFAULT_FPS = 10;

/**
 * Extracts the frame index from a file name.
 *
 * The previous implementation stripped every non-digit and parsed what was
 * left, so `anim2_frame_10.png` sorted as 210. It happened to work only because
 * the shipped animations have no digits before the frame number. Taking the
 * last run of digits is what was meant.
 */
export function frameNumber(fileName: string): number {
  const groups = fileName.match(/\d+/g);
  if (!groups || groups.length === 0) return 0;
  return parseInt(groups[groups.length - 1], 10);
}

/** The repository's `Animations/` in development, `resources/Animations` when packaged. */
export function defaultAnimationsDir(): string {
  return app?.isPackaged
    ? path.join(process?.resourcesPath || '', 'Animations')
    : path.resolve(__dirname, '../../../../Animations');
}

/**
 * Loads one animation, or answers null when there is nothing playable.
 *
 * Null is logged, never thrown: a missing animation is a degraded screen, not
 * a reason to fail the render that asked for it.
 *
 * @param isCancelled checked between batches of frames, so a load that nobody
 *   wants any more stops reading a thousand files.
 */
export async function loadAnimationSequence(
  animationsDir: string,
  animName: string,
  isCancelled: () => boolean = () => false
): Promise<AnimationData | null> {
  try {
    let targetDir = path.join(animationsDir, animName);
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
    let fps = DEFAULT_FPS;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.fps) {
          fps = Number(meta.fps);
        }
      } catch {
        console.warn(`[AnimationPlayer] Failed to parse meta.json for ${animName}, defaulting to ${DEFAULT_FPS} fps`);
      }
    }

    const files = await fs.promises.readdir(targetDir);
    const frameFiles = files
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => frameNumber(a) - frameNumber(b));

    if (frameFiles.length === 0) {
      console.warn(`[AnimationPlayer] No PNG frames found for animation: ${animName}`);
      return null;
    }

    // Asynchronously and in batches. 1,080 synchronous reads blocked the main
    // process -- and with it every IPC reply, the tray, and the window -- for
    // as long as the whole animation took to load off disk.
    const frames: Buffer[] = new Array(frameFiles.length);
    for (let i = 0; i < frameFiles.length; i += FRAME_READ_CONCURRENCY) {
      const batch = frameFiles.slice(i, i + FRAME_READ_CONCURRENCY);
      const buffers = await Promise.all(batch.map(file => fs.promises.readFile(path.join(targetDir, file))));
      buffers.forEach((buffer, offset) => {
        frames[i + offset] = buffer;
      });

      if (isCancelled()) {
        return null;
      }
    }

    let animBuffer: Buffer | undefined;
    const animFilePath = path.join(targetDir, `${animName}.anim`);
    if (fs.existsSync(animFilePath)) {
      animBuffer = await fs.promises.readFile(animFilePath);
    }

    console.log(
      `[AnimationPlayer] Loaded animation '${animName}' with ${frames.length} frames at ${fps} fps` +
        `${animBuffer ? ' (Hardware Accelerated)' : ''}`
    );
    return { name: animName, fps, frames, animBuffer };
  } catch (err) {
    console.error(`[AnimationPlayer] Error loading animation ${animName}:`, err);
    return null;
  }
}
