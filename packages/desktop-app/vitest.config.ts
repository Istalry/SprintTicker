import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/preload/**/*.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 70,
        statements: 90
      }
    }
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer')
    }
  }
});





