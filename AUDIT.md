# BUSY Bar PC Companion — Project Audit

**Date:** 2026-09-04
**Scope:** `packages/desktop-app` (Electron main + preload + React renderer), `packages/unity-plugin`, `scripts/`, `tools/`, repo hygiene.
**Reference specs used:** `Documentation/BUSY Bar API & Display Technical Developer Guide.md`, `CLAUDE.md` (then `GEMINI.md`), `README.md`, and BUSY Bar's own OpenAPI specification and teaching pack. The last of those was third-party material and is no longer tracked here — it now lives untracked in `Documentation/private/`; fetch it from [busy-app](https://github.com/busy-app).

---

## 0. Verified baseline

Everything below was executed against the working tree, not inferred.

| Check | Command | Result |
| :--- | :--- | :--- |
| Unit tests | `pnpm --filter @sprintticker/desktop-app test` | **274/274 pass** (27 files) |
| Coverage | `vitest run --coverage` | **88.27% stmts / 73% branch / 91.66% funcs** — passes the configured 80/70 thresholds |
| ESLint | `eslint packages/desktop-app/src/**` | **Clean** — 73 files, 0 errors, 0 warnings |
| TypeScript (main+preload+shared) | `tsc --noEmit -p packages/desktop-app/tsconfig.json` | **31 errors** ❌ |
| TypeScript (renderer) | not covered by any tsconfig | **excluded entirely** ❌ |
| CI | `.github/` | **no workflows** ❌ |

Two caveats on the green numbers:

* Coverage `include` is `src/main/**` + `src/shared/**` only. The renderer (~4,700 lines of TSX, 22 files) is **0% covered and not measured**. The README's "80%+ coverage" is true for the main process only.
* One of five test runs terminated with a **segfault (exit `3221225477` / `ACCESS_VIOLATION`)** *after* all 274 tests reported green. Root cause is almost certainly leaked native handles: every `TimeTrackingEngine` constructed in a test starts an `OfflineSyncWorker` 5-minute interval (`[OfflineSyncWorker] Starting background sync worker` appears dozens of times in the log) which is never stopped, while `afterEach` closes the underlying `better-sqlite3` handle. See F-14.

---

## 1. Critical

### F-01 — A transient provider outage wipes the entire local project/task cache
`src/main/sync/offline-sync-worker.ts:82,86` · `src/main/providers/openproject-provider.ts:88`

`OpenProjectProvider.getProjects()` and `getTasks()` swallow every error and `return []`. `syncTasksAndProjects()` then treats that empty array as authoritative truth and prunes:

```ts
const projects = await this.providerManager.getProjects();   // [] on network/auth failure
...
this.taskRepo.deleteTasksNotIn(p.id, activeTaskIds);
this.projectRepo.deleteProjectsNotIn(activeProjectIds);      // deletes everything
```

`deleteTasksNotIn` explicitly special-cases the empty list to `DELETE FROM tasks WHERE project_id = ?` (`task-repository.ts:194`). So a Wi-Fi drop, a VPN hiccup, an expired API key, or OpenProject rebooting at the 5-minute tick **destroys the offline cache the app exists to provide**. The user then sees an empty task list on the hardware and in the UI.

**Fix:** make the provider distinguish "empty" from "failed" (return `null`/throw, or a `{ok, data}` result) and skip all pruning unless the fetch demonstrably succeeded.

### F-02 — Offline worklogs are marked permanently FAILED on the first attempt and never retried
`src/main/providers/provider-manager.ts:152,157` vs `src/main/sync/offline-sync-worker.ts:130`

There are two contradictory retry policies over the same `worklog_sync_queue` table:

* `OfflineSyncWorker.processPendingQueue()` → `incrementRetryCount(item.id, 3)` → stays `PENDING` until 3 attempts.
* `ProviderManager.flushPendingSyncQueue()` → `updateSyncItemStatus(item.id, 'FAILED')` → **terminal on attempt 1**.

`TimeTrackingEngine.stopSession()` (`time-tracking-engine.ts:296`) calls `flushPendingSyncQueue()` immediately after enqueuing. So the common path is: user finishes a task while offline → worklog enqueued `PENDING` → flush fires → provider fails → row set to `FAILED`. `getPendingQueueItems()` selects `WHERE status = 'PENDING'` only, so the background worker will **never** pick it up again. There is also **no UI anywhere that surfaces or requeues `FAILED` items** (`grep FAILED src/renderer` → nothing).

Net effect: tracked time logged while offline is silently never synced to OpenProject. This directly contradicts the README's "automated sync queues for offline resilience."

**Fix:** delete `flushPendingSyncQueue`'s duplicate policy and route everything through `incrementRetryCount` with backoff; add a "N worklogs failed to sync" banner + manual retry.

### F-03 — Duplicate time entries: two uncoordinated flushers race over the same queue
`provider-manager.ts:131` · `offline-sync-worker.ts:98`

`OfflineSyncWorker.processPendingQueue()` guards itself with `this.isProcessing`, but `ProviderManager.flushPendingSyncQueue()` shares no lock with it. `stopSession()` and `ProviderManager.logTime()` both trigger the latter. Two concurrent passes read the same `PENDING` rows and both `POST /api/v3/time_entries` → **the same work is billed twice in OpenProject**. Nothing in the DB (no `status='SYNCING'` transition, no transaction) prevents it.

**Fix:** single owner for the queue; claim rows with an atomic `UPDATE ... SET status='SYNCING' WHERE id=? AND status='PENDING'` before dispatching.

### F-04 — The project does not typecheck; 31 real type errors are shipping
`tsc --noEmit -p packages/desktop-app/tsconfig.json`

Vite/esbuild strips types without checking them, there is no `typecheck` npm script, and ESLint runs **without** `parserOptions.project` so no type-aware rule can catch any of this. Several errors are live behaviour bugs, not cosmetics:

| Error | Consequence |
| :--- | :--- |
| `ipc-handler-registry.ts:440-443` — `Property 'providerManager' does not exist` | **`SET_ACTIVE_PROVIDER` never calls `reinitializeProviders()`.** Saving a new OpenProject domain/API key/status mapping has no effect until the app is restarted. |
| `unity-telemetry-service.ts:5` — `Cannot find module './time-tracking-engine'` | Broken import path (the file is at `../engine/`). Bundler resolves nothing; the type is silently `any`. |
| `display-renderer.ts:254,256` — `'neon_night'` / `'default'` not comparable to `ColorThemeId` | `ColorThemeId` is `emerald \| cyberpunk \| retro_arcade \| nordic_cyan`. `getThemeColors()` switches on `neon_night` and `default` — **two dead branches**, and **`nordic_cyan` silently falls through to emerald**. One of four advertised themes does nothing. |
| `display-renderer.ts:527` — `'STATIC'` not assignable to `LedAnimationMode` | Invalid LED mode leaks into the emulator state. |
| `input-decoder.ts:233` — `'description' does not exist on TaskDTO` | Hardware task-picker second line is always `'No description'`. |
| `priority-preemption-engine.ts:266,268` — `Cannot find name 'DisplayRenderer'` | Missing import; the field is untyped. |
| `display-renderer.ts:67,383,384,806`, `ipc-handler-registry.ts:562,567`, `preload/index.ts:81,197-202` — `Cannot find name ...` | 9 missing type imports across the IPC boundary. |
| `busybar-driver.ts:225,233` — `Property 'battery_charge' does not exist on '{}'` | `parseTelemetryData` indexes into `unknown`; no compile-time guarantee the parse shape is right. |

**Fix:** add `"typecheck": "tsc --noEmit"` to both packages, fix the 31 errors, wire it into CI, and add `parserOptions.project` to `.eslintrc.cjs` so type-aware lint rules actually engage.

### F-05 — The renderer has no type safety across the IPC boundary at all
`packages/desktop-app/tsconfig.json:19` — `"exclude": ["src/renderer/**/*"]`

The preload correctly declares `declare global { interface Window { electronAPI: IElectronAPI } }`, but no tsconfig ever compiles the renderer, so that declaration is never loaded there. Compiling the renderer standalone produces a wall of `Property 'electronAPI' does not exist on type 'Window'` and `Parameter implicitly has an 'any' type`. Every one of the ~90 IPC methods is invoked **completely untyped** from the UI — the largest and most change-prone surface in the app.

Additionally `HardwareDisplayEmulator.tsx:3` does:

```ts
import { FONT_4X6 } from '../../main/hardware/pixel-canvas.ts';
```

The renderer reaches directly into main-process source (with a literal `.ts` extension). That pulls main-process modules into the renderer bundle and breaks the process boundary. Shared constants belong in `src/shared/`.

**Fix:** add `tsconfig.renderer.json` including `src/renderer` + `src/preload` + `src/shared`; move `FONT_4X6` to `src/shared/`.

---

## 2. High

### F-06 — The rear 160×80 OLED is never actually driven
`src/main/hardware/display-renderer.ts:365-395`

Every render path builds a `backElements` array (13 call sites) and passes it to `transmitFrame(...)`. `transmitFrame` uses it only to populate `this.lastState` for the emulator subscribers — the **only** hardware call it makes is `sendPixelFrame(pngBuffer, ...)`, which draws a single `display: "front"` `ImageElement`. `grep sendDisplayPayload src/main` confirms no render path ever posts the back elements.

So the README's "Rear OLED Screen (160×80): Renders secondary status, timer counts, and detailed session telemetry" is **emulator-only**. On real hardware the rear screen shows nothing from this app.

Two latent defects will bite the moment this is wired up:

1. **Invalid colours — 13 occurrences of `'#CCCCCCCCFF'`** (`display-renderer.ts:292,293,294,302,303,304,305,427,495,524,674,720,958`). That is **10 hex digits**; the spec requires `#RRGGBBAA` (8). Per §8 of the Developer Guide an invalid colour format is a `400 Bad Request` that rejects **the whole draw payload**, not just the element. `DisplayRenderer.normalizeHexColor()` only pads the 7-char case and would not repair these — and it is not applied to rear elements anyway. (Today the effect is limited to the emulator: `#CCCCCCCCFF` is also invalid CSS, so those canvas assignments silently keep the previous fill colour.)
2. **Non-ASCII glyphs** — `'CPU Load  : 14% [████░░░░░░]'` (`:292`). `sanitizeAsciiText` strips `█`/`░`, so the bar renders as `[]`.

Also note the PERFORMANCE_MONITOR rear mode is **entirely fabricated**: `CPU Load : 14%`, `RAM Usage : 42% (6.8 / 16 GB)` are hardcoded string literals, not real telemetry.

### F-07 — A full PNG asset upload is pushed to the device every single second
`src/main/index.ts:180` → `display-renderer.ts:378` → `busybar-driver.ts:610`

`engine.on('tick')` fires at 1 Hz and calls `renderActiveSession()` unconditionally. That runs `encodeMatrixToPng` and then `sendPixelFrame`, which is `POST /api/assets/upload` **followed by** `POST /api/display/draw` — two HTTP round-trips and a flash write on the microcontroller, **every second, for the entire working day** (~28,800 writes over 8 hours). There is no dirty-check: if the canvas is pixel-identical to the previous frame (e.g. a paused session), it uploads anyway.

The Developer Guide §6 positions PNG upload as the path for *dense* art (>40 rectangle strips); the current front layout is an icon plus two short text rows, which the firmware could render natively with `TextElement` + scroll parameters and no upload at all.

**Fix (in order of payoff):**
1. Hash the encoded PNG and skip transmit when unchanged — kills the majority of traffic instantly.
2. Only the timer digits change second-to-second; use a native `CountdownElement` (`direction: "time_since"`, `timestamp`) so the *firmware* animates the clock and the host redraws only on state change.
3. Drop the tick-driven redraw to state-change-driven.

### F-08 — 60 fps animation loop runs indefinitely during Lunch/Away, holding a power-save blocker
`src/main/hardware/animation-player.ts:186,194,242` · `Animations/*/meta.json` (`"fps": 60`)

* `renderLunchMode()` and `renderAwayMode()` call `play(..., { loop: true })`. `AnimationPlayer.play` starts `powerSaveBlocker.start('prevent-app-suspension')` and only releases it in `stop()` — so the blocker is held for the **entire lunch break and the entire time the workstation is locked**. `powerMonitor.on('lock-screen')` → `enterAwayMode()` → looping animation → blocker held while the machine is locked.
* `setInterval` at `1000/60 ≈ 16ms` fires 60×/s. Even on the hardware-accelerated path (a `.anim` file exists, so the device animates itself), the JS interval still runs and calls `onAnimationFrame`, which does `frameBuffer.toString('base64')` on a PNG and sends it over IPC to the renderer — **60 base64 encodes + 60 IPC messages per second, forever**.
* Without a `.anim` file the fallback path calls `sendPixelFrame` at 60 Hz — 60 asset uploads/second to the device.
* `loadAnimation` does a **synchronous** `fs.readFileSync` per frame on the Electron main thread. `lunch_72x16` has **1,080 frames / 4 MB**; `meeting_72x16` has 1,050. Entering lunch mode blocks the main process while it reads ~1,000 files, then holds all buffers in a `Map` that is **never evicted**.
* On the renderer side, `HardwareDisplayEmulator.tsx:47-56` caches an `HTMLImageElement` per unique base64 data-URL in a `Map` that is also never cleared → up to 1,080 `Image` objects plus their base64 keys retained.

**Fix:** stop the frame interval entirely when the `.anim` hardware path is active (only tick the emulator at ~10 fps); release the power-save blocker for looping/idle animations; lazy-load frames; cap/evict both caches.

### F-09 — The local webhook server is unauthenticated and reachable from any web page
`src/main/api/webhook-server.ts:157-215`

The server on `127.0.0.1:39123` has no token, no `Origin` check, and no `Content-Type` check — it parses any POST body as JSON and routes it. `POST /api/input?key=<k>` doesn't even need a body.

A `fetch('http://127.0.0.1:39123/api/input?key=start', {method:'POST', mode:'no-cors'})` from **any website the user visits** is a CORS *simple request*: no preflight is sent, the response is opaque but **the side effect executes**. That drives `driver.injectRemoteKey` → `InputDecoder` → start/pause/stop tracking sessions, open the hardware task selector, and step through the EOD confirm flow. Any unprivileged local process can do the same. (The EOD *shutdown* itself still requires the user to tick a checkbox in the desktop modal, so that specific escalation is blocked — but session state and the physical display are fully controllable.)

Additional hardening gaps in the same file:

* **Unbounded request body** (`:165`): `bodyText += chunk.toString('utf-8')` with no size cap — a single local POST can exhaust main-process memory.
* **No rate limiting** — see F-10, where Unity itself can flood it.
* **Binds a second server on port 8080** (`:383`) unconditionally whenever `port !== 8080`. 8080 is one of the most contested dev ports on a developer's machine; whoever starts first wins. This "fallback" has no documented purpose and should be removed or made opt-in.
* `start()` registers `once('error', reject)`; any post-listen error is unhandled and will crash the main process. If 39123 is already taken, `start()` rejects inside `app.whenReady()` and initialisation aborts as an unhandled rejection.

### F-10 — The Unity plugin can flood the webhook server with one POST per console error
`packages/unity-plugin/Editor/BusyBarWebhookPublisher.cs:255,285`

```csharp
Application.logMessageReceivedThreaded += OnLogMessageReceived;
...
private static void OnLogMessageReceived(string condition, string stackTrace, LogType type) {
    if (type == LogType.Exception || type == LogType.Error) {
        SendWebhookAsync($"{WebhookBaseUrl}/console", ...);   // Task.Run + HTTP POST
    }
}
```

No debounce, no dedup, no cap. A `NullReferenceException` inside an `Update()` loop in Play Mode logs **once per frame** — at 60 fps that is 60 `Task.Run` allocations and 60 HTTP POSTs per second, indefinitely, thread-pool-starving the Editor and hammering a server with no rate limit. It then drives a `renderExceptionAlert` → matrix redraw for each.

Also in this file:

* `SendWebhookAsync` has an **empty `catch {}`** — explicitly forbidden by `GEMINI.md` §5. (Same anti-pattern in the PowerShell listener: `Get-AppIconPath`'s `catch {}`, and three more.)
* `OnPlayModeStateChanged` treats both `ExitingPlayMode` **and** `EnteredEditMode` as `"exited"` → **two identical exit webhooks** per play session.
* The static ctor defensively `-=` unsubscribes the four `CompilationPipeline` handlers but not `logMessageReceivedThreaded`, `playModeStateChanged`, `EditorApplication.update`, or the `Lightmapping` events. Inconsistent, and fragile if the domain-reload assumption changes.
* No opt-out setting: importing the package unconditionally opens an HTTP client to `127.0.0.1`.

### F-11 — OpenProject API key is sent over plaintext HTTP by default, and stored in plaintext
`src/main/providers/openproject-provider.ts:33-38` · `provider-manager.ts:43`

```ts
if (clean && !clean.startsWith('http://') && !clean.startsWith('https://')) {
  clean = 'http://' + clean;      // ← defaults to plaintext
}
```

A user typing `openproject.mycompany.com` gets `http://`, and `getAuthHeader()` then transmits `Basic base64("apikey:<token>")` — trivially reversible — **in the clear**. Default should be `https://`, with an explicit opt-in for plaintext LAN hosts.

Related:

* The default domain is hardcoded to **`http://192.168.0.139:8090/`** (`provider-manager.ts:43`) — a developer's private LAN address baked into shipping defaults. A fresh install immediately starts probing that address on the user's network.
* `op_api_key` is persisted as plaintext JSON in the `settings` SQLite table. Electron's `safeStorage` (DPAPI-backed on Windows) exists precisely for this.
* Default status IDs are the *names* `'In progress'`, `'In testing'`, `'Developed'`, but they're interpolated as IDs into `/api/v3/statuses/${targetStatusId}` — the defaults can never produce a valid URL.

### F-12 — No pagination: only the first page of projects and work packages is ever seen
`openproject-provider.ts:70,104,153,190`

Every OpenProject call fetches a bare collection URL with no `pageSize`/`offset` and never follows `_links.nextByOffset`. OpenProject's default page size is 20–30. Any user with more than ~20 projects, or a project with more than ~20 open work packages assigned to them, **silently loses everything past page one** — and F-01 then deletes those "missing" tasks from the local cache.

`reconcileRemoteState()` has the same defect, so "time logged today" is undercounted once a user has >20 time entries in a day.

None of these `fetch` calls has a timeout either (contrast with the driver, which uses `AbortSignal.timeout(2000)`), so a hung OpenProject stalls `syncTasksAndProjects()` — which is also **not** guarded by `isProcessing`, allowing overlapping runs to pile up.

Separately: `getTasks` hardcodes `assignee = "me"` into the filter. That's an undocumented, unconfigurable product decision — unassigned tickets and team tickets are invisible.

### F-13 — Notification listener copies the whole Windows notification database every 2 seconds
`src/main/services/windows-notification-listener-service.ts:576-582`

The polling loop, every `pollingIntervalSeconds` (default **2**), does:

```powershell
Copy-Item $notifDbPath $tempDb -Force
Copy-Item "$notifDbPath-wal" "$tempDb-wal" -Force
Copy-Item "$notifDbPath-shm" "$tempDb-shm" -Force
& $sqlite3Cmd -separator '|BUSYSEP|' $tempDb $query
Remove-Item $tempDb -Force
```

`wpndatabase.db` routinely reaches tens of MB. That is a multi-MB triple file copy + spawn of `sqlite3.exe` **30 times a minute, all day** — sustained SSD write amplification and CPU for a feature that produces a handful of events per hour. The no-sqlite3 fallback (`:648`) is worse: it `ReadAllBytes` the entire database and runs a `Singleline` regex over the whole thing on the same cadence.

Additional problems in this service:

* **`findSourceRule` over-matches** (`:702`): `searchId.includes(r.appId.toLowerCase())` — a rule whose `appId` is the empty string makes `''.includes` ⇒ `searchId.includes('')` ⇒ **`true` for every notification**. A user creating a rule without an app ID (or with a 1–2 char ID) silently captures or suppresses everything.
* **No auto-restart**: on `_psProcess.on('exit')` the service sets `_isListening = false` and gives up permanently. Any PowerShell crash silently ends notification capture for the session.
* `$seenPayloadHashes` is capped at 500 only in the native-parser branch; the WinRT branch grows without bound.
* `Get-AppIconPath` runs `Get-AppxPackage` **per notification** — a multi-hundred-millisecond call inside the polling loop.
* Spawning `powershell.exe -ExecutionPolicy Bypass -EncodedCommand <base64>` is a textbook EDR/AV detection signature. Expect this to be quarantined in any managed enterprise environment. Worth documenting, and worth considering a signed `.ps1` or a native WinRT addon instead.
* **Privacy:** every captured notification's title and body is `console.log`ed, buffered in `_logEntries`, broadcast over IPC to the renderer, **and** swept into the diagnostics export (F-18). See F-19.

### F-14 — `TimeTrackingEngine`'s constructor starts a background worker; tests leak native handles
`src/main/engine/time-tracking-engine.ts:44-52`

```ts
this._syncWorker = new OfflineSyncWorker(...);
this._syncWorker.start();      // 5-min interval + immediate network + DB work
this.reconcileStartupState();  // DB query
```

Constructing an object should not start timers or perform I/O. This violates SRP/DIP (`GEMINI.md` §2), makes the class impossible to instantiate in a test without side effects, and is the direct cause of the intermittent test-run segfault: dozens of live intervals holding `better-sqlite3` statements while `afterEach` closes the database.

`main/index.ts` also never calls `engine.dispose()` — the `will-quit` handler cleans up the schedule service, notification listener, webhook server, driver and DB, but not the engine.

**Fix:** move `start()` + `reconcileStartupState()` into an explicit `initialize()`; call `engine.dispose()` from `will-quit`; add `afterEach(() => engine.dispose())` in the test suites.

---

## 3. Medium

### F-15 — Priority lock leak: `menuPriority` is acquired and never released
`display-renderer.ts:661` · `priority-preemption-engine.ts:275`

`evaluateRequest` takes the lock on every granted render. `renderTaskSelection` requests `'menuPriority'` — an event name with **no matching rule**, so it falls back to `priority ?? 50` — and nothing anywhere calls `releaseActiveLock('menuPriority')` (`grep releaseActiveLock` returns eod/standup/unity/lunch/away only). Once the user opens the hardware task selector, `_activeLockEventName` stays `'menuPriority'` at priority 50 for the rest of the session, permanently blocking any event below 50 and confusing `getActiveLockEventName()` (which `InputDecoder` branches on).

There is also **no timeout-based auto-release** on the lock generally, and `hasActiveNotification()` / `dismissNotification()` only recognise four hardcoded event names, so an unknown stuck lock cannot be cleared by the user at all.

### F-16 — ~~Lunch break duplicates ad-hoc tasks and splits sessions instead of pausing~~ (WITHDRAWN in part)

> **Withdrawn by the maintainer.** Logging the hours worked before lunch and
> opening a fresh record afterwards is *intended*, and is better than pausing:
> it produces two honest worklog entries rather than one entry with a hole in
> it. The finding was written against a doc comment that said "auto-pausing",
> so the comment was what was wrong.
>
> **One real defect survived and was fixed:** resume re-ran `createAdHocTask()`,
> orphaning a duplicate task row per lunch break, and left the session's
> `taskId` pointing at the old row while `taskKey`/`taskTitle` came from the
> new one. Resume now reuses the existing row.

Original text follows.

`context-schedule-service.ts:213,225` · `time-tracking-engine.ts:166`

The doc comment says "auto-pausing active tasks during lunch"; the code calls `stopSession('Auto-completed for Lunch Break split')` — it *finalises* a worklog and then `exitLunchMode()` calls `startTask(data.taskId, data.isAdHoc, data.customTitle, ...)`.

For an **ad-hoc** task, `startTask` does:

```ts
if (isAdHoc && customTitle) {
  const adHocTask = this._taskRepo.createAdHocTask(customTitle, 'MISC-1');   // creates a NEW task row
```

So every lunch break **creates a duplicate ad-hoc task** in the local DB. The user accumulates one extra "Fix login bug" row per day. (`startTask` also leaves `taskId` pointing at the *old* id while `taskKey`/`taskTitle` come from the new row — an inconsistency worth cleaning up regardless.)

### F-17 — UTC/local date mismatch in the ceremony scheduler
`context-schedule-service.ts:76`

```ts
const currentMinutes = now.getHours() * 60 + now.getMinutes();   // LOCAL
const todayDateString = now.toISOString().split('T')[0];         // UTC
```

The "already prompted today" key rolls over at UTC midnight while the schedule comparison uses local wall-clock time. In `Europe/Paris` (UTC+2 in summer) the local hours 00:00–02:00 still carry the *previous* UTC date, so the standup/EOD "fired today" flag persists across local midnight and, symmetrically, resets two hours early. Use a local-date key (`toLocaleDateString('sv-SE')` or manual `getFullYear/getMonth/getDate`).

Related, smaller: overnight ranges are unsupported (`isLunchTime` is `>= start && < end`, so `22:00–02:00` never matches); `dispose()`'s doc comment claims it "unregisters powerMonitor listeners" but it only clears the interval — the four `powerMonitor.on(...)` handlers are never removed.

### F-18 — `AutoUpdateManager` is a stub that pretends to check for updates
`src/main/updater/auto-update-manager.ts:47-66`

```ts
// Simulate update check against remote release manifest
return new Promise(resolve => { setTimeout(() => { ...available: false... }, 500); });
```

`electron-updater` is not a dependency and `electron-builder.json` has no `publish` block, so there is no update channel to check. Meanwhile `initialize()` starts a 12-hour interval that will forever "check" and always report "up to date" to the UI. Either implement it or remove the whole surface — a permanently-green "you're on the latest version" indicator is worse than none.

The same file's neighbour, `DiagnosticExporter`, hardcodes `appVersion: '1.0.0'`, `electronVersion` fallback `'30.0.0'`, and `webhookServerStatus: { listening: true, port: 39123 }` — the "diagnostics" bundle reports fiction rather than measured state.

`BusyBarDriver.getDeviceStatus()` does the same: `frontBrightness: 80, backBrightness: 100` are constants (`busybar-driver.ts:421-422`), never read from `GET /api/display/brightness`, yet they are what the Device Diagnostics view displays.

### F-19 — Diagnostics export leaks every captured notification body
`diagnostic-exporter.ts:50` · `logger-interceptor.ts:25`

`LoggerInterceptor` monkey-patches `console.log/warn/error` globally and retains the last 2,000 lines. The notification listener logs full notification content (`[NotificationListener] ... Title: ${event.title}` and `emitLog('notification', '[${appName}][${id}] ${title}: ${body}')`). `generateDiagnosticBundle()` then dumps `LoggerInterceptor.getLogs()` verbatim into a file the user is invited to share for support.

That file will contain **the titles and bodies of every Windows notification** — Signal/WhatsApp message previews, 2FA codes, calendar invites, email subjects — from the last 2,000 log lines. Redact notification content in the export (or hash the identifiers), and consider not logging bodies to the console at all.

### F-20 — Unhandled exceptions from a hardware key press can take down the main process
`input-decoder.ts:326-338`

`executeAction` calls `this._engine.pauseSession()` and `resumeSession()`, both of which `throw` when the session isn't in the expected state (`time-tracking-engine.ts:205,224`). The call site has no `try/catch`, and it runs inside the `driver.on('input', ...)` listener registered in the constructor. An EventEmitter listener that throws propagates as an uncaught exception in the main process. A double-press race (session completes between `getCurrentSession()` and `pauseSession()`) or a stale rotary event is enough. Wrap `executeAction` in a guard.

### F-21 — Missing hardware error-code handling: 409 / 413 are treated as generic failures
`busybar-driver.ts:685,733`

The Developer Guide §8 defines actionable semantics the driver ignores entirely:

* **`409 Conflict`** — "Draw priority is lower than an active session on the device. Increase `priority` to 95 or higher." The driver just increments `framesFailed` and moves on. When the user starts a BUSY/CUSTOM timer on the device (priority 90) or the firmware raises its own session, the app silently stops appearing on the matrix with no diagnostic. Detect 409 and either escalate priority or surface "the device has a higher-priority session running."
* **`413 Payload Too Large`** — should trigger a downscale/retry rather than a silent drop.
* **`503 Service Unavailable`** — documented as "retry after a brief delay"; there is no retry.

Also: `injectRemoteKey` returns `res ? res.ok : true` (`:771`) — a network failure reports **success**. `clearDisplay`, `deleteAppAssets`, `setBrightness`, `getBrightness`, `setAudioVolume`, `playAudio`, `stopAudio`, `syncRtcTime`, `getAccessSettings`, `updateAccessSettings` all `fetch` **without any timeout**, unlike `uploadAsset`/`sendPixelFrame`/`sendDisplayPayload` which use `AbortSignal.timeout(2000)`.

### F-22 — ~~Device IP address and API token are not configurable at runtime~~ (WITHDRAWN in part)

> **Withdrawn by the maintainer.** The bar answers on the fixed address
> `10.0.4.20` over USB and requires no token there. That is how the device
> works, so hardcoding it is correct rather than a shortcut, and Wi-Fi mode is
> not a mode this application targets.
>
> **One real defect survived:** the onboarding wizard rendered an editable IP
> field that was never persisted, whose "Test Ping" called `getDeviceStatus()`
> rather than the typed address and faked success after 600 ms. A control that
> lies is worse than no control.

Original text follows.

`main/index.ts:102` · `OnboardingWizardModal.tsx:11`

```ts
driver = new BusyBarDriver('10.0.4.20', forceMock);   // hardcoded
```

`BusyBarDriver` supports `{ ipAddress, apiToken }` and `setApiToken()`, and the onboarding wizard renders an IP input field — but **nothing persists or applies either value**. `grep setApiToken src/main` shows the only callers are inside `updateAccessSettings`. Consequences:

* Wi-Fi mode (a documented, first-class connection mode) is unreachable — the app can only talk to the USB address.
* If the user enables `mode=key` access protection on the device, the app has no way to be told the key and every request starts returning 401/403.
* The onboarding IP field is decorative.

### F-23 — `eval('require("ws")')` in the driver
`busybar-driver.ts:322`

```ts
const WsCtor = eval('require("ws")');
```

A deliberate bundler-defeat hack. It defeats static analysis, will trip any Electron/CSP security review, and silently breaks if the module isn't externalised correctly at package time (which would kill *all* hardware input, with only a `console.warn`). Mark `ws` as external in `vite.config.electron.ts` and use a normal import.

### F-24 — Second-instance race in the app bootstrap
`main/index.ts:41-51,79`

```ts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); } else { app.on('second-instance', ...); }

app.whenReady().then(async () => { /* DB, webhook server on :39123, driver, tray... */ });
```

The `whenReady` handler is registered **unconditionally**, outside the `else`. `app.quit()` before ready is racy; if `ready` fires first the second instance will open the SQLite file, try to bind 39123 (throwing an unhandled rejection), and construct the driver — all while quitting. Move the entire bootstrap inside the `else` branch.

Also in the same file: `app.on('will-quit', async () => {...})` — Electron does **not** await async `will-quit` listeners, so `await webhookServer.stop()` and everything after it (`driver.disconnect()`, `DatabaseConnection.resetInstance()`) may never run. Use `event.preventDefault()` + explicit `app.exit()`, or do the teardown synchronously.

### F-25 — No database schema versioning
`database-connection.ts:57-120`

`initTables()` is a single `CREATE TABLE IF NOT EXISTS` block with no `PRAGMA user_version`, no migration runner, and no version table. The moment a column is added or changed, **existing user databases will silently keep the old schema** and start failing at query time with `no such column`. For an app whose entire value proposition is a local record of billable time, that is a data-integrity landmine.

Secondary schema issues: `tasks.project_id`, `worklogs.task_id`, and `worklog_sync_queue.task_id` declare no `FOREIGN KEY` even though `foreign_keys = ON` is set (only `paused_intervals` has one); there are **no indexes** on `worklogs(task_id)`, `worklogs(created_at_utc)`, `worklog_sync_queue(status)`, or `active_sessions(status)`; `active_sessions` has no constraint preventing two concurrent `TRACKING` rows.

### F-26 — Non-unique IDs derived from `Date.now()`
`time-tracking-engine.ts:181,275,289` · `windows-notification-listener-service.ts:213`

`sess_${Date.now()}`, `wl_${Date.now()}`, `sync_${Date.now()}`, `win_${Date.now()}`, `sim_${Date.now()}` are all `PRIMARY KEY`s. Two events in the same millisecond — e.g. `stopSession()` immediately followed by `startTask()`, which is exactly what `exitLunchMode` and "start a new task while one is running" do — collide and throw `UNIQUE constraint failed`. Use `crypto.randomUUID()`.

---

## 4. Low / hygiene

| # | Finding |
| :--- | :--- |
| F-27 | **`coverage/` is committed to git** — 63 tracked files that churn on every test run. `git status` currently shows ~60 modified files, all of them build artefacts. Add `coverage/` to `.gitignore` and `git rm -r --cached`. |
| F-28 | **1,511 tracked `__MACOSX`/`._*` junk files** under `Animations/` (macOS zip residue), plus `.DS_Store` forks. ~40% of the repo's tracked file count is garbage. |
| F-29 | **`.gitignore` ends with a stray, newline-less `busybar-firmware`** appended directly after the icon-allowlist comment. It silently untracks the entire vendored firmware tree in `Documentation/busybar-firmware` (which ships its own `.gitmodules`). Make it a real submodule or remove it. |
| F-30 | **Google Fonts loaded from the CDN at runtime** (`src/renderer/index.html:9-13`). An offline-first desktop time tracker makes an external network request to Google on every launch, leaks usage telemetry, and falls back to system fonts when offline. Self-host Inter + JetBrains Mono. |
| F-31 | **No `Content-Security-Policy`** in `index.html` and no `setWindowOpenHandler` / `will-navigate` guard on the `BrowserWindow`. `contextIsolation: true` + `nodeIntegration: false` are correctly set; `sandbox: true` is not. |
| F-32 | **No code signing** in `electron-builder.json` → SmartScreen warnings on every install, and no way to ship trustworthy updates even once F-18 is implemented. |
| F-33 | **`preflight` is not a release gate.** `scripts/preflight-check.js` only compares the desktop and Unity package versions and checks two files exist. It does not run tests, lint, typecheck, or a build. It also prints the root version without comparing it. |
| F-34 | **`predev` and `pretest` fight over the `better-sqlite3` ABI.** `predev` runs `electron-builder install-app-deps` (Electron ABI 123); `pretest` runs `pnpm rebuild better-sqlite3` (Node ABI 137). Running `dev` then `test` (or vice versa) always triggers a full native rebuild, and running `vitest` directly after `dev` fails with `NODE_MODULE_VERSION 123 … requires 137`. Document it, or use `@electron/rebuild` with an explicit target per script. |
| F-35 | **Test-environment branches in production code**: `process.env.NODE_ENV === 'test'` guards in `system-automation-service.ts:65,180,215` and `ipc-handler-registry.ts:310,321`. Inject a clock/exec seam instead. |
| F-36 | **`.substr()`** (deprecated) at `priority-preemption-engine.ts:363`. |
| F-37 | **Dual naming for schedule settings** — `lunchStartTime`/`lunchStart`, `eodWrapUpTime`/`eodTime` are both read with `\|\|` fallbacks (`context-schedule-service.ts:95,112`). Pick one and migrate. |
| F-38 | **Oddly specific personal defaults** shipped as product defaults: standup `10:05`, lunch `12:18`, EOD `17:30`, OpenProject `http://192.168.0.139:8090/`. |
| F-39 | **Placeholder integration URLs presented as real defaults**: `https://discord.com/api/webhooks/demo`, `https://hooks.slack.com/services/demo` (`messaging-service.ts:81-83`). |

---

## 5. README claims that the code does not support

These are documentation defects as much as code defects — someone reading `README.md` will form a materially wrong picture of the product.

| README claim | Reality |
| :--- | :--- |
| "embedded local **Fastify** webhook server" (stated 3×, plus a `console.log` in `index.ts:114` and a doc comment in `diagnostic-exporter.ts:18`) | It's Node's built-in `http` module. `fastify` is not a dependency. |
| "**Slack & Discord Integration:** Sync user presence status and **push webhook alerts** during active focus sessions, meetings, or away modes" | No outbound code exists. `discordWebhookUrl`, `slackWebhookUrl` and `gmailQuery` are stored in settings and **read by nothing** (`grep` confirms: only the default-value literals). The service is inbound-only — it renders a banner when *something else* POSTs to `/api/v1/slack/events`. There is no presence sync and no Gmail integration at all, despite a 290-line `MessagingView.tsx` configuring them. |
| "**Rear OLED Screen (160×80):** Renders secondary status, timer counts, and detailed session telemetry" | Never transmitted to hardware — emulator only (F-06). |
| "Run Unit Tests (**250+ Tests**)" / "Coverage Report (**80%+ Target**)" | Accurate for the main process (274 tests, 88.27%) but the renderer is excluded from coverage entirely; the headline number covers 0% of the UI. |
| "`cross-env MOCK_HARDWARE=true pnpm dev`" | `cross-env` is a `devDependency` of `desktop-app`, not the root, so this exact command fails from the repo root unless `cross-env` is globally installed. `pnpm --filter @sprintticker/desktop-app exec cross-env ...` works. |
| Documentation links use absolute `file:///c:/Users/jbgeron/...` URLs | Broken for every other user and in the GitHub web view. Use relative links. |

---

## 6. Compliance against the BUSY Bar Developer Guide

| Spec requirement | Status |
| :--- | :--- |
| `application_name` (not legacy `app_id`) | ✅ Correct throughout. |
| Filename regex `^[a-zA-Z0-9._-]+$` on asset upload | ✅ Enforced (`ASSET_FILENAME_REGEX`, `busybar-driver.ts:19`). |
| Solid fill = exactly 1 colour; gradient = exactly 2 ("*violating the schema validator will reboot the device*") | ✅ Correctly normalised in `formatHardwarePayload` (`:466-478`). Good defensive work. |
| ASCII sanitisation `0x20–0x7E` | ✅ `sanitizeAsciiText` with smart-quote/em-dash folding. |
| `#RRGGBBAA` 8-digit colour | ⚠️ 13 rear-display elements use 10-digit `#CCCCCCCCFF` (F-06). `normalizeHexColor` handles the 6→8 case but not over-long input. |
| Image `path` = filename only, no PC path | ✅ Stripped via `replace(/^.*[\\/]/, '')`. |
| Font names restricted to the current set | ✅ Only `tiny`/`bold`/`small` are used; no deprecated `medium`/`big`/`tiny5_8`. |
| WebSocket `{ enable: true }` handshake | ✅ Sent on open; protobuf StateStream decoding implemented. |
| Priority ≥ 95 for custom app overlays | ✅ `DEFAULT_DRAW_PRIORITY = 95`. |
| **409 Conflict → escalate priority** | ❌ Not handled (F-21). |
| **413 / 503 handling** | ❌ Not handled (F-21). |
| Clear draw + delete assets on exit | ⚠️ `clearDisplay` exists and is called for idle fallback, but `will-quit` never clears the display or deletes `frame_0.png`/`frame_1.png`/`anim_frame.png` from the device — leftover assets accumulate in device storage across runs. |
| `X-API-Token` header when access protection is on | ⚠️ Implemented in `getHeaders()` but unreachable — no way to configure the token (F-22). |
| Rectangle-strip vs PNG-upload strategy (§6: strips for ≤40 strips, PNG for dense art) | ⚠️ Inverted — a sparse icon+text layout is pushed as a full PNG upload at 1 Hz (F-07). |

---

## 7. Architecture & `GEMINI.md` conformance

`GEMINI.md` demands SOLID, DI, KISS/DRY, methods under 20 lines, and zero technical debt. Where the code diverges:

* **God objects.** `IPCHandlerRegistry` is 640 lines with a **14-parameter constructor**, 9 of them optional with `new X()` fallbacks inside the body — a service locator, not dependency injection (violates DIP directly). `BusyBarDriver` is 1,049 lines and mixes protobuf decoding, HTTP transport, telemetry polling, frame throttling, audio, RTC and access control (SRP). `DisplayRenderer` is 971 lines. `WindowsNotificationListenerService` is 728 lines including a 300-line embedded PowerShell script as a template literal.
* **Method length.** `InputDecoder.handleHardwareInput` is ~120 lines of nested conditionals; `renderActiveSession` ~110; `formatHardwarePayload` ~80. The 20-line rule is not being applied.
* **Empty catch blocks.** Explicitly forbidden by §5; present in `BusyBarWebhookPublisher.SendWebhookAsync` and at least six `catch {}` sites in the PowerShell script and the driver.
* **Magic numbers/strings.** `#CCCCCCCCFF`, `#F59E0B`, `#10B981FF`, `y: 16/32/48/64`, `x: 17`, `55`, `26`, `44`, `27` are scattered as literals through `display-renderer.ts` despite a `render-constants.ts` existing for exactly this purpose. §2 forbids this.
* **Comments that contradict the code.** `dispose()` "unregisters powerMonitor listeners" (it doesn't); "auto-pausing active tasks during lunch" (it stops them); "Fastify" in `diagnostic-exporter.ts` (it isn't).
* **Test naming.** `MethodName_StateUnderTest_ExpectedBehavior` is followed consistently — this part is done well.

---

## 8. Enhancement backlog (not defects)

**Hardware / display**
1. Use native `CountdownElement` (`direction: "time_since"`) for the running timer so the firmware animates it — this alone removes the 1 Hz redraw loop.
2. Use native `TextElement` + `scroll_rate`/`scroll_start_delay`/`scroll_repeat_delay` for long task titles instead of software-marquee-into-PNG.
3. Frame hashing + dirty-rect diffing before any transmission.
4. Read real brightness/battery from the device instead of constants; expose brightness and `auto` in the UI; add the `display` parameter so back-panel brightness is controllable.
5. Consume `GET /api/screen?display=0` (documented BMP capture) in Device Diagnostics to show *actual* device output next to the emulator — a genuinely useful debugging feature the spec already offers.
6. Wire `syncRtcTime` into startup so the device clock stays correct (the method exists and is never called).
7. Delete app assets and clear the display on `will-quit`.

**Time tracking**
8. Idle/away cut-off: cap or split a session when `powerMonitor.getSystemIdleTime()` exceeds a threshold, and prompt "you were away for 47 min — keep or discard?" on return. Today a crash or an overnight lock logs a 16-hour session.
9. Manual worklog editing and deletion (currently write-only).
10. Weekly/monthly aggregate views; the History view is daily only.
11. Surface the sync queue (pending / failed / synced counts) with a manual retry button.

**Providers**
12. Extract an HTTP client with timeout + exponential backoff + 429 handling, shared by the driver and providers.
13. Make the `assignee = me` filter configurable; add a task search box.
14. `safeStorage` for all credentials.

**Product**
15. Windows toast notification when the EOD prompt fires and the window is hidden (currently it force-focuses the window, which is intrusive mid-flow).
16. `--mock-hardware` should also seed demo projects/tasks so the app is demonstrable with no OpenProject instance.
17. Per-app notification rules should be discoverable — populate the rules list from observed `appId`s rather than requiring the user to type them (which is also how F-13's empty-`appId` foot-gun gets triggered).

---

## 9. Suggested remediation order

**Sprint 1 — stop the bleeding (data integrity)**
F-01 (cache wipe) → F-02 (lost worklogs) → F-03 (duplicate time entries) → F-26 (ID collisions) → F-25 (schema versioning, before any further schema change).

**Sprint 2 — restore the quality gate**
F-04 (fix 31 TS errors) + F-05 (typecheck the renderer) → add `typecheck` scripts + type-aware ESLint → add a GitHub Actions workflow running `lint && typecheck && test:coverage` → F-33 (make `preflight` actually gate) → F-27/F-28/F-29 (repo hygiene, so diffs become reviewable again).

**Sprint 3 — hardware correctness & cost**
F-07 (1 Hz PNG upload) → F-08 (60 fps loop + power blocker + memory) → F-06 (wire up or remove the rear OLED, fixing the 10-digit colours) → F-21 (409/413/503) → F-22 (configurable IP/token, unblocking Wi-Fi mode) → F-23 (`eval`).

**Sprint 4 — security & privacy**
F-09 (webhook auth + body cap + drop port 8080) → F-10 (Unity throttling) → F-11 (HTTPS default + `safeStorage`) → F-19 (redact diagnostics) → F-31/F-32 (CSP, signing).

**Sprint 5 — behavioural bugs & truthfulness**
F-15 (lock leak) → F-16 (lunch duplication) → F-17 (UTC date) → F-20 (uncaught throw) → F-13 (notification polling cost + rule matching) → F-24 (bootstrap race) → F-18 (implement or delete the updater) → §5 (bring `README.md` in line with reality).


---

## 10. Findings added after the original audit

Discovered while remediating, or corrected by the maintainer. Numbered
separately so the original findings keep their identifiers.

### F-40 — The repository did not build from a fresh clone
`ipc-handler-registry.ts` imported `system-automation-service`, which was
**untracked**. Any CI workflow would have failed on its first run. Fixed first,
before anything else, because everything downstream depends on it.

### F-41 — 3.9 MB of real Windows notifications committed to history
A WAL captured from `wpndatabase.db` by the notification poller, written to a
malformed path that `.gitignore` did not match. **~1,175 toast records**
including Slack channel names, work item titles and shell fragments — the
largest blob in the repository. All 62 commits were scanned for credentials:
none found, every hit was a test placeholder, so nothing needs rotating. The
file is out of the working tree; removing it from *history* is a publication
prerequisite, tracked in [ROADMAP.md](ROADMAP.md) §1.

### F-42 — The cache wipe fired on a fresh install, not only on failure
Narrower and worse than F-01 as written. `openproject-provider.ts` returned `[]`
when `!this._domain || !this._apiKey`, and the default API key is `''`. Before
the user configured anything, the first five-minute sync tick deleted every
locally created project and task. Both the "unconfigured" and the "failed" paths
now throw.

### F-43 — The display rendered twice per second, not once
`TimeTrackingEngine` emitted `tick` **and** `sessionUpdated` back to back in the
same interval, and two separate listeners each called `renderActiveSession`.
F-07's real cost was therefore ~2 asset uploads per second, ~57,600 per day.
Collapsing the duplicate halved it before any deduplication was added.

### F-44 — High-priority notifications never reached the display in any mode
Corrects the original diagnosis. The listener evaluated the request once as
`highNotificationPriority` (70) and the renderer then re-derived the event name
from a numeric threshold (`priority >= 90`), failed it, and evaluated a **second**
time as `messagingPriority` (65) — which was refused by the lock the first
evaluation had just taken. The banner was therefore lost during normal work, not
only during Lunch and Away.

The Lunch/Away behaviour reported alongside it was **not a bug**: both
notification classes are deliberately ranked below Lunch (95) and Away (100) in
the priority panel, so refusing them there is the configuration working. One
event now produces exactly one `evaluateRequest`.

### F-45 — `syncRtcTime()` would have set the wrong clock
`new Date().toISOString()` sends UTC with a `Z` suffix; the device applies no
conversion and requires an offset. A Paris user's bar would have run two hours
behind.

### F-46 — `pnpm lint` was a no-op in CI
`"lint": "eslint packages/**/*.{ts,tsx}"` — unquoted, in a POSIX shell without
`globstar`, this expands to **four Vite config files** out of 169. It only ever
appeared to work because Windows `cmd.exe` does not glob and passed the pattern
through to ESLint. The original audit's "ESLint clean" line was therefore
measured with a different command than the one CI would have run.

### F-47 — The notification poller leaked into `%TEMP%` forever
It copied `wpndatabase.db` plus its `-wal` and `-shm` sidecars every two
seconds, and deleted only the base file, so the sidecars accumulated
indefinitely. It also had no restart path: if the PowerShell child exited,
notifications stopped silently until the app was restarted.

### F-48 — The personal LAN default was in six places, not one
`http://192.168.0.139:8090/` appeared in `provider-manager.ts` and five times in
`ipc-handler-registry.ts` (two of them consecutive duplicate lines). Fixing only
the first would have shipped the address in the binary.

### F-49 — Contradictory seed tables in main and the renderer
The notification defaults and the priority rules each existed as two independent
copies, and which one won depended on process start order. Both now live in
`src/shared/`. The priority panel was also missing an `eodWrapUpPriority` row
entirely, so a rule the engine enforced could not be seen or edited.

### F-50 — Application icons were never resolved for Win32 apps
The PowerShell helper only handled MSIX/AppX packages via `Get-AppxPackage`.
Slack and Discord are Win32 apps under `%LOCALAPPDATA%`, so no path came back
and the pipeline fell through to a hand-drawn bitmap. Resolution now also scans
Start Menu shortcuts and dereferences Squirrel's `Update.exe` stub, and packaged
apps that declare several `<Application>` entries are matched on the AUMID
suffix rather than the first entry.

### F-51 — Publication blockers unrelated to code
No `LICENSE` and no `license` field in any manifest, while `Documentation/`
contained a wholesale copy of BUSY Bar's own documentation and `icon reference/`
held third-party brand marks. Applying MIT at the root would have purported to
license material this project does not own. Resolved in Phase 1: third-party
documentation moved to an untracked `Documentation/private/`, third-party marks
untracked, and a `LICENSE` added that states its own scope. `Animations/`
provenance is still unconfirmed and is excluded from that scope until it is.

### F-52 — The notification listener could not start at all
`spawn ENAMETOOLONG`, on every launch since 2026-09-04.

The PowerShell listener script travelled to `powershell.exe` as a
`-EncodedCommand` argument. That encoding is base64 of UTF-16LE, so it costs
about 2.67 characters of command line per character of script, against a Windows
command-line cap of 32,767. The script therefore had an undocumented ceiling
near 12,000 characters, and nothing measured it.

`a97c6f6` — the commit that stopped the poller copying `wpndatabase.db` every
two seconds — took the encoded argument from 30,232 to 34,208 characters and
over that cap. The regression was introduced by Phase 1 itself.

The consequence is larger than it looks, because this listener is the *only*
source of Windows notifications: Slack, Discord, Teams and everything else stop
together, and there is no per-application path left to notice the loss. The
failure was also quiet — one log line, after which the app reported successful
initialisation and every other subsystem behaved normally.

Fixed by writing the script to a file and launching it with `-File`, which has
no length ceiling, so the failure cannot return as the script grows. The
regression test asserts the invariant that broke — the command line stays within
the Windows limit — rather than the mechanism that happens to satisfy it today.

Found by running the packaged application and reading its console. No test
covered `startListening`, so the suite was green throughout.

### F-53 — Every idle transition posted a draw the device rejects
The log line was `display payload: device returned 400`, on each return to idle.

The idle path called `clearDisplay()` -- `DELETE /api/display/draw`, which is
correct and did its job -- and then posted a second request carrying
`elements: []` and `led_notification_color: '#00000000'`, commented as turning
the LED off.

It was wrong twice over. The device schema declares `elements` as required with
`minItems: 1`, so an empty array is a validation failure rather than "draw
nothing", and the request was rejected. And `led_notification_color` is
documented as the colour to *blink* the status LED -- "if not specified, the LED
will not blink" -- so there is no off colour to send. Not asking for a blink is
how the LED stays dark.

Nothing visible was lost, because the payload that failed to arrive was empty,
which is exactly why this survived: the symptom was one log line for a request
whose success would have changed nothing. Resolved by deleting the second call.

The regression test asserts the schema rule across every render path rather than
this one call site, and was confirmed to fail against the previous code.

Found by reading the packaged application's console against real hardware; the
payload itself was captured through `--mock-hardware`, which logs each draw
rather than sending it, so no frame was pushed to the device to find this.

### Non-finding — empty `catch` blocks
The original audit flagged these. On inspection there was nothing to do: of 19
matches, 7 are PowerShell inside a generated script string and the 12 TypeScript
ones all already carry a comment explaining why the failure is safe to swallow.
Recorded here so it is not re-raised.

---

## 11. Remediation status

The Phase 1 branch addressed the findings below. Verify against the code, not
this table — it is a summary, and summaries drift.

| Area | Findings |
| :--- | :--- |
| **Fixed** | F-01, F-02, F-03, F-04, F-05, F-07, F-08, F-09, F-10, F-13, F-14, F-15, F-19, F-20, F-21, F-23, F-24, F-25, F-26, F-27, F-28, F-29, F-30, F-31, F-37, F-38, F-39, F-40, F-42, F-43, F-44, F-45, F-46, F-47, F-48, F-49, F-50, F-51, F-52, F-53 |
| **Deleted rather than fixed** | F-06 (rear OLED left as emulator preview), F-18 (updater stub) |
| **Withdrawn in part** | F-16, F-22 — see the notes on each |
| **Open, deferred with a reason** | F-11, F-12, F-17, and the table in [ROADMAP.md](ROADMAP.md) |
| **Open, not yet triaged** | F-33 (`preflight` is not a gate), F-34 (the ABI split -- documented in `CLAUDE.md` rather than removed), F-35 (`NODE_ENV === 'test'` branches in production code), F-36 (deprecated `.substr`) |
| **Publication prerequisite** | F-41 — history rewrite, [ROADMAP.md](ROADMAP.md) §1 |
