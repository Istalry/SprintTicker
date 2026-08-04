import { defineConfig } from 'vite';
import path from 'path';

/**
 * Native C++ addons (better-sqlite3), Electron built-ins, and Node.js built-ins
 * are externalized so Electron loads them natively.
 */
const ELECTRON_EXTERNALS: (string | RegExp)[] = [
  // Electron built-in
  'electron',

  // Native addon (pre-built binary — must never be bundled)
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
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
  build: {
    target: 'node18',
    lib: {
      entry: path.resolve(__dirname, 'src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: path.resolve(__dirname, 'dist/main'),
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
