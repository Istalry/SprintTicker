import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLUGIN_DIR_NAME, pluginAssets } from '../src/assets/write-assets';
import { HIDDEN_KINDS, KEY_KINDS, PLUGIN_UUID, actionUuid, kindOfUuid } from '../src/key-kinds';
import { readZip } from './support/zip';

/**
 * The plugin's folder against the code: Stream Deck reads the manifest, the
 * code reads `KEY_KINDS`, and nothing but this test holds the two together.
 * `streamdeck validate` checks the manifest's own rules; this checks that
 * what it names is what the build writes.
 */

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN_DIR = path.join(PACKAGE_DIR, PLUGIN_DIR_NAME);

interface ManifestAction {
  UUID: string;
  Icon: string;
  PropertyInspectorPath?: string;
  VisibleInActionsList?: boolean;
  Controllers: string[];
  States: { Image: string }[];
}

const manifest = JSON.parse(readFileSync(path.join(PLUGIN_DIR, 'manifest.json'), 'utf8')) as {
  UUID: string;
  Version: string;
  Icon: string;
  CategoryIcon: string;
  CodePath: string;
  Actions: ManifestAction[];
  Profiles?: { Name: string; DeviceType: number; DontAutoSwitchWhenInstalled?: boolean }[];
};
const assets = pluginAssets();

/** A manifest image path names a file without its extension; one the build writes must exist. */
function written(imagePath: string, extensions: string[]): string[] {
  return extensions.map(ext => `${imagePath}${ext}`).filter(file => assets.has(file));
}

describe('manifest', () => {
  it('Manifest_Uuid_IsThePluginsAndNamesTheFolder', () => {
    expect(manifest.UUID).toBe(PLUGIN_UUID);
    expect(PLUGIN_DIR_NAME).toBe(`${PLUGIN_UUID}.sdPlugin`);
  });

  it('Manifest_Actions_AreTheKeyKindsInOrder', () => {
    expect(manifest.Actions.map(a => a.UUID)).toEqual(KEY_KINDS.map(actionUuid));
  });

  it('Manifest_HiddenActions_AreTheFiveTheAnswerKeysReplace', () => {
    // Still declared so a deck laid out with them keeps working; out of the
    // list so a new one is laid out with the answer keys.
    const hidden = manifest.Actions.filter(a => a.VisibleInActionsList === false).map(a => kindOfUuid(a.UUID));
    expect(hidden).toEqual(HIDDEN_KINDS);
  });

  it('Manifest_Actions_AreKeysOnly', () => {
    // The actions draw keys alone; a dial would appear and show nothing.
    for (const action of manifest.Actions) expect(action.Controllers).toEqual(['Keypad']);
  });

  it('Manifest_Version_IsThePackagesWithABuildNumber', () => {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string };
    expect(manifest.Version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(manifest.Version.startsWith(`${pkg.version}.`)).toBe(true);
  });

  it('Manifest_PluginIcon_WrittenAsPngAtBothSizes', () => {
    expect(written(manifest.Icon, ['.png', '@2x.png'])).toHaveLength(2);
    const width = (file: string) => (assets.get(file) as Buffer).readUInt32BE(16);
    expect(width(`${manifest.Icon}.png`)).toBe(256);
    expect(width(`${manifest.Icon}@2x.png`)).toBe(512);
  });

  it('Manifest_EveryImage_IsWrittenByTheBuild', () => {
    const images = [manifest.CategoryIcon, ...manifest.Actions.flatMap(a => [a.Icon, ...a.States.map(s => s.Image)])];
    for (const image of images) expect(written(image, ['.svg', '.png']), image).toHaveLength(1);
  });

  it('Manifest_ListIcons_AreWhiteOnNothing', () => {
    for (const image of [manifest.CategoryIcon, ...manifest.Actions.map(a => a.Icon)]) {
      const svg = assets.get(`${image}.svg`) as string;
      expect(svg.match(/#[0-9A-Fa-f]{6}/g), image).toEqual(['#FFFFFF']);
    }
  });

  it('Manifest_KeyImages_DrawnAt72', () => {
    for (const action of manifest.Actions) {
      expect(assets.get(`${action.States[0].Image}.svg`)).toContain('width="72" height="72"');
    }
  });

  it('Manifest_CodePath_IsAModule', () => {
    expect(manifest.CodePath).toBe('bin/plugin.js');
    expect(JSON.parse(assets.get('bin/package.json') as string)).toEqual({ type: 'module' });
  });

  it('Manifest_NoPropertyInspector', () => {
    // No key has settings: nothing to set up beyond placing it.
    expect(manifest.Actions.filter(a => a.PropertyInspectorPath)).toEqual([]);
    expect(existsSync(path.join(PLUGIN_DIR, 'ui'))).toBe(false);
  });
});

/**
 * The layouts installed with the plugin (P13c): exported from the Stream
 * Deck app, never generated -- the format is Stream Deck's own. A key in one
 * naming an action this plugin no longer declares would install as a dead
 * tile, which is what this holds off.
 */
describe('profiles', () => {
  const profiles = manifest.Profiles ?? [];

  it('Profiles_TheMiniAndMobile_AreShipped', () => {
    // Stream Deck Mini is device type 1, Stream Deck Mobile 3.
    expect(profiles.map(p => p.DeviceType)).toEqual(expect.arrayContaining([1, 3]));
  });

  it.each(profiles.map(p => [p.Name, p] as const))('Profile_%s_NeverTakesOverTheDeck', (_name, profile) => {
    // Installed beside the user's own profiles; they switch to it.
    expect(profile.DontAutoSwitchWhenInstalled).toBe(true);
  });

  it.each(profiles.map(p => p.Name))('Profile_%s_EveryKeyIsAnActionOfThisPlugin', name => {
    const file = path.join(PLUGIN_DIR, `${name}.streamDeckProfile`);
    expect(existsSync(file), file).toBe(true);
    const zip = readZip(readFileSync(file));

    const pkg = JSON.parse(zip.get('package.json')!.toString('utf8')) as { RequiredPlugins: string[] };
    expect(pkg.RequiredPlugins).toEqual([PLUGIN_UUID]);

    const uuids = [...zip.entries()]
      .filter(([entry]) => /\/Profiles\/[^/]+\/manifest\.json$/.test(entry))
      .flatMap(([, content]) => {
        const page = JSON.parse(content.toString('utf8')) as { Controllers: { Actions: Record<string, { UUID: string }> | null }[] };
        return page.Controllers.flatMap(c => Object.values(c.Actions ?? {}).map(a => a.UUID));
      });
    expect(uuids.length).toBeGreaterThan(0);
    for (const uuid of uuids) expect(kindOfUuid(uuid), uuid).not.toBeNull();
    // A shipped layout never uses a hidden action: those are for decks laid out before them.
    expect(uuids.map(kindOfUuid).filter(kind => HIDDEN_KINDS.includes(kind!))).toEqual([]);
  });
});

describe('key kinds', () => {
  it('KindOfUuid_EveryAction_RoundTrips', () => {
    for (const kind of KEY_KINDS) expect(kindOfUuid(actionUuid(kind))).toBe(kind);
  });

  it('KindOfUuid_Foreign_Null', () => {
    expect(kindOfUuid('com.elgato.streamdeck.system.hotkey')).toBeNull();
    expect(kindOfUuid(`${PLUGIN_UUID}.dial`)).toBeNull();
  });
});
