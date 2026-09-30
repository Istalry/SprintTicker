import { defineConfig } from 'vite';
import path from 'path';
import { ELECTRON_NODE_TARGET } from './build-targets';

/**
 * Native C++ addons (better-sqlite3), Electron built-ins, and Node.js built-ins
 * are externalized so Electron loads them natively.
 *
 * The packages named here are exactly the app's runtime `dependencies`, and
 * `tests/runtime-dependencies.test.ts` holds the two lists equal. Everything
 * else main imports is bundled into dist/main/index.js, so electron-builder --
 * which packs every `dependencies` entry into the installer -- must not see it
 * there. React, lucide and the fonts once did: 39 MB of the 42 MB app.asar was
 * source that Vite had already bundled.
 */
export const ELECTRON_EXTERNALS: (string | RegExp)[] = [
  // Electron built-in
  'electron',

  // Native addon: better-sqlite3 13 loads a prebuilt N-API binary from its
  // own prebuilds/ directory, so it must never be bundled.
  'better-sqlite3',
  'ws',

  // All Node.js built-in modules (node: protocol and classic form)
  /^node:/,
  'path',
  'fs',
  'os',
  'events',
  'child_process',
  'http',
  'https',
  'net',
  'tls',
  'stream',
  'util',
  'crypto',
  'url',
  'assert',
  'buffer',
  'querystring',
  'zlib',
  'timers',
  'readline',
];

export default defineConfig({
  // public/ is the renderer's. Copying it here put a second and third
  // icon.png and favicon.ico into the installer, which nothing loads.
  publicDir: false,
  build: {
    target: ELECTRON_NODE_TARGET,
    lib: {
      entry: path.resolve(__dirname, 'src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: path.resolve(__dirname, 'dist/main'),
    // Left to the `build` script, which deletes dist/ first: a watcher in
    // `pnpm dev` emptying its directory mid-session is not worth the risk.
    emptyOutDir: false,
    rollupOptions: {
      external: ELECTRON_EXTERNALS,
    },
    sourcemap: true,
    minify: false,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
    },
  },
});
