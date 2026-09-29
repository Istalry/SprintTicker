import fs from 'node:fs';
import path from 'node:path';
import { parseScene, Scene, SCENE_ID_PATTERN, serializeScene } from '../src/model/scene';
import { renderFrame } from '../src/render/compositor';
import type { RenderedSequence } from './export';

/**
 * Scene files on disk: `scenes/<id>.scene.json`, one per scene, committed with
 * the repository so an animation can be edited again rather than only
 * re-drawn from its PNGs.
 */

const SUFFIX = '.scene.json';

function fileFor(dir: string, id: string): string {
  // The id becomes a path segment, so it is checked here as well as by
  // parseScene: a request can name a scene without sending one.
  if (!SCENE_ID_PATTERN.test(id)) throw new Error(`invalid scene id ${JSON.stringify(id)}`);
  return path.join(dir, `${id}${SUFFIX}`);
}

export function listScenes(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith(SUFFIX))
    .map(name => name.slice(0, -SUFFIX.length))
    .filter(id => SCENE_ID_PATTERN.test(id))
    .sort();
}

export function loadScene(dir: string, id: string): Scene {
  const file = fileFor(dir, id);
  return parseScene(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Validates before writing, so a file on disk is always one the studio can open again. */
export function saveScene(dir: string, value: unknown): Scene {
  const scene = parseScene(value);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fileFor(dir, scene.id), serializeScene(scene));
  return scene;
}

/** Every frame of a scene, rendered by the same compositor the editor previews with. */
export function renderSequence(scene: Scene): RenderedSequence {
  const frames: Uint8Array[] = [];
  for (let f = 0; f < scene.frameCount; f++) {
    const raster = renderFrame(scene, f);
    frames.push(new Uint8Array(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength));
  }
  return { id: scene.id, width: scene.width, height: scene.height, fps: scene.fps, frames };
}
