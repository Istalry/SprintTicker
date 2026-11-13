#!/usr/bin/env node
/**
 * Captures the screenshots and bar clips the documentation shows.
 *
 *   pnpm docs:images     # builds, captures, then renders scenes and icons
 *
 * or, on a build that is already current, `node scripts/doc-images/capture-app.js`.
 * Close SprintTicker first (see below).
 *
 *   node scripts/doc-images/capture-app.js --screens <dir>
 *
 * captures every screen instead -- the places, Settings' groups, the prompts,
 * the picker and Place windows, the first run -- into <dir>, for a design
 * review or a video (P15). Nothing in docs/images is touched, and no clip is
 * rendered.
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
 *   The capture's instance serves the local port too, though, and if the
 *   installed app is running *it* owns that port, with the user's bar and any
 *   Stream Deck behind it. So the script refuses to start while anything
 *   answers there.
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
// `--screens <dir>`: every screen into <dir>, nothing into docs/images.
const SCREENS = (() => {
  const at = process.argv.indexOf('--screens');
  return at > 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : null;
})();

// How long a new screen takes to reach the emulator after the event behind it.
const SETTLE_MS = 700;
// The tracked time the pictures show: a timer at 00:00 says nothing.
const SESSION_MINUTES = 84;
// The longest a DevTools call may take; the slowest is a screenshot.
const SEND_TIMEOUT_MS = 20000;

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
      // A window that closes on the key it was sent never answers it: the
      // wait would be forever, and the run with it.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer in ${SEND_TIMEOUT_MS} ms`));
      }, SEND_TIMEOUT_MS);
      this.pending.set(id, msg => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
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
    // The real pointer may rest over the window, and its hover would show
    // in the picture as a second place selected. Move it to the corner.
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await sleep(150);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SCREENS ?? IMAGES, `${name}.png`);
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

  /**
   * Clicks the first button or menu item named `label` -- by its accessible
   * label, its text, or a text that ends or starts with it (an icon's glyph
   * first, a count after).
   */
  async press(label) {
    const found = await this.eval(`(() => {
      const want = ${JSON.stringify(label)};
      const all = [...document.querySelectorAll('button, [role=menuitem], [role=tab]')];
      const text = b => b.textContent.replace(/\\s+/g, ' ').trim();
      const button = all.find(b => b.getAttribute('aria-label') === want)
        ?? all.find(b => text(b) === want)
        ?? all.find(b => text(b).endsWith(want))
        ?? all.find(b => text(b).startsWith(want));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!found) throw new Error(`nothing named "${label}" on screen`);
    await sleep(400);
  }

  /** A key press the page receives as the user's: Escape, or Ctrl+K. */
  async key(key, { ctrl = false } = {}) {
    const codes = { Escape: ['Escape', 27], k: ['KeyK', 75] };
    const [code, vk] = codes[key];
    const base = { key, code, windowsVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0 };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(400);
  }

  /** Scrolls the settings row named `title` to the top (P16: rows, not <details>). */
  async reveal(title) {
    const found = await this.eval(`(() => {
      const want = ${JSON.stringify(title)};
      const row = [...document.querySelectorAll('[role=group][aria-labelledby]')]
        .find(g => document.getElementById(g.getAttribute('aria-labelledby'))?.textContent.trim() === want);
      if (!row) return false;
      row.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    if (!found) throw new Error(`no row "${title}" on screen`);
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
  // Installed again on every clip: a reload takes the page's recorder with
  // it, and RECORDER is a no-op where one is still there.
  await page.eval(RECORDER);
  await page.eval('window.__docRec.start()');
  await sleep(ms);
  const frames = await page.eval('window.__docRec.stop()');
  fs.writeFileSync(path.join(framesDir, `${name}.json`), JSON.stringify({ name, holdMs: 1000, frames }));
  log(`clip ${name}: ${frames.length} frame(s)`);
}

// --- the invented day ------------------------------------------------------

const PROJECTS = [
  {
    id: 'demo-mg', key: 'MG', name: 'Moonlight Garden',
    tasks: [
      { key: 'MG-12', title: 'Fix the lantern glow at dusk', status: 'in_progress' },
      { key: 'MG-14', title: 'Pond ripple shader', status: 'todo' },
      { key: 'MG-15', title: 'Firefly flocking', status: 'todo' },
      { key: 'MG-17', title: 'Dew on the leaves', status: 'in_progress' },
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

// Task, ownership, assignee: everything else is the user's.
const OWNERS = [
  ['demo-mg_MG-15', 'unassigned', null],
  ['demo-mg_MG-17', 'other', 'Rin Okada'],
  ['demo-pf_PF-35', 'unassigned', null]
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
  // The invented profile sends to OpenProject without credentials, which
  // Today answers with "No account yet" (P11b): put away, as a user would,
  // or every picture of Today shows it over the session.
  await page.api("dismissNotice('no-account')");
  // The mini timer's one-line tour of its buttons shows on its first open
  // only (P12d); the picture is of the timer as it is every day after.
  await page.api("saveFlowSetting('mini_tour_seen', true)");
  // The day's schedule around the time the capture runs, not the defaults:
  // run at 13:00, the default lunch (12:30-13:30) paused the session and the
  // stand-up clip found nothing to come back to (2026-11-12). The stand-up
  // is behind us, lunch and the wrap-up hours ahead.
  const at = hours => {
    const d = new Date(Date.now() + hours * 3600_000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const schedule = await page.api('getScheduleSettings()');
  await page.api(`saveScheduleSettings(${JSON.stringify({
    ...schedule,
    standupTime: at(-2),
    lunchStartTime: at(3),
    lunchEndTime: at(4),
    eodWrapUpTime: at(6)
  })})`);
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
  // Whose each task is, as a sync from a team's tracker would store it: an
  // import makes every task the user's. Two nobody has, one an invented
  // teammate is on -- and both switches on, so the picture shows both marks.
  for (const [taskId, ownership, assignee] of OWNERS) {
    db.prepare('UPDATE tasks SET ownership = ?, assignee_name = ? WHERE id = ?').run(ownership, assignee, taskId);
  }
  // From OpenProject, as the worklogs above were sent there: a project made
  // in the app has no page on a provider, so its tasks would show no arrow to
  // open one. OpenProject is not set up in this profile, so nothing is asked
  // of it -- and nothing here clicks an arrow.
  db.prepare("UPDATE projects SET provider_id = 'openproject' WHERE id LIKE 'demo-%'").run();
  db.close();
  await page.api('setTaskVisibility({ unassigned: true, others: true })');
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

  await listener(page, true);
  await clip(page, framesDir, 'banner', 3000, () =>
    page.api(`simulateNotification({ appId: 'slack', appName: 'Slack', title: 'Mira', body: 'Playtest at three?' })`)
  );
  await listener(page, false);
  await sleep(10000);

  // The places and Settings' groups since the 2026-11 redesign (P3); a
  // row's fold is opened by its button, and the row scrolled to the top.
  for (const { steps, press, row, name } of [
    { steps: ['Tasks'], name: 'app-projects' },
    { steps: ['History'], name: 'app-history' },
    { steps: ['Settings', 'Account'], name: 'app-providers' },
    { steps: ['Settings', 'My workday'], name: 'app-ceremonies' },
    { steps: ['Settings', 'Desk devices'], press: 'Choose apps…', row: 'Windows notifications on the bar', name: 'app-notifications' },
    { steps: ['Settings', 'Desk devices'], press: 'Open…', row: 'What the bar shows first', name: 'app-priority' },
    { steps: ['Settings', 'Desk devices'], name: 'app-device' }
  ]) {
    // The panel reads the listener's state when it opens, so it is switched
    // on first.
    if (name === 'app-notifications') await listener(page, true);
    for (const step of steps) await nav(step);
    // A place keeps the scroll of the one before it.
    await page.eval(`document.querySelector('main').scrollTop = 0`);
    if (press) {
      await page.click(press);
      await page.reveal(row);
    }
    await page.shot(name);
    if (name === 'app-notifications') await listener(page, false);
    if (name === 'app-history') await shootCorrection(page);
    await nav('Today');
  }

  await nav('Settings');
  await nav('General');
  // The first run (S1-S3): S1 with No account chosen, then S2 with
  // neither device -- the picture of using it without a bar.
  await page.click('Run setup');
  await page.eval(`[...document.querySelectorAll('input[type=radio]')]
    .find(r => r.closest('label')?.textContent.includes('No account'))?.click()`);
  await sleep(300);
  await page.shot('app-setup-wizard');
  // Continue saves "No account" on this throwaway profile, whose projects are
  // its own anyway; S2 is reached no other way.
  await page.click('Continue');
  await sleep(500);
  await page.eval(`[...document.querySelectorAll('input[type=checkbox]')]
    .find(c => c.closest('label')?.textContent.includes('I have neither'))?.click()`);
  await sleep(300);
  await page.shot('app-setup-wizard-nobar');
  // Closed by a reload: the desk's answer must not be saved.
  await reload(page);

  // Last, because joining stops MG-12: the stand-up is an ad-hoc session,
  // shown by its name alone with the meeting icon. Stopping it restarts
  // MG-12, at zero -- backdated again for the pictures without a bar.
  await page.api('triggerStandupPrompt()');
  await sleep(2500);
  await clip(page, framesDir, 'standup', 3000, () => page.api('joinStandup()'));
  await page.api('completeSession()');
  await sleep(1500);
  // The two worklogs that made -- MG-12 cut short, the stand-up's minute --
  // would sit atop every session log pictured after this one. The throwaway
  // profile's file, as in seed(): only the invented day stays.
  const db = openDb(profile);
  db.prepare("DELETE FROM worklog_sync_queue WHERE id NOT LIKE 'demo-sync-%'").run();
  db.prepare("DELETE FROM worklogs WHERE id NOT LIKE 'demo-log-%'").run();
  db.close();
  backdateSession(profile, SESSION_MINUTES);
  await sleep(1500);
  await page.api('pauseSession()');
}

/**
 * The session log with the correction dialog open on its first worklog: the
 * panel's first picture stops above the log, where the badges and the pencil
 * are. Cancelled afterwards, so nothing is corrected.
 */
async function shootCorrection(page, name = 'app-history-edit') {
  const opened = await page.eval(`(() => {
    const pencil = document.querySelector('button[aria-label^="Correct "]');
    if (!pencil) return false;
    pencil.closest('.space-y-2').scrollIntoView({ block: 'center' });
    pencil.click();
    return true;
  })()`);
  if (!opened) throw new Error('no worklog to correct in History');
  await page.shot(name);
  await page.click('Cancel');
}

// --- every screen (--screens) ---------------------------------------------

/**
 * Every screen, for a review or a video: each step is tried on its own and
 * reported when it fails, so one label that moved costs one picture, not the
 * run. The order matters where a step leaves state behind.
 */
async function captureEveryScreen(page, profile) {
  const step = async (name, run) => {
    try {
      await run();
    } catch (err) {
      log(`skipped ${name}: ${err.message}`);
    }
  };
  const top = () => page.eval(`(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 0; })()`);
  const place = async (...steps) => {
    for (const s of steps) await page.press(s);
    await top();
  };
  const other = async (match, name, close = true) => {
    const win = await Page.open(match);
    await win.shot(name);
    // Escape closes the window, so its own key-up may never be answered.
    if (close) await win.key('Escape').catch(() => undefined);
    win.close();
  };

  await step('today idle', () => page.shot('s01-today-idle'));
  await page.api(`startTask('demo-mg_MG-12')`);
  backdateSession(profile, SESSION_MINUTES);
  await sleep(2000);
  await step('today tracking', () => page.shot('s02-today-tracking'));
  await step('today paused', async () => {
    await page.api('pauseSession()');
    await page.shot('s03-today-paused');
  });
  await page.api('resumeSession()');
  await sleep(1000);
  await step('ctrl+k', async () => {
    await page.key('k', { ctrl: true });
    await page.shot('s04-ctrl-k');
    await page.key('Escape');
  });
  await step('picker window', async () => {
    await page.api('openTaskPicker()');
    await other(url => url.includes('#picker'), 's05-picker-window');
  });
  // The mini timer stays open through the interruption.
  await step('mini timer', async () => {
    await page.api('toggleMiniWindow()');
    await other(url => url.includes('#mini'), 's06-mini-timer', false);
  });
  await step('interruption', async () => {
    await page.api('interrupt()');
    await sleep(1500);
    await page.shot('s07-today-interruption');
    const mini = await Page.open(url => url.includes('#mini'));
    await mini.shot('s08-mini-interruption');
    mini.close();
    // Stop opens the Place window (P13c), raised.
    await page.api('stopInterruption()');
    await other(url => url.includes('#picker'), 's09-place-window');
    await sleep(800);
    await page.shot('s10-today-to-place');
  });
  await step('mini off', () => page.api('toggleMiniWindow()'));
  await step('stand-up prompt', async () => {
    await page.api('triggerStandupPrompt()');
    await sleep(1500);
    await page.shot('s11-today-standup-prompt');
    await page.api('cancelStandupPrompt()');
  });
  await step('end my day', async () => {
    await page.press('End my day');
    await page.shot('s12-end-my-day');
    await page.press('Remind me in 15 min');
  });

  await step('tasks', async () => {
    await place('Tasks');
    await page.shot('s13-tasks');
  });
  await step('tasks, own project', async () => {
    await page.api(`createProject({ id: 'ADMIN', key: 'ADMIN', name: 'Studio admin', providerId: 'sprintticker' })`);
    await page.api(`importTasks('ADMIN', [{ key: 'ADMIN-1', title: 'Expense report' }, { key: 'ADMIN-2', title: 'Order a new drawing tablet' }])`);
    await page.press('Today');
    await place('Tasks');
    await page.press('Studio admin');
    await page.press('More for Studio admin');
    await page.shot('s14-tasks-own-project');
    await page.key('Escape');
  });

  await step('history day', async () => {
    await page.press('Today');
    await place('History');
    await page.shot('s15-history-day');
  });
  await step('history correction', () => shootCorrection(page, 's16-history-correct'));
  await step('add time', async () => {
    await page.press('Add time');
    await page.shot('s17-history-add-time');
    await page.key('Escape');
  });
  await step('history week', async () => {
    await page.press('Week');
    await page.shot('s18-history-week');
  });
  await step('check my week', async () => {
    await page.press('Check my week');
    await page.shot('s19-check-my-week');
    await page.key('Escape');
  });

  const groups = [
    ['General', 's20-settings-general'],
    ['Account', 's21-settings-account'],
    ['My workday', 's22-settings-workday'],
    ['Desk devices', 's23-settings-devices'],
    ['Data', 's24-settings-data']
  ];
  for (const [group, name] of groups) {
    await step(name, async () => {
      await page.press('Today');
      await place('Settings', group);
      await page.shot(name);
    });
  }
  await step('settings search', async () => {
    await page.eval(`(() => {
      const box = document.querySelector('input[aria-label="Search settings"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(box, 'lunch');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.shot('s25-settings-search');
  });
  await step('developer', async () => {
    await page.eval(`localStorage.setItem('sprintticker.showDeveloperTools', 'true')`);
    await reload(page);
    await place('Settings', 'Developer');
    await page.shot('s26-settings-developer');
    await page.press('Open Bar health');
    await page.shot('s27-settings-bar-health');
  });

  await step('first run', async () => {
    await page.press('Today');
    await place('Settings', 'General');
    await page.press('Run setup');
    await page.shot('s28-first-run-account');
    await page.eval(`[...document.querySelectorAll('input[type=radio]')]
      .find(r => r.closest('label')?.textContent.includes('No account'))?.click()`);
    await sleep(300);
    await page.press('Continue');
    await sleep(500);
    await page.shot('s29-first-run-devices');
  });
  // Closed by a reload: the desk's answer must not be saved.
  await reload(page);

  await step('without a bar', async () => {
    const config = await page.api('getDeviceConfig()');
    await page.api(`setDeviceConfig(${JSON.stringify({ ...config, enabled: false })})`);
    await sleep(1500);
    await reload(page);
    await page.shot('s30-nobar-today');
    await place('Settings', 'Desk devices');
    await page.shot('s31-nobar-devices');
  });
}

async function captureWithoutBar(page) {
  const config = await page.api('getDeviceConfig()');
  await page.api(`setDeviceConfig(${JSON.stringify({ ...config, enabled: false })})`);
  await sleep(1500);
  await reload(page);
  await page.api('resumeSession()');
  await sleep(1000);
  await page.shot('app-nobar-session');
  await page.click('Settings');
  await page.click('Desk devices');
  await page.shot('app-nobar-device');
  await page.click('Today');
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
      `something already answers on ${WEBHOOK} -- close SprintTicker first: the capture's own ` +
        'instance needs the port, and the running one drives a real bar'
    );
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-docs-'));
  const framesDir = path.join(profile, 'frames');
  fs.mkdirSync(framesDir);
  fs.mkdirSync(SCREENS ?? IMAGES, { recursive: true });
  log('profile', profile);

  const child = launch(profile);
  let page = null;
  try {
    page = await Page.open(url => !url.includes('#mini') && !url.startsWith('devtools'));
    // The app finishing its start before the first call reaches it.
    await sleep(2000);
    await listener(page, false);
    await seed(page, profile);
    await reload(page);
    await page.eval(RECORDER);

    if (SCREENS) {
      await captureEveryScreen(page, profile);
      log('screens in', SCREENS);
      return;
    }
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
