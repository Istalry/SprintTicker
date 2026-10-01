const fs = require('fs');
const path = require('path');

function runPreflightChecks() {
  console.log('[PreflightCheck] Running release pre-flight verification checks...');

  // 1. Verify root package.json & desktop-app version sync
  const rootPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const desktopPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../packages/desktop-app/package.json'), 'utf8'));
  const unityPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../packages/unity-plugin/package.json'), 'utf8'));

  console.log(`[PreflightCheck] Workspace Root Version: ${rootPkg.version}`);
  console.log(`[PreflightCheck] Desktop App Version: ${desktopPkg.version}`);
  console.log(`[PreflightCheck] Unity Package Version: ${unityPkg.version}`);

  // All three, not two. The root version was printed and never compared, so a
  // root that had drifted passed this check silently -- and the root is the one
  // `build-windows.yml` matches the git tag against before it will build, so
  // the drift would have surfaced as a refused release instead of here.
  const versions = new Set([rootPkg.version, desktopPkg.version, unityPkg.version]);
  if (versions.size !== 1) {
    throw new Error(
      `Version mismatch! Root (${rootPkg.version}) vs Desktop App (${desktopPkg.version}) ` +
        `vs Unity Package (${unityPkg.version}). All three must agree before a release.`
    );
  }

  // 2. Verify the better-sqlite3 binary the installer will carry.
  //
  // Not build/Release: since 13 nothing is compiled there. The package ships
  // one N-API binary per platform in prebuilds/, loaded by Node and Electron
  // alike, so this looked for a file that never exists and warned on every
  // run. The one that ships is win32-x64, whatever this check runs on. It is
  // in the package tarball, so --ignore-scripts no longer hides it, and a
  // missing one is now an error: the packaged app would die opening its
  // database.
  const sqlitePkg = require.resolve('better-sqlite3/package.json', {
    paths: [path.join(__dirname, '../packages/desktop-app')]
  });
  const shippedBinary = path.join(path.dirname(sqlitePkg), 'prebuilds', 'win32-x64.node');
  if (!fs.existsSync(shippedBinary)) {
    throw new Error(`better-sqlite3 has no Windows x64 prebuild at ${shippedBinary}. See CLAUDE.md section 2.`);
  }
  console.log('[PreflightCheck] ✓ better-sqlite3 Windows x64 prebuild present.');

  // 3. Verify Unity C# Editor scripts
  const publisherCs = path.join(__dirname, '../packages/unity-plugin/Editor/BusyBarWebhookPublisher.cs');
  const listenerCs = path.join(__dirname, '../packages/unity-plugin/Editor/BusyBarSceneSaveListener.cs');
  if (!fs.existsSync(publisherCs) || !fs.existsSync(listenerCs)) {
    throw new Error('Unity C# Editor scripts missing in packages/unity-plugin/Editor!');
  }
  console.log('[PreflightCheck] ✓ Unity C# Editor scripts verified.');

  console.log('[PreflightCheck] SUCCESS: All pre-flight checks passed!');
}

runPreflightChecks();
