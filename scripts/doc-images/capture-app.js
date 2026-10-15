#!/usr/bin/env node
/**
 * Captures the screenshots and bar clips the documentation shows.
 *
 *   pnpm docs:images     # builds, captures, then renders scenes and icons
 *
 * or, on a build that is already current, `node scripts/doc-images/capture-app.js`.
 * Close SprintTicker and Unity first (see below).
 *
 * Runs the app on a throwaway profile, under `--mock-hardware`, filled with
 * invented projects and tasks, and drives it over the Chrome DevTools
 * Protocol: screenshots of each panel, with a bar and in no-bar mode, and the
 * frames the app sends its emulator while it shows each screen. Those frames
 * go to a JSON file per clip, which `make-images.py` renders as the LED panel.
 *
 * Why it is built this way, each point a way of getting it wrong:
 *
 * - **Never the real database.** Development and installed builds share
 *   `%APPDATA%\SprintTicker` (CLAUDE.md §7); a capture on it would publish the
 *   user's own task names, and a pending migration would run on it. The
 *   profile is a fresh temp directory, removed at the end.
 * - **Never the real bar.** `--mock-hardware` keeps every draw in the process.
 *   The Unity events below are POSTed to the webhook port, though, and if the
 *   installed app is running *it* owns that port and would put them on the
 *   user's bar. So the script refuses to start while anything answers there.
 * - **No other Unity editor.** Every editor open on the machine posts to the
 *   webhook port, so the script stops if one besides its own connects.
 * - **No real notifications.** The listener is off on the profile except for
 *   the few seconds a picture needs it -- a simulated notification is dropped
 *   while it is off -- so a toast arriving mid-capture has little chance of
 *   landing in a picture. It only reads notifications that arrive after it
 *   starts. Look at the pictures before committing them all the same.
 * - **The emulator's frames, not its canvas.** The canvas draws each LED with
 *   bloom and a white core, so reading colours back from it is guesswork. The
 *   frames are the elements main sent, rasterised the way the emulator does.
 *
 * Dependency-free like the rest of `scripts/`: Node 24's global WebSocket and
 * `node:sqlite`. Electron is the app's own devDependency.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = path.join(ROOT, 'packages', 'desktop-app');
const IMAGES = path.join(ROOT, 'docs', 'images');
const CDP_PORT = 9334;
const WEBHOOK = 'http://127.0.0.1:39123';
const UNITY = `${WEBHOOK}/api/v1/unity`;
const EDITOR = { projectName: 'Moonlight Garden', instanceId: 'docs-capture', unityVersion: '6000.0.1f1' };

// How long a new screen takes to reach the emulator after the event behind it.
const SETTLE_MS = 700;
// The tracked time the pictures show: a timer at 00:00 says nothing.
const SESSION_MINUTES = 84;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.log('[capture]', ...args);

// --- the app ---------------------------------------------------------------

async function portAnswers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    // Nothing listening is the answer this check hopes for.
    return false;
  }
}

function launch(profile) {
  const electron = createRequire(path.join(APP_DIR, 'package.json'))('electron');
  const env = { ...process.env };
  // VS Code's terminal exports this; with it, electron.exe runs as plain Node
  // and rejects every flag below.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electron,
    [
      APP_DIR,
      `--user-data-dir=${profile}`,
      '--mock-hardware',
      `--remote-debugging-port=${CDP_PORT}`,
      // The same pixel size on every machine, whatever its display scaling.
      '--force-device-scale-factor=1',
      '--lang=en-US'
    ],
    { env, stdio: 'ignore' }
  );
  return child;
}

// --- CDP -------------------------------------------------------------------

class Page {
  static async open(match) {
    for (let i = 0; i < 60; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
        const target = targets.find(t => t.type === 'page' && match(t.url));
        if (target) {
          const page = new Page(target.webSocketDebuggerUrl);
          await page.ready;
          return page;
        }
      } catch {
        // The app is still starting; the loop is the wait.
      }
      await sleep(500);
    }
    throw new Error('the app window never appeared on the debugging port');
  }

  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = event => {
      const msg = JSON.parse(String(event.data));
      const done = this.pending.get(msg.id);
      if (done) {
        this.pending.delete(msg.id);
        done(msg);
      }
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, msg => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  /** Calls `window.electronAPI.<call>` and returns its answer. */
  api(call) {
    return this.eval(`window.electronAPI.${call}`);
  }

  async shot(name) {
    // Let a panel's own fetches settle and its transitions finish.
    await sleep(900);
    await assertNoOtherEditor(this);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(IMAGES, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    log('screenshot', path.relative(ROOT, file));
  }

  /** Clicks the first button whose visible text or title is `label`. */
  async click(label) {
    const found = await this.eval(`(() => {
      const want = ${JSON.stringify(label)};
      const button = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === want || b.title === want);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!found) throw new Error(`no button "${label}" on screen`);
    await sleep(300);
  }

  close() {
    this.ws.close();
  }
}

// --- the bar ---------------------------------------------------------------

/**
 * Installs a listener that rasterises every display state main sends the
 * emulator into 72x16 RGB hex, the way the emulator builds its pixel buffer:
 * rectangles and bitmaps first, images over them.
 */
const RECORDER = `(() => {
  if (window.__docRec) return;
  const W = 72, H = 16;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const images = new Map();
  const hex = c => { const m = /^#?([0-9a-f]{6})/i.exec(c || ''); return m ? m[1].toLowerCase() : '000000'; };
  const raster = async state => {
    const buf = Array(W * H).fill('000000');
    const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = c; };
    for (const el of state.frontElements || []) {
      if (el.type === 'bitmap' && el.bitmapData) {
        const def = el.color || state.ledColorHex || '#10B981FF';
        el.bitmapData.forEach((row, r) => row.forEach((p, c) => {
          if (p !== null && p !== 0 && p !== undefined) put(el.x + c, el.y + r, hex(typeof p === 'string' ? p : def));
        }));
      } else if (el.type === 'rectangle') {
        const fill = hex((el.fill_colors && el.fill_colors[0]) || el.fill);
        for (let r = 0; r < (el.height || 4); r++) for (let c = 0; c < (el.width || 10); c++) put(el.x + c, el.y + r, fill);
      }
    }
    for (const el of state.frontElements || []) {
      if (el.type !== 'image' || !el.data) continue;
      let img = images.get(el.data);
      if (!img) { img = new Image(); img.src = el.data; images.set(el.data, img); }
      if (!img.complete) await img.decode().catch(() => {});
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, el.x || 0, el.y || 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < W * H; i++) {
        if (d[i * 4 + 3] > 0) buf[i] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
      }
    }
    return buf.join('');
  };
  const rec = window.__docRec = { frames: [], on: false, current: null, last: '' };
  let chain = Promise.resolve();
  const take = state => {
    const t = performance.now();
    chain = chain.then(async () => {
      const px = await raster(state);
      rec.current = px;
      if (rec.on && px !== rec.last) { rec.last = px; rec.frames.push({ t, px }); }
    });
  };
  window.electronAPI.getDisplayState().then(s => s && take(s));
  window.electronAPI.onDisplayStateUpdated(s => s && take(s));
  rec.start = () => {
    rec.frames = []; rec.on = true; rec.last = rec.current || '';
    if (rec.current) rec.frames.push({ t: performance.now(), px: rec.current });
  };
  rec.stop = () => { rec.on = false; return chain.then(() => rec.frames); };
})()`;

/**
 * Records what the bar shows for `ms` after `act`.
 *
 * Recording starts once the screen has had time to change: started before
 * `act`, every clip opened on the screen it replaced.
 */
async function clip(page, framesDir, name, ms, act = async () => {}) {
  await act();
  await sleep(SETTLE_MS);
  await page.eval('window.__docRec.start()');
  await sleep(ms);
  const frames = await page.eval('window.__docRec.stop()');
  await assertNoOtherEditor(page);
  fs.writeFileSync(path.join(framesDir, `${name}.json`), JSON.stringify({ name, holdMs: 1000, frames }));
  log(`clip ${name}: ${frames.length} frame(s)`);
}

/**
 * Refuses to go on while a Unity editor other than the invented one is
 * connected.
 *
 * Every Unity editor open on this machine posts to the webhook port, whichever
 * app owns it, so a real project's heartbeats and console errors reach the
 * capture instance. The first run of this script published one that way: a
 * real "Plugins: Failed..." exception on the bar in a screenshot, and "2 Unity
 * Instances Connected" in another. Checked before every picture rather than
 * once, because an editor can connect at any moment, a heartbeat every five
 * seconds.
 */
async function assertNoOtherEditor(page) {
  const telemetry = await page.api('getUnityTelemetry()');
  const others = (telemetry?.instances ?? []).filter(i => i.instanceId !== EDITOR.instanceId);
  if (others.length > 0) {
    throw new Error(
      `${others.length} other Unity editor(s) connected -- close Unity before capturing; ` +
        'its events would end up in the pictures'
    );
  }
}

async function unity(route, body = {}) {
  const res = await fetch(`${UNITY}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...EDITOR, ...body })
  });
  if (!res.ok) throw new Error(`Unity ${route} answered ${res.status}`);
}

// --- the invented day ------------------------------------------------------

const PROJECTS = [
  {
    id: 'demo-mg', key: 'MG', name: 'Moonlight Garden',
    tasks: [
      { key: 'MG-12', title: 'Fix the lantern glow at dusk', status: 'in_progress' },
      { key: 'MG-14', title: 'Pond ripple shader', status: 'todo' },
      { key: 'MG-15', title: 'Firefly flocking', status: 'todo' },
      { key: 'MG-9', title: 'Save system for seeds', status: 'done' }
    ]
  },
  {
    id: 'demo-pf', key: 'PF', name: 'Pixel Forge',
    tasks: [
      { key: 'PF-31', title: 'Anvil sound pass', status: 'todo' },
      { key: 'PF-33', title: 'Ore spawn tables', status: 'in_progress' },
      { key: 'PF-35', title: 'Bellows particle burst', status: 'todo' }
    ]
  }
];

// Hours before now, task, minutes, comment: the day's logged work so far.
// Today only: the session panel's table lists the latest worklogs whatever
// their day, and a total there disagreeing with Work History reads as a bug
// in the pictures.
const WORKLOGS = [
  [6.5, 'demo-mg_MG-14', 85, 'Ripples follow the wind now'],
  [4.8, 'demo-pf_PF-31', 40, 'Hammer and quench sounds'],
  [3.9, 'demo-mg_MG-15', 55, 'Boids, first pass'],
  [2.5, 'demo-pf_PF-33', 70, 'Iron and copper tables']
];

function openDb(profile) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(profile, 'sprintticker.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/**
 * Moves the running session's start back. The engine computes the elapsed
 * time from the row on every tick, so the next frame shows it.
 */
function backdateSession(profile, minutes) {
  const db = openDb(profile);
  db.prepare("UPDATE active_sessions SET start_time_utc = ? WHERE status = 'TRACKING'").run(
    new Date(Date.now() - minutes * 60 * 1000).toISOString()
  );
  db.close();
}

async function reload(page) {
  await page.eval('window.__docReloadMarker = true');
  await page.send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const gone = await page.eval('window.__docReloadMarker !== true').catch(() => false);
    if (gone) break;
  }
  // The views fetch their state once mounted.
  await sleep(2500);
}

const listener = (page, on) => page.api(`saveNotificationSettings({ enableListener: ${on} })`);

async function seed(page, profile) {
  for (const project of PROJECTS) {
    await page.api(`createProject(${JSON.stringify({ id: project.id, key: project.key, name: project.name })})`);
    await page.api(`importTasks(${JSON.stringify(project.id)}, ${JSON.stringify(project.tasks)})`);
  }
  // Written straight into the profile's database: a worklog of an hour and a
  // half cannot be produced through the app in less than one. This is the
  // throwaway profile's file -- see the header -- and the app reads worklogs
  // per request, so they show without a restart.
  const db = openDb(profile);
  const insert = db.prepare(
    'INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  // Each one sent and delivered, so Work History shows them as a user with a
  // provider sees them: "Sent", not "Local only". Delivered rows are never
  // sent again, so nothing leaves the machine.
  const delivered = db.prepare(
    `INSERT INTO worklog_sync_queue (id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status, worklog_id, remote_worklog_id)
     VALUES (?, 'openproject', ?, ?, ?, ?, ?, 'SYNCED', ?, ?)`
  );
  WORKLOGS.forEach(([hoursAgo, taskId, minutes, comment], i) => {
    const start = new Date(Date.now() - hoursAgo * 3600 * 1000);
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    insert.run(`demo-log-${i}`, `demo-session-${i}`, taskId, minutes * 60, start.toISOString(), comment, end.toISOString());
    delivered.run(`demo-sync-${i}`, taskId, minutes * 60, start.toISOString(), comment, end.toISOString(), `demo-log-${i}`, String(900 + i));
  });
  db.close();
}

// --- the run ---------------------------------------------------------------

async function captureWithBar(page, framesDir, profile) {
  const nav = label => page.click(label);

  await page.shot('app-session-idle');

  await page.api(`startTask('demo-mg_MG-12')`);
  backdateSession(profile, SESSION_MINUTES);
  await sleep(2000);
  await clip(page, framesDir, 'tracking', 4200);
  await page.shot('app-session-tracking');

  await clip(page, framesDir, 'paused', 3000, () => page.api('pauseSession()'));
  await page.shot('app-session-paused');
  await page.api('resumeSession()');
  await sleep(1500);

  await page.api('toggleMiniWindow()');
  const mini = await Page.open(url => url.includes('#mini'));
  await mini.shot('app-mini-timer');
  mini.close();
  await page.api('toggleMiniWindow()');

  await unity('heartbeat');
  await clip(page, framesDir, 'unity-compile', 3000, () => unity('compile', { state: 'started', type: 'compile' }));
  await unity('compile', { state: 'finished', type: 'compile' });
  await sleep(2500);
  await clip(page, framesDir, 'unity-build', 3000, () => unity('compile', { state: 'started', type: 'build', progress: 40 }));
  await nav('Unity Engine');
  await page.shot('app-unity');
  await unity('compile', { state: 'finished', type: 'build' });
  await sleep(2500);
  await clip(page, framesDir, 'unity-playmode', 3000, () => unity('playmode', { state: 'entered' }));
  await unity('playmode', { state: 'exited' });
  await sleep(2500);
  await clip(page, framesDir, 'unity-exception', 3000, () =>
    unity('console', { type: 'exception', message: 'NullReferenceException: Lantern.Glow' })
  );
  await sleep(9000);

  await listener(page, true);
  await clip(page, framesDir, 'banner', 3000, () =>
    page.api(`simulateNotification({ appId: 'slack', appName: 'Slack', title: 'Mira', body: 'Playtest at three?' })`)
  );
  await listener(page, false);
  await sleep(10000);

  for (const [label, name] of [
    ['Projects & Tasks', 'app-projects'],
    ['Work History', 'app-history'],
    ['Task Providers', 'app-providers'],
    ['Ceremonies', 'app-ceremonies'],
    ['Notifications', 'app-notifications'],
    ['Priority Rules', 'app-priority'],
    ['Device Diagnostics', 'app-device']
  ]) {
    // The panel reads the listener's state when it opens, so it is switched
    // on first.
    if (name === 'app-notifications') await listener(page, true);
    await nav(label);
    await page.shot(name);
    if (name === 'app-notifications') await listener(page, false);
    if (name === 'app-history') await shootCorrection(page);
  }

  await nav('Active Session');
  await page.click('Setup Wizard');
  await page.shot('app-setup-wizard');
  await page.click('Not now -- use it without one');
  await page.shot('app-setup-wizard-nobar');
  // Closed by a reload: the wizard has no state that outlives it, and the
  // answer above must not be saved.
  await reload(page);
  await page.api('pauseSession()');
}

/**
 * The session log with the correction dialog open on its first worklog: the
 * panel's first picture stops above the log, where the badges and the pencil
 * are. Cancelled afterwards, so nothing is corrected.
 */
async function shootCorrection(page) {
  const opened = await page.eval(`(() => {
    const pencil = document.querySelector('button[aria-label^="Correct "]');
    if (!pencil) return false;
    pencil.closest('.space-y-2').scrollIntoView({ block: 'center' });
    pencil.click();
    return true;
  })()`);
  if (!opened) throw new Error('no worklog to correct in Work History');
  await page.shot('app-history-edit');
  await page.click('Cancel');
}

async function captureWithoutBar(page) {
  const config = await page.api('getDeviceConfig()');
  await page.api(`setDeviceConfig(${JSON.stringify({ ...config, enabled: false })})`);
  await sleep(1500);
  await reload(page);
  await page.api('resumeSession()');
  await sleep(1000);
  await page.shot('app-nobar-session');
  await page.click('Device & Logs');
  await page.shot('app-nobar-device');
  await page.click('Active Session');
  await page.api('toggleMiniWindow()');
  const mini = await Page.open(url => url.includes('#mini'));
  await mini.shot('app-nobar-mini-timer');
  mini.close();
  await page.api('toggleMiniWindow()');
}

async function main() {
  if (!fs.existsSync(path.join(APP_DIR, 'dist', 'main', 'index.js'))) {
    throw new Error('the app is not built: run `pnpm build` first');
  }
  if (await portAnswers(WEBHOOK)) {
    throw new Error(
      `something already answers on ${WEBHOOK} -- close SprintTicker first, or the Unity events ` +
        'this sends would reach it, and its bar'
    );
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-docs-'));
  const framesDir = path.join(profile, 'frames');
  fs.mkdirSync(framesDir);
  fs.mkdirSync(IMAGES, { recursive: true });
  log('profile', profile);

  const child = launch(profile);
  let page = null;
  try {
    page = await Page.open(url => !url.includes('#mini') && !url.startsWith('devtools'));
    // Longer than an editor's heartbeat interval, so an open one is seen
    // before anything is captured.
    await sleep(6000);
    await assertNoOtherEditor(page);
    await listener(page, false);
    // Off by default; the exception screen is one of the pictures.
    const unitySettings = await page.api('getUnitySettings()');
    await page.api(`saveUnitySettings(${JSON.stringify({ ...unitySettings, showUnityErrors: true })})`);
    await seed(page, profile);
    await reload(page);
    await page.eval(RECORDER);

    await captureWithBar(page, framesDir, profile);
    await captureWithoutBar(page);

    const target = process.env.DOC_FRAMES_DIR;
    if (target) {
      fs.mkdirSync(target, { recursive: true });
      for (const f of fs.readdirSync(framesDir)) fs.copyFileSync(path.join(framesDir, f), path.join(target, f));
    }
    log('rendering the bar clips');
    const py = spawn(process.env.PYTHON || 'python', ['-I', path.join(__dirname, 'make-images.py'), '--only', 'captured,screenshots', '--frames', framesDir], {
      stdio: 'inherit'
    });
    const code = await new Promise(resolve => py.on('close', resolve));
    if (code !== 0) throw new Error(`make-images.py exited ${code}`);
  } finally {
    if (page) page.close();
    child.kill();
    await sleep(1500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

main().catch(err => {
  console.error('[capture]', err.message);
  process.exit(1);
});
