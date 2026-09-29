import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { SCENE_ID_PATTERN } from '../src/model/scene';

/**
 * Writes a rendered scene out as the PNG sequence `scripts/build-anims.js`
 * compiles, and optionally compiles it.
 *
 * The layout is the one the app already reads, so an exported scene needs no
 * other change to play: `Animations/<id>/<id>/frame_00000.png ...` plus a
 * `meta.json`, and `<id>.anim` beside them once compiled.
 */

export interface RenderedSequence {
  id: string;
  width: number;
  height: number;
  fps: number;
  /** One tightly-packed RGBA buffer per frame, `width * height * 4` bytes. */
  frames: Uint8Array[];
}

/**
 * Frame files are numbered with no other digits in the name, because
 * `seq2anim.py` reads a frame's position from *every* digit in its filename:
 * `lunch_72x16_00003.png` would be frame 721600003.
 */
export function frameFileName(index: number): string {
  return `frame_${String(index).padStart(5, '0')}.png`;
}

const STUDIO_FILE = /^(frame_\d{5}\.png|meta\.json|[a-z0-9_-]+\.anim)$/;

export function sequenceDir(animationsDir: string, id: string): string {
  if (!SCENE_ID_PATTERN.test(id)) throw new Error(`invalid scene id ${JSON.stringify(id)}`);
  return path.join(animationsDir, id, id);
}

export interface DeviceResponse {
  status: number;
  body: string;
}

export interface DeviceClient {
  host: string;
  request(
    method: string,
    path: string,
    options?: { body?: unknown; contentType?: string; timeoutMs?: number }
  ): Promise<DeviceResponse>;
}

/**
 * The part of `scripts/lib/busybar-device.js` the studio uses. Declared here
 * because `scripts/` is deliberately untyped JavaScript; this is the one place
 * that has to agree with it.
 */
export interface DeviceModule {
  createDeviceClient(options: { host: string; token?: string; timeoutMs?: number }): DeviceClient;
  encodePng(width: number, height: number, rgba: Uint8Array): Buffer;
}

/** The shared CommonJS device helpers, loaded by absolute path so bundling cannot move them. */
export function loadDeviceModule(repoRoot: string): DeviceModule {
  const require = createRequire(import.meta.url);
  return require(path.join(repoRoot, 'scripts/lib/busybar-device.js')) as DeviceModule;
}

function validate(sequence: RenderedSequence): void {
  if (sequence.frames.length === 0) throw new Error('a sequence needs at least one frame');
  const expected = sequence.width * sequence.height * 4;
  sequence.frames.forEach((frame, i) => {
    if (frame.byteLength !== expected) {
      throw new Error(`frame ${i} is ${frame.byteLength} bytes; ${sequence.width}x${sequence.height} RGBA is ${expected}`);
    }
  });
}

/**
 * Writes the frames and `meta.json` into `dir`.
 *
 * Refuses a directory holding anything the studio did not write. The folders
 * beside these are the firmware's own frame sets, and an export whose id
 * happened to match one would otherwise delete a set nobody can regenerate
 * from this tool. Stale frames from a longer earlier export *are* removed --
 * `seq2anim.py` compiles every PNG in the folder, so a leftover frame 90 would
 * play after a new 60-frame scene.
 */
export function writeSequence(dir: string, sequence: RenderedSequence, encodePng: DeviceModule['encodePng']): string[] {
  validate(sequence);

  if (fs.existsSync(dir)) {
    const foreign = fs.readdirSync(dir).filter(name => !STUDIO_FILE.test(name));
    if (foreign.length > 0) {
      throw new Error(
        `${dir} holds files the studio did not write (${foreign.slice(0, 3).join(', ')}` +
          `${foreign.length > 3 ? ', ...' : ''}). Pick another scene id rather than overwrite them.`
      );
    }
    for (const name of fs.readdirSync(dir)) {
      if (/^frame_\d{5}\.png$/.test(name)) fs.rmSync(path.join(dir, name));
    }
  }
  fs.mkdirSync(dir, { recursive: true });

  const written: string[] = [];
  sequence.frames.forEach((rgba, i) => {
    const file = path.join(dir, frameFileName(i));
    fs.writeFileSync(file, encodePng(sequence.width, sequence.height, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)));
    written.push(file);
  });

  // `sections` must be present even when empty, and `color_mode` must be one
  // `seq2anim.py` knows; rgb888 because the panel has no alpha to show.
  const meta = { fps: sequence.fps, color_mode: 'rgb888', sections: [] };
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return written;
}

/**
 * Compiles a sequence folder into a `.anim` with the firmware toolchain.
 *
 * Resolves with the file's size, since that is the first thing worth knowing
 * about an animation the device might refuse.
 */
export function compileAnim(repoRoot: string, dir: string, outFile: string): Promise<number> {
  const script = path.join(repoRoot, 'scripts/busybar-anim-toolchain/seq2anim.py');
  const python = process.env.PYTHON || 'python';
  return new Promise((resolve, reject) => {
    execFile(python, [script, '-o', outFile, dir], { timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`seq2anim failed: ${stderr.trim() || err.message}. It needs Python with Pillow and colorlog.`));
        return;
      }
      // seq2anim reports conversion errors on stderr and still exits 0 from
      // some paths, so the file's existence is the real answer.
      if (!fs.existsSync(outFile)) {
        reject(new Error(`seq2anim produced no file: ${stderr.trim() || 'no output'}`));
        return;
      }
      resolve(fs.statSync(outFile).size);
    });
  });
}
