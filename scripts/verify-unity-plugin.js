const fs = require('fs');
const path = require('path');

/**
 * Validates the UPM package structure for com.antigravity.busybar.
 *
 * This is a verification step, not a packaging step: it checks that the
 * manifest and Editor scripts are present and prints what it found. Unity
 * consumes the folder directly via UPM, so no archive is produced.
 */
function buildUnityPackage() {
  console.log('[VerifyUnityPlugin] Validating the UPM package structure (com.antigravity.busybar)...');

  const pluginDir = path.join(__dirname, '../packages/unity-plugin');
  const manifestPath = path.join(pluginDir, 'package.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Unity package manifest missing at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`[VerifyUnityPlugin] Package Name: ${manifest.name}`);
  console.log(`[VerifyUnityPlugin] Version: ${manifest.version}`);

  const editorDir = path.join(pluginDir, 'Editor');
  if (!fs.existsSync(editorDir)) {
    throw new Error('Editor scripts directory missing in packages/unity-plugin');
  }

  const files = fs.readdirSync(editorDir);
  console.log(`[VerifyUnityPlugin] Found ${files.length} Editor C# files:`, files);

  console.log('[VerifyUnityPlugin] Manifest and Editor scripts look valid. No archive is produced -- import the folder directly via Package Manager > Add package from disk.');
}

buildUnityPackage();
