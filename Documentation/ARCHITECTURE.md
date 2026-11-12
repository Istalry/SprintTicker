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
                    │  8 views, no Node, no Electron          │
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
│   WebhookServer (127.0.0.1:39123) <── remote keys, Stream Deck           │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTP
                          ┌──────────────────────┐
                          │  BUSY Bar            │
                          │  10.0.4.20 (default) │
                          └──────────────────────┘
```

Three processes, one database, two outbound directions (the device over USB, a
task provider over the internet), and one inbound (remote key presses and the
Stream Deck plugin, on loopback).

The device address is a persisted setting (`DeviceConfigDTO.ipAddress`), seeded
from `10.0.4.20` and edited in Settings › Device. Main reads it before
constructing `BusyBarDriver`; changing it calls `reconfigure()`, which tears the
ping loop and StateStream socket down and re-dials rather than restarting the
app. It has to be a setting: over Wi-Fi the bar holds a DHCP lease, and a host
whose USB CDC-NCM driver will not start the interface is recovered by proxying
the bar onto a different address entirely.

**No-bar mode** is `DeviceConfigDTO.enabled: false`. The driver then never
dials: `connect()` declines without starting the ping loop, every command throws
`disconnected` without a request, and frames are queued as they are for an
unplugged bar. `AnimationPlayer` skips the upload and runs frames for the
preview; the renderer shows no animated icon and skips the idle clear; and the
Windows notification listener, which polls Windows' notification database every
couple of seconds to mirror it onto the bar, is started and stopped with the mode (`followBar`). Turning the bar off while it is
connected releases the display through `clearDisplay` first, or the last frame
would stay on it. `DeviceStatusDTO.enabled` carries
the mode to the renderer, which hides the bar's header preview and its
bar-only settings live. Turning it back
on (`setEnabled(true)`) dials the configured address and emits `reconnected`,
and the renderer draws the current screen past its deduplication, which had
recorded the last frame as sent. The queued frame is not replayed: a clear
asked for meanwhile would have ended it. A row saved before the field existed
reads as `true`.

**Three windows, one renderer bundle.** The dashboard, the **mini timer** and
the **picker window** load the same `index.html`; the mini timer loads it at
`#mini`, and `main.tsx` mounts `MiniBar` instead of `App` for that hash. The
picker window (redesign P7b) loads it at `#picker` -- `#picker?mode=assign`
to assign the ad-hoc session (`shared/picker-window.ts`) -- and mounts
`PickerWindow`: the window's `TaskPicker`, its pick done by the same
`utils/pick-task.ts` as the dashboard's. `PickerWindowManager` owns it: one at
a time, centred on the display under the pointer, frameless and on top,
shown on `ready-to-show` and raised with `ForegroundRaiser` when the press
reached another app (the deck). It closes on a pick, Escape or ✕ (the
renderer's `window.close()`, after main has answered the pick) and on
`blur`. A window that cannot be made falls back to the dashboard's picker
(`openTaskPickerInMainWindow`), kept until the window has run packaged. The
tray, the deck's `openPicker` and `mini:open-task-picker` /
`mini:open-assign-picker` open it; the bar keeps raising the dashboard with
its picker until P14.

**The command palette** (`CommandPalette`, Ctrl+K, redesign P7c) is renderer
only. `utils/palette-actions.ts` lists the actions the session allows, in the
words of `shared/words.ts`, each with other words for it ("sort" finds
Place), and every setting of `settings-groups.ts`; `filterPalette` ranks
them. `App` runs an action as the window's own control for it does, and a
task picked there goes through `pickTask`, as the picker's. **Placing
several interruptions** (`PlaceInterruptionsDialog`, S12b) keeps a choice
per row and sends nothing until "Place the N chosen": the names first
(`interruption:rename`), then one place per task (`interruption:place`, or
`interruption:place-many` for several), then
the rows kept off. The Tasks place's rows start and switch through
`pickTask` too, and its Stop is `session:complete` without Done, so the
window has one finish flow. Both get the same web preferences and
the same navigation lock (`secureAndLoad` in `index.ts`), so the second window
cannot end up laxer than the first. `MiniWindowManager` owns the mini timer: it
builds it through an injected factory, remembers its position and whether it
was open under the `mini_window` setting, and checks a saved position against
the displays that exist now -- a monitor unplugged since would leave an
always-on-top window off-screen. It closes with the dashboard (`dispose`, which
keeps `open` for the next launch), because Windows quits an app only when its
last window is gone. Every broadcast -- the registry's and the engine tick's
`session:on-updated` -- goes to all windows, or the mini timer would keep
showing a session that has ended. The schedule's questions -- the ceremonies,
the resume question, a session left running -- go to every window as well,
through a `PromptOutlet` (`windows/prompt-outlet.ts`), which also shows a
toast while the dashboard is hidden. Nothing that asks brings a window
forward (P8c). Picking a task from the tray or the mini timer
goes through `openTaskPickerInMainWindow`, which sends the picker's hardware
action on `input:on-hardware-event` with `inputKey: 'app'`.

**The window is four places and a header** (`AppShell`): Today, Tasks,
History and Settings, switched by state in `App` with no router, and the
same with or without a bar. `App` owns the place, the session and the
global modals (`useModals`); each place is a view (`views/Today`, `Tasks`,
`History`, `Settings/SettingsPage`). The header holds the bar's preview,
the mode chip (`priority:get-user-mode` / `set-user-mode`), the mini timer,
End my day and `StatusPanel`, whose one word is the worst of the bar, the
provider queue and the update (`utils/status-summary.ts`). Settings is six
groups, indexed with their search words in `settings-groups.ts`; the
existing views mount there whole or by `part`, so a card moved and none
was rewritten. **The bar opens its own picker**: the window opens its picker
on `TRIGGER_TASK_SELECTOR_MODAL` only for `inputKey: 'app'` or while a
session runs (`windowPickerWanted`), or a START on the bar opened two.

**The window has one task picker** (`TaskPicker`, redesign P7) for Start,
Switch, Assign, Place and Move. It reads one snapshot (`tasks:get-picker`:
previous, recent, starred, every listed task, projects, time per project)
and groups it with the pure rules of `shared/task-picker.ts` -- the groups'
order, search across projects, a project key and a space, what looks like a
key -- within the lists' order (`task-order.ts`) and visibility
(`task-visibility.ts`). Fetch by key (`tasks:fetch-by-key`) asks the active
provider's `getTaskByKey`, keeps the task as the sync would, and is shown
only with `canFetchByKey`. Picking during an interruption is
`interruption:switch`, with `takeAlong` when its time goes too.

**Starting with Windows** is `LaunchAtLoginService`
(`src/main/services/launch-at-login.ts`), behind both the switch in Settings,
General and the tray's checkbox; the tray rebuilds its menu from the service's
notification. It keeps no state: every read asks Windows
(`getLoginItemSettings(...).executableWillLaunchAtLogin`), because the
Startup apps page can switch the entry off with no event the app hears. The
entry is the Run value named by the AppUserModelID, and it carries
`--hidden`: a run started with it makes the dashboard with `show: false`.
The window is made all the same, since closing it is what quits the app.
The path is `PORTABLE_EXECUTABLE_FILE` when the portable stub sets it, or
`process.execPath`. At startup `refresh()` rewrites an entry that is still
enabled, which upgrades one written without `--hidden`, but never one
switched off: a write approves it again. Unpackaged, the service writes
nothing and says why (`reason: 'not-packaged'`).

The mini timer's icon is the bar's. `DisplayRenderer` keeps the icon of the
frame it paints (`frameScreenIcon`, beside `frameIcon` and consumed with it in
`transmitFrame`): the bitmap a screen draws at the left, with its top row as
the label, or for a full-panel scene the icon in `SCENE_ICONS` with the
scene's title. The firmware's clock has none. It is pushed on its own channel,
`display:on-screen-icon`, and only when it changes: the display state goes out
on every tick and every scene frame.

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

**Words and provider names are shared too.** `src/shared/words.ts` holds the
redesign's glossary: the verbs, the states and their bar forms, each bar word
measured against its field in its font by `words.test.ts`. The deck's words
live in `deck-protocol.ts`, the one file the plugin may import, and
`words.ts` re-exports them. `src/shared/provider-names.ts` decides what the
app calls each provider (`providerDisplayName`: Jira, OpenProject, the name
of a custom server, "This computer" for time that stays here); the adapters'
`providerName` and the window's provider choice both read it.

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

`discardSession()` ends a session keeping nothing -- no worklog, nothing
queued, the task's status untouched. Every caller confirms with the user first.

A session can also end in the past. `resumeSession` records when each pause
ended (`paused_intervals.resumed_at_utc`, written by nothing before), so
`stopSessionAt(endUtc)` logs the time up to an end the user chose, less the
pauses before it -- through `workedSecondsUntil` in
`src/shared/session-review.ts`, which the window uses to show what each end
would log. `pauseSessionAt(utc)` pauses a running session as of an instant in
the past, without a pause row: provisional, so `withdrawPause()` can take it
back and `stopSessionAt` can log past it. Pauses from before resumes were
recorded are known only as a total, which `getClosedPauses` places at the
start.

A worklog belongs to the day it began (`started_at_utc`), as Jira's `started`
and OpenProject's `spentOn` file it; History and the end-of-day summary
used to file it on its stop. So a session never ends as a worklog across local
midnight: `finishSession` splits its time with `splitWork`
(`shared/work-split.ts`) into one worklog per local day, and another after
each pause of `splitPauseMinutes` or more (a schedule setting, 15 by default,
0 for never), each starting at the first instant worked in it. The split is
made at the end, never by a timer, so the session's start -- which the
forgotten-session check reads -- never moves, and nothing unconfirmed is sent.
The pieces add up to the session's total exactly, a clock set back during a
pause included; a piece shorter than the provider's floor is folded into its
longer neighbour (`mergeShortPieces`). Each piece is a worklog and a queue row
of its own, with its own marker, so a resend or a correction names one entry.
`getSessionDays()` gives the window the same split for a stop now.

Ad-hoc work is told apart by its id (`adhoc_` prefix, `isAdHocTaskId`), not by
the caller's flag: every list that offers an ad-hoc row again starts it as an
ordinary task. An ad-hoc session never moves a remote status, and finishing
it as done marks the row done here only. It is never queued: its worklog
stays local.

### Provider layer — `src/main/providers/`

```
ITaskProvider  ← the contract (task-provider-interface.ts)
    ├── OpenProjectProvider   REST API v3, HAL pagination
    ├── JiraProvider          REST API v3, two pagination schemes
    └── AdHocProvider         local only, no network

ProviderManager   resolves the active provider, holds credentials,
                  and reads what it can do (providerCapabilities)
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

It also keeps how the sync is going (`getHealth`, `onHealthChanged`,
`shared/sync-health.ts`) for Today's S31 cards (P11b): `first-sync` with the
projects fetched so far, when the cache holds none of the provider's;
`unreachable` or `refused`, with when the failure began -- kept apart from
the first-sync state a retry passes through, so "since 10:42" holds; `ok`
with the last committed pass's time; `not-configured`. In memory only: after
a restart the time of the last sync is unknown until the next one.
`NoticeService` keeps Today's one-time notices: the version last seen
(`last_seen_version`, recorded silently by a fresh install) and "No account
yet" put away.

| Constant | Value | Why |
| :--- | ---: | :--- |
| `SYNC_INTERVAL_MS` | 5 min | Background pass |
| `MAX_SYNC_ATTEMPTS` | 8 | Then the row parks as FAILED, with the server's own message |
| `SYNC_BACKOFF_BASE_MS` | 30 s | Doubles per attempt |
| `SYNC_BACKOFF_MAX_MS` | 1 h | Ceiling on one wait |
| `SYNC_CLAIM_TIMEOUT_MS` | 10 min | A claim left behind by a crash is reclaimable after this |
| `UNDO_WINDOW_MS` | 10 s | Every row is written due this long from now: the hold Undo has |

**Every send is held, and only `UndoService` undoes.** A row the queue takes
-- a session's worklog, a correction, a move, a deletion -- is written with
`next_attempt_at_utc` ten seconds ahead, and `dispatchAfterHold` wakes the
worker when that ends; nothing new in the worker, which already skipped rows
not yet due. `UndoService` holds the last user action for the same ten
seconds, on the same clock: Stop, Done and Discard from the window, the mini
timer or the deck (`undoableSessionEnding`), and a correction, move or
deletion from History. Each records a `RestorePoint` -- the rows the action
touches, before and just after -- and Undo puts the "before" back, rowids
included, so the queue's order on a worklog is kept. It refuses when any
queue row has moved since (claimed, sent, an attempt counted), so what
reached the provider is never taken back here only. A Done transition waits
with the stop (`StopOptions.holdRemote`) and runs when the action is final:
the window ends, another action is offered, or the app quits. Starting a
session makes a held stop final, since undoing it would open a second one.
The bar's own STOP and DROP are not undoable yet (P14).

**A start moves the task only once it was timed** (S20). In Progress
(`takeUpTask`) and taking an unassigned task (`claimTask`) used to run in
`startTask`, so a task started to look at it was moved and assigned all the
same. Now the engine hands them to a `SideEffectScheduler`, which runs them
once the session's `elapsedSeconds` -- pauses left out -- reaches
`start_side_effects.afterSeconds` (120 by default, read at each tick, so
Settings applies at once). A stop, a discard or a switch cancels them; the
scheduler checks the session id on every tick, so a run never lands on the
next session. Turned off (`enabled: false`) nothing runs. A stop undone
before its time reschedules the rest.

**Done goes to the project's own state.** `done_state_by_project` keeps an
override per project; the engine names the session's project when it moves a
task to Done, and `ProviderManager` reads the override (`doneStateFor`) and
hands it to the adapter as `doneState`, which replaces the completion action:
Jira matches it against the issue's transitions by id, name or target status,
OpenProject PATCHes it as a status id. No override, and the completion
action runs as before. A state the workflow lacks answers false, as any
transition that cannot happen; the time is queued regardless.

**An overlap holds the later entry.** `getPendingQueueItems` skips the first
send of a worklog that overlaps an earlier one (`shared/overlap.ts`: starts
first, lower id on a tie, ends after the other begins, another session), and
the worklog reads `held-overlap` with the other entry's key. Correcting
either releases it at the next pass. Entries already sent stay sent, and
their corrections go; the window warns before saving a correction that
would overlap.

**The tracked task survives the prune.** The engine names it
(`protectTasks`), and a sync that no longer finds it -- reassigned, closed or
moved -- keeps it and its project, records it as unlisted, and tells the
engine, which re-sends the session with `taskUnlisted`. A task reassigned
while it stays in progress is still found, as a teammate's: its ownership
says so, the session reads `reassigned` without asking the provider, and the
engine re-sends it once when the owner changes. A task nobody owned that
someone took between the pick and the start reads the same way: the engine's
claim (`claimTask`, run by the `SideEffectScheduler` once the session has
been timed long enough) finds it taken, records it as
theirs, and re-sends the session at once, with `taskOwnerName`; it also hands
`onTaskClaim` a report, which `ProviderEventService` turns into a toast and a
**TAKEN** banner. It used to be retired
mid-session, deleted outright when no time had been logged on it yet, so
finishing it as done found no row and did nothing. The sync after the session
ends retires it as usual. Why it left (`getTaskStanding`, `taskLeftBecause`)
is asked at every sync while it is unlisted, and the session re-sent only
when the answer changes: asked once, a task reassigned and then closed kept
"reassigned", and FINISH sent its transition to a closed work package.
Between syncs the engine reads the task being timed once a minute
(`checkStandingEveryMinute`, on its tick; `TASK_STANDING_CHECK_MS`) through
`OfflineSyncWorker.checkStanding`: a task closed or gone joins the unlisted
set with its reason, an open one has its owner written to its row
(`TaskRepository.setOwnership`), and the session is re-sent when either
changed. Not during an interruption, for ad-hoc work or the app's own
projects, offline, or for a provider without the read; a failed read keeps
what was known. The session says when the task was first seen leaving
(`taskLeftAtUtc`), and `moveSessionTo` moves its time so far to another
task -- stop, `reassign` each entry, start -- for Today's card (S5b).

A pass that arrives mid-pass does not get dropped: the single-dispatcher guard
**coalesces**, setting a flag so the new row drains before the current pass
ends. Without that, finishing one task and starting the next — the app's core
loop — waited out the full interval anyway.

**The queue carries corrections too.** A row's `operation` is `CREATE` (a
worklog), `UPDATE` or `DELETE` (one already sent). A correction names in
`origin_sync_id` the row that sent the worklog: that row holds the entry's id
once the provider gave one, and its marker finds the entry when it did not
(`findWorklog`), after which the id is kept. An `UPDATE` keeps the original
marker in the comment, so the next search still finds it. A `DELETE` that
finds nothing is done -- the entry is gone -- while an `UPDATE` that finds
nothing parks with "Not found in Jira". `getPendingQueueItems` holds a row
until every earlier row of its worklog has arrived, so an `UPDATE` never runs
ahead of the `CREATE` it corrects, and a pass that delivered anything runs
once more so the correction behind it goes out at once.

### `WorklogCorrectionService` — `src/main/services/`

Corrects or deletes a worklog: here at once, at the provider through the queue.
What it queues depends on how far the send got:

| The send | A correction | A deletion |
| :--- | :--- | :--- |
| None (ad-hoc, too short, recovered, or untied by migration 8) | Here only | Here only |
| Queued, not claimed (`PENDING`, `FAILED`) | The queued row is rewritten, and given a fresh start | The queued row is dropped -- unless an attempt was made, whose lost answer may have created the entry; then a `DELETE` goes out and finds it by its marker |
| Claimed or delivered | An `UPDATE` behind it; one unsent per worklog, the latest wins | A `DELETE` behind it, replacing any unsent `UPDATE` |

A split (`split`, S16c) is a correction and an added entry in one
transaction: the worklog is shortened as the table says, and the rest is a
new worklog on the task chosen, from the same session. When the shortening
is an `UPDATE`, the new entry's `CREATE` names it in `origin_sync_id`, and
`getPendingQueueItems` holds a `CREATE` while the row it names is unsent --
so the provider has the first entry shortened before it gets the second,
and never the same minutes on both. On a `CREATE` that column means only
this wait; on a correction it names the send corrected.
| At a provider with no remote (ad-hoc rows of an older build) | Here only | Here only |

History's week (S15) is `shared/week-sheet.ts` over `worklogs:get-range`:
each task's time per day grouped by project, the Day row, and the provider's
row, which sums `providerSeconds` -- the duration of the last `SYNCED` queue
row for the worklog on its current task, a `DELETE` counting as nothing. So
the row is what the provider holds, not what it will hold: a correction not
answered yet leaves the old value.

Check my week (S15b) is `shared/week-issues.ts` (`checkWeek`), pure: the
week's entries, the interruptions to place, the schedule and the session
running in, a list of issues with their fixes out -- fragments to place,
corrections and sends not answered (`syncState`), untracked time in each
working day's hours (`day-gaps`), overlaps (`overlap.ts`), and, in a closed
week, the queue rows created since it closed (`worklogs:get-week-changes`,
read from the queue because a deletion leaves no worklog). There is no daily
target. The window draws it (`CheckWeekDialog`); the week's close notice
opens it on that week, by remounting History with `checkWeekOf`.

History's timeline (S14b) is drawn from `shared/day-gaps.ts`: a day's working
window -- the stand-up to the wrap-up on a working day, the hours the
reminders use (`inWorkingHours`) -- less its lunch, less every entry and, on
today, the session running and everything after now. Pure, and only shown:
nothing is logged from a gap.

Time **added by hand** (`add`, S16b) is a worklog under a session id of its
own (`IdPrefix.MANUAL_SESSION`: the column is NOT NULL, and there was no
session) and a first send for its task's provider, held for the undo window
like a stop's; Undo is a `RestorePoint` over the worklog's id, named before
it is written. An overlap is not refused here: the queue's own rule holds the
later entry.

A **move** to another task (`reassign`) goes by the same send:

| The send | A move |
| :--- | :--- |
| None | A `CREATE` for the new task's provider, if it has one -- the first send of ad-hoc time |
| Queued, never attempted (`send_attempts = 0`) | The row is pointed at the new task and provider; the old provider never hears of it |
| Attempted, claimed or delivered | A `DELETE` of the entry where it is, then a `CREATE` on the new task |

The `CREATE` waits for the `DELETE` on the same worklog (`getPendingQueueItems`),
so a move stopped half-way has the time on neither provider for a while, never
on both. Two reads keep a moved worklog straight: `getSendOf` and the sync
state go by the send *for its current task*, and the drops of unsent
corrections go by the send they correct (`origin_sync_id`), never by the
worklog alone -- either way, a later correction or deletion took the move's
`DELETE` with it, or aimed at the entry already deleted. Moving time moves
neither task's status; an emptied ad-hoc task is retired.

Each change runs in one transaction with the worklog's, and wakes the worker
as a stop does. The rules for a valid correction are
`checkWorklogCorrection` in `src/shared/`, shared with the window; the
provider's floor applies only to a worklog that goes to it.

### `PriorityPreemptionEngine` — `src/main/services/`

Decides what the display shows. Every claim carries a score; the highest holds
the display and takes a named lock, which the claimant must release.

Two rules, both scars:

- **Never hardcode a ranking.** The table below is a *default* the user edits in
  **What the bar shows first** in Settings. Nothing in the code may assume a particular order.
- **One event produces exactly one `evaluateRequest`.** Evaluating twice takes
  the lock twice under different names, and the release then never matches the
  lock actually held.
- **Releasing is the whole of ending a screen.** `releaseActiveLock` frees the
  lock it names, replays a queued alert if one is waiting, and otherwise hands
  the display back to the user's mode (`setContextMode`). A caller that renders
  again afterwards draws twice; one releasing a lock it does not hold renders
  nothing, which leaves the screen that took it alone.
- **The freed display goes, in order, to:** a queued alert (a request that
  was *refused* and left a callback); the most important screen a preemption
  *set aside*, redrawn by `DisplayRenderer.resumeScreen` from the last screen
  drawn under that lock; a **background state** registered with
  `addBackgroundScreen`, which redraws what it is now; and only then the
  user's mode. Background states are offered highest-ranked first, and one
  ranked above everything queued or set aside comes before the queue.
  Releasing a lock that is set aside rather than held removes
  it from that list. A screen set aside comes back only in a mode whose rule
  displays it: the stand-up prompt, covered by Away, waits through a Lunch
  begun meanwhile and returns after it. The tracker and the mode locks are
  never set aside: `setContextMode` draws them as they are now.
- **The bar's picker is the background state.** Registered by
  `InputDecoder`, it comes back while it is open: refused under Away and
  never queued, it would otherwise be open and unseen once Away ended. A
  state is reclaimed rather than resumed -- it redraws what it is by then,
  not what it was when covered. The Unity Editor's compile and Play Mode
  screens were the other background states, until the app dropped Unity on
  2026-11-09; the mechanism stays general.

| Claim | Event name | Default score |
| :--- | :--- | ---: |
| Away mode | `awayModePriority` | 100 |
| Bar task picker | `menuPriority` | 97 |
| Lunch mode | `lunchModePriority` | 95 |
| End-of-day wrap-up | `eodWrapUpPriority` | 80 |
| Resume after lunch question | `resumePromptPriority` | 76 |
| Stand-up prompt | `standupPromptPriority` | 75 |
| Notification — high | `highNotificationPriority` | 70 |
| Notification — default | `messagingPriority` | 65 |
| Active task tracker | `activeTrackerPriority` | 45 |

Each rule also carries an action per user mode — `DISPLAY`, `SUPPRESS` or
`QUEUE` — for `WORK`, `LUNCH` and `AWAY`. That is how notifications correctly
do not interrupt a break: not a special case in the code, a row in the table.

The bar's picker had no row, so it took the default 50 and was queued under
Lunch: START during lunch opened a picker nobody could see. It has its own row
now, above Lunch, and is never queued -- every press redraws it, and a copy
queued under Away replayed after the user had closed it.

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
   puts `hardware_anim` to rest -- unless the driver believes nothing else is
   on the panel, since the scene is then what the bar shows.

Steps 1-2 and 4 address the same element id, so they run under one lock in
`AnimationPlayer`.

**No animation is ever removed by id.** On firmware 1.2.4 removing a playing
animation that way hangs the bar now and then (2026-10-07), while drawing
another animation under the same id never did. So `removeDisplayElements`
puts an animation to rest instead: it draws the empty animation
(`blank-animation.ts`, one transparent frame, 80 bytes, uploaded once per
connection) under the same id and layer, and the ledger keeps listing it.
Icons and scenes change by merging the next one over it. It leaves the panel
only when the screen closes.

`clearDisplay` remains for handing the display back (the idle clock, quit). It
removes the images beside any animation, one id per request, waits
`ANIMATION_TEARDOWN_SETTLE_MS` after the last removal, and closes the screen on
the animations alone -- the release measured safe 100 times in a row. On a
panel it cannot vouch for, it removes the frame whatever it lists. A draw that
lands meanwhile makes the clear `superseded` and stops its removals. Clears
are serialised: a second one running alongside closed at once and hung the
bar on 2026-10-05. One that finds the panel known to be empty sends nothing.

**After an outage the renderer redraws; the driver never replays.** A failed
ping, or a request that got no answer between two good pings, means the panel
may hold anything: an earlier screen, the firmware's own after a reboot, or a
screen whose clear failed while the bar was away. The driver forgets the
ledger at the loss, so what requests answered after the bar came back still
holds; when a ping sees it again it drops the pending frame and emits
`reconnected`;
`DisplayRenderer` then draws the screen of whoever holds the display
(`resumeScreen`), or the user's mode, with its animation restarted. Replaying
the pending frame put BUILDING 40% back on a bar whose build had long ended.

**The driver enforces the device's rules for everyone.** Frames, the animation
player, the icon animator and the idle clock's clear each order their own
requests and none sees the others, so the driver puts every display and asset
request through one `SerialQueue`. Each request's guard runs at the head of
the queue, after every earlier request has answered, against a
`DisplayLedger` of what the panel holds: a removal of an element known to be
absent, a clear of a panel known to be empty and an upload over a playing
`.anim` -- or one it may be playing, after a draw over it got no answer --
are answered without a request, and anything that could empty the panel waits
for the settle after the last removal. The panel is "known" once a clear has
emptied it; before that, or after a request that got no answer, nothing is
skipped.

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

**The `.anim` is chosen per bar, at upload time.** Firmware 1.2 reads only
`bicycle0` files and 1.3 only `bicycle1`, and a file in the other format is
drawn with a 200 as the firmware's load-error icon. So every animation is on
disk in both (`<id>.anim`, `<id>.v1.anim`), `AnimationData.anims` holds
whichever exist, and both players ask the driver's `getAnimationFormat()`
before each upload: the scene on every play, the icon after every reset. The
format comes from the version the bar reports at each ping
(`shared/anim-format.ts`); none readable means no `.anim` -- frames for a
scene, the static icon for an icon. The driver's upload guard refuses a file
in another format without a request, a failed ping forgets the format until
the next ping reads it, and a changed version makes the ledger forget every
element (`noteRebooted`), so the files are uploaded again in the new format
after an update rather than drawn from the old ones still stored.

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
the bar, and the paused menu: INTERRUPT, STOP, FINISH and DROP, of which row
1 shows the pair holding the choice, or INTERRUPT alone (`pausedChoicesShown`).
It opens on FINISH, and goes back there when a pause ends on INTERRUPT. A
click on INTERRUPT is decoded as `START_INTERRUPTION` and handed to
`ContextScheduleService.answerFromBar`, which interrupts as the window's
button does; the decoder ends nothing itself. DROP asks **DISCARD?** first;
while the question is up the click confirms, BACK refuses, and every other
key waits. A session started anywhere else while the picker is open closes
it: it used to hold the display over the new session until BACK. After lunch,
under `resumePromptPriority`, OK and START answer yes and BACK no; the answer
goes to `ContextScheduleService` through the action handlers. Its project list goes through `filterProjectsWithTasks`
(`src/shared/project-filter.ts`), the rule the window's two lists use, and
reads the stored switch each time the picker opens. The driver listener is wrapped in a try/catch on purpose: a throw
inside an EventEmitter listener with no error handler terminates the main
process, so without it a button press could take the whole app down.

### `ContextScheduleService` — `src/main/services/`

Runs the day: the stand-up and end-of-day prompts, Lunch, and Away on lock or
suspend, from a check every 30 seconds.

Its questions never take the focus (P8c). A ceremony asked is kept
(`getCeremonyPrompt`, a `CeremonyPromptDTO` with its time) and sent on
`schedule:on-ceremony-prompt` to every window through the `PromptOutlet`,
with a toast while the dashboard is hidden; Join, Skip today (`skipStandup`,
which releases the bar's prompt and draws nothing itself), Remind me
(`snoozeCeremony`) and the wrap-up's end or cancel (`closeEodPrompt`) close
it with a null. Today shows the stand-up as a card and the mini timer as its
row; the wrap-up still opens its dialog, without coming forward. Lunch
starting over a running task, and every resume question, are announced the
same way.

Lunch and Away pause a running session (`pauseSession('lunch' | 'away')`,
the reason on its `paused_intervals` row), before the mode switches so the
scene lands over the paused frame. Nothing is logged then: at the task's
stop `splitWork` cuts the worklog at the break, which files the time as two
worklogs either side of it. The paused session is the `lunch_resume` setting,
with the day it was stored, the session id (`heldSessionId`) and the break
(`pausedFor`). When lunch ends, or at the first check in WORK after the end
-- the app was closed, or Windows stayed locked, since Away never leaves for
Lunch's end -- or when Away ends, the service asks "Back at your desk?" in
the window (`schedule:on-resume-prompt`, `held: true`) and on the bar under
`resumePromptPriority`, while that session is still open and paused; an
entry of another day, or one whose session was resumed, stopped or replaced,
is dropped. The answer (`schedule:answer-resume-prompt`) resumes the session,
or with `workedThrough` withdraws the pause -- its row deleted, so nothing
splits there -- or leaves it paused. Lunch beginning under Away relabels the
entry as lunch's. Lunch's hour finding an interruption running asks first
(S25): a `LUNCH` ceremony prompt naming it (`endsInterruption`), in WORK and
under Away, closed when lunch's hour or the interruption ends;
`answerLunchQuestion(true)` enters Lunch, which ends the interruption and
gives its held task Lunch's pause (`relabelPause`), and `false` stores
`lunch_skipped_date`. `exitAwayMode` in lunch's hour with an interruption
running goes to WORK and asks. Away leaves an interruption running.

An entry with no session id is a task to start again: the stand-up's, ended
by lunch, or one stored by a version whose Lunch stopped the task. It is
restarted at the same moments unless anything is open by then; a task no
longer listed (`TaskRepository.isListed`) is asked about first, and the entry
is kept until answered, so a restart asks again.

The service also listens to the engine. A session going TRACKING during lunch
-- a new session, or one resumed; not the engine's tick, which tells its
listeners every second while a session runs and used to skip lunch whenever
one did -- is the user working through it: the stored resume is dropped,
`lunch_skipped_date` stops the next check entering Lunch again that day, and
the mode goes back to WORK. "During lunch" includes the lunch hours in WORK,
after Away ended and before the next check entered Lunch. `exitLunchMode`
switches to WORK before its own restart, which is how that restart is told
apart from the user's.

Joining the stand-up (`joinStandup`, from `schedule:join-standup` or OK on the
bar's prompt) switches the timer to the ad-hoc **Daily Standup** task -- one
row, found by title (`startNamedAdHocTask`) -- or, when `standup_task` names a
task still listed, to that task, whose time is sent like any entry (D3). It
may be backdated (`joinedAt`, "joined 5 min ago"): `startTask`'s `startedAt`
starts the new session then, never before what it replaces began, and stops
that one there (`stopSessionAt`), so the minutes come off it. All of this
happens under the prompt's lock, then
releases it, which draws once: the session screen, with the meeting icon in
place of the stopwatch, animated by the device like the stopwatch
(`ANIMATED_ICONS.meeting`). The prompt's meeting scene used to stay, and joining
looked like nothing happening. The task it stopped is `standup_resume`, with
the stand-up's session id. When that session ends, the task restarts by the
lunch rules, asking first if it left the list (`after: 'standup'`); any other
session drops the entry. The restart is queued as a microtask, because it is
made from the engine's listener: started there, the listeners after this one
would still be handed the ended session, and the renderer would draw the idle
clock over the restarted task. A stand-up stopped by lunch hands lunch the task
before it, not the meeting.

The stand-up keeps that mechanism, the **set-aside**: one `set_aside`
setting holding the task to bring back, the session whose end brings it back
(`endsWith`), and why (`after`). `switchSettingAside` starts the next session
and stores the one it replaced; it restarts the task itself unless it left
the user's lists. An entry stored by an interruption of the model before
(`after: 'interruption'`) is still honoured, and asks.

**Interruptions are fragments, not sessions** (redesign P6, migration 15).
Interrupt (`ContextScheduleService.interrupt(source, at?)`, which the window,
the mini timer, the tray, the bar, the deck and the shortcut all reach)
calls `engine.startInterruption`: the session open, tracking or paused, is
**held** -- paused with a `paused_intervals` row of reason `interruption`,
never stopped, nothing logged or sent -- and a row opens in `interruptions`,
naming the held session and whether it was already paused. One fragment
runs at a time, by a partial unique index as for sessions. **Another**
closes it and opens the next with `after_id`, holding the same session, so
a run reads back as Marc, Ana, Marc and one Back. **Back**
(`backFromInterruption(addGapMinutes)`) closes it and ends the held pause --
earlier by the gap, after a Stop -- unless the session was paused before.
**Stop** closes it alone; **Switch** (`switchFromInterruption(taskId,
takeAlong)`) closes it, stops the held session as any start does, and
starts the task, placing the fragment on it with `takeAlong`; **Discard**
marks it discarded.

While a fragment runs, `getCurrentSession()` answers a **fragment view**:
the fragment's id as session and task id, ad-hoc, tracking, titled
`Interruption HH:MM` until named, with `interruption: RunningInterruptionDTO`
saying what it holds. The bar, the deck, the tray and the mini timer read
that view, and the engine routes their commands to the fragment: pause,
stop and Done are Stop, resume is Back, discard is Discard, a start is a
switch, assigning is a switch taking it along, renaming names the fragment,
and Interrupt is Another. Inside the engine `sessionView()` is the session
itself. `onInterruptionEnded` tells who ended one and how; the schedule
service asks "Back to MG-12?" from it after a Stop or a Discard -- never
over lunch or the wrap-up, never for a task paused before -- and its Yes is
Back, with the gap counted when asked (`interruptionEndedAtUtc`). Lunch
during an interruption stops it, and the held task, if it was running before,
takes Lunch's pause; Away leaves it running; the wrap-up stops both.

A fragment that ended waits to be **placed**: `InterruptionService` lists
them (`getInterruptionsToPlace`, every day), places one or several on a
task -- a worklog of its span through `logSpan`, the path `finishSession`
uses, queued with P5's hold -- keeps one off (a local ad-hoc worklog, never
queued) or discards one, each behind a restore point so Undo puts the rows
back. Interruptions of the model before -- ad-hoc tasks marked `unsorted`
(migration 13) and their worklogs -- became fragments in migration 15 with
`legacy_worklog_id`; placing one moves that worklog
(`WorklogCorrectionService.reassign`). While one runs (S9), the engine moves
its start earlier (`moveInterruptionStart`, the held task's open pause with
it, so the minutes come off the task) and keeps a task chosen for it
(`chooseTaskForInterruption`), which `tellInterruptionEnded` places it on
before telling the listeners -- for every end but a discard. A worklog read says when it came from
one (`fromInterruption`: an `interruptions` row names it as
`placed_worklog_id` or `legacy_worklog_id`), and Today marks it ⚡. In the
renderer, Today, History and the wrap-up share `InterruptionsToPlace` (its
list from `useInterruptionsToPlace`), and Today's and History's entries
share `useEntryActions` -- Correct, Move and Delete with their dialogs and
the closed-week question -- and `SyncBadge`. The optional global
shortcut is one more caller: `InterruptShortcutService` takes Electron's
`globalShortcut` by constructor, registers the stored chord only when the user
turned it on (`interrupt_shortcut`), reports a chord another app holds as
`taken`, lets go of it while the window records a new one, and unregisters at
quit, synchronously. A press with nothing on screen -- window hidden, no mini
timer, no bar connected -- is told by one of the app's own toasts, which the
notification listener never mirrors to the bar. The stand-up's
`standup_resume` entry from before is read once at start and moved over.
An ad-hoc session can be named while it runs (`renameAdHocSession`: the task
row and the session's copy together, one notification) or assigned to a task
in place (`assignSessionToTask`): `retargetSession` rewrites the open row's
project, task, key, title and `is_ad_hoc`, and sets `provider_id` -- the one
write of it after the start, for a session that had none, so the time still
never follows the active provider. The task's start-time effects wait as a
start's do (`SideEffectScheduler`), counted from the session's start.
After it ended, ad-hoc work is named from History (`renameAdHocTask`), which
goes through `renameAdHocSession` when the task is the open session's, so
the copy follows.
The wrap-up stops the session through
`stopForWrapUp`, which drops every stored restart first: stopped from the IPC
handler, a stand-up running at wrap-up time restarted its task overnight.
End my day (S17, `EndMyDayDialog`) does it through `endDayUndoably`, which
captures the session -- and, during an interruption, the session it holds --
and offers Undo (`Day ended`). The optional shutdown is `EndDayShutdown`:
started by the undo's commit, it passes over the queue every second until
nothing is due within the undo window or `END_DAY_DRAIN_TIMEOUT_MS` (30 s)
has passed, then asks Windows to shut down; Undo, a new wrap-up or a cancel
stops it at any point. Its figures (`endOfDayFigures` in
`shared/day-summary.ts`) count the list it shows, so the button and the rows
cannot disagree.

Only working days have ceremonies. `WorkingCalendar` answers which days are:
the schedule's `workingDays` (Monday to Friday by default, never empty), less
the holidays the provider lists (`getNonWorkingDays`). Those are read at most
once a day, over the range from last week's Monday to three weeks ahead, and
kept in the `non_working_days` setting; a failed read keeps the previous days
and tries again at the next check, so an outage never turns a known holiday
into a working day. The stand-up, entering Lunch and the wrap-up are gated on
it; leaving Lunch and Away is not, so a mode never outlives its hours.

The read is asynchronous and the check is not: the first check of a day
answers from the days read the day before. That is safe because the first
check of a day comes at midnight when the app runs overnight, and at start
it passes over anything already due; a holiday added the same morning is the
one case it misses.

The wrap-up of the week's last working day closes the week (`closeWeek`):
the time logged Monday to that day (`TimeTrackingEngine.getLoggedSeconds`)
goes to the window as `WeekEndedDTO` (`schedule:on-week-ended`), is kept in
`week_ended_notice` until dismissed, and is handed to `onWeekEnded`
listeners -- the hook a timesheet client attaches to. `last_week_closed`
holds the Monday of the last week closed: the first check of a working day
in WORK closes the week before if that wrap-up was missed, and a week is
never closed twice. A first run sets it without closing anything, and a week
with no working day is marked closed without a notice.

### `MorningService` — `src/main/services/`

The morning card (S4b, P8e2), read by Today when it opens (`morning:get`).
It answers null on a day off, once a session is open or anything is logged
today, and once the card was seen -- `morning:seen`, sent by the window when
a session starts or the card is put away, stores the day as
`morning_seen_date`. Otherwise: the last task timed that is still the
user's and open (`TaskRepository.getRecent`, ad-hoc work left out) with its
last entry's end (`WorklogRepository.getLastEndOf`), the stand-up's time
while it is still to come, and the user's tasks in progress. The
interruptions from earlier days come from the window's own list.

### `ReminderService` — `src/main/services/`

The "still...?" questions (P8d). `dueReminder` is pure: from the session,
when nothing started running, the day's start and the `prompt_delays`, it
answers the reminder due -- nothing timing (counted from the later of the
idle start and the stand-up time; not while "Back to MG-12?" is asked), a
long pause, a long interruption, a long stand-up -- with an id naming the
occurrence. The service evaluates it on `ContextScheduleService.onChecked`,
in working hours only (`inWorkingHours`: a working day, the stand-up's time
to the wrap-up's, and WORK), asks each id once through the `PromptOutlet`
(`reminders:on-changed`, a toast while the window is hidden), and closes it
on `reminders:dismiss`, outside working hours, or as soon as the engine
reports a state the id no longer matches. A resume question after an
interruption left `nothingTiming` minutes gets one more toast. The ids it
asked are kept in memory: a restart may ask an occurrence once more.

### `FirstRunService` — `src/main/services/`

The first run (S1–S3, P11a). `shouldShow` is true once: at the first launch
of an install with no Jira or OpenProject credentials and no worklog, and an
install that has either is marked done (`first_run_done`) without ever
seeing it. Test connection builds a fresh adapter from what was typed --
never the saved one, so a wrong token replaces nothing -- and reads
`getUserName` (`/myself`, `/api/v3/users/me`) then the projects. A failure is
the answer, never a throw: `auth` is *refused*, a DNS `ENOTFOUND` or a 404 on
the account is *not found*, any other transport failure is *network*, empty
fields are *incomplete* (`shared/first-run.ts` writes each out). The desk is
read from the driver's status, `%APPDATA%\Elgato\StreamDeck` and the deck
socket's client count. "Install the plugin" opens the `.streamDeckPlugin`
the installer carries in `resources/StreamDeck/` (`package:win` packs it
first). "make one ↗" is built by main from the provider and the host typed.

### `PresenceMonitor` and `ForgottenSessionService` — `src/main/services/`

Time is wall clock minus pauses, so a session forgotten on Friday read 62
hours on Monday and its stop sent them all at once. `PresenceMonitor` keeps
`last_user_presence_utc`: now less `powerMonitor.getSystemIdleTime()`,
written every minute when it moves on, on lock and suspend, at quit
(synchronously, before the database closes), and on a press on the bar.

`ForgottenSessionService` looks for a forgotten session at start, on resume
and unlock, every minute, and on a press on the bar -- reading the previous
presence before recording the new one. A session is forgotten when it is
running, the later of the previous presence and its start falls on an
earlier local day than today, that was at least `FORGOTTEN_MIN_GAP_MS` (two
hours) ago, the user is present now, and the Ceremonies setting is on.
Overtime never qualifies: input moves the presence on every minute. The
session is then paused at that instant (`pauseSessionAt`), the question is
stored as `forgotten_session_review` -- it survives a restart -- and sent
through the `PromptOutlet` (a toast while the window is hidden). Decide later
(S18, P10b) is the `later` action: it marks the stored question `deferred`,
so the window shows a card on Today instead of the dialog, and `ask` takes
the mark off and brings the dashboard forward -- the user's click. Neither
answers: the session stays paused and nothing is logged. The mini timer shows
the question in both states, with Answer. At start (`check({ atStart: true })`,
P10c) it also looks for a session the app was closed under the same day: a
running session whose last activity was `FORGOTTEN_MIN_GAP_MS` ago or more is
paused there and asked with `cause: 'closed'`, whoever is at the machine,
since nothing watched the presence meanwhile. The minute samples never ask
about a same-day gap: with the app running, that is a meeting. The service listens to the engine:
anything else done to the session answers the question. Its bar listener is prepended to
the driver's `input` event, ahead of `InputDecoder`'s, so a first press that
resumes the session does not hide that it was left running.

### `WindowsNotificationListenerService` — `src/main/services/`

Polls the Windows Action Center database via a PowerShell child process, and
mirrors notifications from apps you have allowed. App icons are resolved from
the MSIX manifest or a Start Menu shortcut and downscaled to 15×15
(`AppIconResolver`). An unpackaged app's shortcut is found by its AUMID in the
shell's `shell:AppsFolder`, and by file name only when the shell does not list
it.

**This is the reason the app is Windows-only in practice**, and its failures are
silent — a listener that never starts looks exactly like an app that never
notifies you. Notification text is redacted from logs and from the diagnostics
export unless you launch with `--debug-notifications`.

### `ProviderEventService` — `src/main/services/`

Polls the active provider's `getEventsSince` and tells the user what happened
on their tasks: a Windows toast through `ElectronToastPresenter`, and a banner
on the bar when there is one. It keeps a cursor per provider under
`provider_event_cursors`: the newest event time seen, **on the provider's
clock**. The first poll for a provider records "now" and shows nothing, so a
first launch does not replay the unread history; a failed poll leaves the
cursor where it was, so the next one picks up what it missed. Turning the
feature off forgets the cursors. More than three events in one poll become a
single summary toast pointing at the provider's inbox, and the bar gets one
banner per poll whatever the count.

The bar is reached from here, once, through `renderNotificationBanner` --
never by letting the Windows listener mirror the toast. The listener skips
the app's own AppUserModelIDs on both of its paths, and must: mirroring would
put each event on the bar twice and take the display lock twice. The
AppUserModelID itself (`app-identity.ts`) equals electron-builder's `appId`,
because Windows attributes a toast to the shortcut carrying that ID.

A toast's link is opened only if it is `http:` or `https:`: it comes from a
remote server, and `shell.openExternal` would as readily run a `file:` URL.

OpenProject has a notification feed and the adapter reads it. Jira Cloud has
none, so `JiraProvider.getEventsSince` rebuilds one from a search over the
issues the user is involved in, their changelog and their comments, and drops
everything the user did themselves (`Documentation/API.md` has the rules).
The service cannot tell the two apart, and does not need to.

### `WebhookServer` — `src/main/api/`

An HTTP server on `127.0.0.1:39123` for remote key presses. See the
[API reference](API.md#local-http-api) for routes and the screening rules.
WebSocket handshakes go through it too (`onUpgrade`), screened for an
`Origin` before any handler sees them.

### `DeckServer` and `DeckActionService` — `src/main/api/`, `src/main/services/`

The app's side of the Stream Deck plugin: a WebSocket at `/api/v1/deck` on
the same port, and the service behind it. The service reads the state the
keys show -- the session, the bar's screen icon, the prompt holding the bar
-- and pushes it only when it changes, so the deck does not hear the
engine's tick. It listens to the engine and the renderer's icon, and reads
again once a second while a deck is connected, because a prompt
taking the display has no event of its own.

Every action is something the app already does, called the same way: ending
a session is `completeSession` (`session-commands.ts`), shared with the
window's `COMPLETE_SESSION`; a prompt is answered by OK or BACK through
`InputDecoder.handleHardwareInput`, so the wrap-up's two presses and the
stand-up's switch stay where the bar's keys reach them; the picker is the
tray's `openTaskPickerInMainWindow`, with a `ForegroundRaiser` that gets the
window past Windows' foreground lock -- a key press reaches Stream Deck, not
the app, and `focus()` alone only flashes the taskbar. It never draws on the
bar itself. The protocol is in
`src/shared/deck-protocol.ts`; [API reference](API.md#the-stream-deck-socket).

---

## 4. Data

Everything lives in one SQLite file at
`%APPDATA%\SprintTicker\sprintticker.db`, for both `pnpm dev` and an installed
build. **Development therefore shares your real database** — a migration you are
testing runs against your actual worklogs.

### Schema

| Table | Holds |
| :--- | :--- |
| `projects` | Cached projects, with `provider_id`: the provider's own id, `sprintticker` for a project made in the app -- which the sync never deletes -- or `local`, the old default, meaning not known. Keys need not be unique |
| `tasks` | Cached tasks: `status` is `todo` / `in_progress` / `done`; `priority_rank` is 0 (most urgent) to 4, or NULL; `archived_at_utc` set on a task that left the lists but has worklogs; `description` is the start of the provider's, as plain text; `ownership` is `mine`, `unassigned` or `other`, with `assignee_name` on a teammate's (migration 12); `unsorted` is 1 on an interruption's ad-hoc task until it is named or its time moved (migration 13) |
| `active_sessions` | Every session — `TRACKING` / `PAUSED` / `COMPLETED`. At most one is open (`TRACKING` or `PAUSED`), by a partial unique index. `provider_id` is where its time goes, read from its project when it starts. `previous_task_id` is the task of the session `startTask` stopped to start it (migration 14). Recent tasks are read from here, with no table of their own |
| `task_stars` | Starred tasks, keyed by `provider_id` and `task_key` so a star survives the task being retired and fetched again under a new id; an ad-hoc task is keyed by its id under `adhoc`, since every ad-hoc task shows the same key. `task_id` is the row last seen (migration 14) |
| `paused_intervals` | Each pause, FK to the session, `ON DELETE CASCADE`; `reason` is `user`, `interruption`, `lunch` or `away` (migration 15) |
| `interruptions` | The interruption fragments (migration 15): span, `name`, `source`, the session it held (`interrupted_session_id`, `interrupted_was_paused`), the fragment before it in its run (`after_id`), and its fate -- `placed_task_id` and `placed_worklog_id`, `kept_off`, or `discarded_at_utc`. `legacy_worklog_id` names the worklog of an interruption of the model before. At most one has no end |
| `worklogs` | Local record of tracked time. Written even when the remote refuses it. `task_id` is a FK to `tasks` |
| `worklog_sync_queue` | Outbound worklogs: `PENDING` / `SYNCING` / `SYNCED` / `FAILED`, with backoff and `last_error`. Each row names the `worklog_id` it sends, its `operation` (`CREATE` today), and once sent the provider's `remote_worklog_id` |
| `settings` | Key/value, JSON: provider configuration, and the redesigned flows' settings -- the start's side effects, Done per project, the prompts' delays, the shortcuts, close to tray, the stand-up's task -- each read through a reader in `shared/flow-settings.ts` that answers a whole, valid value whatever is stored |

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
7. `task-description` — a nullable `description` on `tasks`, filled by the next
   sync.
8. `worklog-remote-identity` — ties each queue row to its worklog and keeps
   the id the provider gave the entry, so a worklog already sent can be
   corrected. Nothing linked the two, and the provider's answer was read for
   `success` and dropped. The identity lives on the queue rather than the
   worklog because deleting a worklog removes it locally at once while its
   remote deletion still has to name the entry. Existing rows are tied to
   the worklog written beside them -- same task, start and duration -- only
   where the match is one to one; nothing sent before it has a remote id.
9. `session-provider` — a session records the provider its task came from,
   and its time and status changes go there. They went to whichever provider
   was active when it ended, so switching provider mid-session sent a Jira
   issue's id to OpenProject, where a numeric id can name a different work
   package. An open session takes its project's provider; `local`, the
   column's default and what every OpenProject project held, counts as not
   known and keeps the old rule.
10. `project-key-not-unique` — rebuilds `projects` without `UNIQUE` on
    `key`. Nothing reads a project by its key, and a second project with the
    same one -- another provider's, one recreated under a new id, or one made
    here -- failed to save, and the repository only logged it.
11. `send-attempts` — each queue row counts the times it was claimed for
    sending, and the count never goes back down. A send whose answer was
    lost may have been recorded, so a row sent before is looked for by its
    marker before it is sent again; `retry_count` could not say so, since a
    correction and new credentials both reset it, and a crashed claim never
    raised it. Rows that show any sign of an attempt start at 1.
12. `task-ownership` — `tasks.ownership` and `assignee_name`: the sync keeps
    unassigned tasks and teammates' tasks in progress too. Every row before
    was the user's, so `mine` is both the default and the truth.
13. `task-unsorted` — `tasks.unsorted`, set on an interruption's ad-hoc task
    until it is named or its time moved.
14. `stars-and-previous-task` — `task_stars`, and
    `active_sessions.previous_task_id`. Older sessions have none, and
    "Previous task" falls back to the ended sessions themselves
    (`shared/previous-task.ts`): the most recent one whose task is not the
    current one and can still be offered -- listed, and named.
15. `interruptions` — the `interruptions` table and `paused_intervals.reason`.
    Every worklog of a task still `unsorted` becomes a fragment waiting to
    be placed, with `legacy_worklog_id` naming it; the ad-hoc tasks and
    their worklogs are kept, so nothing is lost before
    `db:check-migration` has said so.

**A migration is checked on a copy of real data before it ships.**
`pnpm db:check-migration` copies the database, migrates the copy and compares
counts either side (`db/migration-check.ts`): every worklog and every second
kept, apart from worklogs written for recovered sessions; every orphaned task id
given a task; at most one open session; no foreign key violation; no row of
the provider queue lost, no project lost. It also reports how many queued sends are tied to
their worklog. The rules
name no migration, so a new one is held to them unchanged. The tests prove the
migrations on invented data; this proves them on data nobody invented.

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
2. `TimeTrackingEngine.startTask()` writes `active_sessions`, with the
   provider the task's project came from, and asks that provider to move the
   issue to its configured in-progress status. A project made in the app has
   none: its time stays in local history.
3. The engine notifies subscribers → `DisplayRenderer` composes the tracker
   screen → `PriorityPreemptionEngine` scores it at `activeTrackerPriority`
   (45) and, if nothing outranks it, grants the display → `BusyBarDriver`
   uploads a PNG and draws it.
4. **A Slack notification arrives.** The listener matches it against your rules,
   the engine scores it at 65 or 70, and it preempts the tracker — unless you
   are at Lunch, whose rule sits above both.
5. **You finish.** The engine writes a local worklog, checks the session's
   provider's `minimumLoggableSeconds`, enqueues the row for that provider --
   not the one active now -- and wakes the worker.
6. The worker claims the row atomically, POSTs it, and marks it `SYNCED` — or
   parks it with the server's own message if the failure is permanent, or backs
   off if it is not. The first row a provider parks on refused credentials
   raises one toast (`onSendingStopped`), and no more until new credentials
   are saved or a send goes through.
7. The Sync Queue panel shows anything still in flight, with attempt count and
   next attempt time.

---

## 6. Stream Deck plugin

`packages/streamdeck-plugin` is a plugin for Elgato's Stream Deck app, built
on its SDK (`@elgato/streamdeck` 3) and bundled by Vite into one ESM file that
Stream Deck runs on its own Node 24. Elgato's app keeps the device; the plugin
only declares actions, which the user places on any key: Session, Interrupt
and the answer keys A, B and C -- five of a Mini's six keys. The answer keys
stand in for whichever end applies (`resolveKind`): A is yes while a prompt
holds the bar and Done otherwise, B no or Not done, and C Discard either way,
so the end that keeps nothing never moves. The five fixed actions they replaced
(Not done, Done, Discard, Yes, No) are still declared and still work, hidden
from Stream Deck's list (`VisibleInActionsList: false`), so a deck laid out
with them keeps its keys.

```
Stream Deck app ◄──► actions.ts (SDK) ──► DeckController ──► AppLink ◄──► ws://127.0.0.1:39123/api/v1/deck
                                             │   faces.ts: state ─► face, press ─► request
                                             └─► svg.ts: face ─► key image
```

- **What a key shows and what a press does are pure functions** of the
  app's last state (`faceFor`, `planPress` in `faces.ts`), so every kind is
  tested in every state without a device or the SDK. The SDK's classes in
  `actions.ts` pass events on and decide nothing.
- **The app pushes; the plugin ticks.** A state carries the session's
  elapsed time and when it was read, so the Session key redraws its clock
  each second from that alone, and only while a session runs. A key image
  is sent only when it differs from the last one sent.
- **A question is asked on the key that will answer it.** Discard, and Done
  on a task no longer the user's, arm on the first press and act on a second
  within four seconds; another task starting withdraws the question, and so
  does an answer key changing meaning.
- **An answer key ignores a press just after it changed meaning.** For
  `ANSWER_SETTLE_MS` (700 ms) after A or B turned from Done to yes, or back,
  a press only flashes the key: the stand-up's question arriving as a finger
  comes down on DONE would otherwise join the stand-up.
- **One key has a long press: Session.** Held `LONG_PRESS_MS` (500 ms), it
  opens the picker at once, without waiting for the key to come up; let go
  sooner, it pauses or resumes. It acts when the key comes up, every other
  key as it goes down. Never yes or no: an answer does not depend on how
  long a key is held.
- **The line to the app reconnects by itself** (1, 2, 5, then every 10 s),
  and every key turns grey and says offline until it is back. A hello with
  another protocol version keeps the line open but makes every key say
  update app.
- **A face has a tone**: `ready` (its glyph in colour), `idle` (grey,
  nothing to do) or `ask` (filled, waiting on the user). `renderFace` lays
  out the session, a filled key and the rest from that alone.
- **The Session key moves as the bar's icon does.** The renderer names the
  `.anim` beside the screen icon (`ScreenIconDTO.animation`), and
  `DeckIconMotions` reads that animation's frames once -- `decodePng`, a
  small decoder of the 8-bit PNGs in `Animations/` -- samples them at
  10 fps and keeps each pose once (`iconMotionFrom`). The state carries the
  poses and their order, never the file name; the plugin picks the pose of
  the moment from the wall clock (`deckIconPixels`) and redraws at the
  motion's rate, sending only what changed: about once a second for the
  stopwatch, ten times for an icon always in motion. A motion read after
  its icon pushes the state again; one that fails leaves the still icon.
- **A one-shot is frames, not an animated image.** `setImage` shows the
  first frame of a GIF, a WebP or an animated SVG (measured on Stream Deck
  Mobile), so `DeckController.play` sends six static images 100 ms apart,
  each drawn at a `progress` the renderer turns into a part-drawn stroke or
  a moved part. The state's redraws of that key wait for the end, and a key
  arming for a question stops it. A press on Done, Not done or Discard plays
  (`playsOnPress`), and so do Yes and No when a question arrives.
- **The build writes the manifest's images**: each key's default face is the
  plugin's own offline face, rendered at build time, so the two cannot
  disagree.

It imports only from `desktop-app/src/shared/`: the protocol is
`deck-protocol.ts`, one module for both sides.

---

## 7. Animation studio

`packages/anim-studio` is a development tool, not part of the app: nothing in it
ships, and the app never imports it. It produces the frame sets the app plays.

```
scene.json ──► renderFrame(scene, frame) ──► PNG sequence + meta.json ──► seq2anim ──► .anim, .v1.anim
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
  `Animations/<id>/<id>/`, prefers the `.anim` in the bar's format when present
  and streams the PNGs otherwise, so an exported scene plays without any change
  to the app. A compiled export writes one per format, each with that
  firmware's compiler, and the bar preview asks the bar its firmware first.
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

Vitest, 2789 tests across 134 files, in two projects: `main` in Node for
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

The animation studio has its own suite, 117 tests across 6 files, run by
`pnpm test` after the app's and on its own by `pnpm test:studio`. So has the
Stream Deck plugin, 238 tests across 8 files (`pnpm test:deck`), which also
runs its link against the app's real `DeckServer` over loopback.

What the suite structurally **cannot** see: application startup, IPC wiring, and
anything touching real hardware. Those need the app actually running — read its
console, not just its UI.
