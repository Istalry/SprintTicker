#!/usr/bin/env node
/**
 * The dry run at scale (redesign P15b): is SprintTicker still smooth with a
 * real team's load?
 *
 *   pnpm dryrun:scale                 # builds, then runs
 *   node scripts/dry-run-scale.js [--projects 20] [--tasks 50] [--days 60] [--latency 150] [--out <dir>]
 *
 * The app runs on a throwaway profile under `--mock-hardware`, as the
 * picture capture does (capture-app.js, whose launch and CDP pieces this
 * imports), against the fake OpenProject (scripts/fake-openproject.js) in
 * this process: 20 projects of 50 tasks by default, a third of them nobody's
 * and some a teammate's. It measures, in this order:
 *
 * 1. the first sync of every task, and the longest the window froze during it;
 * 2. history: `--days` working days of entries written into the profile's
 *    file (a day of work cannot be played in less than a day), then a day
 *    played through the app's own commands -- the stand-up, starts and
 *    switches, an interruption placed, Lunch and Away, a correction, time
 *    added, End my day -- whose entries go to the fake through the queue;
 * 3. what the user waits for: Today on opening, Ctrl+K and the picker window
 *    with their searches, Tasks and its projects, History's day, week and
 *    Check my week, the mini timer; and the reads behind them, from main.
 *
 * Each figure is the time from the action to the screen showing its result,
 * two frames later, with the longest task that blocked the window meanwhile.
 * The report goes to `<out>/dry-run.json` and the console.
 *
 * Never the real database, never the real bar, never the installed app's
 * port: it runs on capture-app.js's own local API port, beside the user's
 * SprintTicker.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, Page, openDb, reload, backdateSession, portAnswers, sleep, APP_DIR, WEBHOOK } = require('./doc-images/capture-app.js');
const { createFakeOpenProject } = require('./fake-openproject.js');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const PROJECTS = Number(arg('projects', 20));
const TASKS = Number(arg('tasks', 50));
const DAYS = Number(arg('days', 60));
// What a hosted OpenProject takes to answer, measured nowhere in particular:
// a local fake answers in a millisecond, and the first sync's figure would
// say nothing about a user's.
const LATENCY_MS = Number(arg('latency', 150));
const OUT = path.resolve(arg('out', fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-dryrun-'))));

// The fake cycles Task, Bug, Feature, Epic, Milestone, and the provider keeps
// the first three: this many packages leave `TASKS` tasks per project.
const packagesFor = tasks => Math.floor(tasks / 3) * 5 + (tasks % 3);
const TEAMMATE = { id: 9, name: 'Rin Okada' };

const log = (...args) => console.log('[dry-run]', ...args);
const report = { startedAt: new Date().toISOString(), projects: PROJECTS, tasksPerProject: TASKS, days: DAYS, latencyMs: LATENCY_MS, steps: [], notes: [] };
const record = (name, result) => {
  report.steps.push({ name, ...result });
  const extra = result.longest !== undefined ? `, longest block ${result.longest} ms` : '';
  log(`${name}: ${result.ms} ms${extra}${result.detail ? ` -- ${result.detail}` : ''}`);
};

// --- in the page -----------------------------------------------------------

/**
 * Installed in a window: `measure` runs an action and waits for the screen
 * to show its result, then two frames for the paint; long tasks are what
 * froze the window meanwhile.
 */
const PROBE = `(() => {
  if (window.__dr) return;
  const dr = window.__dr = { long: [] };
  try {
    new PerformanceObserver(list => list.getEntries().forEach(e => dr.long.push(e.duration))).observe({ type: 'longtask' });
  } catch (e) { dr.noLongTasks = String(e); }
  // A hidden window paints no frame: wait at most 250 ms, and say so.
  dr.hiddenFrames = 0;
  const frame = () => new Promise(r => {
    const t = setTimeout(() => { dr.hiddenFrames += 1; r(); }, 250);
    requestAnimationFrame(() => { clearTimeout(t); r(); });
  });
  dr.waitFor = async (pred, timeout = 12000) => {
    const t = performance.now();
    while (!pred()) {
      if (performance.now() - t > timeout) throw new Error('timed out waiting for the screen');
      await new Promise(r => setTimeout(r, 4));
    }
  };
  dr.measure = async (act, until) => {
    const from = dr.long.length;
    const t0 = performance.now();
    await act();
    await dr.waitFor(until);
    await frame(); await frame();
    const ms = Math.round(performance.now() - t0);
    const longs = dr.long.slice(from);
    return { ms, longest: Math.round(Math.max(0, ...longs)), longTasks: longs.length };
  };
  dr.type = (input, text) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  dr.button = text => [...document.querySelectorAll('button')].find(b => b.textContent.replace(/\\s+/g, ' ').trim() === text || b.getAttribute('aria-label') === text);
  dr.options = () => document.querySelectorAll('[role=option]').length;
  dr.blockedSince = from => Math.round(Math.max(0, ...dr.long.slice(from)));
})()`;

/** Runs `act` in the page and waits for `until`, both JavaScript source. */
async function measure(page, act, until) {
  await page.eval(PROBE);
  return page.eval(`window.__dr.measure(async () => { ${act} }, () => (${until}))`);
}

/** The text of the step's result, for the report: what the screen showed. */
const count = (page, expression) => page.eval(expression);

// --- the fake provider ------------------------------------------------------

async function startFake() {
  const fake = createFakeOpenProject({ projects: PROJECTS, workPackages: packagesFor(TASKS), pageSize: 100, quiet: true });
  // Whose each package is: the fake gives every one to the user. A third
  // nobody's and one in ten a teammate's, as a team's tracker has them.
  for (let p = 1; p <= PROJECTS; p++) {
    for (let i = 1; i <= packagesFor(TASKS); i++) {
      const id = p * 1000 + i;
      if (i % 3 === 0) fake.assignees.set(id, null);
      else if (i % 10 === 1) fake.assignees.set(id, TEAMMATE);
    }
  }
  // Every answer `LATENCY_MS` late, as across a network.
  const [handler] = fake.server.listeners('request');
  fake.server.removeAllListeners('request');
  fake.server.on('request', (req, res) => setTimeout(() => handler(req, res), LATENCY_MS));
  await new Promise(resolve => fake.server.listen(0, '127.0.0.1', resolve));
  return { ...fake, url: `http://127.0.0.1:${fake.server.address().port}` };
}

// --- the steps --------------------------------------------------------------

async function firstSync(page, fake) {
  await page.eval(PROBE);
  const from = await page.eval('window.__dr.long.length');
  const before = fake.requests.length;
  const t0 = Date.now();
  await page.api(`setActiveProvider(${JSON.stringify({ providerId: 'openproject', opDomain: fake.url, opApiKey: 'dry-run' })})`);
  await page.api('syncProviderNow()').catch(err => report.notes.push(`syncProviderNow: ${err.message}`));
  // Done when the health says so and the provider has stopped being asked;
  // the counts are read after, so reading them is not in the figure.
  let quietSince = Date.now();
  let seen = fake.requests.length;
  let health = null;
  for (let i = 0; i < 1200; i++) {
    await sleep(100);
    if (fake.requests.length !== seen) { seen = fake.requests.length; quietSince = Date.now(); }
    health = await page.api('getSyncHealth()');
    if (health?.state === 'ok' && Date.now() - quietSince > 1500) break;
  }
  const ms = quietSince - t0;
  const list = await page.api('getProjects()');
  const projects = list.filter(p => p.providerId === 'openproject').length;
  let tasks = 0;
  for (const p of list) tasks += (await page.api(`getTasks(${JSON.stringify(p.id)})`)).length;
  record('first sync', {
    ms,
    longest: await page.eval(`window.__dr.blockedSince(${from})`),
    detail: `${projects} projects, ${tasks} tasks, ${fake.requests.length - before} requests, health ${health?.state}`
  });
  return tasks;
}

/**
 * A sync after the first, as every few minutes: main writes every task again,
 * and while it does it answers nothing else -- the window, the bar, the deck.
 * The figure is the slowest answer to a trivial call made every 20 ms meanwhile.
 */
async function syncAgain(page, fake) {
  await page.eval(PROBE);
  const from = await page.eval('window.__dr.long.length');
  const before = fake.requests.length;
  const t0 = Date.now();
  const sync = page.api('syncProviderNow()').catch(err => report.notes.push(`sync again: ${err.message}`));
  const probe = await page.eval(`(async () => {
    let worst = 0, n = 0;
    const end = performance.now() + 9000;
    while (performance.now() < end) {
      const t = performance.now();
      await window.electronAPI.getUserMode();
      worst = Math.max(worst, performance.now() - t);
      n += 1;
      await new Promise(r => setTimeout(r, 20));
    }
    return { worst: Math.round(worst), n };
  })()`);
  await sync;
  record('a sync again, the slowest answer from main', {
    ms: probe.worst,
    longest: await page.eval(`window.__dr.blockedSince(${from})`),
    detail: `${probe.n} calls over 9 s; ${fake.requests.length - before} requests; the sync took ${Date.now() - t0} ms or less`
  });
}

/** `DAYS` working days before today, written into the throwaway profile's file. */
function seedHistory(profile) {
  const db = openDb(profile);
  const tasks = db.prepare("SELECT id FROM tasks WHERE archived_at_utc IS NULL AND id NOT LIKE 'adhoc%' ORDER BY id").all().map(r => r.id);
  const insert = db.prepare(
    'INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const delivered = db.prepare(
    `INSERT INTO worklog_sync_queue (id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status, worklog_id, remote_worklog_id)
     VALUES (?, 'openproject', ?, ?, ?, ?, ?, 'SYNCED', ?, ?)`
  );
  // A seeded generator: the same history on every run, so two runs compare.
  let seed = 1026;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let entries = 0;
  db.exec('BEGIN');
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  for (let done = 0; done < DAYS;) {
    day.setDate(day.getDate() - 1);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    done += 1;
    // 09:00 to about 17:30, six to ten entries, a few short ones.
    let at = new Date(day.getTime() + 9 * 3600_000);
    const n = 6 + rnd(5);
    for (let i = 0; i < n; i++) {
      const minutes = i % 4 === 3 ? 5 + rnd(15) : 30 + rnd(70);
      const task = tasks[rnd(Math.min(tasks.length, 120))];
      const id = `dry-log-${entries}`;
      const end = new Date(at.getTime() + minutes * 60_000);
      insert.run(id, `dry-session-${entries}`, task, minutes * 60, at.toISOString(), `Seeded ${entries}`, end.toISOString());
      delivered.run(`dry-sync-${entries}`, task, minutes * 60, at.toISOString(), `Seeded ${entries}`, end.toISOString(), id, String(100000 + entries));
      entries += 1;
      at = new Date(end.getTime() + (5 + rnd(20)) * 60_000);
    }
  }
  db.exec('COMMIT');
  db.close();
  return { entries, tasks };
}

/** Today, through the app's own commands; every session backdated to have a length. */
async function playToday(page, profile, tasks) {
  const t0 = Date.now();
  const [a, b, c, d] = [3, 8, 14, 20].map(i => tasks[i % tasks.length]);
  const stepped = [];
  const step = async (name, call) => {
    try {
      await call();
      stepped.push(name);
    } catch (err) {
      report.notes.push(`today, ${name}: ${err.message}`);
    }
    await sleep(400);
  };
  await step('stand-up', async () => {
    await page.api('triggerStandupPrompt()');
    await sleep(500);
    await page.api('joinStandup()');
    backdateSession(profile, 15);
    await page.api('completeSession()');
  });
  // Only the first session is backdated: a second would overlap it, and an
  // overlapping entry is held, never sent (CLAUDE.md §7). The rest are short.
  await step('start', async () => {
    await page.api(`startTask(${JSON.stringify(a)})`);
    backdateSession(profile, 150);
    await sleep(1500);
  });
  await step('switch', async () => {
    await page.api(`startTask(${JSON.stringify(b)})`);
  });
  await step('interruption placed', async () => {
    await page.api('interrupt()');
    await sleep(800);
    await page.api('stopInterruption()');
    const waiting = await page.api('getInterruptionsToPlace()');
    if (waiting.length) await page.api(`placeInterruption(${JSON.stringify(waiting[0].id)}, ${JSON.stringify(c)})`);
  });
  await step('Lunch', async () => {
    await page.api("setUserMode('LUNCH')");
    await sleep(1500);
    await page.api("setUserMode('WORK')");
    await sleep(800);
    await page.api('answerResumePrompt(true)');
  });
  await step('Away', async () => {
    await page.api("setUserMode('AWAY')");
    await sleep(1500);
    await page.api("setUserMode('WORK')");
  });
  await step('correction', async () => {
    const today = await page.api('getTodaysWorklogs()');
    const entry = today.find(w => w.taskId === a) || today.find(w => w.durationSeconds > 600);
    if (!entry) throw new Error('no entry of today to correct');
    await page.api(`updateWorklog(${JSON.stringify(entry.id)}, ${JSON.stringify({ durationSeconds: entry.durationSeconds - 60, startedAtUtc: entry.startedAtUtc, comment: 'Corrected in the dry run' })})`);
  });
  await step('time added', async () => {
    const start = new Date();
    start.setHours(7, 0, 0, 0);
    await page.api(`addWorklog(${JSON.stringify({ taskId: d, durationSeconds: 1800, startedAtUtc: start.toISOString(), comment: 'Added in the dry run' })})`);
  });
  await step('End my day', async () => {
    await page.api(`startTask(${JSON.stringify(d)})`);
    // Never `shouldShutdown`: this machine is the developer's.
    await page.api('triggerEodWrapUp({ shouldShutdown: false })');
  });
  record('a day played', { ms: Date.now() - t0, detail: `${stepped.length} of 9 steps: ${stepped.join(', ')}` });
}

/** The queue, once Undo's ten seconds are over: everything reached the fake? */
async function drained(page, fake) {
  const t0 = Date.now();
  let queue = null;
  for (let i = 0; i < 120; i++) {
    queue = await page.api('getSyncQueue()');
    if (queue.counts.pending + queue.counts.syncing === 0 && Date.now() - t0 > 11_000) break;
    await sleep(500);
  }
  record('the day sent', {
    ms: Date.now() - t0,
    detail: `${fake.timeEntries.size} entries at the fake; queue pending ${queue.counts.pending}, failed ${queue.counts.failed}`
  });
}

async function today(page) {
  // The page's own clock, from the navigation, at the moment Today's entries
  // are on screen.
  await page.eval('window.__docReloadMarker = true');
  await page.send('Page.reload', { ignoreCache: true });
  let ms = null;
  for (let i = 0; i < 200 && ms === null; i++) {
    await sleep(20);
    ms = await page.eval(`window.__docReloadMarker === true || !document.querySelector('main table tbody tr') ? null : Math.round(performance.now())`).catch(() => null);
  }
  record('Today, on opening', { ms, detail: 'from the navigation to its entries on screen' });
  await sleep(1500);
}

async function palette(page) {
  await page.eval(PROBE);
  const open = await measure(page,
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));`,
    `document.querySelector('[role=combobox]')`);
  record('Ctrl+K, open', open);
  const search = await measure(page,
    `window.__dr.type(document.querySelector('[role=combobox]'), 'WP 4');`,
    `window.__dr.options() > 0 && [...document.querySelectorAll('[role=option]')].some(o => o.textContent.includes('WP 4'))`);
  record('Ctrl+K, search "WP 4"', { ...search, detail: `${await count(page, 'window.__dr.options()')} rows` });
  await page.key('Escape');
}

async function picker(page) {
  const t0 = Date.now();
  await page.api('openTaskPicker()');
  let win = await Page.open(url => url.includes('#picker'));
  await win.eval(PROBE);
  await win.eval(`window.__dr.waitFor(() => window.__dr.options() > 0)`);
  record('Picker window, first open', { ms: Date.now() - t0, detail: `${await count(win, 'window.__dr.options()')} rows` });
  // Escape closes the window; the next open makes it again or shows it.
  await win.key('Escape').catch(() => undefined);
  win.close();
  await sleep(800);
  const t1 = Date.now();
  await page.api('openTaskPicker()');
  win = await Page.open(url => url.includes('#picker'));
  await win.eval(PROBE);
  await win.eval(`window.__dr.waitFor(() => document.visibilityState === 'visible' && window.__dr.options() > 0)`);
  record('Picker window, open again', { ms: Date.now() - t1 });
  // Typing letter by letter, as a user does: "w", "wp", "wp ", "wp 4".
  for (const text of ['w', 'wp', 'wp ', 'wp 4']) {
    const before = await count(win, 'window.__dr.options()');
    const r = await measure(win,
      `window.__dr.type(document.querySelector('[role=combobox]'), ${JSON.stringify(text)});`,
      `window.__dr.options() !== ${before} || true`);
    record(`Picker, typing "${text}"`, { ...r, detail: `${await count(win, 'window.__dr.options()')} rows` });
  }
  await win.eval(`window.__dr.type(document.querySelector('[role=combobox]'), '')`);
  await sleep(300);
  for (const [label, text] of [['every task', 'WP'], ['one project', 'project 17'], ['one task', 'WP 37 of project 9'], ['cleared', '']]) {
    const before = await count(win, 'window.__dr.options()');
    const r = await measure(win,
      `window.__dr.type(document.querySelector('[role=combobox]'), ${JSON.stringify(text)});`,
      text ? `window.__dr.options() !== ${before} || document.querySelector('[role=combobox]').value === ${JSON.stringify(text)} && window.__dr.options() > 0`
        : `window.__dr.options() > 0 && window.__dr.options() !== ${before}`);
    record(`Picker, search ${label}${text ? ` "${text}"` : ''}`, { ...r, detail: `${await count(win, 'window.__dr.options()')} rows` });
    await sleep(200);
  }
  // The arrows through a long list: the active row must follow at once.
  await win.eval(`window.__dr.type(document.querySelector('[role=combobox]'), 'WP')`);
  await sleep(500);
  const arrows = await measure(win,
    `const f = document.querySelector('[role=combobox]'); for (let i = 0; i < 40; i++) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));`,
    `document.querySelector('[role=combobox]').getAttribute('aria-activedescendant')`);
  record('Picker, 40 arrow presses on every task', arrows);
  await win.key('Escape').catch(() => undefined);
  win.close();
  await sleep(500);
}

async function tasksPage(page) {
  const nav = await measure(page,
    `window.__dr.button('Tasks').click();`,
    `document.querySelector('section[aria-label=Tasks] table tbody tr')`);
  record('Tasks, open', { ...nav, detail: `${await count(page, "document.querySelectorAll('section[aria-label=Tasks] tbody tr').length")} rows` });
  const other = await measure(page,
    `[...document.querySelectorAll('nav[aria-label=Projects] button')].filter(b => b.textContent.includes('Fake Project')).at(-1).click();`,
    `document.querySelector('section[aria-label=Tasks] h2, section[aria-label=Tasks] h3')?.textContent.includes('Fake Project')`);
  record('Tasks, another project', other);
  await page.click('Today');
}

async function history(page) {
  const day = await measure(page,
    `window.__dr.button('History').click();`,
    `document.querySelector('section[aria-label="The day\\'s entries"]')`);
  record('History, the day', day);
  const before = await measure(page,
    `window.__dr.button('The day before').click();`,
    `true`);
  record('History, the day before', before);
  const week = await measure(page,
    `[...document.querySelectorAll('[role=group][aria-label=Show] button')].find(b => b.textContent.trim() === 'Week').click();`,
    `document.querySelector('section[aria-label="The week"] table')`);
  record('History, the week', week);
  const back = await measure(page,
    `window.__dr.button('The week before').click();`,
    `document.querySelector('section[aria-label="The week"] table')`);
  record('History, the week before', back);
  const check = await measure(page,
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Check my week')).click();`,
    `document.querySelector('[role=dialog]')`);
  record('Check my week, open', check);
  await page.key('Escape');
  await page.click('Today');
}

async function mini(page) {
  const t0 = Date.now();
  await page.api('toggleMiniWindow()');
  const win = await Page.open(url => url.includes('#mini'));
  await win.eval(`(async () => { while (!document.querySelector('button')) await new Promise(r => setTimeout(r, 4)); })()`);
  record('Mini timer, open', { ms: Date.now() - t0 });
  win.close();
  await page.api('toggleMiniWindow()');
}

/** The reads behind the screens, timed from here: the IPC round trip and main's work. */
async function reads(page) {
  const from = new Date();
  from.setDate(from.getDate() - 7 * 12);
  const iso = d => d.toISOString().slice(0, 10);
  for (const [name, call] of [
    ['getPickerData', 'getPickerData()'],
    ['getProjects', 'getProjects()'],
    ['getTodaysWorklogs', 'getTodaysWorklogs()'],
    ['getWorklogsRange, 12 weeks', `getWorklogsRange('${iso(from)}', '${iso(new Date())}')`],
    ['getWeekChanges', `getWeekChanges('${iso(new Date())}')`],
    ['getRecentTasks', 'getRecentTasks()'],
    ['getSyncQueue', 'getSyncQueue()']
  ]) {
    const t0 = Date.now();
    const answer = await page.api(call);
    const size = JSON.stringify(answer ?? null).length;
    record(`read ${name}`, { ms: Date.now() - t0, detail: `${Math.round(size / 1024)} KB` });
  }
}

async function heap(page, profile) {
  await page.send('Performance.enable');
  const { metrics } = await page.send('Performance.getMetrics');
  const get = name => metrics.find(m => m.name === name)?.value ?? 0;
  const db = fs.statSync(path.join(profile, 'sprintticker.db')).size;
  report.memory = {
    jsHeapUsedMB: Math.round(get('JSHeapUsedSize') / 1048576),
    domNodes: get('Nodes'),
    databaseKB: Math.round(db / 1024)
  };
  log('memory', report.memory);
}

// --- the run ---------------------------------------------------------------

async function main() {
  if (!fs.existsSync(path.join(APP_DIR, 'dist', 'main', 'index.js'))) throw new Error('the app is not built: run `pnpm build` first');
  if (await portAnswers(WEBHOOK)) throw new Error(`something already answers on ${WEBHOOK} -- another capture or dry run is running`);
  fs.mkdirSync(OUT, { recursive: true });
  const fake = await startFake();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-dryrun-profile-'));
  log(`profile ${profile}; fake OpenProject at ${fake.url}; report in ${OUT}`);
  const child = launch(profile);
  let page = null;
  try {
    page = await Page.open(url => !url.includes('#mini') && !url.includes('#picker') && !url.startsWith('devtools'));
    await sleep(2000);
    await page.api('saveNotificationSettings({ enableListener: false })');
    await page.api("saveFlowSetting('mini_tour_seen', true)");
    await page.api('setTaskVisibility({ unassigned: true, others: true })');

    const tasks = await firstSync(page, fake);
    if (!tasks) throw new Error('the first sync brought no task');
    await syncAgain(page, fake);
    const seeded = seedHistory(profile);
    report.notes.push(`${seeded.entries} entries seeded over ${DAYS} working days`);
    await reload(page);
    await playToday(page, profile, seeded.tasks);
    await drained(page, fake);

    for (const [name, run] of [['today', today], ['palette', palette], ['picker', picker], ['tasks', tasksPage], ['history', history], ['mini', mini], ['reads', reads]]) {
      try {
        await run(page);
      } catch (err) {
        const state = await page.eval(`JSON.stringify({ visibility: document.visibilityState, dialogs: [...document.querySelectorAll('[role=dialog]')].map(d => d.getAttribute('aria-label') || d.textContent.slice(0, 60)) })`).catch(e => String(e));
        report.notes.push(`${name} failed: ${err.message}; window ${state}`);
        log(`${name} failed: ${err.message}; window ${state}`);
        await page.key('Escape').catch(() => undefined);
      }
    }
    report.hiddenFrames = await page.eval('window.__dr?.hiddenFrames ?? 0').catch(() => null);
    await heap(page, profile);
  } finally {
    fs.writeFileSync(path.join(OUT, 'dry-run.json'), JSON.stringify(report, null, 2));
    log('report', path.join(OUT, 'dry-run.json'));
    if (page) page.close();
    child.kill();
    fake.server.close();
    await sleep(1500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

main().catch(err => {
  console.error('[dry-run]', err.message);
  process.exit(1);
});
