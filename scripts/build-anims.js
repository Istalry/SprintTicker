const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const animationsDir = path.join(__dirname, '../Animations');
const toolchainScript = path.join(__dirname, 'busybar-anim-toolchain/seq2anim.py');

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

      const animFile = path.join(folderPath, `${folder}.anim`);
      console.log(`Compiling animation: ${folder} -> ${animFile}`);
      try {
        execSync(`python "${toolchainScript}" -o "${animFile}" "${folderPath}"`, { stdio: 'inherit' });
        compiledCount++;
      } catch (err) {
        console.error(`[ERROR] Failed to compile animation ${folder}`);
        process.exit(1);
      }
    }
  }
  console.log(`[SUCCESS] Compiled ${compiledCount} animations successfully.`);
} else {
  console.log('Animations directory not found, skipping compilation.');
}
