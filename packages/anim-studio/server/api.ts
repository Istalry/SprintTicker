import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_USB_IP } from '../../desktop-app/src/shared/device-constants';
import { parseScene, SceneError } from '../src/model/scene';
import { BarTarget, PreviewDeps, previewOnBar, stopPreview } from './bar-preview';
import { compileAnim, loadDeviceModule, sequenceDir, writeSequence } from './export';
import { listScenes, loadScene, renderSequence, saveScene } from './scenes';

/**
 * The studio's local API, served by the Vite dev server itself.
 *
 * The browser half cannot write files or reach the bar -- a page on localhost
 * has no filesystem, and the bar sends no CORS headers -- so those few things
 * go through here. It is middleware on the dev server rather than a second
 * process, so `pnpm studio` is one command with one port.
 *
 * It is loaded by the dev server (`ssrLoadModule` in `vite.config.ts`), not
 * imported by the config: a config that imports TypeScript from across the
 * workspace is exactly what Vite's coming native config loader cannot load.
 */

export interface StudioPaths {
  repoRoot: string;
  scenesDir: string;
  animationsDir: string;
}

/** Scenes are small; anything larger than this is not a scene. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Refuses a request from any other origin.
 *
 * This API writes into the repository and drives hardware. Any page open in
 * the same browser can send a request to localhost, so without this a
 * website could POST an export over `Animations/` -- the Origin check is the
 * only thing standing between "a local tool" and "a local tool anyone can
 * drive".
 */
export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return; // not a browser, or a same-origin GET
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'bad origin');
  }
  if (originHost !== req.headers.host) throw new HttpError(403, 'cross-origin requests are refused');
}

function targetFrom(body: Record<string, unknown>): BarTarget {
  const host = typeof body.host === 'string' && body.host.trim() ? body.host.trim() : process.env.BUSYBAR_IP || DEFAULT_USB_IP;
  // An empty token field falls back to the environment, so a token need never
  // be typed into (or stored by) the page at all.
  const token = typeof body.token === 'string' && body.token ? body.token : process.env.BUSYBAR_TOKEN || '';
  return { host, token };
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, 'body must be an object');
  return value as Record<string, unknown>;
}

export interface StudioApi {
  /** Connect-style middleware: answers `/api/*`, passes everything else on. */
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  /** Takes any preview this session left on the bar back off it. */
  close(): Promise<void>;
}

export function createStudioApi(paths: StudioPaths): StudioApi {
  let lastTarget: BarTarget | null = null;
  const device = loadDeviceModule(paths.repoRoot);
  const previewDeps: PreviewDeps = {
    device,
    compile: (dir, outFile) => compileAnim(paths.repoRoot, dir, outFile)
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://studio.local');
    const method = req.method ?? 'GET';
    if (!url.pathname.startsWith('/api/')) return false;
    assertSameOrigin(req);

    if (method === 'GET' && url.pathname === '/api/scenes') {
      send(res, 200, { scenes: listScenes(paths.scenesDir) });
      return true;
    }

    const sceneMatch = /^\/api\/scenes\/([^/]+)$/.exec(url.pathname);
    if (sceneMatch) {
      const id = decodeURIComponent(sceneMatch[1]);
      if (method === 'GET') {
        send(res, 200, { scene: loadScene(paths.scenesDir, id) });
        return true;
      }
      if (method === 'PUT') {
        const scene = parseScene(await readJson(req));
        if (scene.id !== id) throw new HttpError(400, `scene id ${scene.id} does not match the URL (${id})`);
        saveScene(paths.scenesDir, scene);
        send(res, 200, { saved: id });
        return true;
      }
    }

    if (method === 'GET' && url.pathname === '/api/bar/defaults') {
      // Whether a token is configured, never the token itself.
      send(res, 200, { host: process.env.BUSYBAR_IP || DEFAULT_USB_IP, hasEnvToken: Boolean(process.env.BUSYBAR_TOKEN) });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/export') {
      const body = asObject(await readJson(req));
      const scene = parseScene(body.scene);
      const dir = sequenceDir(paths.animationsDir, scene.id);
      const files = writeSequence(dir, renderSequence(scene), device.encodePng);
      let animBytes: number | null = null;
      if (body.compile === true) {
        animBytes = await compileAnim(paths.repoRoot, dir, path.join(dir, `${scene.id}.anim`));
      }
      send(res, 200, { dir: path.relative(paths.repoRoot, dir), frames: files.length, animBytes });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/bar/preview') {
      const body = asObject(await readJson(req));
      const scene = parseScene(body.scene);
      const target = targetFrom(body);
      lastTarget = target;
      send(res, 200, await previewOnBar(target, renderSequence(scene), previewDeps));
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/bar/stop') {
      const target = targetFrom(asObject(await readJson(req)));
      const message = await stopPreview(target, device);
      lastTarget = null;
      send(res, 200, { message });
      return true;
    }

    throw new HttpError(404, `no route for ${method} ${url.pathname}`);
  }

  return {
    handle(req, res, next) {
      route(req, res)
        .then(handled => {
          if (!handled) next();
        })
        .catch((err: unknown) => {
          const status = err instanceof HttpError ? err.status : err instanceof SceneError ? 400 : 500;
          const message = err instanceof Error ? err.message : String(err);
          if (status >= 500) console.error(`[anim-studio] ${req.method} ${req.url}: ${message}`);
          send(res, status, { error: message });
        });
    },

    async close() {
      if (!lastTarget) return;
      const target = lastTarget;
      lastTarget = null;
      await stopPreview(target, device);
    }
  };
}
