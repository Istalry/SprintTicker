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
                    │  React 18 + Vite + Tailwind             │
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
                          ┌────────▼─────────┐
                          │  BUSY Bar        │
                          │  10.0.4.20 (USB) │
                          └──────────────────┘
```

Three processes, one database, two outbound directions (the device over USB, a
task provider over the internet), and one inbound (the Unity plugin on
loopback).

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
      │              (proportional font row 0, fixed 3×5 row 1)
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
> **Row 0 has no character capacity**
>
> It is set in the firmware's own proportional font, so `measureText` and
> `fitToWidth` in `shared/proportional-text.ts` are the only correct way to ask
> whether something fits. Both the composer and the canvas must use them: a
> one-character disagreement truncates a row twice, and the second cut lands
> mid-word with no marker.

The rear 160×80 OLED is **preview only**: `buildRearElements` feeds the on-screen
emulator, and `transmitFrame` sends the front matrix and nothing else.

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
| `tasks` | Cached tasks: `status` is `todo` / `in_progress` / `done` |
| `active_sessions` | The live session — `TRACKING` / `PAUSED` / `COMPLETED` |
| `paused_intervals` | Each pause, FK to the session, `ON DELETE CASCADE` |
| `worklogs` | Local record of tracked time. Written even when the remote refuses it |
| `worklog_sync_queue` | Outbound worklogs: `PENDING` / `SYNCING` / `SYNCED` / `FAILED`, with backoff and `last_error` |
| `settings` | Key/value, including provider configuration |

Migrations are versioned and forward-only (`src/main/db/migrations.ts`):

1. `initial-schema` — the pre-migrations schema, reproduced verbatim so an
   existing database replays it as a no-op and lands on v1 with its data intact.
2. `sync-queue-claim-and-backoff` — rebuilds the queue table, because SQLite
   cannot `ALTER` a `CHECK` constraint and the queue needed a fourth state.
3. `query-indexes`.

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

## 7. Testing

Vitest, 707 tests across 50 files. `coverage.include` is `src/main/**` and
`src/shared/**` — **the renderer is not measured**, which is roughly 4,700 lines
of TSX. The floor is a ratchet (83 / 74 / 84.5 / 85) and is raised, never
lowered.

Two harnesses let the provider layer be exercised over a real socket without a
real instance: `scripts/fake-openproject.js` (`pnpm mock:openproject`) and
`scripts/fake-jira.js` (`pnpm mock:jira`). Both deliberately serve more than one
page of everything and clamp the page size server-side — a harness that fits on
one page cannot fail the way production failed.

What the suite structurally **cannot** see: application startup, IPC wiring, and
anything touching real hardware. Those need the app actually running — read its
console, not just its UI.
