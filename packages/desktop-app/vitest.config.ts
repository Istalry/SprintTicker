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
        'src/shared/pixel-bitmaps.ts',
        // Generated from the firmware's LVGL font by tools/lvgl-font-to-ts.js.
        'src/shared/busy-font.ts'
      ],
      // A ratchet, not a target. Raise these as coverage improves; never
      // lower them to make a run pass.
      //
      // They dropped from 80/70 when @vitest/coverage-v8 went from 1 to 5, on
      // an unchanged suite of 346 passing tests: 88.15% statements became
      // 76.19%. Nothing regressed. AST-aware remapping is the default from v2
      // onward, and the old provider counted a whole line as covered when any
      // part of it executed -- which is why statements and lines used to report
      // the identical 88.15% and now differ. The earlier figure was generous;
      // this one is real, and the README's "80%+" claim was resting on the
      // generous one.
      //
      // The 80/70 target is met as of the Jira provider: statements crossed 80
      // and branches 71 on the honest metric. Still ratcheted to just under
      // the measured figures, so a regression fails the build with ~1% of
      // headroom for an unrelated refactor.
      // Raised again with the hardware task picker and the tray context menu:
      // measured 82.77 / 74.06 / 84.15 / 84.98. `input-decoder.ts` went from
      // 66% to 94% and `tray-manager.ts` from 69% to 92%, which is most of the
      // move -- both were untested behaviour a user reaches with a physical
      // button or a tray click, not percentage-chasing.
      thresholds: {
        lines: 84.5,
        functions: 83.5,
        branches: 73.5,
        statements: 82
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





