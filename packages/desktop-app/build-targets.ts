/**
 * What the installed Electron actually runs, as build targets.
 *
 * The bundles used to target `node18` and Vite's default browser baseline --
 * runtimes several years older than Electron 44's Node 24 and Chromium 152 --
 * so syntax both of them run natively was down-levelled for nothing.
 *
 * These are read off Electron itself, not guessed from its release notes:
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron -p "JSON.stringify(process.versions)"
 *
 * They are a pair with the Electron version, like better-sqlite3 (CLAUDE.md
 * §2): `build-targets.test.ts` fails when the installed Electron major is not
 * `ELECTRON_MAJOR`, so an Electron bump cannot leave them behind silently. The
 * browserslist entry in package.json -- which autoprefixer reads -- is checked
 * against the same major, since JSON cannot import this file.
 */
export const ELECTRON_MAJOR = 44;

/** Electron 44 embeds Node 24.20. For vite.config.electron.ts and vite.config.preload.ts. */
export const ELECTRON_NODE_TARGET = 'node24';

/** Electron 44 embeds Chromium 152. For the renderer, vite.config.ts. */
export const ELECTRON_CHROME_TARGET = 'chrome152';
