import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isValidDeviceHost } from '../../desktop-app/src/shared/device-constants';
import { DeviceModule, RenderedSequence, writeSequence } from './export';

/**
 * Plays a scene on a real bar, because an animation cannot be judged on a
 * monitor: the LEDs' brightness, bleed and colour are nothing like a screen's.
 *
 * It compiles the scene exactly as an export would and plays the `.anim` the
 * way the app does, so what is seen is what will ship.
 */

/** Its own name, so clearing the preview can never remove the app's elements. */
export const STUDIO_APP = 'sprintticker_studio';

/**
 * Above the app's 95, so the preview shows over whatever the app is drawing.
 * 100 is the device's ceiling. The app's draws get 409 meanwhile, which it
 * already treats as "someone else holds the display", not as a failure.
 */
export const PREVIEW_PRIORITY = 100;

/**
 * How long the device keeps the preview if nothing stops it. A studio closed
 * without pressing Stop must not leave the bar stuck on a preview.
 */
export const PREVIEW_TIMEOUT_S = 300;

const PREVIEW_FILE = 'studio_preview.anim';

export interface BarTarget {
  host: string;
  token: string;
}

/**
 * What a preview needs from the outside world, passed in so the tests can
 * answer as a refusing device would without a bar or Python.
 */
export interface PreviewDeps {
  device: DeviceModule;
  /** Compiles a sequence folder to a `.anim` and resolves with its size. */
  compile: (dir: string, outFile: string) => Promise<number>;
}

export interface PreviewResult {
  bytes: number;
  status: number;
  message: string;
}

function assertHost(target: BarTarget): void {
  // The app's own allow-list: the host is typed by a person, and one stray `/`
  // or `@` would otherwise aim these requests somewhere else entirely.
  if (!isValidDeviceHost(target.host)) throw new Error(`"${target.host}" is not an IP address or hostname`);
}

export async function previewOnBar(target: BarTarget, sequence: RenderedSequence, { device, compile }: PreviewDeps): Promise<PreviewResult> {
  assertHost(target);
  const client = device.createDeviceClient({ host: target.host.trim(), token: target.token, timeoutMs: 15_000 });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-studio-'));
  try {
    const dir = path.join(work, 'seq');
    writeSequence(dir, sequence, device.encodePng);
    const animFile = path.join(work, PREVIEW_FILE);
    const bytes = await compile(dir, animFile);

    const upload = await client.request('POST', `/api/assets/upload?application_name=${STUDIO_APP}&file=${PREVIEW_FILE}`, {
      body: fs.readFileSync(animFile),
      contentType: 'application/octet-stream'
    });
    if (upload.status < 200 || upload.status >= 300) {
      return { bytes, status: upload.status, message: `The bar would not store the file (${upload.status} ${upload.body.slice(0, 120)}).` };
    }

    // Remove the previous preview first. A draw merges by element id, and an
    // older element left in place can sit on top of the new one.
    await client.request('DELETE', `/api/display/draw?application_name=${STUDIO_APP}`);

    const draw = await client.request('POST', '/api/display/draw', {
      body: {
        application_name: STUDIO_APP,
        priority: PREVIEW_PRIORITY,
        elements: [
          {
            id: 'studio_preview',
            type: 'animation',
            path: PREVIEW_FILE,
            x: 0,
            y: 0,
            display: 'front',
            loop: true,
            section: 'default',
            timeout: PREVIEW_TIMEOUT_S
          }
        ]
      }
    });
    if (draw.status === 409) {
      return { bytes, status: 409, message: 'Something with a higher priority holds the display.' };
    }
    if (draw.status < 200 || draw.status >= 300) {
      return { bytes, status: draw.status, message: `The bar stored the file but would not draw it (${draw.status} ${draw.body.slice(0, 120)}).` };
    }
    return { bytes, status: draw.status, message: `Playing on ${target.host} for up to ${PREVIEW_TIMEOUT_S / 60} minutes.` };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Takes the preview off the bar and deletes its file there.
 *
 * Both requests are always made -- a failed clear is no reason to leave the
 * file behind -- and the answer says which, if either, the bar refused.
 */
export async function stopPreview(target: BarTarget, device: DeviceModule): Promise<string> {
  assertHost(target);
  const client = device.createDeviceClient({ host: target.host.trim(), token: target.token });
  const draw = await client.request('DELETE', `/api/display/draw?application_name=${STUDIO_APP}`);
  const assets = await client.request('DELETE', `/api/assets/upload?application_name=${STUDIO_APP}`);
  const refused = [
    draw.status >= 300 ? `clearing the display (${draw.status})` : '',
    assets.status >= 300 ? `deleting the file (${assets.status})` : ''
  ].filter(Boolean);
  return refused.length === 0 ? 'Preview removed from the bar.' : `The bar refused ${refused.join(' and ')}.`;
}
