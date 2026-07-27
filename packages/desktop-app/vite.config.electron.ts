import { defineConfig } from 'vite';
import path from 'path';

/**
 * All packages that must NOT be bundled by Rollup for the Electron main process.
 * They are kept in node_modules and required at runtime by Node.js / Electron.
 *
 * Fastify's internal dependency `avvio` uses dynamic CJS require() patterns that
 * Rollup cannot statically resolve, causing a "Cannot find module 'avvio'" crash
 * at startup when the main process output is loaded inside the Electron context.
 */
const ELECTRON_EXTERNALS: (string | RegExp)[] = [
  // Electron built-in
  'electron',

  // Fastify and all its internal sub-dependencies
  'fastify',
  'avvio',
  'find-my-way',
  'light-my-request',
  'pino',
  'pino-std-serializers',
  '@fastify/ajv-compiler',
  '@fastify/error',
  '@fastify/fast-json-stringify-compiler',
  'ajv',
  'fast-json-stringify',
  'fast-deep-equal',
  'fast-uri',
  'flatstr',
  'process-warning',
  'rfdc',
  'secure-json-parse',

  // Native addon (pre-built binary — must never be bundled)
  'better-sqlite3',

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
