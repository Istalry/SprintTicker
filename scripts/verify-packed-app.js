const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * Automated verification of the packed Windows binary.
 *
 * Launches the unpacked Electron application, watches for main-process uncaught
 * exceptions, waits for the embedded HTTP server on port 39123, and then
 * asserts three things the app actually does -- see `runBehaviourChecks`.
 *
 * The behaviour checks are the point. Booting and opening a port is necessary
 * but proves very little: packaging, ABI and LFS failures in this repository
 * have historically only shown up in a packaged build, and a build can boot
 * cleanly with its routing or its request screening broken.
 */
async function verifyPackedApp() {
  const exePath = path.resolve(__dirname, '../packages/desktop-app/dist-electron/win-unpacked/SprintTicker.exe');
  
  if (!fs.existsSync(exePath)) {
    console.error(`[VERIFY ERROR] Executable not found at path: ${exePath}`);
    process.exit(1);
  }

  // The first run's "Install the plugin" opens this file (P11a); a build
  // packed without `pnpm deck:pack` first would answer "not in this build".
  const deckPlugin = path.join(path.dirname(exePath), 'resources', 'StreamDeck', 'SprintTicker.streamDeckPlugin');
  if (!fs.existsSync(deckPlugin)) {
    console.error(`[VERIFY ERROR] The Stream Deck plugin is not in the build: ${deckPlugin}`);
    process.exit(1);
  }

  console.log(`========================================================`);
  console.log(` [VERIFY] Launching packed binary: ${exePath}`);
  console.log(`========================================================`);

  // Kill any existing running instance first
  try {
    execSync('taskkill /F /IM "SprintTicker.exe" >nul 2>&1');
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

  // Poll the local HTTP server at 127.0.0.1:39123
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

  if (!verified) {
    killApp(appProcess);
    console.error(`\n[VERIFY FAILED] Server did not respond on port 39123 within ${maxWaitMs}ms.`);
    process.exit(1);
  }

  // The app is still running here on purpose: the checks below talk to it.
  console.log(`\n[VERIFY] Server is up. Asserting what it actually does:`);
  let failures;
  try {
    failures = await runBehaviourChecks();
  } catch (err) {
    killApp(appProcess);
    console.error(`\n[VERIFY FAILED] Behaviour checks could not complete: ${err.message}`);
    process.exit(1);
  }

  killApp(appProcess);

  if (failures.length > 0) {
    console.error(`\n========================================================`);
    console.error(` [VERIFY FAILED] ${failures.length} behaviour check(s) failed:`);
    for (const name of failures) console.error(`   - ${name}`);
    console.error(`========================================================\n`);
    process.exit(1);
  }

  console.log(`\n========================================================`);
  console.log(` [SUCCESS] Packed application verified cleanly!`);
  console.log(` Webhook server on http://127.0.0.1:39123 routes a JSON`);
  console.log(` request and refuses both browser-shaped request forms.`);
  console.log(` Zero uncaught exceptions or missing module errors detected.`);
  console.log(`========================================================\n`);
  process.exit(0);
}

// Probes 39123 and nothing else. This used to try 8080 first and fall back to
// 39123, from a build that ran a second server there. That server is gone, so
// any unrelated process holding 8080 -- a dev server, a proxy -- made this
// report SUCCESS without ever contacting the packaged app.
//
// Any response counts as *up*, including the 405 the server returns for GET.
// That is only the readiness signal; what the app actually does is asserted
// separately, by `runBehaviourChecks` below.
function checkHttpServer() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:39123/', () => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** One request to the packaged app's local API. */
function request({ method = 'POST', path: urlPath = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 39123,
        method,
        path: urlPath,
        headers: {
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      res => {
        let raw = '';
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error(`Timed out calling ${method} ${urlPath}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Asserts what the packaged app *does*, not merely that a port is open.
 *
 * Until this existed, a passing run proved only that the binary booted and
 * something answered on 39123 -- true of a build whose routing was broken and
 * true of an unrelated process. These three checks are the smallest set that
 * cannot pass by accident:
 *
 * 1. A well-formed JSON request reaches the router and is answered there, as
 *    an unknown endpoint (404 NOT_FOUND). That exercises screening, body
 *    parsing, routing and the JSON response. It used to be a Unity heartbeat;
 *    the one route left, `/api/input`, presses a key on the bar, which a
 *    check of the build must not do.
 * 2. The same request without `Content-Type: application/json` is refused.
 * 3. A request carrying an `Origin` header is refused.
 *
 * Checks 2 and 3 are the loopback hardening, and they are worth pinning in the
 * *packaged* build specifically: loopback is not a security boundary, and these
 * two rules are the whole of what stands between a web page the user happens to
 * be visiting and hardware this API can drive. A regression in either is
 * invisible from the UI and would never fail a unit test that stubs the server.
 */
/** A path no route answers: reaching the router has no side effect. */
const VERIFY_PATH = '/api/v1/verify-packed-app';

async function runBehaviourChecks() {
  const failures = [];

  const check = (name, condition, detail) => {
    if (condition) {
      console.log(`  [OK]   ${name}`);
    } else {
      console.error(`  [FAIL] ${name} -- ${detail}`);
      failures.push(name);
    }
  };

  const routed = await request({
    path: VERIFY_PATH,
    headers: { 'Content-Type': 'application/json' },
    body: { probe: 'verify-packed-app' }
  });
  check(
    'JSON request is screened in, parsed and routed (404 NOT_FOUND)',
    routed.status === 404 && routed.body.includes('NOT_FOUND'),
    `got ${routed.status} ${routed.body}`
  );

  // Sent as text/plain: a "simple" request is precisely the one a browser may
  // issue cross-origin with no preflight, so this is the shape that must fail.
  const wrongType = await request({
    path: VERIFY_PATH,
    headers: { 'Content-Type': 'text/plain' },
    body: { probe: 'verify-packed-app' }
  });
  check(
    'Request without application/json is refused (415)',
    wrongType.status === 415,
    `got ${wrongType.status} ${wrongType.body}`
  );

  // Browsers set Origin; native clients do not.
  const browserish = await request({
    path: VERIFY_PATH,
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: { probe: 'verify-packed-app' }
  });
  check(
    'Request carrying an Origin header is refused (403)',
    browserish.status === 403,
    `got ${browserish.status} ${browserish.body}`
  );

  return failures;
}

function killApp(proc) {
  try {
    execSync('taskkill /F /IM "SprintTicker.exe" >nul 2>&1');
  } catch (_) {}
  try {
    proc.kill();
  } catch (_) {}
}

verifyPackedApp();
