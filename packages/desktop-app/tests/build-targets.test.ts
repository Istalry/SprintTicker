import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { ELECTRON_MAJOR } from '../build-targets';

/**
 * The build targets describe one Electron release. When Electron moves, these
 * fail, and whoever bumped it reads the new Node and Chromium off Electron and
 * updates build-targets.ts -- instead of the bundles quietly targeting the old
 * runtime, which is how they came to target Node 18 under Electron 44.
 */
describe('build targets', () => {
  const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

  it('ElectronMajor_InstalledElectron_IsTheOneTheTargetsDescribe', () => {
    const installed = readJson(require.resolve('electron/package.json')).version as string;

    expect(Number(installed.split('.')[0])).toBe(ELECTRON_MAJOR);
  });

  it('Browserslist_ForAutoprefixer_NamesTheSameElectron', () => {
    const pkg = readJson(path.join(__dirname, '..', 'package.json'));

    expect(pkg.browserslist).toEqual([`electron ${ELECTRON_MAJOR}.0`]);
  });
});
