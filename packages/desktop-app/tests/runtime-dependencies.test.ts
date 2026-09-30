import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { builtinModules } from 'module';
import path from 'path';
import { ELECTRON_EXTERNALS } from '../vite.config.electron';

/**
 * electron-builder packs every `dependencies` entry into app.asar, and main
 * can load at runtime only what Vite left external. The two lists must be the
 * same set, and each direction fails differently:
 *
 * - a dependency main does not load is dead weight in every installer. React,
 *   lucide and the fonts were 39 MB of a 42 MB asar, all of it already bundled.
 * - an external that is not a dependency is missing from the installer, and
 *   the packaged app dies on its first `require` -- while `pnpm dev`, which
 *   resolves from the workspace's node_modules, works perfectly.
 */
describe('runtime dependencies', () => {
  it('Dependencies_Always_AreExactlyWhatMainLoadsAtRuntime', () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const builtins = new Set(['electron', ...builtinModules]);
    const externalPackages = ELECTRON_EXTERNALS
      .filter((entry): entry is string => typeof entry === 'string')
      .filter(name => !builtins.has(name));

    expect(Object.keys(pkg.dependencies).sort()).toEqual(externalPackages.sort());
  });
});
