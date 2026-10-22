import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STOPWATCH_16X16_BITMAP } from '../../../desktop-app/src/shared/pixel-bitmaps';
import { faceFor } from '../faces';
import { KEY_KINDS, KeyKind } from '../key-kinds';
import { renderFace, renderListIcon } from '../svg';
import type { Glyph } from '../faces';
import { ledTilePng } from './png';

/**
 * Writes the images the manifest names, and the `package.json` that makes
 * Node read the bundle as a module. Generated rather than kept in git: the
 * keys' default faces are the same faces the plugin draws, so a change to
 * one cannot leave the other behind.
 */

/** The plugin's folder, as Stream Deck installs it. */
export const PLUGIN_DIR_NAME = 'io.github.istalry.sprintticker.sdPlugin';

/** The glyph each action shows in Stream Deck's action list. */
const LIST_GLYPHS: Record<KeyKind, Glyph> = {
  session: 'timer',
  'not-done': 'stop',
  done: 'check',
  discard: 'trash',
  switch: 'list',
  favourite: 'star',
  yes: 'yes',
  no: 'no',
  away: 'coffee'
};

/** Every file written, relative to the plugin's folder, with its content. */
export function pluginAssets(): Map<string, string | Buffer> {
  const files = new Map<string, string | Buffer>();
  // The manifest's plugin icon: PNG only, 256 and 512 (@2x).
  files.set('imgs/plugin.png', ledTilePng(STOPWATCH_16X16_BITMAP, 256));
  files.set('imgs/plugin@2x.png', ledTilePng(STOPWATCH_16X16_BITMAP, 512));
  files.set('imgs/category.svg', renderListIcon('timer', 28));
  for (const kind of KEY_KINDS) {
    files.set(`imgs/actions/${kind}.svg`, renderListIcon(LIST_GLYPHS[kind], 20));
    // A key's face before the plugin first draws it: the app not reached yet.
    const offline = faceFor(kind, { link: 'offline', message: null, now: new Date(0), armed: false });
    files.set(`imgs/keys/${kind}.svg`, renderFace(offline, 72));
  }
  // The bundle is ESM; without this, Node reads `bin/plugin.js` as CommonJS.
  files.set('bin/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  return files;
}

/** Writes them under `pluginDir`. */
export function writeAssets(pluginDir: string): string[] {
  const written: string[] = [];
  for (const [relative, content] of pluginAssets()) {
    const target = path.join(pluginDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(relative);
  }
  return written;
}

// Run as the build's last step (`node build/write-assets.js`), from the package's folder.
if (process.argv[1] && path.basename(process.argv[1]) === 'write-assets.js') {
  const dir = path.resolve(process.cwd(), PLUGIN_DIR_NAME);
  const written = writeAssets(dir);
  console.log(`[streamdeck-plugin] Wrote ${written.length} files into ${PLUGIN_DIR_NAME}.`);
}
