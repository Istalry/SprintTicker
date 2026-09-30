// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Flat config, replacing `.eslintrc.cjs` (ESLint 8 reached end of life).
 *
 * Two things about flat config that are not obvious and cost real time:
 *
 * - **`.eslintignore` is not read any more.** Its contents have to live in the
 *   `ignores` object below, and that file is deleted rather than left as a
 *   second source of truth that silently does nothing. Without this, `scripts/`
 *   and `tools/` -- deliberately unlinted, untyped, dependency-free CommonJS --
 *   get linted for the first time and the migration looks catastrophic.
 * - **`--ext` no longer exists.** The extensions are the `files` globs here, and
 *   the root `lint` script is a plain `eslint packages`.
 *
 * The ordering matters: later objects override earlier ones for the files they
 * match, which is what the per-process overrides at the bottom rely on.
 */
export default tseslint.config(
  // Global ignores. A config object with only `ignores` applies everywhere,
  // which is flat config's replacement for `.eslintignore`.
  {
    ignores: [
      // Build output
      '**/dist/**',
      '**/build/**',
      '**/release/**',
      '**/out/**',
      // Generated reports
      '**/coverage/**',
      // Vendored / third-party
      'packages/unity-plugin/**',
      'Documentation/**',
      // Standalone tools that are not part of the TypeScript build
      'tools/**',
      'scripts/**',
      // Plain JavaScript was never linted here: the ESLint 8 invocation was
      // `--ext .ts,.tsx`, and flat config has no `--ext`, so without this the
      // build's own config files (postcss, tailwind) get linted for the first
      // time and fail on `module is not defined`. Keeping them out preserves
      // exactly what the previous gate checked. Bringing them in is a
      // reasonable idea and a separate decision, not a side effect of this
      // migration.
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // `env:` does not exist in flat config; globals are declared outright.
      // Both sets are supplied here because `src/shared/**` is consumed by the
      // main process and the renderer alike and must type-check under either.
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: {
      react: { version: '18.2' }
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // The React Compiler set, in full, since 2026-09-30. It was held back to
      // the two classic rules until the renderer had smoke tests; its 16
      // findings were fixed under them, not suppressed.
      //
      // The one that shapes code most is set-state-in-effect. It flags any
      // call, in an effect's body, to a local function that sets state --
      // including one that only sets it after an `await`, because the
      // compiler does not model `await`. State set in a `.then` callback or a
      // subscription callback is fine. So a read that an effect starts is a
      // promise chain, or a stateless reader whose answer is applied in
      // `.then`; see useWorklogs.
      ...reactHooks.configs['recommended-latest'].rules,
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },

  {
    // Type-aware rules, deliberately curated.
    //
    // Not `tseslint.configs.recommendedTypeChecked`: that produces hundreds of
    // findings on this codebase and would be switched off within a day. These
    // two each catch a class of bug that has actually shipped here -- the
    // `will-quit` handler was `async`, so Electron never awaited it and the
    // teardown after the first await was dead code. no-misused-promises catches
    // exactly that, statically.
    files: ['packages/desktop-app/**/*.ts', 'packages/desktop-app/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // Kept as an explicit `project` rather than `projectService: true`.
        // tsconfig.eslint.json exists on purpose -- it is the widest program, so
        // that tests and the Vite configs are covered too -- and the service
        // would change which files resolve without anyone deciding to.
        project: ['./packages/desktop-app/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // `attributes` is off because `onClick={async () => ...}` is idiomatic
      // React and accounts for 39 of the 43 findings; the sub-checks that
      // remain cover the dangerous shapes, such as an async callback handed
      // to setInterval.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } }
      ],
      '@typescript-eslint/await-thenable': 'error'
    }
  },

  {
    // An unhandled rejection terminates the process on Node 15+, so in the
    // main process a floating promise is a crash, not an untidiness.
    files: ['packages/desktop-app/src/main/**/*.ts', 'packages/desktop-app/src/preload/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error'
    }
  },

  {
    // No `.then(` in the hardware layer. This is the shape that shipped the
    // dark-Away-animation bug twice: `uploadAsset(...).then(() => draw(...))`
    // runs the draw whether or not the upload succeeded, and a `.catch` hung off
    // it only sees a rejection -- so when the driver reported a refusal as a
    // value, neither handler ran. The driver throws now, which is the real fix;
    // this keeps the chained form from coming back, because awaiting each step
    // is what lets the caller see which one failed. `.catch(` on its own stays
    // allowed: it is how a deliberately unawaited call reports its failure.
    files: ['packages/desktop-app/src/main/hardware/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='then']",
          message:
            'Await device calls instead of chaining .then(): a chained step runs even when the one before it failed. See CLAUDE.md §6.'
        }
      ]
    }
  },

  {
    // In the renderer an unhandled rejection is logged by the browser and the
    // UI keeps running, so this is a warning while the remaining call sites
    // are worked through. Several of them sit in views slated for deletion.
    files: ['packages/desktop-app/src/renderer/**/*.ts', 'packages/desktop-app/src/renderer/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn'
    }
  },

  {
    // Process boundary: the renderer runs with contextIsolation and no Node
    // integration. Importing main-process code pulls `electron`, `fs` and
    // better-sqlite3 into the browser bundle, where they cannot work.
    // Anything genuinely shared belongs in src/shared/.
    files: ['packages/desktop-app/src/renderer/**/*.ts', 'packages/desktop-app/src/renderer/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/**', '../../main/*', '../main/*'],
              message:
                'Renderer code must not import from src/main/**. Move anything shared into src/shared/.'
            },
            {
              group: ['electron'],
              message:
                'Renderer code must not import electron directly. Go through the preload bridge (window.electronAPI).'
            }
          ]
        }
      ]
    }
  },

  {
    // The reverse direction: main must not depend on React components.
    files: ['packages/desktop-app/src/main/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/renderer/**', '../renderer/*'],
              message:
                'Main-process code must not import from src/renderer/**. Move anything shared into src/shared/.'
            }
          ]
        }
      ]
    }
  },

  {
    // The animation studio. Its server half runs inside the Vite dev server,
    // where an unhandled rejection kills `pnpm studio` mid-export, so floating
    // promises are errors here as in main. The page marks the ones it means to
    // leave unawaited with `void`.
    files: ['packages/anim-studio/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./packages/anim-studio/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // The studio reads the app's fonts and shared constants in place, and
      // nothing else: main pulls in electron and better-sqlite3, the renderer
      // pulls in React, and either would tie this tool to the app's stack --
      // the thing it was split out to avoid.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/desktop-app/src/main/**', '**/desktop-app/src/renderer/**', 'electron', 'react'],
              message: 'The studio may import only from desktop-app/src/shared/. See packages/anim-studio/README.md.'
            }
          ]
        }
      ]
    }
  },

  {
    // Tests may reach into either process to build fixtures.
    files: ['packages/desktop-app/tests/**/*.ts', 'packages/desktop-app/tests/**/*.tsx'],
    rules: {
      'no-restricted-imports': 'off'
    }
  }
);
