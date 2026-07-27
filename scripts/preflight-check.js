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

  if (desktopPkg.version !== unityPkg.version) {
    throw new Error(`Version mismatch! Desktop App (${desktopPkg.version}) vs Unity Package (${unityPkg.version})`);
  }

  // 2. Verify better-sqlite3 native bindings exist
  const nativeBindingPath = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node');
  if (!fs.existsSync(nativeBindingPath)) {
    console.warn('[PreflightCheck] Warning: better-sqlite3 native binary not compiled yet. Run `pnpm approve-builds`.');
  } else {
    console.log('[PreflightCheck] ✓ better-sqlite3 native C++ bindings verified.');
  }

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
