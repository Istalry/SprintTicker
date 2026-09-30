# Architecture

How SprintTicker is put together, as shipped.

This describes the system that exists. `Documentation/design-history/` describes
what was *intended* before it was built, is not maintained, and disagrees with
the code in places — where they differ, the code is right and this document
tries to be.

For the rules you must not break while changing any of it — the hardware
contract, the process boundaries, the code standards — see
[CLAUDE.md](../CLAUDE.md). This file explains the shape; that one explains the
traps.

---

## 1. The whole thing in one picture

<!-- docs-build:svg=architecture -->

```
                    ┌─────────────────────────────────────────┐
                    │              RENDERER                   │
                    │  React 19 + Vite + Tailwind             │
                    │  9 views, no Node, no Electron          │
                    └────────────────┬────────────────────────┘
                                     │ window.electronAPI
                                     │ (contextBridge, the ONLY path)
                    ┌────────────────▼────────────────────────┐
                    │              PRELOAD                    │
                    │  ipcRenderer.invoke / .on wrappers      │
                    │  typed by IElectronAPI                  │
                    └────────────────┬────────────────────────┘
                                     │ IPC
┌────────────────────────────────────▼────────────────────────────────────┐
│                                  MAIN                                   │
│                                                                         │
│   IpcHandlerRegistry ── the single place a channel gets a handler       │
│           │                                                             │
│   ┌───────┴────────┬──────────────┬───────────────┬─────────────────┐   │
│   │                │              │               │                 │   │
│  TimeTracking   Provider      Priority        Display          Windows   │
│  Engine         Manager       Preemption      Renderer         Notif.    │
│   │                │          Engine             │             Listener  │
│   │                │              │              │                 │     │
│   │           OfflineSync         │         BusyBarDriver     PowerShell  │
│   │           Worker              │              │            child proc  │
│   │                │              │              │                       │
│   └────────┬───────┘              └──────────────┘                       │
│            │                                                             │
│      Repositories ──> DatabaseConnection ──> better-sqlite3              │
│                                                                          │
│   WebhookServer (127.0.0.1:39123) <── Unity Editor plugin                │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTP
                          ┌──────────────────────┐
                          │  BUSY Bar            │
                          │  10.0.4.20 (default) │
                          └──────────────────────┘
```

Three processes, one database, two outbound directions (the device over USB, a
task provider over the internet), and one inbound (the Unity plugin on
loopback).

The device address is a persisted setting (`DeviceConfigDTO.ipAddress`), seeded
from `10.0.4.20` and edited in Settings › Device. Main reads it before
constructing `BusyBarDriver`; changing it calls `reconfigure()`, which tears the
ping loop and StateStream socket down and re-dials rather than restarting the
app. It has to be a setting: over Wi-Fi the bar holds a DHCP lease, and a host
whose USB CDC-NCM driver will not start the interface is recovered by proxying
the bar onto a different address entirely.

---

## 2. Process boundaries

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. These are
not defaults left in place; they are the reason the renderer can be treated as
untrusted.

| Rule | Enforced by |
| :--- | :--- |
| Renderer must not import `src/main/**` or `electron` | ESLint `no-restricted-imports`, **error** |
| Main must not import `src/renderer/**` | ESLint `no-restricted-imports`, **error** |
| `src/shared/**` must run in both | Convention, plus the fact that both sides import it |
| Preload and renderer cannot drift | The `: IElectronAPI` annotation on the bridge object — a missing method is a compile error |

> [!WARNING]
> **Never duplicate a constant across the boundary**
>
> Main and the renderer once carried contradictory copies of the notification
> defaults and the priority table, and which one won depended on process start
> order. Anything both sides need — DTOs, IPC channel names, priority defaults,
> schedule defaults, the fonts, the text sanitiser — lives in `src/shared/` and
> is imported, never re-declared.

---

## 3. Main process components

### `TimeTrackingEngine` — `src/main/engine/`

Owns the session lifecycle: start, pause, resume, stop. Sessions are
**timestamp-based**, not tick-based — elapsed time is derived from
`start_time_utc` minus accumulated pauses, so the count survives the app being
closed, the machine sleeping, or a crash. `reconcileStartupState()` picks a
live session back up on launch.

Stopping a session does three things: writes a local worklog (always), asks the
active provider's `minimumLoggableSeconds` whether the duration can be recorded
remotely at all, and if so enqueues it and wakes the sync worker for an
immediate drain rather than waiting out the interval.

### Provider layer — `src/main/providers/`

```
ITaskProvider  ← the contract (task-provider-interface.ts)
    ├── OpenProjectProvider   REST API v3, HAL pagination
    ├── JiraProvider          REST API v3, two pagination schemes
    └── AdHocProvider         local only, no network

ProviderManager   resolves the active provider, holds credentials
provider-http.ts  the single network call site: timeout, retries, classification
provider-errors.ts ProviderRequestError, with isPermanent
```

Three rules hold this together, each one a bug that already happened:

- **A provider reports failure by throwing**, never by returning `[]`. An empty
  array is indistinguishable from "this user has no tasks", and the sync worker
  prunes the local cache against what it receives (audit F-01).
- **Only GET/HEAD/OPTIONS are retried.** A worklog POST has no idempotency key
  in either API, so repeating it after a response that was sent but never
  received bills the session twice.
- **`isPermanent` decides whether a queued row retries.** Any 4xx except 408 and
  429 is permanent — those two describe a moment, the rest describe the request.

### `OfflineSyncWorker` — `src/main/sync/`

One owner of the `worklog_sync_queue` table, and rows are claimed atomically
(`UPDATE ... SET status='SYNCING' WHERE id=? AND status='PENDING'`). Two
uncoordinated flushers used to race here and double-bill (F-02, F-03).

| Constant | Value | Why |
| :--- | ---: | :--- |
| `SYNC_INTERVAL_MS` | 5 min | Background pass |
| `MAX_SYNC_ATTEMPTS` | 8 | Then the row parks as FAILED, with the server's own message |
| `SYNC_BACKOFF_BASE_MS` | 30 s | Doubles per attempt |
| `SYNC_BACKOFF_MAX_MS` | 1 h | Ceiling on one wait |
| `SYNC_CLAIM_TIMEOUT_MS` | 10 min | A claim left behind by a crash is reclaimable after this |

A pass that arrives mid-pass does not get dropped: the single-dispatcher guard
**coalesces**, setting a flag so the new row drains before the current pass
ends. Without that, finishing one task and starting the next — the app's core
loop — waited out the full interval anyway.

### `PriorityPreemptionEngine` — `src/main/services/`

Decides what the display shows. Every claim carries a score; the highest holds
the display and takes a named lock, which the claimant must release.

Two rules, both scars:

- **Never hardcode a ranking.** The table below is a *default* the user edits in
  the Priority Rules panel. Nothing in the code may assume a particular order.
- **One event produces exactly one `evaluateRequest`.** Evaluating twice takes
  the lock twice under different names, and the release then never matches the
  lock actually held.

| Claim | Event name | Default score |
| :--- | :--- | ---: |
| Away mode | `awayModePriority` | 100 |
| Lunch mode | `lunchModePriority` | 95 |
| End-of-day wrap-up | `eodWrapUpPriority` | 80 |
| Stand-up prompt | `standupPromptPriority` | 75 |
| Notification — high | `highNotificationPriority` | 70 |
| Notification — default | `messagingPriority` | 65 |
| Unity build failure | `unityBuildFailurePriority` | 60 |
| Unity compiling | `unityCompilingPriority` | 55 |
| Unity Play Mode | `unityPlayModePriority` | 50 |
| Active task tracker | `activeTrackerPriority` | 45 |

Each rule also carries an action per user mode — `DISPLAY`, `SUPPRESS` or
`QUEUE` — for `WORK`, `LUNCH` and `AWAY`. That is how notifications correctly
do not interrupt a break: not a special case in the code, a row in the table.

### Render pipeline — `src/main/hardware/`

```
DisplayRenderer      decides what a screen looks like
      │
PixelCanvas          draws it into a 72×16 pixel buffer
      │              (Sprint 5 on row 0, Sprint Small on row 1)
pixel-matrix-to-png  encodes the buffer as a PNG
      │
BusyBarDriver        uploads the asset, then draws it — two HTTP requests
```

Every frame is an **asset upload plus a draw**. `transmitFrame` hashes the frame
and skips an identical one, which is why a tracking session sends traffic on
state change rather than on every tick, and why the timer shows `HH:MM` rather
than seconds.

The standard front layout is a 16px icon at `x=0..15`, a one-pixel gutter, then
two text rows at `x=17` in a 55px field.

> [!WARNING]
> **Neither text row has a character capacity**
>
> Both rows are set in proportional fonts drawn for this project: Sprint 5 on
> row 0 and the condensed Sprint Small on row 1. `measureText` and `fitToWidth`
> in `shared/proportional-text.ts` are the only correct way to ask whether
> something fits, and they take the font as an argument. The composer and the
> canvas both get it from `ROW0_FONT` / `ROW1_FONT`. A one-character
> disagreement truncates a row twice, and the second cut lands mid-word with no
> marker.

The fonts are drawn as ASCII art in `packages/desktop-app/fonts/*.glyphs`, one
block per character. `tools/glyphs-to-ts.js` compiles them into
`shared/fonts/sprint-*.ts`, and `pnpm fonts:check` fails CI if the two drift. The
generator refuses a sheet that is missing any printable ASCII character, draws
two characters identically, or leaves a blank column at a glyph's edge.

The rear 160×80 display is left to the firmware, which mirrors the front there
at twice the size and shows its own clock when the front is empty.
`transmitFrame` sends the front matrix and nothing else, and
`HardwareDisplayStateDTO` carries the front only. The rear preview, its three
modes and the setting that chose between them were removed once the rear was
measured: they drew diagnostics the bar never showed.

> [!WARNING]
> **The front matrix has one owner at a time**
>
> `transmitFrame` draws element `px_matrix_img`, opaque across the whole panel,
> while `AnimationPlayer` draws `hardware_anim`. A draw merges by element id
> rather than replacing the element set, and the firmware composites
> `px_matrix_img` **above** the animation whichever order they arrive in — so
> transmitting a frame while an animation plays blacks it out, with both calls
> returning 200. `transmitFrame` skips the hardware send while
> `isHardwareAnimationActive()`.

**Changing owner never empties the panel.** Emptying the element set closes
the device's screen, and on firmware 1.2.4 closing it after an image and an
animation have shared it hangs the bar (see API.md). So the handover is make
before break, with `z_index` doing the work:

1. `AnimationPlayer` uploads the `.anim` and draws `hardware_anim` at z 0,
   under the frame at z 1 -- the bar still shows the previous screen.
2. It removes `px_matrix_img`, revealing the scene. A frame that cannot be
   removed means a scene nobody can see, so that falls back to streaming.
3. When the scene stops, the renderer's next frame lands at z 1 over it.
4. Once that frame comes back `sent`, the renderer calls `retireScene`, which
   removes `hardware_anim` -- unless the driver believes nothing else is on
   the panel, since removing it then would empty the panel after all.

Steps 1-2 and 4 address the same element id, so they run under one lock in
`AnimationPlayer`. `clearDisplay` remains for handing the display back (the
idle clock, quit); the driver tracks what it has drawn (`shownElementIds`) and
takes every animation down by id, with a pause, before that clear.

**Animated icons are a second layer, not a second owner.** The screen is still
one PNG with the icon's static pixels in it. `IconAnimator` lays the icon's
16×16 `.anim` over them as element `icon_anim`, and `z_index` keeps it on top
(`FRONT_LAYER_Z`: scene 0, frame 1, icon 2), so the device animates it with no traffic
per frame.

- **Which icons animate** is `ANIMATED_ICONS` in `shared/render-constants.ts`,
  keyed by the static bitmap each one stands over. The paint helpers take the
  bitmap id, `transmitFrame` hands the result to `IconAnimator.show()`, and a
  screen that names no animated icon removes the previous one.
- **Each `.anim` is uploaded once per connection.** `show()` is called on every
  transmitted frame and does nothing when the icon has not changed.
  `invalidateFrameCache()` resets it after a clear or a reconnect.
- **The static icon is the fallback.** A refused upload, a refused draw, or a
  409 leaves it showing. A refused icon is not retried until the next reset.
- **The emulator animates the icon locally** from its PNG frames, laid over the
  screen as `icon_anim_preview`, and stops when the device has refused it, so
  the preview never animates what the bar shows still.

Both players read animations through `animation-sequence.ts`, which owns the
folder layout and frame ordering.

### `InputDecoder` — `src/main/hardware/`

Turns physical events into application actions, through a rebindable map.

| Control | Default action |
| :--- | :--- |
| START press | `TOGGLE_TRACK_PAUSE` |
| Wheel left / right | `NAVIGATE_QUEUE_PREV` / `NAVIGATE_QUEUE_NEXT` |
| Wheel click | `TRIGGER_TASK_SELECTOR_MODAL` |
| BACK short press | `DISMISS_NOTIFICATION_ALERT` |
| BACK long press | `COMPLETE_AND_LOG_ACTIVE_TASK` |

It also runs the two-stage task picker (project, then task) driven entirely from
the bar. The driver listener is wrapped in a try/catch on purpose: a throw
inside an EventEmitter listener with no error handler terminates the main
process, so without it a button press could take the whole app down.

### `WindowsNotificationListenerService` — `src/main/services/`

Polls the Windows Action Center database via a PowerShell child process, and
mirrors notifications from apps you have allowed. App icons are resolved from
the MSIX manifest or a Start Menu shortcut and downscaled to 15×15.

**This is the reason the app is Windows-only in practice**, and its failures are
silent — a listener that never starts looks exactly like an app that never
notifies you. Notification text is redacted from logs and from the diagnostics
export unless you launch with `--debug-notifications`.

### `WebhookServer` — `src/main/api/`

An HTTP server on `127.0.0.1:39123` for the Unity Editor plugin. See the
[API reference](API.md#local-http-api) for routes and the screening rules.

---

## 4. Data

Everything lives in one SQLite file at
`%APPDATA%\SprintTicker\sprintticker.db`, for both `pnpm dev` and an installed
build. **Development therefore shares your real database** — a migration you are
testing runs against your actual worklogs.

### Schema

| Table | Holds |
| :--- | :--- |
| `projects` | Cached projects, with `provider_id` |
| `tasks` | Cached tasks: `status` is `todo` / `in_progress` / `done`; `priority_rank` is 0 (most urgent) to 4, or NULL; `archived_at_utc` set on a task that left the lists but has worklogs |
| `active_sessions` | Every session — `TRACKING` / `PAUSED` / `COMPLETED`. At most one is open (`TRACKING` or `PAUSED`), by a partial unique index |
| `paused_intervals` | Each pause, FK to the session, `ON DELETE CASCADE` |
| `worklogs` | Local record of tracked time. Written even when the remote refuses it. `task_id` is a FK to `tasks` |
| `worklog_sync_queue` | Outbound worklogs: `PENDING` / `SYNCING` / `SYNCED` / `FAILED`, with backoff and `last_error` |
| `settings` | Key/value, including provider configuration |

Migrations are versioned and forward-only (`src/main/db/migrations.ts`):

1. `initial-schema` — the pre-migrations schema, reproduced verbatim so an
   existing database replays it as a no-op and lands on v1 with its data intact.
2. `sync-queue-claim-and-backoff` — rebuilds the queue table, because SQLite
   cannot `ALTER` a `CHECK` constraint and the queue needed a fourth state.
3. `query-indexes`.
4. `task-priority-rank` — a nullable `priority_rank` on `tasks`. Adding a
   nullable column rewrites nothing; existing rows stay NULL until the next
   sync brings a priority.
5. `worklog-task-foreign-key` — `worklogs.task_id` becomes a foreign key to
   `tasks`, and `tasks` gains `archived_at_utc`. Earlier builds deleted tasks
   that worklogs still referenced, so before the table is rebuilt each orphaned
   id gets a **tombstone**: an archived task named from the session that
   logged it, or from its id when that session is gone too. No worklog is
   dropped.
6. `one-open-session` — a partial unique index allows one open session. The
   engine always meant one, but a crash could leave an older row open, never
   shown or stopped. Before the index is built, each such row is closed where
   the next session began, the latest it can have run, and its time written as
   a local worklog marked as recovered. It is not queued for the provider: the
   end is inferred, and sending it is the user's call.

**Tasks with history are archived, never deleted.** The sync prune, deleting a
project and deleting a task all go through `retireTasks`, which deletes a task
nobody logged time against and archives the rest: gone from every list, still
there for history to name. A task the provider lists again comes back with its
history. The foreign key has no `ON DELETE` action, so a path that forgets this
fails rather than orphaning worklogs. And a session whose task disappears while
it runs -- pruned mid-session, or started on an id that was never cached --
leaves an archived row named from the session when it stops, so the time is
logged rather than refused.

Credentials are encrypted at rest through Electron's `safeStorage`
(`db/secret-store.ts`). Every failure mode degrades rather than losing the key:
no keystore means plaintext plus a warning, and ciphertext written by another OS
account reads back as "not configured" so you are prompted to re-enter.

**Repositories take their `DatabaseConnection` through the constructor.** A
repository that resolves the singleton itself cannot be tested — that is why the
suite once wrote a real database to disk. Tests use
`new DatabaseConnection(':memory:')`.

---

## 5. How a session flows

Start to finish, across every component:

1. **You pick a task** — from the UI, or with the wheel on the bar.
2. `TimeTrackingEngine.startTask()` writes `active_sessions`, and asks the
   provider to move the issue to its configured in-progress status.
3. The engine notifies subscribers → `DisplayRenderer` composes the tracker
   screen → `PriorityPreemptionEngine` scores it at `activeTrackerPriority`
   (45) and, if nothing outranks it, grants the display → `BusyBarDriver`
   uploads a PNG and draws it.
4. **A Slack notification arrives.** The listener matches it against your rules,
   the engine scores it at 65 or 70, and it preempts the tracker — unless you
   are at Lunch, whose rule sits above both.
5. **You finish.** The engine writes a local worklog, checks
   `minimumLoggableSeconds`, enqueues the row and wakes the worker.
6. The worker claims the row atomically, POSTs it, and marks it `SYNCED` — or
   parks it with the server's own message if the failure is permanent, or backs
   off if it is not.
7. The Sync Queue panel shows anything still in flight, with attempt count and
   next attempt time.

---

## 6. Unity plugin

`packages/unity-plugin` is a UPM package
(`io.github.istalry.sprintticker`) of Editor-only C#. `BusyBarWebhookPublisher`
and `BusyBarSceneSaveListener` initialise themselves and POST compile state,
Play Mode transitions and console exceptions to the local HTTP server. It
modifies neither your scenes nor your project code.

---

## 7. Animation studio

`packages/anim-studio` is a development tool, not part of the app: nothing in it
ships, and the app never imports it. It produces the frame sets the app plays.

```
scene.json ──► renderFrame(scene, frame) ──► PNG sequence + meta.json ──► seq2anim ──► .anim
                     │                          Animations/<id>/<id>/
                     └──► editor preview                                  └──► bar preview
```

- **A scene is data**: a size, a frame rate, a length, and layers drawn bottom to
  top: a plate, an icon sprite, text. `parseScene` validates every field, so a
  malformed colour cannot reach the device.
- **The compositor is a pure function of the scene and the frame number.** The
  editor, the exporter and the tests all call it, so the preview is exactly
  what gets exported.
- **Motion is keyframed, and rendering is supersampled 4 × 4.** Icons move by
  fractions of a pixel with anti-aliased edges and optional motion blur, which
  is how the official animations move (`packages/anim-studio/STYLE-GUIDE.md`).
  A sprite at rest on whole pixels renders exactly as drawn.
- **The export lands where the app already looks.** `AnimationPlayer` reads
  `Animations/<id>/<id>/`, prefers `<id>.anim` when present and streams the
  PNGs otherwise, so an exported scene plays without any change to the app.
  Which folder each mode plays is `FRONT_ANIMATIONS` in
  `shared/render-constants.ts`. A name with no folder behind it fails only as a
  log warning and an empty panel, so `animation-assets.test.ts` checks every
  entry against the repository. All seven are studio scenes. Task done, task
  logged, task started and end of day are played once (`loop: false`): the
  device holds a one-shot's last frame, and `DisplayRenderer` returns to the
  session after each one's `*_DISPLAY_SECONDS`, a little longer than the
  scene. A
  session update meanwhile is held behind it, which is why the STOP and
  FINISH paths start the scene *before* stopping the session, and the picker
  plays GO! before releasing its lock. Another task starting ends a scene at
  once; the session GO! announces does not, or its per-second updates would
  cut it off. A lock released during a scene restores the work screen
  without stopping it. While the
  device plays a scene, `AnimationPlayer`'s preview ticks at 15 fps and skips
  frames to keep time with it.
- **The server half** (`server/api.ts`) runs inside the Vite dev server. It
  writes scene files and exports, and plays a scene on the bar under the
  application name `sprintticker_studio`, at priority 100 with an element
  timeout. It refuses requests from any other origin.

It imports only from `desktop-app/src/shared/`, which is where the fonts and
`isValidDeviceHost` live.

---

## 8. Testing

Vitest, 1381 tests across 70 files, in two projects: `main` in Node for
`src/main` and `src/shared`, and `renderer` in jsdom for React smoke tests
(`tests/renderer/`). The renderer's tests mount every view against a mock
bridge typed as the whole `IElectronAPI`, so bridge drift fails the typecheck.
`coverage.include` is `src/main/**` and `src/shared/**` — **the renderer is not
measured**, which is roughly 4,700 lines of TSX. The floor is a ratchet
(92 / 85 / 90 / 93.5) and is raised, never lowered.

Two harnesses let the provider layer be exercised over a real socket without a
real instance: `scripts/fake-openproject.js` (`pnpm mock:openproject`) and
`scripts/fake-jira.js` (`pnpm mock:jira`). Both deliberately serve more than one
page of everything and clamp the page size server-side — a harness that fits on
one page cannot fail the way production failed.

The animation studio has its own suite, 113 tests across 6 files, run by
`pnpm test` after the app's and on its own by `pnpm test:studio`.

What the suite structurally **cannot** see: application startup, IPC wiring, and
anything touching real hardware. Those need the app actually running — read its
console, not just its UI.
