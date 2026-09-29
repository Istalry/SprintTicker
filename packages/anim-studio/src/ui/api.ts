import { parseScene, Scene } from '../model/scene';

/** The studio server's API, as the page sees it. See `server/plugin.ts`. */

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${method} ${path} failed with ${res.status}`);
  return json;
}

export async function listScenes(): Promise<string[]> {
  return (await call<{ scenes: string[] }>('GET', '/api/scenes')).scenes;
}

export async function loadScene(id: string): Promise<Scene> {
  const { scene } = await call<{ scene: unknown }>('GET', `/api/scenes/${encodeURIComponent(id)}`);
  return parseScene(scene);
}

export async function saveScene(scene: Scene): Promise<void> {
  await call('PUT', `/api/scenes/${encodeURIComponent(scene.id)}`, scene);
}

export interface ExportResult {
  dir: string;
  frames: number;
  animBytes: number | null;
}

export function exportScene(scene: Scene, compile: boolean): Promise<ExportResult> {
  return call('POST', '/api/export', { scene, compile });
}

export interface BarDefaults {
  host: string;
  hasEnvToken: boolean;
}

export function barDefaults(): Promise<BarDefaults> {
  return call('GET', '/api/bar/defaults');
}

export interface PreviewResult {
  bytes: number;
  status: number;
  message: string;
}

export function previewOnBar(scene: Scene, host: string, token: string): Promise<PreviewResult> {
  return call('POST', '/api/bar/preview', { scene, host, token });
}

export async function stopBarPreview(host: string, token: string): Promise<string> {
  return (await call<{ message: string }>('POST', '/api/bar/stop', { host, token })).message;
}
