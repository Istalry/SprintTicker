/**
 * Fails a release whose Stream Deck plugin changed while its version did not.
 *
 * Stream Deck installs a pack only over an older version: one carrying the
 * installed `Version` is answered "already installed", and the old code keeps
 * running with nothing else saying so (measured 2026-10-22). The plugin's
 * version is its own, apart from the app's -- the user's choice, so that it
 * can move on its own (2026-10-22) -- and so no tag raises it.
 *
 * Compared on what ships, never on the sources: the plugin bundles
 * `deck-protocol.ts`, which imports `dtos.ts` for one class, so a diff of
 * sources would ask for a new version at almost every release. The previous
 * release's pack against the one just made, both unzipped, with the
 * manifest's `Version` left out of the comparison and read for the verdict.
 * Pack against pack, never against the built folder: `streamdeck pack` leaves
 * out `bin/plugin.js.map`, which the folder holds, so that comparison failed
 * on the very pack it was made from.
 *
 *   node scripts/check-deck-release.js <previous pack, unzipped> <new pack, unzipped>
 */
const fs = require('fs');
const path = require('path');

const PLUGIN_SUFFIX = '.sdPlugin';

/** The .sdPlugin folder itself, or the one an unzipped pack holds. */
function findPluginDir(root) {
  if (root.endsWith(PLUGIN_SUFFIX)) return root;
  const found = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith(PLUGIN_SUFFIX));
  if (found.length !== 1) {
    throw new Error(`Expected one ${PLUGIN_SUFFIX} folder in ${root}, found ${found.length}.`);
  }
  return path.join(root, found[0].name);
}

/** `{ version, files }`: every file by its relative path, the manifest without its Version. */
function readPlugin(dir) {
  const files = new Map();
  let version = null;
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      let content = fs.readFileSync(path.join(dir, child));
      if (child === 'manifest.json') {
        const manifest = JSON.parse(content.toString('utf8'));
        version = manifest.Version;
        delete manifest.Version;
        content = Buffer.from(JSON.stringify(manifest));
      }
      files.set(child, content);
    }
  };
  walk('');
  if (!version) throw new Error(`${dir} has no manifest.json with a Version.`);
  return { version, files };
}

/** Stream Deck's versions are dotted numbers, up to four of them. */
function compareVersions(a, b) {
  const parts = v => v.split('.').map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  if ([...pa, ...pb].some(n => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Not a Stream Deck version: ${a} / ${b}`);
  }
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** The paths added, removed or changed between two plugins. */
function changedFiles(previous, current) {
  const paths = new Set([...previous.files.keys(), ...current.files.keys()]);
  return [...paths]
    .filter(p => {
      const [a, b] = [previous.files.get(p), current.files.get(p)];
      return !a || !b || !a.equals(b);
    })
    .sort();
}

/**
 * `{ ok, message }`. No previous pack passes: nothing was installed from a
 * release to be stuck on. A version lowered fails even with nothing changed,
 * since the pack would not install over the previous one either.
 */
function verdict(previous, current) {
  if (!previous) return { ok: true, message: 'No earlier pack to compare with.' };
  const order = compareVersions(current.version, previous.version);
  if (order < 0) {
    return { ok: false, message: `The plugin went back from ${previous.version} to ${current.version}.` };
  }
  const changed = changedFiles(previous, current);
  if (changed.length === 0) return { ok: true, message: `Unchanged since ${previous.version}.` };
  if (order > 0) return { ok: true, message: `Changed, and raised from ${previous.version} to ${current.version}.` };
  return {
    ok: false,
    message:
      `The plugin changed but is still ${current.version}, and Stream Deck would keep the old one ` +
      `("already installed"). Raise its version in packages/streamdeck-plugin/package.json and the ` +
      `manifest. Changed: ${changed.join(', ')}`
  };
}

function main(argv) {
  const [previousRoot, currentRoot] = argv;
  if (!previousRoot || !currentRoot) {
    throw new Error('Usage: node scripts/check-deck-release.js <previous pack, unzipped> <new pack, unzipped>');
  }
  const previous = fs.existsSync(previousRoot) ? readPlugin(findPluginDir(previousRoot)) : null;
  const result = verdict(previous, readPlugin(findPluginDir(currentRoot)));
  console.log(`[check-deck-release] ${result.message}`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`[check-deck-release] ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { compareVersions, changedFiles, verdict, readPlugin, findPluginDir, main };
