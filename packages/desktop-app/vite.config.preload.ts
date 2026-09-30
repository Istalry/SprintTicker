import { defineConfig } from 'vite';
import path from 'path';
import { ELECTRON_NODE_TARGET } from './build-targets';

const PRELOAD_EXTERNALS: (string | RegExp)[] = [
  'electron',
  /^node:/,
  'path',
  'fs',
  'events',
  'util',
  'buffer',
];

export default defineConfig({
  // public/ is the renderer's. Copying it here put a second and third
  // icon.png and favicon.ico into the installer, which nothing loads.
  publicDir: false,
  build: {
    target: ELECTRON_NODE_TARGET,
    lib: {
      entry: path.resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: path.resolve(__dirname, 'dist/preload'),
    // Left to the `build` script, which deletes dist/ first: a watcher in
    // `pnpm dev` emptying its directory mid-session is not worth the risk.
    emptyOutDir: false,
    rollupOptions: {
      external: PRELOAD_EXTERNALS,
    },
    sourcemap: true,
    minify: false,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
