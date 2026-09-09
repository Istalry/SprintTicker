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
      // Deliberately the two classic rules rather than
      // `reactHooks.configs['recommended-latest']`.
      //
      // eslint-plugin-react-hooks went 4 -> 7 in this migration (v4 has no flat
      // config at all), and v7's recommended set is the React Compiler one --
      // it adds `set-state-in-effect`, `purity` and `refs`, which report **16
      // findings** across the renderer. They look like real anti-patterns and
      // are probably worth fixing, but they are renderer refactoring in code
      // that has no tests, and this commit is a config migration. Adopting the
      // expanded set belongs after the smoke harness exists, as its own change
      // with its own verification. See ROADMAP.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
    // Tests may reach into either process to build fixtures.
    files: ['packages/desktop-app/tests/**/*.ts', 'packages/desktop-app/tests/**/*.tsx'],
    rules: {
      'no-restricted-imports': 'off'
    }
  }
);
