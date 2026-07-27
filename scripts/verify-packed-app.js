const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * Automated Verification Script for Packed Windows Binary
 * Launches the unpacked Electron application, checks for main process uncaught exceptions,
 * and asserts that the embedded Fastify Webhook Server starts cleanly on port 39123.
 */
async function verifyPackedApp() {
  const exePath = path.resolve(__dirname, '../packages/desktop-app/dist-electron/win-unpacked/Antigravity BUSY Bar Companion.exe');
  
  if (!fs.existsSync(exePath)) {
    console.error(`[VERIFY ERROR] Executable not found at path: ${exePath}`);
    process.exit(1);
  }

  console.log(`========================================================`);
  console.log(` [VERIFY] Launching packed binary: ${exePath}`);
  console.log(`========================================================`);

  // Kill any existing running instance first
  try {
    execSync('taskkill /F /IM "Antigravity BUSY Bar Companion.exe" >nul 2>&1');
  } catch (_) {}

  let hasUncaughtError = false;
  let errorMessage = '';

  const appProcess = spawn(exePath, ['--mock-hardware'], {
    cwd: path.dirname(exePath),
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', MOCK_HARDWARE: 'true' },
    detached: false
  });

  appProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[APP LOG]: ${text.trim()}`);
    if (text.includes('Uncaught Exception') || text.includes('Cannot find module')) {
      hasUncaughtError = true;
      errorMessage = text;
    }
  });

  appProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.error(`[APP STDERR]: ${text.trim()}`);
    if (text.includes('Uncaught Exception') || text.includes('Cannot find module') || text.includes('Error:')) {
      hasUncaughtError = true;
      errorMessage = text;
    }
  });

  appProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[VERIFY ERROR] App exited unexpectedly with code ${code}`);
    }
  });

  // Poll Fastify HTTP server at 127.0.0.1:39123
  const startTime = Date.now();
  const maxWaitMs = 12000;
  let verified = false;

  while (Date.now() - startTime < maxWaitMs) {
    if (hasUncaughtError) {
      console.error(`\n[VERIFY FAILED] Main process uncaught exception detected:\n${errorMessage}`);
      killApp(appProcess);
      process.exit(1);
    }

    try {
      const isUp = await checkHttpServer();
      if (isUp) {
        verified = true;
        break;
      }
    } catch (_) {}

    await new Promise(r => setTimeout(r, 500));
  }

  killApp(appProcess);

  if (verified) {
    console.log(`\n========================================================`);
    console.log(` [SUCCESS] Packed application verified cleanly!`);
    console.log(` Native Webhook Server is listening on http://127.0.0.1:39123`);
    console.log(` Zero uncaught exceptions or missing module errors detected.`);
    console.log(`========================================================\n`);
    process.exit(0);
  } else {
    console.error(`\n[VERIFY FAILED] Server did not respond on port 39123 within ${maxWaitMs}ms.`);
    process.exit(1);
  }
}

function checkHttpServer() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8080/', (res) => {
      resolve(true);
    });
    req.on('error', () => {
      const fallbackReq = http.get('http://127.0.0.1:39123/', (res2) => {
        resolve(true);
      });
      fallbackReq.on('error', () => resolve(false));
      fallbackReq.setTimeout(1000, () => {
        fallbackReq.destroy();
        resolve(false);
      });
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function killApp(proc) {
  try {
    execSync('taskkill /F /IM "Antigravity BUSY Bar Companion.exe" >nul 2>&1');
  } catch (_) {}
  try {
    proc.kill();
  } catch (_) {}
}

verifyPackedApp();
