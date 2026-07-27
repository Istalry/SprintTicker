import { defineConfig } from 'vite';
import path from 'path';

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
  build: {
    target: 'node18',
    lib: {
      entry: path.resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    outDir: path.resolve(__dirname, 'dist/preload'),
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
