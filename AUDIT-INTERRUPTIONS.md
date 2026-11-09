# Audit: start a timer at once, name or assign it afterwards

*2026-11-06. A dated snapshot, like `AUDIT.md`: the request, what the code
does today, the gaps, and a proposed design. Nothing here is implemented.*

## The request

From the user's manager: when someone interrupts him, he wants to **start a
new timer at once**, with as little friction as possible, and **name it or
assign it to a task afterwards**.

That breaks down into four needs:

1. **Start**: one gesture, from wherever his hand is, with no question asked.
2. **The work he was doing**: it must not swallow the interruption's time, and
   should come back when the interruption ends.
3. **Name later**: while it runs, or after it has ended.
4. **Assign later**: to a real task, whose provider must then receive the time.

## 1. What exists today

### 1.1 Ad-hoc sessions

An ad-hoc session is a session on a task row whose id starts `adhoc_`, filed
under the built-in `ADHOC` project.

| Fact | Where |
| :--- | :--- |
| A new ad-hoc task **requires a title**: `createAdHocTask` throws without one, and `startTask` refuses an empty id unless it has a title. | `src/main/db/repositories/task-repository.ts:249-264`, `src/main/engine/time-tracking-engine.ts:325-330` |
| Every ad-hoc row shares one key, the configured "ad-hoc key" (`MISC-1`). The bar shows the title instead, for that reason. | `task-repository.ts:249`, `src/main/hardware/display-renderer.ts:1208-1218` |
| The engine mints the row; the renderer sends an empty id and a title. | `time-tracking-engine.ts:351-367`, `src/renderer/components/TaskSelectionModal.tsx:116-120` |
| `startNamedAdHocTask` reuses the listed ad-hoc row with the same title (the stand-up uses it, so it does not make a row every morning). | `time-tracking-engine.ts:303-306`, `task-repository.ts:236-245` |
| Ad-hoc by its id as well as by the flag, everywhere it matters. | `src/main/db/id-generator.ts:47` |
| The session gets **no provider** (`provider_id` null). | `time-tracking-engine.ts:413` |
| **Ad-hoc time is never queued**: worklogs are written locally, split by day and pause like any session, and nothing is sent. | `time-tracking-engine.ts:915-922` |
| A renamed task is followed by the open session after each sync -- **except ad-hoc**, "named by the user, not the provider". | `time-tracking-engine.ts:97-123` |
| A `renameSessionTask` exists in the repository, used only by that follow. | `src/main/db/repositories/session-repository.ts:138-142` |

### 1.2 Renaming

**There is no way to rename an ad-hoc session or task, running or finished.**

- No IPC channel renames a session (`src/shared/ipc-channels.ts`).
- `tasks:update` (`ipc-handler-registry.ts:364-369`) would overwrite a task
  row, but nothing in the window calls it on an existing task: the Projects
  tab uses it only to *create* a task in the app's own projects
  (`ProjectTaskManagerView.tsx:185-206`).
- History shows a worklog's key and title by joining the task row
  (`worklog-repository.ts:50-59`), so renaming the ad-hoc task row would
  rename its history at once -- but there is no control for it.

### 1.3 Assigning to a task

**There is no way to move time from one task to another, ad-hoc or not.**

- A correction changes duration, start and comment only. The task is excluded
  on purpose: "Jira cannot move a worklog between issues"
  (`src/shared/worklog-correction.ts:15-20`, said again in the dialog,
  `EditWorklogModal.tsx:170`).
- `WorklogCorrectionService` handles a never-queued worklog (ad-hoc) by
  rewriting it locally and queuing nothing
  (`worklog-correction-service.ts:17`, `:58`). It has no operation that
  creates a *first* send for a worklog.
- A running ad-hoc session cannot be switched onto a task without ending it:
  `startTask` stops the current session first (next section).

### 1.4 The session that was running

- **Starting anything stops the running session**, logs it with the comment
  "Auto-completed due to new task start" and queues it -- and **nothing brings
  it back** (`time-tracking-engine.ts:332-335`,
  `src/shared/worklog-comments.ts:7`). The user has to pick it again.
- Only one session can be open: migration 6 (`one-open-session`) and the
  `db:check-migration` rule "at most one open session". Keeping the previous
  one paused underneath is not possible in the current model.
- **The stand-up already is an interruption**, and is the model to copy.
  `joinStandup` starts the "Daily Standup" ad-hoc task, stores the task it
  stopped as `standup_resume`, and when the stand-up's session ends -- STOP,
  FINISH or DROP -- restarts it, once, the same day, after every listener has
  heard of the end (`queueMicrotask`), asking first if the task has left the
  user's lists, and handing it to Lunch instead during lunch. Starting
  another task in between is the user's choice and cancels the restart.
  (`src/main/services/context-schedule-service.ts:264-291`, `:517-538`,
  `:546-579`; CLAUDE.md §5.)

### 1.5 Every surface, and what it costs today

"Interruption" below means: a task T is running, someone walks in, the user
wants a new timer.

| Surface | How a session starts there | Ad-hoc? | Cost of an interruption today |
| :--- | :--- | :--- | :--- |
| **Main window** | "Switch / New Task" on the hero card (`ActiveTaskHeroCard.tsx:131-137`) opens the two-step picker (`TaskSelectionModal.tsx`). The Projects tab has "Switch" per task (`ProjectTaskManagerView.tsx:439-452`). | Yes: "+ Create Custom / Ad-Hoc Task" (`TaskSelectionModal.tsx:208-224`), then a title, **required** (Start is disabled without one, `:330-341`). | 2 clicks + **typing a name** + Enter. T is stopped and not restarted. If the window is hidden, add the tray or the mini timer to reach it. |
| **Mini timer** | The list icon opens the *dashboard's* picker (`MiniBar.tsx:165-172`, `openTaskPicker`). | Through the dashboard picker only. | 1 click + the window's 2 clicks + typing + Enter. Nothing can be named in the mini timer. |
| **Tray** | "Trigger Task Selector Modal" opens the dashboard picker; "Start / Pause" with no session only shows the window (`tray-manager.ts:91-108`). | Through the dashboard picker only. | Right-click + 1 click + the window's path. |
| **BUSY Bar keys** | START with no session, or wheel click with no session, opens the bar's picker: project, then task (`input-decoder.ts:464-467`, `:503-511`, `:549-570`). **The picker opens only when nothing runs**; with a session, START pauses and the wheel click only raises the window. | Only an ad-hoc row that **already exists** (it is listed under the ad-hoc project). The bar has no text entry, so it cannot make a new one. | START (pause) -> turn to STOP (the paused menu starts on FINISH, `display-renderer.ts:502`), click -> START (picker) -> turn to the ad-hoc project, click -> turn to an existing ad-hoc row, click: **5 presses plus at least 3 turns**, with a name chosen in advance. T is not restarted. |
| **Stream Deck** | No key starts a session. Session pressed with nothing running, or held, brings the window forward with its picker (`deck-action-service.ts:179-181`). | Through the window only. | Session held + the window's path (mouse and keyboard). |
| **History / worklog correction** | -- | -- | Can change a worklog's duration, start and comment; **not its task, not an ad-hoc task's name** (`EditWorklogModal.tsx`, `worklog-correction.ts:15`). |

There is no global keyboard shortcut anywhere in the app (no
`globalShortcut`), and the bar's key bindings, though stored and rebindable
in main (`input-decoder.ts:63-70`, `:161-170`), have no editor in the window.

## 2. Gaps against the request

| Need | Gap |
| :--- | :--- |
| Start at once | Every path asks for a name or a choice from a list. The fastest is 2 clicks and typing, and only with the window in front. The bar and the deck cannot start new ad-hoc work at all. |
| The work in progress | It is stopped and never restarted. The stand-up's restart exists but is tied to the stand-up. |
| Name later | Impossible, running or finished. |
| Assign later | Impossible, running or finished. Ad-hoc time is kept locally forever. |

## 3. Proposed design

### 3.1 The concept: an interruption is an ad-hoc session the app names for now

One new action, **Interrupt**, available on every surface. It:

1. starts a new ad-hoc task, **always a new row**, titled with a placeholder
   the app chooses -- for instance `Interruption 14:32` -- so nothing is asked;
2. sets the running session aside the way the stand-up does: stops and logs
   it, and stores it to restart when the interruption ends;
3. marks the row as **to be sorted** until the user names it or assigns it.

The interruption then *is* an ordinary ad-hoc session: pause, stop, done,
discard, the bar's screens, Lunch, Away, the forgotten-session check and the
midnight split all work on it already, with no new rule.

**One rule in one place.** The interrupt-and-restart logic belongs in one
service, called by the window, the mini timer, the tray, the bar and the
deck. The natural home is the stand-up's: **extract `joinStandup`'s
switch-and-restart into a shared "set aside" mechanism** and make the
stand-up one caller of it (with its fixed title and reused row) and Interrupt
another (with a placeholder title and a new row). Otherwise there would be
two copies of "restart once, the same day, not over an open session, ask if
unlisted, hand to Lunch during lunch" -- the duplicated-constant hazard of
CLAUDE.md §3. `DeckActionService` and `InputDecoder` only call it.

**Options for the session that was running** (the user's decision):

| Option | For | Against |
| :--- | :--- | :--- |
| **A. Stop it and restart it afterwards** (the stand-up's model) -- *recommended* | No schema change; reuses tested code; T's time before and after the interruption becomes two worklogs, which is what happened. | T shows two entries for the day; a restart is a new session (new start time on the bar). |
| B. Keep it open and paused underneath | One session for T. | Breaks "one open session" (migration 6, `db:check-migration`), the bar, the deck and every listener assume one session; a stacked-session model is a large migration and a new source of display bugs. |
| C. Do nothing to it (just start the new one) | Simplest. | That is today's behaviour: T is stopped and forgotten. |

Restart behaviour to decide with A: automatic when the interruption ends (as
the stand-up), or a question on the screens ("Back to SCRUM-12?"). Automatic
matches the stand-up and costs no press; a question costs one press but
never restarts the wrong thing. An interruption started during an
interruption should keep the *first* restart target (the stand-up already
leaves a running stand-up alone).

> [!IMPORTANT]
> **Decided 2026-11-06: option A, with the restart asked.** When the
> interruption ends, the user is asked whether to go back to the task it
> stopped; nothing restarts on its own.

What the decision means for the build:

- **The question is the after-lunch one, extended.** `ResumePromptDTO.after`
  is `'lunch' | 'standup'` (`src/shared/dtos.ts:256`); it gains
  `'interruption'`. The bar's prompt (`RESUME_PROMPT_EVENT`, OK / BACK in
  `InputDecoder`), the Stream Deck's `resume` prompt with its Yes / No keys,
  and the window's dialog already answer it, so no surface gets a rule of its
  own. Today that question is asked only for a task that left the user's
  lists; for an interruption it is always asked.
- **The stand-up keeps its automatic restart.** Folding both into one
  set-aside mechanism means the restart's *policy* -- ask always, ask only
  when unlisted -- is a parameter of the caller, not a second copy of the
  rules (once, the same day, never over an open session, Lunch takes it over).
- **Ended by the wrap-up: no question.** The wrap-up stops the session
  (`ipc-handler-registry.ts:539-543`) and must drop any pending restart
  first; asking "back to SCRUM-12?" as the day closes is wrong either way.
  The stand-up's automatic restart appears to have the same hole -- the
  wrap-up does not clear `standup_resume`, so a stand-up running at wrap-up
  time would restart the task before it, overnight. Read from the code, not
  yet shown by a test; the scripted case comes first.
- **Ended by Discard, by Lunch, or by starting another task: no question.**
  Discard and another task are the user moving on; Lunch takes over the
  restart as it does for the stand-up.
- **The question waits like the others.** Unanswered, it holds its lock as
  the after-lunch question does; a session started meanwhile answers it no.

### 3.2 Naming later

- **While it runs**: a new engine method renames the open ad-hoc session --
  the task row's title and the session's copy (`renameSessionTask`) in one
  transaction, one notification, so one redraw of the bar (each redraw is two
  requests, CLAUDE.md §4). Ad-hoc only: a provider's task is named by the
  provider, and the open session copies its task's key and title (CLAUDE.md
  §7) -- which this keeps, since the row and the copy change together.
- **After it ended**: renaming the ad-hoc task row renames every worklog of
  it in History, since History reads the title from the row. Local only: ad-hoc
  time was never sent, so nothing goes through the queue.
- Naming clears the "to be sorted" mark. A name equal to an existing ad-hoc
  row's could merge into it (the stand-up's reuse) or stay separate; separate
  is simpler and loses nothing.

### 3.3 Assigning to a task later

This is the part with the most rules behind it.

**While it runs: retarget the open session in place.** A new engine method
points the open session at the chosen task: `task_id`, `project_id`, key and
title copied from the task row, `is_ad_hoc` cleared, and `provider_id` set to
the task's provider. The start time stays, so the whole interruption goes to
the task when it ends. Then the start's side effects for that task run as
`startTask` runs them -- In Progress only for the user's own listed task, the
claim of an unassigned one, nothing on a teammate's -- which means extracting
them from `startTask` rather than copying them. The empty ad-hoc row is
retired (`retireTasks` deletes an untouched row).

- *"A session's provider is fixed at start"*: the rule exists so the time does
  not follow whichever provider is active when it ends. An ad-hoc session has
  no provider; assigning is the moment it gets one, read from the task's
  project, and it is fixed from then on. That keeps the rule's purpose; it
  should be written into CLAUDE.md §7 as the one sanctioned exception.
- The open session then follows its task's renames like any other
  (`followTaskRename`), since it is no longer ad-hoc.

**After it ended: send its worklogs to the task, through the queue.** Ad-hoc
worklogs were never queued, so there is nothing to correct at the provider:
assigning them is a *first send*. A new operation on
`WorklogCorrectionService` (not a direct provider call, CLAUDE.md §7):

1. in one transaction, point each worklog of the ad-hoc row at the task
   (`worklogs.task_id`, a foreign key to `tasks` -- the task row exists, it was
   picked from a list), and enqueue a `CREATE` per worklog for the task's
   provider, as `finishSession` would have (`time-tracking-engine.ts:931-941`);
2. use the interruption's name as the worklog comment, so the provider shows
   what it was (the task's title is the task's);
3. refuse, or merge into a neighbour, a worklog shorter than the provider's
   minimum (`minimumLoggableSeconds`, Jira's minute) -- the same reason
   `mergeShortPieces` exists;
4. the pieces are already one per local day, so each lands on its day.

Every later correction of those worklogs then works unchanged: they have a
send, so `getSendOf` finds it and corrections queue behind it.

**Options for which worklogs can be reassigned** (the user's decision):

| Option | For | Against |
| :--- | :--- | :--- |
| **Only never-sent worklogs** (ad-hoc, interruptions) -- *recommended* | A first send; no remote state to undo; exactly the request. | A provider task's time stays where it was logged. |
| Any worklog, as DELETE on the old task + CREATE on the new | Fixes a session logged on the wrong task too. | Two remote writes that can half-succeed; time can move between providers; a DELETE of a sent entry in a closed timesheet week. A separate feature. |

> [!IMPORTANT]
> **Decided 2026-11-06: any worklog can be assigned to another task**, sent
> or not. The design below extends the never-sent case to the others.

**Moving a worklog, by how far its send got.** One operation,
`WorklogCorrectionService.reassign(worklogId, taskId)`, in one transaction
that also rewrites `worklogs.task_id`, so History shows the new task at once:

| The worklog's send | What is queued |
| :--- | :--- |
| None: ad-hoc, a project made here, too short, recovered | A `CREATE` for the new task's provider, if it has one and the duration reaches its minimum. Nothing to undo. |
| A `CREATE` queued and **never attempted** (`send_attempts = 0`) | That row is rewritten in place to the new task and provider; the old provider never hears of it. Its unsent corrections are folded in. |
| A `CREATE` attempted, claimed or delivered | A `DELETE` on the old task (its provider, its marker, as `remove` queues one today), then a new `CREATE` on the new task with its own marker. Unsent corrections of the old entry are dropped: the `DELETE` supersedes them. |

The third row is the half-success the earlier table warned about, and the
queue already orders it the safe way. `getPendingQueueItems` holds a row
until every earlier row on the same worklog is `SYNCED`
(`worklog-repository.ts:257-273`), so the `CREATE` waits for the `DELETE` to
arrive: **delete before create**. A move that stops half-way leaves the time
off both providers for a while -- the local worklog still has it, and the
sync panel shows the parked row -- and never on both, which is the double
billing §7 of CLAUDE.md exists to prevent. `getSendOf` takes the latest
`CREATE` (`:369-379`), so later corrections name the new entry. The
`DELETE` and the `CREATE` may be for different providers; each row carries
its own. **No migration**: `worklog_id`, `operation`, `origin_sync_id`,
`provider_id` and `task_id` are all there.

Traps to build against:

- **`correct` and `remove` must not drop the move's `DELETE`.** Both drop
  "unsent corrections of this worklog" by `worklog_id`
  (`worklog-correction-service.ts:62`, `:99`). After a move, the unsent
  `DELETE` of the *previous* entry is among them: deleting the worklog
  before the move arrived would drop it, then drop the new `CREATE`, and
  leave the old entry at the old provider for good. Scope those drops to the
  current send (`origin_sync_id = send.id`), and test it.
- **"Never attempted" is `send_attempts`, never `retry_count`.** See the
  finding below; a move that rewrites a row in place on the strength of
  `retry_count = 0` could rewrite one whose first attempt already landed.
- **The old provider may no longer be configured**, or may refuse the
  deletion: the `DELETE` parks and the `CREATE` waits behind it. Refuse the
  move up front when the old provider is not configured, rather than park it
  for the user to find later.
- **The sync state needs a word** for a worklog whose move is on its way;
  `correction-pending` would do, but History should say "moving".
- **The window's text changes**: "The task cannot change: a worklog is not
  moved between issues" (`EditWorklogModal.tsx:170`, `worklog-correction.ts:15`,
  `USER-GUIDE.md:304`) becomes how a move is done.
- **Moving time does not move the task's status**, on either task.

> [!WARNING]
> **Finding while reading the queue (2026-11-06): deleting a worklog after
> correcting it can leave its entry at the provider.** `remove` decides an
> unclaimed send was never attempted from `retry_count === 0`
> (`worklog-correction-service.ts:100`), but `rewriteUnsentSyncItem` -- every
> correction of an unsent row -- resets `retry_count` to 0
> (`worklog-repository.ts:409`), and CLAUDE.md §7 says `retry_count` is the
> retry budget, reset on purpose, and `send_attempts` the record of
> attempts. So: a send whose answer was lost (recorded at Jira, retry
> pending), then a correction, then a deletion -- the row is dropped as never
> attempted, no `DELETE` is queued, and the entry stays at the provider while
> the app has none. Read from the code, not yet shown by a test. Independent
> of this feature; a fix of its own.

Two more questions this raises:

- **A week already closed** (`last_week_closed`, `onWeekEnded`): assigning last
  week's interruption sends time into a week whose close has been acted on.
  Refuse it, or warn; anything hanging off `onWeekEnded` must not be surprised.
- **Done**: an interruption finished with Done marks the *ad-hoc* row done;
  assigning it later must not mark the real task done.

### 3.4 Surfaces

| Surface | Start | Name | Assign | Presses |
| :--- | :--- | :--- | :--- | :--- |
| **Main window** | An "Interrupt" button on the hero card, beside Switch / New Task. | The hero card's title is editable for an ad-hoc session. | "Assign to a task" opens the existing picker in an *assign* mode (same lists, same visibility and order). | 1 click to start. |
| **Global shortcut** (new, optional) | A configurable system-wide hotkey, off by default (conflicts with other apps are the user's to choose around). | -- | -- | 1 key chord, window hidden or not. |
| **Mini timer** | A lightning button in the row. | The title becomes an input on click; the row is 360 px wide, room enough. | Opens the dashboard picker in assign mode, as the list icon does today. | 1 click. |
| **Tray** | "Start an interruption" at the top of the menu. | -- | -- | Right-click + 1. |
| **BUSY Bar** | A new bindable action, `START_INTERRUPTION`. Where to put it is the user's decision: the **wheel click while a session runs** (today it only raises the window, `input-decoder.ts:503-511`) costs 1 press; a fourth choice in the paused menu (START, turns, click) costs 2 presses and some turns, and changes nothing existing. | Not on the bar: no text entry. | Not on the bar. | 1, or 2 plus turns. |
| **Stream Deck** | A new action, **Interrupt**, sending a new `interrupt` request that `DeckActionService` hands to the same service. No rule of its own (CLAUDE.md §3). | -- | -- | 1 press. |
| **History** | -- | Rename on an ad-hoc row. | "Assign to a task" on an ad-hoc row: all its worklogs, or one. A "to sort" badge on the unassigned ones. | -- |
| **End-of-day wrap-up** (optional) | -- | -- | Lists the day's unsorted interruptions before the day closes. | -- |

Notes per surface:

> [!IMPORTANT]
> **Decided 2026-11-06: on the bar, Interrupt is a fourth choice of the
> paused menu**, and **the Stream Deck plugin gets an Interrupt action.**
> The wheel click keeps its meaning.

- **Bar, the paused menu.** `PAUSED_CHOICES` (`display-renderer.ts:56`)
  becomes `INTERRUPT, STOP, FINISH, DISCARD`, Interrupt at the **left end**:
  the wheel stops at either end, so "turn left until it stops" reaches it
  blind, and DISCARD keeps the right end. The menu still opens on FINISH, so
  an interruption from a running task is START, two notches left (or more),
  click: 2 presses. The click hands the choice to the shared Interrupt
  service; `InputDecoder` keeps no rule of its own.
  - **The label does not fit beside STOP.** Row 1 is 55 px; measured in
    Sprint Small, `INTERRUPT` is 38 px with its bar, and with STOP (17), the
    3 px gap and the right arrow that is 62. Either `pausedChoicesShown`
    shows Interrupt **alone** when it is chosen (38 + arrow = 42, fits), or
    the label is short -- `NEW` (16) or `INTR` (18) beside STOP. Alone reads
    best; check it on the bar with the font sheet in mind, since legibility on
    the LEDs is not a unit test's call. With four choices the opening pair
    STOP / FINISH gains a left arrow: 4 + 17 + 3 + 26 + 4 = 54 of 55 px.
  - **Where the interruption starts.** At the click, not at the pause before
    it: a pause can be older than the interruption (paused for a coffee, then
    someone walked in), and backdating would give the interruption that time.
    The few seconds between START and the click stay off both.
  - **The pause screen tests and pictures change**: the menu's layout tests,
    `hardware-decoder` tests for the ends, and the paused screen in
    `pnpm docs:images`.
- **Bar, nothing running.** Not decided: the bar's picker could offer
  "+ Interruption" first. With no task to set aside it is only an unnamed
  ad-hoc start, which the picker cannot do today for want of text entry.
- **Stream Deck, the Interrupt action.** A seventh action
  (`io.github.istalry.sprintticker.interrupt`), acting as the key goes down
  like every key but Session, with no confirmation: nothing is lost -- the
  task is logged and its restart is asked. It sends a new `interrupt`
  request, added to `DECK_ACTIONS` (`shared/deck-protocol.ts:101`);
  `DeckActionService` hands it to the shared service. Which key it replaces
  on a six-key Mini is the user's layout in Elgato's app, not ours. The
  restart's question arrives as the existing `resume` prompt, so the Yes and
  No keys answer it with no change. Ships as a plugin release: raise the
  version (manifest and `package.json`, held equal by `package.test.ts`),
  draw its face in `faces.ts` with a test for each state, and run
  `pnpm deck:validate`.

> [!IMPORTANT]
> **Decided 2026-11-06: a global keyboard shortcut for Interrupt, off by
> default.**

- **Global shortcut.** Electron's `globalShortcut`, behind a small service
  in main that takes it by constructor (tests register nothing on the
  developer's machine, CLAUDE.md §6) and calls the shared Interrupt service.
  - **Off until the user turns it on** in Settings, where they also record
    the chord. A suggested chord should avoid `Ctrl+Alt` alone: on AZERTY and
    other layouts it is AltGr, which types characters. `Ctrl+Alt+Shift+I` is
    a candidate.
  - **Registration can fail** -- `register` answers false when another app
    holds the chord -- and Settings must say so rather than show it on.
    Windows also delivers nothing while an elevated window has the focus;
    worth a line in the User Guide.
  - **The press must show something** when the window is hidden and no bar is
    connected: the mini timer if it is open, otherwise a toast ("Interruption
    started -- SCRUM-12 logged"), through the app's own toast path so it is
    not mirrored to the bar twice (CLAUDE.md §5).
  - Unregistered at quit, synchronously (`will-quit` handlers are not
    awaited, CLAUDE.md §6), and re-registered when the chord changes.
  - New IPC to read and set it: `Documentation/API.md`, the preload, the
    bridge's type and the renderer test mock.

- **Bar**: the interruption's screen is the session screen with its
  placeholder title; no new lock, no new priority rule, nothing for the
  priority engine. The bar's picker could also offer "+ Interruption" first
  when nothing runs.
- **Stream Deck**: the Mini has six keys and the six actions fill it, so
  Interrupt replaces one there (Discard is the rarest). Adding an action means
  a new face in `faces.ts`, the manifest, `package.test.ts`, and a **version
  bump of the plugin** (a pack installs only over an older version). An older
  app answers an unknown action `invalid-request`, which the key shows; that
  is acceptable without raising `DECK_PROTOCOL_VERSION`, since nothing an old
  plugin sends changes meaning.
- **Unity plugin**: not concerned.

### 3.5 What needs a migration

| Change | Migration? |
| :--- | :--- |
| Interrupt and its restart | **No**: a setting holds the set-aside session, as `standup_resume` does. If the stand-up's key is folded into a shared one, read the old key once. |
| Rename while running or after | **No**: `tasks.title`, `active_sessions.task_title` exist. |
| Assign while running | **No**: every column exists (`provider_id` since migration 9). |
| Assign after ending | **No** for the data: `worklogs.task_id` and the queue's columns exist. |
| Move a sent worklog (delete, then create) | **No**: the queue's `operation`, `origin_sync_id` and per-row provider already express it. |
| "To be sorted" mark | **Yes, if it is a column** -- e.g. migration 13, `tasks.unsorted INTEGER NOT NULL DEFAULT 0` -- so History, the wrap-up and a badge can find interruptions without guessing from a title. The alternative is a reserved key or title pattern, which is a meaning hidden in a string. Recommended: the column, checked with `pnpm db:check-migration` on a copy of the real database, run by the user from an ordinary terminal. |

> [!IMPORTANT]
> **Decided 2026-11-06: migration 13 adds the "to be sorted" mark.**

- `ALTER TABLE tasks ADD COLUMN unsorted INTEGER NOT NULL DEFAULT 0`: every
  existing row is sorted, nothing is rewritten. Still the next free number
  on 2026-11-06 (the last is 12, `task-ownership`); check again before
  writing it, in case another change took 13.
- Set to 1 on the row Interrupt creates, and only there. Cleared by naming
  the row, or by assigning its time to a task -- which leaves the row with no
  worklog, so `retireTasks` deletes it.
- Read by History (a badge, and a filter for the unsorted) and by the
  end-of-day wrap-up ("2 interruptions to sort, 35 min").
- Checked like every migration (CLAUDE.md §7): the user runs
  `pnpm db:check-migration` on a copy of the real database, from an ordinary
  terminal, and pastes the output. An added column with a default loses
  nothing, so no new rule in `migration-check.ts` should be needed; the run
  still has to say so.

### 3.6 Alternative considered: split a session after the fact

Instead of starting anything, the user keeps T running and later, in History,
cuts "14:10 to 14:35 was something else" out of it. Zero presses at the
moment of the interruption, which is the request's spirit; but it relies on
remembering times, and T's worklog is usually already sent by then, so the
cut is an UPDATE on T plus a CREATE elsewhere -- the two-remote-writes problem
of 3.3. A one-press "mark" (record the instant, keep T running) softens the
memory problem but not the second. Worth keeping in mind, not first.

## 4. Risks and what to test

- **The restart path is where the stand-up's bugs were**: a restart from inside
  an engine listener (`queueMicrotask`), Lunch during the interruption, Away
  over it, a forgotten night across it, a banner holding the display when it
  ends. Each needs a scripted case on the `Desk` (`display-handback.test.ts`),
  and the stress generator should gain Interrupt as an event.
- **One evaluate, one render**: Interrupt must render once (start the new
  session, which draws), never "stop, draw LOGGED, start, draw".
- **Retargeting a running session** must re-notify every listener once
  (the deck's state, the bar, the window), and the sync's `protectTasks` must
  then protect the new task id.
- **Assigning after the fact**: the failure branches -- the task gone, the
  provider not configured, below the minimum, the week closed -- each need a
  test where they happen (CLAUDE.md §6).
- **Bridge**: new IPC channels (start an interruption, rename the session,
  assign the session, assign worklogs) go in `electron-api.d.ts`, the preload,
  and the renderer test mock.

## 5. Documentation the change will touch

`Documentation/USER-GUIDE.md` (the feature on every surface),
`Documentation/API.md` (IPC channels, the deck action),
`Documentation/ARCHITECTURE.md` (the set-aside mechanism, assigning through
the queue, migration 13), `README.md`, `CHANGELOG.md` § Unreleased,
`ROADMAP.md`, and CLAUDE.md §5 and §7 (the shared restart, the provider fixed
at assignment, never-sent worklogs only).

## 6. Decisions for the user

1. ~~The session that was running~~ -- **decided 2026-11-06: stop it, and ask
   to restart it when the interruption ends** (section 3.1).
2. ~~Which worklogs may be assigned later~~ -- **decided 2026-11-06: any
   worklog**, by delete-then-create through the queue (section 3.3).
3. ~~The bar~~ -- **decided 2026-11-06: a fourth choice of the paused menu**,
   at its left end (section 3.4). Its label -- `INTERRUPT` shown alone, or a
   short `NEW` -- is to be checked on the bar.
4. ~~The Stream Deck~~ -- **decided 2026-11-06: a new Interrupt action**
   (section 3.4).
5. ~~A global keyboard shortcut~~ -- **decided 2026-11-06: yes, off by
   default**, the chord recorded by the user (section 3.4).
6. ~~The "to be sorted" mark~~ -- **decided 2026-11-06: migration 13**
   (section 3.5).

All six are decided.

## 7. Proposed build order

Each step lands working and documented on its own, so a step can ship
before the next (CLAUDE.md §6: the working path is not removed in the
commit that adds the new one).

1. **The wrap-up and the stand-up's restart.** A scripted case showing
   whether a stand-up running at wrap-up restarts the task before it; the fix
   if it does. It is the ground the next step stands on.
2. **The shared set-aside**, extracted from the stand-up with the restart
   policy as a parameter; the stand-up's tests unchanged and green.
3. **Interrupt** in the window, the mini timer and the tray, with the asked
   restart (`ResumePromptDTO.after = 'interruption'`), and **migration 13**.
4. **Naming and assigning while it runs**: rename, retarget the open session.
5. **Moving worklogs**, ad-hoc and sent, through the queue -- after the
   `retry_count` fix (section 3.3's finding) has landed, since a move
   decides "never attempted" the same way.
6. **History and the wrap-up**: rename, move, the unsorted badge and list.
7. **The bar's paused menu**, its label checked on the device.
8. **The Stream Deck action**, as a plugin release.
9. **The global shortcut.**
