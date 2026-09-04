module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  settings: {
    react: {
      version: '18.2'
    }
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  },
  overrides: [
    {
      // Type-aware rules, deliberately curated.
      //
      // Not `plugin:@typescript-eslint/recommended-requiring-type-checking`:
      // that produces hundreds of findings on this codebase and would be
      // switched off within a day. These three each catch a class of bug that
      // has actually shipped here -- the `will-quit` handler was `async`, so
      // Electron never awaited it and the teardown after the first await was
      // dead code. no-misused-promises catches exactly that, statically.
      files: ['packages/desktop-app/**/*.ts', 'packages/desktop-app/**/*.tsx'],
      parserOptions: {
        project: ['./packages/desktop-app/tsconfig.eslint.json'],
        tsconfigRootDir: __dirname
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
      files: ['packages/desktop-app/tests/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off'
      }
    }
  ]
};
