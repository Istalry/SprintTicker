import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: [
        'src/main/index.ts',
        'src/preload/**/*.ts',
        'src/main/providers/task-provider-interface.ts',
        // Pure data and constants: no branches to cover, and counting them
        // dilutes the figure for code that does have logic.
        'src/shared/render-constants.ts',
        'src/shared/pixel-fonts.ts',
        'src/shared/pixel-bitmaps.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
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





