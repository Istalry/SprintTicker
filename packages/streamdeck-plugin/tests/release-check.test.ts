import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The release's check that a changed plugin carries a higher version, since
 * Stream Deck installs a pack only over an older one. The script is the
 * repository's untyped CommonJS; this holds its verdicts.
 */

interface Plugin {
  version: string;
  files: Map<string, Buffer>;
}
interface Check {
  compareVersions(a: string, b: string): number;
  verdict(previous: Plugin | null, current: Plugin): { ok: boolean; message: string };
  readPlugin(dir: string): Plugin;
  main(argv: string[]): number;
}

const check = createRequire(import.meta.url)('../../../scripts/check-deck-release.js') as Check;

const plugin = (version: string, files: Record<string, string>): Plugin => ({
  version,
  files: new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)]))
});

describe('compareVersions', () => {
  it.each([
    ['0.4.0.0', '0.3.0.0', 1],
    ['0.4.0.0', '0.4.0', 0],
    ['0.10.0.0', '0.9.0.0', 1],
    ['0.4.0.0', '0.4.0.1', -1]
  ])('CompareVersions_%s_Against_%s_Is_%i', (a, b, expected) => {
    expect(check.compareVersions(a, b)).toBe(expected);
  });

  it('CompareVersions_NotNumbers_Throws', () => {
    expect(() => check.compareVersions('0.4.x', '0.4.0')).toThrow();
  });
});

describe('verdict', () => {
  const before = plugin('0.4.0.0', { 'bin/plugin.js': 'a', 'imgs/session.svg': 's' });

  it('Verdict_NoEarlierPack_Passes', () => {
    expect(check.verdict(null, before).ok).toBe(true);
  });

  it('Verdict_NothingChanged_PassesAtTheSameVersion', () => {
    expect(check.verdict(before, plugin('0.4.0.0', { 'bin/plugin.js': 'a', 'imgs/session.svg': 's' })).ok).toBe(true);
  });

  it('Verdict_ChangedAndRaised_Passes', () => {
    expect(check.verdict(before, plugin('0.5.0.0', { 'bin/plugin.js': 'b', 'imgs/session.svg': 's' })).ok).toBe(true);
  });

  it.each([
    ['a file changed', { 'bin/plugin.js': 'b', 'imgs/session.svg': 's' }, 'bin/plugin.js'],
    ['a file added', { 'bin/plugin.js': 'a', 'imgs/session.svg': 's', 'imgs/new.svg': 'n' }, 'imgs/new.svg'],
    ['a file removed', { 'bin/plugin.js': 'a' }, 'imgs/session.svg']
  ])('Verdict_%s_AtTheSameVersion_FailsNamingIt', (_name, files, named) => {
    const result = check.verdict(before, plugin('0.4.0.0', files));
    expect(result.ok).toBe(false);
    expect(result.message).toContain(named);
  });

  it('Verdict_VersionLowered_FailsEvenUnchanged', () => {
    expect(check.verdict(before, plugin('0.3.0.0', { 'bin/plugin.js': 'a', 'imgs/session.svg': 's' })).ok).toBe(false);
  });
});

describe('readPlugin and main', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** An unzipped pack: one .sdPlugin folder holding a manifest and the bundle. */
  function pack(name: string, version: string, code: string, extraManifest = {}): string {
    const dir = path.join(root, name, 'io.example.test.sdPlugin');
    mkdirSync(path.join(dir, 'bin'), { recursive: true });
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ Name: 'Test', Version: version, ...extraManifest }));
    writeFileSync(path.join(dir, 'bin', 'plugin.js'), code);
    return path.join(root, name);
  }

  it('ReadPlugin_Manifest_VersionReadAndLeftOutOfTheFiles', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'deck-release-'));
    const a = check.readPlugin(path.join(pack('a', '0.4.0.0', 'x'), 'io.example.test.sdPlugin'));
    const b = check.readPlugin(path.join(pack('b', '0.5.0.0', 'x'), 'io.example.test.sdPlugin'));
    expect(a.version).toBe('0.4.0.0');
    expect(a.files.get('manifest.json')).toEqual(b.files.get('manifest.json'));
    expect([...a.files.keys()].sort()).toEqual(['bin/plugin.js', 'manifest.json']);
  });

  it('Main_ManifestChangedAtTheSameVersion_Fails', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'deck-release-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const previous = pack('previous', '0.4.0.0', 'x');
    const current = pack('current', '0.4.0.0', 'x', { Description: 'new' });
    expect(check.main([previous, path.join(current, 'io.example.test.sdPlugin')])).toBe(1);
    log.mockRestore();
  });

  it('Main_NoPreviousFolder_Passes', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'deck-release-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(check.main([path.join(root, 'none'), pack('current', '0.4.0.0', 'x')])).toBe(0);
    log.mockRestore();
  });

  it('Main_NoArguments_Throws', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'deck-release-'));
    expect(() => check.main([])).toThrow(/Usage/);
  });
});
