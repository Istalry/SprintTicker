import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const PLUGIN_DIR = path.join(__dirname, '..', '..', 'unity-plugin');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}

/** The nearest `.asmdef` at or above a script's folder, within the package. */
function owningAssembly(script: string, files: string[]): string | undefined {
  for (let dir = path.dirname(script); dir.startsWith(PLUGIN_DIR); dir = path.dirname(dir)) {
    const asmdef = files.find(file => path.dirname(file) === dir && file.endsWith('.asmdef'));
    if (asmdef) return asmdef;
  }
  return undefined;
}

/**
 * Unity compiles no script in a package unless an assembly definition owns it.
 * The plugin never had one, so no editor ever ran it: Unity's log said "will
 * not be compiled because it exists outside the Assets folder and does not
 * belong to any assembly definition file", and the bar heard nothing from
 * either project open (2026-10-16). Nothing on this side failed.
 */
describe('Unity plugin package', () => {
  const files = filesUnder(PLUGIN_DIR);

  it('Scripts_Always_BelongToAnAssemblyDefinition', () => {
    const scripts = files.filter(file => file.endsWith('.cs'));

    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter(script => !owningAssembly(script, files))).toEqual([]);
  });

  it('Plugin_Always_CompilesForTheEditorOnly', () => {
    // Its scripts use UnityEditor: in a player build they would not compile.
    const publisher = files.find(file => file.endsWith('BusyBarWebhookPublisher.cs'))!;
    const asmdef = JSON.parse(readFileSync(owningAssembly(publisher, files)!, 'utf8'));

    expect(asmdef.includePlatforms).toEqual(['Editor']);
  });

  it('Assets_Always_HaveTheirMetaFile', () => {
    // A package is read-only in some projects; Unity cannot write a missing
    // .meta there, and an asset without one is skipped.
    const assets = files.filter(file => /\.(cs|asmdef|json)$/.test(file));

    expect(assets.filter(asset => !files.includes(`${asset}.meta`))).toEqual([]);
  });
});
