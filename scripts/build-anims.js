const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ANIM_FORMATS, animFileName } = require('./lib/anim-formats');

/**
 * Compiles every animation in `Animations/` once per `.anim` format, each with
 * the firmware compiler for that format: `<name>.anim` for firmware 1.2,
 * `<name>.v1.anim` for 1.3. A bar plays only the format of its own firmware,
 * so the app ships both and picks one per bar (`shared/anim-format.ts`).
 *
 * The compilers are GPL and run as separate processes, never imported.
 */

const animationsDir = path.join(__dirname, '../Animations');
const python = process.env.PYTHON || 'python';

if (fs.existsSync(animationsDir)) {
  const folders = fs.readdirSync(animationsDir);
  let compiledCount = 0;
  for (const folder of folders) {
    let folderPath = path.join(animationsDir, folder);
    if (fs.statSync(folderPath).isDirectory()) {

      const nestedDir = path.join(folderPath, folder);
      if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
        folderPath = nestedDir;
      }

      for (const { format, compiler } of ANIM_FORMATS) {
        const animFile = path.join(folderPath, animFileName(folder, format));
        console.log(`Compiling animation: ${folder} -> ${animFile}`);
        try {
          execFileSync(python, [compiler, '-o', animFile, folderPath], { stdio: 'inherit' });
          compiledCount++;
        } catch {
          console.error(`[ERROR] Failed to compile animation ${folder} (format ${format})`);
          process.exit(1);
        }
      }
    }
  }
  console.log(`[SUCCESS] Compiled ${compiledCount} animation files successfully.`);
} else {
  console.log('Animations directory not found, skipping compilation.');
}
