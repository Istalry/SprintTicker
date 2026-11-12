# API reference

The four API surfaces in this project:

1. [IPC channels](#ipc-channels) — renderer ↔ main
2. [Local HTTP API](#local-http-api) — remote key presses and the Stream Deck → main
3. [`ITaskProvider`](#itaskprovider) — the contract a task provider implements
4. [The BUSY Bar device contract](#the-busy-bar-device-contract) — main → hardware

Source of truth for each is named at the top of its section. Where this file and
the code disagree, the code is right — tell us so it can be fixed here.

---

## IPC channels

**Source:** `src/shared/ipc-channels.ts`, `src/preload/electron-api.d.ts`

The renderer never touches Electron or Node directly. Every call goes through
`window.electronAPI`, whose shape is `IElectronAPI`. That annotation on the
bridge object is load-bearing: it turns preload/renderer drift into a compile
error rather than an undefined at runtime.

Channels named `ON_*` are main → renderer events, subscribed with a callback.
Everything else is a request/response `invoke`.

### Session and timer

| Channel | Purpose |
| :--- | :--- |
| `session:get-current` | The live session, or `null` |
| `session:start-task` | Start tracking a task |
| `session:move-to` | `(taskId)`. "↳ Move my 1h 24m…" (S5b): stops the open session as a switch does, moves each of its entries to the task as `worklogs:move` does, and starts that task; answers the new session. Refused before anything stops for an interruption, ad-hoc work, the same task, or less time than the new provider records; a move refused after the stop still starts the task and rejects with the reason |
| `session:rename` | Name the open ad-hoc session, and its task (so History follows): a string, trimmed, at most 120 characters (`checkAdHocTitle`). Clears the task's unsorted mark. Refused for a provider's task, which keeps the provider's name. Answers the session |
| `session:assign` | Assign the open ad-hoc session to a task, by id, in place: the session keeps its start and pauses, takes the task's project, key and title, and gets the task's provider -- ad-hoc work had none. The task is taken up as a start takes it up (In Progress, or claimed when nobody has it); the ad-hoc row is retired. Refused for a provider task's session, an ad-hoc target, or an unknown task. Answers the session |
| `mini:open-assign-picker` | Open the picker window (`#picker?mode=assign`) to choose the task the open ad-hoc session goes to. Answers whether a picker opened: when the window cannot be made, the dashboard's picker opens instead, and `false` means there was no dashboard either |
| `mini:open-place-picker` | The mini timer's ↳ (P12d): open the picker window (`#picker?mode=place`) to choose the task the running interruption's time goes to (`interruption:choose-task`); the timer runs on. Without the picker window, the dashboard opens on Today, whose interruption card asks the same |
| `schedule:get-standup-running` | The stand-up, when it is the session open, and the key of the task set aside for it (`{ returnsToKey }`, null when nothing was timing), or `null` (P12d) |
| `schedule:get-working-now` | Whether it is working hours now -- WORK, a working day, from the stand-up to the wrap-up, the reminders' rule -- for the mini timer's loud "Nothing timing" (P12d) |
| `session:start-interruption` | Kept for one release as an alias of `interruption:start` |
| `interruption:start` | Interrupt: `{ source?, startedAtUtc? }`, `source` one of `window`, `mini`, `tray`, `bar`, `deck`, `shortcut`, `notification` (anything else is `window`). Holds the session open -- paused with reason `interruption`, nothing logged or sent -- and starts a fragment; during one it is Another. Through `ContextScheduleService.interrupt`. Answers the session view: while a fragment runs, the fragment as an ad-hoc session with `interruption` set |
| `interruption:another` | Ends the fragment running and starts the next, holding the same session |
| `interruption:back` | `(addGapMinutes?)`: ends the fragment and resumes the held session, its pause ended that many minutes earlier; one paused before stays paused |
| `interruption:stop` | Ends the fragment alone, with ten seconds to undo; the held session stays paused and "Back to MG-12?" is asked |
| `interruption:switch` | `(taskId, takeAlong)`: ends the fragment, stops the held session, starts `taskId`; with `takeAlong` the fragment is placed on it |
| `interruption:discard` | `(id?)`: the running fragment, or one waiting; ten seconds to undo |
| `interruption:rename` | `(id, name)`: names a fragment, running or waiting; `checkAdHocTitle` rules |
| `interruption:move-start` | `(atUtc)`: the running fragment began then (S9's "started 5 min ago"), held between what it takes its minutes from -- the held session's start and last pause, the fragment before it in the run -- and now; over a running task the task's pause moves with it. Answers the session |
| `interruption:choose-task` | `(taskId \| null)`: where the running fragment's time goes when it ends -- placed there at Back, Stop, Another or a switch, never at a discard; null is Later. Kept in memory: after a restart it waits to be placed. The choice is `interruption.chosenTask` on the session |
| `interruption:place` / `interruption:place-many` | `(id, taskId)` / `(ids, taskId)`: a worklog of each fragment's span on the task, queued with the hold; an interruption of the model before has its worklog moved. Refused for one not waiting. Ten seconds to undo |
| `interruption:keep-off` | `(id)`: keeps it off the provider, as a local ad-hoc worklog |
| `interruption:get-to-place` | Every fragment that ended and waits, any day, oldest first: `{ id, name, title, startedAtUtc, endedAtUtc, durationSeconds, source, interruptedTaskKey, index, ofRun }` |
| `interruption:on-updated` | Pushes that list whenever one ends, is placed, kept off or discarded, from any surface |
| `session:pause` / `session:resume` | Pause and resume |
| `session:complete` | Stop, write a worklog, optionally mark the task done. When a session was stopped, the bar plays DONE! (marked done) or LOGGED (not). Its sends and its Done transition wait the undo window (ten seconds) |
| `session:get-current` / `session:on-updated` carry `taskUnlisted: true` | The tracked task is no longer the user's: the provider stopped listing it at the last sync (reassigned, closed, moved), or lists it as a teammate's. The sync keeps the task until the session ends; finishing it as done asks the user first |
| ... and `taskLeftBecause` | Why, once the provider has said: `closed` (done there -- finishing it asks nothing and sends no transition), `reassigned` (still open, out of the user's scope) or `gone` (deleted, or no longer visible). Absent while unknown |
| ... and `taskOwnerName` | Who the task is assigned to, when it is someone else's -- reassigned, started as a teammate's, or taken by someone between the pick and the start. The window says "Assigned to" that name |
| `sync:get-health` | How the provider's sync is going: `{ state: 'ok' \| 'first-sync' \| 'unreachable' \| 'refused' \| 'not-configured' \| 'unknown', providerId, sinceUtc, lastSyncedAtUtc, progress: { done, total } \| null }` |
| `sync:on-health` | Pushes it on every change: each project of a first sync, a failure, a recovery |
| `notices:get` | Today's one-time notices: `{ updatedTo: string \| null, noAccountDismissed }` |
| `notices:dismiss` | `'updated' \| 'no-account'`: put away for good; answers the notices |
| `window:on-open-route` | Push, main to the window: open on a place (`shared/window-route.ts`) -- `'today'`, `'end-day'` (the tray's End my day…, P12a), `'undo'` and `'account'` (a toast's click, P12c). The window goes to Today, or Settings › Account for `account`; `end-day` opens End my day as the header's button does, `undo` focuses the Undo bar's button |
| `worklogs:get-refused` | The worklogs whose send the provider refused for good (`syncState: 'refused'`), oldest first: Today's refused card (P11c) |
| `worklogs:keep-off` | `(worklogId)`. Keeps a refused entry off its provider: its send is dropped and the worklog stays here as local time, undoable. Rejects for an entry whose send was not refused -- keeping that off would be a deletion |
| `first-run:should-show` | True once, at the first launch of an install never set up; an install with credentials or a worklog is marked done instead |
| `first-run:finish` | Start my first task, or Set up later: it does not open on its own again |
| `first-run:test-connection` | `{ providerId: 'jira' \| 'openproject', site, email?, token }`, saving nothing: `{ ok: true, userName, projectCount }` or `{ ok: false, reason: 'incomplete' \| 'not-found' \| 'refused' \| 'network' \| 'failed', host, detail }` -- never throws for the remote's failure |
| `first-run:detect-desk` | `{ bar: { found, address, connectionType }, deck: { installed, connected } }` |
| `first-run:install-deck-plugin` | Opens the `.streamDeckPlugin` the installer carries; false when this build has none |
| `first-run:open-token-page` | `(providerId, site)`: opens Atlassian's token page, or `/my/access_tokens` on the OpenProject host typed; main builds the URL |
| `session:get-forgotten-review` | The session left running across a change of day, paused at the last activity and awaiting an answer: `{ sessionId, taskKey, taskTitle, startTimeUtc, lastPresenceUtc, endOfDayUtc, pauses, taskUnlisted, deferred }`, or null; `deferred` after Decide later, `cause` `overnight` or `closed` (SprintTicker closed under it the same day) |
| `session:resolve-forgotten` | Answers it with `{ action, endUtc? }`: `stop` or `restart` log up to `endUtc` (between the start and now, required), `discard` keeps nothing, `keep` counts the whole absence and runs on. `later` and `ask` answer nothing: they defer the question to Today's card and the mini timer and bring it back, `ask` also bringing the dashboard forward. An unknown action or an end outside the session throws; answers `false` when nothing is asked any more |
| `session:on-forgotten-review` | Pushes the question when it is found, and null once anything answers it -- the window, the bar's STOP, a resume |
| `session:get-previous` | The task to switch back to, or null: the task the open session replaced, else the most recent ended session's task that is not the current one -- in either case only one still listed and named (`shared/previous-task.ts`) |
| `session:get-days` | The open session's time per local day were it stopped now, `{ dateKey, seconds }[]`: one entry unless it crosses midnight. The finish dialog says how it will be filed |
| `session:discard` | End the session keeping nothing: no worklog, nothing queued, the task's status untouched, no scene on the bar. Answers `{ success, discardedSeconds }`. Every caller confirms with the user first. Undoable for ten seconds, as a stop is |
| `undo:get` | The last action Undo can take back -- `{ kind, label, expiresAtUtc }`, `kind` one of `stop`, `discard`, `correct`, `move`, `delete`, `end-day` -- or null |
| `undo:run` | Takes it back: a stop or discard reopens the session as it was, an edit puts the worklog and its queue rows back. `false` when its ten seconds are over, a row was sent meanwhile, or (for a stop) another session runs |
| `undo:on-changed` | **Event** -- an action was offered, undone or became final |
| `flow-settings:get` | A setting of the redesigned flows (`shared/flow-settings.ts`: `start_side_effects`, `done_state_by_project`, `prompt_delays`, `shortcuts`, `close_to_tray`, `standup_task`, `provider_display_name`, `first_interruption_seen`), read through its reader -- whole and valid, the default when unset. Another key throws |
| `flow-settings:save` | Stores one, made whole and valid by the same reader, and answers what was stored |
| `session:on-updated` | **Event** — the session changed |

### Providers, projects and tasks

| Channel | Purpose |
| :--- | :--- |
| `provider:get-all` | Current provider settings, and the providers to choose from, each under the name the app writes for it (`providerDisplayName`) |
| `provider:get-capabilities` | What the active provider can do: `ProviderCapabilitiesDTO` (`canAssign`, `canTransition`, `canFindWorklog`, `canFetchByKey`, `hasHolidays`), read off the adapter's optional methods. A control for something it cannot do is hidden, never greyed. With no providers wired, every capability is false |
| `provider:set-active` | Persist settings, reinitialise providers, start a sync. Takes a **partial** `ProviderSettingsUpdateDTO`, so unrelated providers' credentials are left alone |
| `provider:get-projects` / `provider:get-tasks` | Read the local cache. Each project carries its tasks neither done nor archived, counted per owner: `openTaskCount` (the user's), `openUnassignedCount`, `openOthersCount`. `provider:get-tasks` answers every owner's tasks, each with its `ownership`; the views filter them by the task visibility |
| `provider:create-adhoc` | A local task with no ticket. Its key is the configured ad-hoc key (`fallback_ticket_key`, `MISC-1` by default); its time is never queued for a provider |
| `provider:fetch-op-statuses` | OpenProject status list, for the settings form |
| `provider:sync-now` | Fetch projects and tasks immediately |
| `provider:get-sync-queue` | Everything undelivered, with attempt counts and the server's own message. Each row's `operation` says what it asks: `CREATE` a worklog, `UPDATE` or `DELETE` one already sent |
| `provider:retry-failed-worklogs` | Un-park `FAILED` rows |
| `projects:on-updated` | **Event** — the cached project list changed: after every committed sync, the periodic one included, and after a manual or credentials-triggered one that failed, carrying its result |
| `projects:get-only-with-tasks` / `projects:set-only-with-tasks` | The "only projects with tasks" switch, on by default. The setter takes a boolean and throws `ArgumentException` on anything else |
| `projects:on-only-with-tasks` | **Event** — the switch changed, so every view showing it follows |
| `tasks:get-visibility` / `tasks:set-visibility` | Whether the task lists show unassigned tasks and teammates' tasks: `{ unassigned, others }`, `{ true, false }` by default. The setter takes exactly two booleans and throws `ArgumentException` on anything else; a damaged stored value reads its missing fields as their defaults |
| `tasks:on-visibility` | **Event** — the task visibility changed, so every list follows |

> `provider:reconcile` was removed. It was declared on the bridge with no
> handler in main, so calling it rejected. The providers keep their
> `reconcileRemoteState` methods; the channel comes back the day a UI needs a
> server-side day total, together with its handler.

### Projects, tasks and worklogs (local)

`projects:create`, `projects:rename`, `projects:delete`, `tasks:delete`,
`tasks:update`, `tasks:import`, `worklogs:get-by-date`,
`worklogs:get-daily-summary`, `worklog:get-todays`, `db:wipe-all-data`, and the
`worklog:on-updated` event.

A worklog read carries `adHoc: true` when it was logged on ad-hoc work, and
`unsorted: true` when that work is an interruption not yet named or assigned
(migration 13); a daily summary's items carry `unsorted` too.

| Channel | Does |
| :--- | :--- |
| `tasks:star` | `(taskId)`: stars a task, kept by its provider and key, so the star outlives the row (an ad-hoc task by its id). Answers the starred list. Throws for no id or an unknown task |
| `tasks:unstar` | `(taskId)`: takes the star off; nothing for a task never starred. Answers the starred list |
| `tasks:get-starred` | The starred tasks the lists hold now, most recently starred first. A star whose task is retired stays, and comes back with the task |
| `tasks:get-recent` | The last six tasks timed, each once, the most recently started first -- read from the sessions. Retired tasks and interruptions not named yet are left out |
| `tasks:get-picker` | Everything the task picker lists, in one read: `{ previous, recent, starred, tasks, projects, projectSeconds }`. `tasks` is every task the lists hold, whoever's and across projects, without ad-hoc work or archived tasks; `projectSeconds` is the time logged per project over the last 30 days, which orders "most used" |
| `tasks:fetch-by-key` | `(key)`: one task by the key the user typed, from the active provider (`getTaskByKey`), kept like a synced task and answered; null when the provider has none. Refused when the provider names a project SprintTicker does not list, and when there is no key |
| `worklogs:get-unsorted` | Every worklog of an ad-hoc task still marked unsorted, whatever its day. Since migration 15 such worklogs are interruptions to place, read through `interruption:get-to-place` |
| `tasks:rename-ad-hoc` | `(taskId, title)`: names ad-hoc work after the fact -- the task row, so every worklog of it reads the new name -- and clears its unsorted mark. Local only, nothing is queued. The open session's own task is renamed as `session:rename` renames it, its copy included. Refused for a provider's task, an unknown one, or a title `checkAdHocTitle` refuses |

`projects:delete` and `tasks:delete` delete a task only if no time was logged
against it; one with worklogs is archived -- off every list, still in history.

`tasks:open-page` takes a task id and opens the task's page on the provider it
came from, in the browser: Jira's `<site>/browse/<KEY>`, OpenProject's
`<site>/work_packages/<id>`. Main builds the URL from the provider's own
configured site (`getTaskPageUrl`), opens it through `shell.openExternal` only
if it is http(s) on that site, and answers `false` for a task with no page --
ad-hoc work, the app's own projects, a provider not set up. The renderer
never hands main a URL. Each worklog carries `hasTaskPage`, so History
knows where to offer it.
Worklogs come back with `taskKey` and `taskTitle` beside `taskId`, read from
the task row, archived or not, and with `syncState`: `local` (never queued),
`pending`, `failed`, `refused` (P11c: the provider turned the send down for
good, with its answer verbatim in `refusal`), `sent`, `correction-pending` or
`correction-failed`.
`fromInterruption: true` marks the worklog of an interruption placed on its
task (or kept off the provider), which Today marks ⚡.

| Channel | Purpose |
| :--- | :--- |
| `worklog:update` | `(worklogId, { durationSeconds, startedAtUtc, comment })`. Rewrites the worklog here at once and queues the change for its provider; answers the worklog as it now stands and resends `worklog:on-updated`. Rejects with the reason, as a sentence, when the correction is refused: under a second, under the provider's floor (Jira: a minute) for a worklog it holds, ending in the future, or a comment over `WORKLOG_COMMENT_MAX_CHARS` (1000). Not the task: that is `worklogs:move` |
| `worklog:delete` | `(worklogId)`. Deletes the worklog here at once and queues its deletion at the provider; answers `true` |
| `worklogs:get-range` | `(from, to)`: local days `YYYY-MM-DD`, both included, `from` not after `to`. The worklogs begun on them, oldest first, each with `projectId`, `projectName` and `providerSeconds` -- what its provider holds by the last send it answered (absent when it holds nothing; the old value while a correction waits). History's week (S15) |
| `worklogs:get-week-changes` | `(day)`: any local day `YYYY-MM-DD` of the week. Null while the week is open; once it is closed (`last_week_closed`), the sends queued for time begun in it since it closed -- the wrap-up of its last working day (`ContextScheduleService.weekClosedAt`) -- as `WeekChangeDTO` (`operation`, `taskKey`, `startedAtUtc`, `durationSeconds`, `queuedAtUtc`, `state`: `waiting`, `sent` or `failed`), oldest first. Check my week (S15b) |
| `worklogs:export-csv` | `(from, to)`, as `worklogs:get-range`. Asks where to save (`sprintticker-<from>-to-<to>.csv`) and writes those worklogs as CSV (`shared/worklog-csv.ts`: Date, Start, End, Duration, Hours, Project, Task, Title, Note, Sent; local times; RFC 4180 quoting; a cell starting `=`, `+`, `-` or `@` gets a leading `'`). Answers the path, or null when cancelled |
| `worklog:split` | `(worklogId, atUtc, taskId)`. Split in two (S16c, `WorklogCorrectionService.split`): the worklog shortened to end at `atUtc` -- a correction, through the queue -- and the rest a new worklog on `taskId`, from the same session and with the same note, whose first send waits for the shortening (`origin_sync_id` on its `CREATE`). Undo for ten seconds (`Split MG-12 · 2h 00m`) puts the entry back whole. Answers `{ first, second }` and resends `worklog:on-updated`. Rejects with the reason: a moment not inside the entry (`splitPieces`), ad-hoc work or an unknown task, or a piece under its provider's floor |
| `worklog:create-manual` | `(ManualWorklogDTO: { taskId, durationSeconds, startedAtUtc, comment })`. Adds time nobody timed (S16b, `WorklogCorrectionService.add`): a worklog here, under a session id of its own (`manual_…`), and a first send to the task's provider through the queue, held for the undo window with Undo (`Added to PF-31 · 30m`). A project made in SprintTicker keeps it here; an empty note is sent as `Added in SprintTicker`. Answers the worklog and resends `worklog:on-updated`. Rejects with the reason (`checkManualWorklog`): no task, ad-hoc work or an unknown task, under the provider's floor, ending in the future, or across local midnight. An overlap or a closed week is never refused -- the window warns, and the queue holds the later entry |
| `worklogs:move` | `(worklogId, taskId)`. Moves the worklog to another task (`WorklogCorrectionService.reassign`): here at once, and through the queue as a `DELETE` where it is then a `CREATE` on the new task's provider -- or the unsent send pointed there, when it was never attempted or was refused. An ad-hoc worklog takes its task's name as its comment. Answers the worklog as it now stands. Rejects with the reason: an ad-hoc, unknown or same task; shorter than the new provider records; or an entry at a provider that cannot be corrected from here |

The rules are `checkWorklogCorrection` in `src/shared/worklog-correction.ts`,
which the window applies too, so it refuses exactly what main refuses.

### Hardware input

| Channel | Purpose |
| :--- | :--- |
| `input:get-bindings` / `input:save-bindings` | The rebindable control map |
| `input:inject-remote-key` | Simulate a physical key |
| `input:on-hardware-event` | **Event** — a physical control was used |

### Priority and display

| Channel | Purpose |
| :--- | :--- |
| `priority:get-rules` / `priority:save-rules` | The scoring table |
| `priority:set-user-mode` / `priority:get-user-mode` | `WORK` / `LUNCH` / `AWAY` |
| `priority:on-user-mode-updated` | **Event** |
| `display:get-state` | Current frame, for the emulator |
| `display:on-state-updated` | **Event** |
| `display:get-screen-icon` | The icon of the screen on the bar, for the mini timer: `{ pixels, label, animation? }`, a 16x16 bitmap, the screen's top row or scene title, and the `.anim` the bar plays over it when it moves; or `null` while the firmware's clock shows |
| `display:on-screen-icon` | **Event**, to every window, only when the icon changes -- the tracker's tick and a scene's frames do not move it |
| `display:set-color-theme`, `display:get-color-theme`, `display:trigger-confetti-burst` | Display options. The color theme is the task key's color on the bar: `set` takes `emerald` (blue), `cyberpunk` (pink), `retro_arcade` (amber) or `nordic_cyan` (pale cyan), refuses anything else, and stores it (`color_theme`) so a restart draws it again; `get` answers the stored one. `display:trigger-confetti-burst` plays DONE! alone, for the debug panel |
| `display:preview-screen` | Draws one **real** screen for the debug panel, through the actual renderer — the panel used to hand-build payloads and drifted into a vocabulary main had stopped emitting |

### Device, ceremonies, notifications, diagnostics, updates

| Group | Channels |
| :--- | :--- |
| Device | `device:get-status`, `device:get-config`, `device:set-config`, `device:on-status-changed` |
| Ceremonies | `schedule:get-settings`, `schedule:save-settings`, `schedule:trigger-eod-prompt`, `schedule:trigger-eod-wrapup` (`{ shouldShutdown }`: End my day -- saves open editors, stops through `stopForWrapUp` with Undo, and with `shouldShutdown` shuts down only after the undo has passed and the queue has answered, 30 s at most), `schedule:cancel-eod-wrapup` (also cancels a shutdown on its way), `schedule:trigger-standup-prompt`, `schedule:cancel-standup-prompt`, `schedule:join-standup` (optional `joinedAt`, an ISO time: "joined 5 min ago"; anything else is refused), `schedule:answer-lunch-question` (`true` starts Lunch and ends the interruption, `false` works through lunch today; answers `false` when nothing was asked), `schedule:get-standup-task` / `schedule:set-standup-task` (`{ taskId, taskKey, title }` or null for the local Daily Standup), `schedule:get-week-ended`, `schedule:get-last-week-closed` (the Monday of the last week closed, or null: the window warns before changing time up to its Sunday, `isInClosedWeek`), `schedule:dismiss-week-ended`, `schedule:on-week-ended`, `schedule:snooze-ceremony`, `schedule:get-ceremony-prompt` (the ceremony waiting on an answer, `{ type: 'STANDUP' \| 'EOD', title, at }` with `at` its time as HH:MM, or null), `schedule:on-ceremony-prompt` (the same, pushed to every window, and null once Join, Skip today, Remind me or the wrap-up answers it; it never brings a window forward), `schedule:update-ceremony-prompt` |
| Morning card | `morning:get` answers the morning card (`{ dateKey, lastTask: { id, key, title, stoppedAtUtc } \| null, standupAt, inProgress: [{ id, key, title }] }`), or null on a day off, once the day has begun (a session open, anything logged today) or once seen; `morning:seen` stores today as seen |
| Reminders | `reminders:get` answers the "still...?" reminder being asked (`{ id, kind, sinceUtc, minutes, taskKey?, name?, heldTaskKey? }`, `kind` one of `nothing-timing`, `long-pause`, `interruption-running`, `standup-running`), or null; `reminders:dismiss` takes its `id` and answers false when it is no longer asked; `reminders:on-changed` pushes it to every window, and null once answered or over |
| Resume after lunch | `schedule:get-resume-prompt` answers the question being asked, or null; `schedule:answer-resume-prompt` takes `true` (resume) or `false` (leave it), and after an interruption the minutes to count as work since it ended (`addGapMinutes`), and answers `false` when nothing was asked; `schedule:on-resume-prompt` pushes the question, `{ taskKey, taskTitle, after }`, and null once it is answered, from the window or the bar. `after` is `lunch`, `standup` or `interruption`: what stopped the task -- or, after an interruption, what it waited paused through, with `interruptionEndedAtUtc`. Lunch and the stand-up ask only about a task that left the user's lists; an interruption asks every time, and adds `unlisted: true` when the task has left them as well |
| Notifications | `notifications:get-settings`, `notifications:save-settings`, `notifications:simulate`, `notifications:get-listener-status`, `notifications:on-log`, `notifications:open-settings` |
| Provider events | `provider-events:get-settings`, `provider-events:save-settings` (answers the settings as stored: an interval is clamped to 30-3600 s), `provider-events:test` (a sample through the destinations switched on; answers `{ toast, bar }`) |
| Diagnostics | `diagnostics:export-logs` |
| Updates | `updates:check`, `updates:get-enabled`, `updates:set-enabled`, `updates:open-release-page`, `updates:on-status` |
| App | `app:get-system-locale` -- Windows' regional format (`en-BE`, `fr-FR`), read once by the renderer at startup to format times |
| Interrupt shortcut | `app:get-interrupt-shortcut` answers `{ enabled, accelerator, registered, problem }`: `enabled` is the user's choice, `registered` whether Windows gave the app the chord, `problem: 'taken'` when it is on but another app holds it. `app:set-interrupt-shortcut` takes `{ enabled, accelerator }`, an Electron accelerator; refuses one `chordProblem` refuses (no Ctrl, Alt or Win; modifiers out of order; an unknown key), stores the rest and answers what Windows said. `app:set-interrupt-shortcut-recording` takes a boolean: true lets go of the chord while the window records a new one, false registers the stored one again |
| Start with Windows | `app:get-launch-at-login` answers `{ enabled, available, reason }`, read from Windows each time; `app:set-launch-at-login` takes a boolean, refuses anything else, and answers the state Windows then reports. `available: false` with `reason` `not-packaged` (a development run, which would register a bare electron.exe) or `not-windows` writes nothing |
| Mini timer | `mini:toggle` (answers whether it is open afterwards), `mini:is-open`, `mini:on-visibility` (**Event**, to every window, however it was opened or closed), `mini:open-task-picker` (opens the picker window, `#picker`; the dashboard's picker when the window cannot be made, and `false` if there is no dashboard either) |

---

## Local HTTP API

**Source:** `src/main/api/webhook-server.ts`

`http://127.0.0.1:39123`, bound to loopback and never reachable from the
network. It takes remote key presses, and carries the Stream Deck plugin's
WebSocket (below). It also served the Unity Editor plugin's four
`/api/v1/unity/*` routes until 2026-11-09; they answer `404` now, like any
other path.

### Routes

| Route | Method | Body |
| :--- | :--- | :--- |
| `/api/input` | POST | `{ key }` — or `?key=` — injects a physical key event (`up`, `down`, `start`, `ok`, `back`, …) |

Responses are JSON. `200 { status: 'ACCEPTED', key }` on success,
`400 { error: 'INVALID_PAYLOAD' }` when no key is given,
`404 { error: 'NOT_FOUND' }` for any other path.

### Screening

> [!WARNING]
> **Loopback is not a security boundary**
>
> Any page in any browser on this machine can POST to `127.0.0.1`, and this API
> can drive hardware and inject input. Requests are therefore screened before
> routing.

| Rule | Response | Why |
| :--- | :--- | :--- |
| Method must be POST | `405` | |
| An `Origin` header is present | `403` | Browsers set it; native clients do not |
| `Content-Type` is not `application/json` | `415` | A browser may send a cross-origin POST without permission only while the request stays "simple" — form, plain-text or multipart. Requiring JSON forces a CORS preflight, and no `Access-Control-Allow-Origin` is ever sent, so that preflight fails and the real request is never made |
| Body over 64 KB | `413` | |

**This is not authentication.** Any local program can still call this API. What
the checks close is the path from a web page you happen to be visiting to your
hardware. `pnpm verify:packed` asserts all of it against a real packaged build.

### The Stream Deck socket

**Source:** `src/main/api/deck-server.ts`, `src/main/services/deck-action-service.ts`;
the protocol is `src/shared/deck-protocol.ts`, the one file the plugin imports.

`ws://127.0.0.1:39123/api/v1/deck`. The app pushes the state when it
changes; the plugin sends requests and gets one answer for each. A handshake
is refused before the upgrade when:

| Rule | Response | Why |
| :--- | :--- | :--- |
| An `Origin` header is present | `403` | A browser opens a cross-origin WebSocket with no CORS check at all, so the content-type rule that stops a page's POST does not exist here: this header is the whole defence |
| Another path | `404` | |
| Four decks already connected | `503` | One is the case; a few cover a plugin restarting before its old socket closed |

A message over 4 KB closes the socket (1009). No token, as for `/api/input`.

**From the app**, as JSON text:

| Message | When |
| :--- | :--- |
| `{ type: 'hello', protocol: 1 }` | First, on every connection |
| `{ type: 'state', state, at }` | On connection, then on each change: the session (`taskId`, `taskKey`, `taskTitle`, `isAdHoc`, `status: 'tracking' \| 'paused'`, `elapsedSeconds`, `finishNeedsConfirmation`) or null, the bar's screen `icon` (`pixels`, `label`, and `motion` while it moves: `{ fps, poses, sequence }`, its distinct 16x16 poses and the order they play in, at 10 fps at most -- absent until the app has read the frames, and from an app older than the field), and the `prompt` waiting for an answer. Never once a second: `at` is when `elapsedSeconds` was read, and the plugin counts on from it (`deckElapsedSeconds`). The time is pushed again only when it drifts more than 2 s from that count -- the clock set back, a forgotten session paused at the last activity |
| `{ type: 'result', id, ok: true }` | A request done |
| `{ type: 'result', id, ok: false, error, message }` | A request refused or failed; `error` is one of `invalid-request`, `no-session`, `needs-confirmation`, `no-prompt`, `no-window`, `failed` |

**From the plugin**, `{ id, action, confirmed? }`, `id` 1 to 128
characters. Unknown fields are dropped, and an unknown action is refused as
`invalid-request` -- `start`, `toggle-away` and `list-tasks` among them,
removed with the keys that used them (2026-10-22).

| `action` | Does what | Refused when |
| :--- | :--- | :--- |
| `pause`, `resume` | What the mini timer's buttons do | Nothing tracking, or nothing paused |
| `stop` | Ends the session, task left open -- the window's Not done, with LOGGED on the bar | No session |
| `finish` | Ends it and marks the task done, with DONE! | No session; or the task left the user's list and `confirmed` is not true (NOT YOURS?) |
| `discard` | Keeps nothing | No session; or `confirmed` is not true -- always asked |
| `open-picker` | Brings the window forward with its task picker -- to the front, past Windows' foreground lock (`ForegroundRaiser`), since the press reached Stream Deck and not the app | No window |
| `interrupt` | Starts an interruption, as the window's Interrupt: `ContextScheduleService.interrupt('deck')`, a timer at once while the task running waits paused; during one, Another. Added without raising the protocol: an app older than it answers `invalid-request` | Never; `failed` if the app cannot |
| `prompt-yes`, `prompt-no` | OK or BACK on the bar while a prompt holds it: the stand-up (`standup`), the wrap-up (`wrap-up`, then `wrap-up-confirm` after the first yes), the resume question (`resume`) | No prompt holds the bar |

A prompt is reported only while it holds the bar's display: covered by a
banner, the bar's own OK would answer the banner, and the deck answers what
the bar would.

---

## `ITaskProvider`

**Source:** `src/main/providers/task-provider-interface.ts`

What you implement to add a task provider. Three exist: `OpenProjectProvider`,
`JiraProvider`, `AdHocProvider`.

```ts
interface ITaskProvider {
  readonly providerId: string;
  readonly providerName: string;
  readonly minimumLoggableSeconds: number;

  initialize(credentials: Record<string, string>): Promise<boolean>;
  getProjects(): Promise<ProjectDTO[]>;
  getTasks(projectId: string): Promise<TaskDTO[]>;
  reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number | null }>;
  logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }>;
  // doneState: for 'done', the project's own state (done_state_by_project), replacing
  // the completion action -- a Jira transition id or name, or the status it leads
  // to; an OpenProject status id. A state the workflow lacks answers false.
  updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done', doneState?: string): Promise<boolean>;

  // Optional: correcting an entry logTime made. A provider with no remote leaves them out.
  findWorklog?(taskId: string, startedAtUtc: string, marker: string): Promise<string | null>;
  updateWorklog?(taskId: string, remoteWorklogId: string, payload: WorklogPayload): Promise<void>;
  deleteWorklog?(taskId: string, remoteWorklogId: string): Promise<void>;

  // Optional: where one task stands -- for a tracked task that left the
  // list, and once a minute for the task being timed. 404 is 'gone'; an
  // open task carries its ownership (and the assignee's name when it is
  // someone else's); any other failure throws. Checks the credentials
  // first, so a refused token never reads as 'gone'.
  getTaskStanding?(taskId: string): Promise<TaskStanding>; // { state: 'open' | 'closed' | 'gone'; ownership?; assigneeName? }

  // Optional: one task by the key the user typed in the picker -- Jira's
  // /issue/{key}; OpenProject's work package by OP-1234, #1234 or 1234 --
  // whoever has it, outside the task scope. Null for none (404); an epic or a
  // milestone is none. Without it the picker offers no Fetch (canFetchByKey).
  getTaskByKey?(key: string): Promise<TaskDTO | null>;

  // Optional: assigns a task nobody owns to the user, reading its assignee
  // first. Answers 'assigned', 'already_mine', or 'taken' with the name of
  // whoever has it -- never reassigned away from them. Throws on failure.
  assignToMe?(taskId: string): Promise<TaskClaim>;

  // Optional: the task's page on the provider's own site, or null.
  getTaskPageUrl?(task: Pick<TaskDTO, 'id' | 'key'>): string | null;

  // Optional: the instance's holidays between two local dates, inclusive, as
  // YYYY-MM-DD. Weekends are the user's setting, not the provider's.
  getNonWorkingDays?(fromKey: string, toKey: string): Promise<string[]>;

  // Optional: activity on the user's tasks, for toasts and bar banners.
  getEventsSince?(sinceUtc: string): Promise<ProviderEventDTO[]>;
  getEventsInboxUrl?(): string | null;
}
```

**Assigning on start.** Starting a task nobody owns calls `assignToMe` on the
provider it came from, in the background, once the session is running.
Jira reads `fields=assignee` and then `PUT /rest/api/3/issue/{id}/assignee`
with the user's `accountId`; it has no conditional write, so the read just
before is the narrowest window it allows. OpenProject reads the work package
and `PATCH`es `_links.assignee` under its `lockVersion`, so an assignee set in
between is refused (409) rather than overwritten; it then reads once more and
decides again. Both were measured on a real OpenProject 17.9 instance on 2026-10-16,
with an edit played between the read and the write. An assignment that went through moves the task to In Progress,
as for the user's own task. A failure is told in a toast and never queued.

`getNonWorkingDays` is OpenProject's `GET /api/v3/days/non_working`, filtered
on the range (`date` `<>d`): unfiltered, an instance answers the current year
only, which loses New Year from a range read in December. Like every read it
throws on failure; `not_configured` is the one the caller stays quiet about.

`TaskDTO.description` is optional: plain text on one line, at most
`TASK_DESCRIPTION_MAX_CHARS` (500), cut with an ellipsis. Convert with
`task-description.ts` -- `adfToPlainText` for Jira's document tree,
`markdownToPlainText` for OpenProject's `description.raw` -- then
`clampDescription`. Omit the field when there is nothing left; do not send an
empty string. Jira asks for `description` in its `fields` list, the one heavy
field it requests.

### The contract, in rules

**Report failure by throwing a `ProviderRequestError`. Never return `[]`.**
An empty array is indistinguishable from "this user has no tasks", and
`OfflineSyncWorker` prunes the local cache against what it receives. Returning
an empty list on a network error is how the cache got deleted (F-01). A partial
page is the same hazard: if pagination cannot finish, throw rather than return
what you have.

**Check that the remote accepts the credentials; a 200 does not prove it.**
Jira Cloud answers a revoked or expired token as an anonymous caller:
`/project/search` and `/search/jql` return 200 and empty, and only an endpoint
that needs a user, such as `/myself`, returns 401 (measured 2026-10-02, with
no credentials and with wrong ones alike). `JiraProvider` therefore calls
`/myself` before every read the prune or the event cursor depends on, trusting
the answer for `JIRA_AUTH_CHECK_TTL_MS` (one minute) so that a sync pass does
not ask once per project. A new adapter has to find out how its API treats a
bad credential, and `scripts/fake-jira.js` reproduces Jira's answer so the
check has cover.

**`logTime` answers the entry's own id, or none.** `remoteWorklogId` is kept
on the queue row and is how a later correction finds the entry. When the API
answers without one, leave it `undefined`: an id made up here
(`jira_wl_<time>`, as the adapters once did) is indistinguishable from a real
one, and a correction sent to it would miss an entry that does exist.

**Correcting an entry: find it by its marker, rewrite it whole, and read a
404 for what it means.** Every comment `logTime` sends ends with the marker of
its queue row (`syncMarker`, `[#xxxxxxxx]`); `findWorklog` looks for it among
the task's entries from a day before the start to a day after
(`WORKLOG_SEARCH_MARGIN_MS`), and answers null only when it has read them all
-- a page walk that cannot finish throws, or a correction would be given up on
an entry that exists. On OpenProject the task's entries are picked by
`entity_type` + `entity_id`: 17.9 has no `work_package` filter on time
entries, since time can be logged on a meeting, and answers it 400. An
instance from before that answers the entity filters 400 instead, and is
searched again by `work_package`. Advance through pages by what each page held, never by
the page size asked for: Jira clamps `maxResults`, and the fake does too so a
test catches it. `updateWorklog` replaces duration, start and comment (Jira
`PUT .../worklog/{id}`, OpenProject `PATCH /time_entries/{id}`), so repeating
it is harmless; it validates like `logTime`, Jira's one-minute floor
included. `deleteWorklog` treats a 404 as done -- the entry is already gone --
and nothing else: a 403 or a 500 says nothing about the entry. A 404 on an
update is a permanent failure: the entry was deleted at the provider.

**`minimumLoggableSeconds` is a fact about your API, not a policy.** Jira's time
tracking is minute-granular, so it declares 60; OpenProject and AdHoc record
arbitrary durations and declare 1. The engine reads it before queueing, so a
session too short to record is never handed to a provider that will refuse it —
and one provider's limitation never costs a user time on another.

Declare a number you have **measured**, not one you read in the vendor's
documentation. Jira's 60 was verified against a live site with
`pnpm probe:jira-worklog`: 59s is refused and 60s accepted. Guessing high is not
the safe direction — it silently discards time the remote would have stored, and
nothing anywhere reports that it happened.

**A task's priority is a rank, `priorityRank`: 0 most urgent, 4 least.** Map
your provider's priority name with `priorityRankFromName`, which knows Jira's
two shipped schemes and OpenProject's. Leave the field off for a priority it
does not know rather than guessing: an unranked task sorts after the ranked
ones in the hardware picker, while a wrong rank puts it where nobody expects.

**`reconcileRemoteState` may answer `null`.** `remoteLoggedTimeToday: null`
means "this provider cannot find out". Jira has no single endpoint for "time I
logged today", and AdHoc has no remote at all; both return `null` rather than a
`0` a caller would render as a measured "you logged nothing today".
OpenProject returns a real total, and `null` when the fetch failed.

**`getEventsSince` throws too, and works on the provider's clock.** It answers
what happened after `sinceUtc`, exclusive: `assigned`, `mentioned`,
`commented`, `status_changed` or `date_alert` (`ProviderEventDTO` in
`src/shared/provider-events.ts`). An empty array means nothing happened, so a
failure must throw, or the poller would move its cursor past events it never
saw. `occurredAtUtc` is the server's own timestamp: the cursor advances on it,
never on this machine's clock. Drop what is not about the user's attention
rather than inventing a kind for it, and add the provider's id to
`PROVIDERS_WITH_EVENTS`, which a test holds to the adapters that implement the
method. OpenProject reads unread `/api/v3/notifications` -- the API has no
time filter -- and maps `assigned`/`responsible`, `mentioned`, `commented`,
`processed` and `dateAlert`.

Jira Cloud has no notifications API, so its adapter approximates one:
`GET /rest/api/3/myself` once per configuration for the account id, then
`/search/jql` over `(assignee = currentUser() OR reporter = currentUser() OR
watcher = currentUser()) AND updated >= -Nm` with `expand=changelog` and the
`comment` field. A changelog `assignee` set to the user is `assigned`, as is an
issue someone else created already assigned to them; a `status` item is
`status_changed`, with `From → To` as its summary; a comment is `mentioned`
when its ADF has a `mention` node carrying the user's account id, `commented`
otherwise. Anything whose author is the user is dropped. Two traps:

- **The window is relative, never a date.** JQL reads `"2026-10-01 10:05"` in
  the timezone of the user's Jira profile, so an absolute bound shifts by the
  difference. N is the minutes since the cursor plus
  `JIRA_EVENT_WINDOW_MARGIN_MINUTES`, and the timestamps cut it exactly.
- **Never read `item.toString` off a changelog item.** It is a field -- the new
  value's display text -- and where it is missing the expression is
  `Object.prototype.toString`. `historyItemField` reads own properties only.

A changelog or comment list the search truncated (`total` above what came back)
is completed from `/issue/{id}/changelog` (its last page: it lists oldest
first) or `/issue/{id}/comment?orderBy=-created`. `providerEventKindsFor`
limits the settings panel to the kinds a provider produces; Jira has no
`date_alert`.

**Use `providerFetch`.** `src/main/providers/provider-http.ts` is the one place
a provider talks to the network: per-attempt timeout, `Retry-After`-aware
backoff, bounded retries, and classification into `ProviderRequestError`. Do not
call `fetch` directly.

**Only GET/HEAD/OPTIONS are retried.** Neither API has an idempotency key, so
repeating a worklog POST after a lost response bills the time twice. An
over-reported day is harder to spot than a missing entry the queue will resend.

**`isPermanent` decides whether a queued row retries.** Any 4xx except `408` and
`429` is permanent — those two describe a moment; the rest describe the request.
A permanent failure parks the row at once with the server's own message instead
of spending eight attempts on byte-identical requests.

### Errors

`ProviderRequestError` (`provider-errors.ts`) carries a `kind`, an optional
HTTP `status`, and a derived `isPermanent`.

| `kind` | Means |
| :--- | :--- |
| `not_configured` | No credentials. **Always permanent** |
| `auth` | `401` or `403`. **Always permanent** — retrying a revoked key to the ceiling is what parked rows with no explanation |
| `protocol` | Any other HTTP status, or a malformed response |
| `transport` | The request never completed — network failure or timeout |

`isPermanent` is `true` for `auth` and `not_configured` regardless of status,
and otherwise for any 4xx **except `408` and `429`**. A 5xx stays retryable: the
request was fine and the server was not.

`ProviderRequestError.notConfigured(providerId)` and
`ProviderRequestError.fromStatus(providerId, status, context, detail)` are the
two standard constructors. Pass `detail` — it is what makes a failure say
`HTTP 401 - You did not provide the correct credentials` instead of leaving the
user to guess.

Note that `ArgumentException` is **not** a `ProviderRequestError`: a
non-positive duration throws one, and the queue cannot classify it, so callers
must not enqueue work that will throw that way.

### Task scope

`src/shared/task-scope.ts` holds the vocabulary — assigned to me, everything
open, or a custom query — and each adapter renders it in its own dialect: JQL
for Jira, a v3 filter array for OpenProject. A custom OpenProject filter is
validated and **throws** if malformed, because an invalid filter that quietly
matched nothing would let the prune delete every cached task for the project.

The default scope -- still stored as `assigned_to_me` -- fetches more than
the user's work: their open tasks, every open task nobody is assigned, and a
teammate's task while it is in progress (`keptByDefaultScope` in
`src/shared/task-ownership.ts`, applied after the query as well as in it).
Jira asks in one JQL with `OR`. OpenProject's v3 filters only `AND`, so it
makes up to three requests per project -- assignee `=` `me`, assignee `!*`
(none), and the configured In Progress status with assignee `!` `me` -- and
merges them by id; with no In Progress status configured, a teammate's work
is not asked for.

**Whose a task is comes from its assignee**, never from the query that found
it: `TaskDTO.ownership` is `unassigned` or `other` (with `assigneeName`), and
absent for the user's own. Jira compares the issue's `assignee.accountId` with
`/myself`; OpenProject compares the user id in `_links.assignee.href` with
`/api/v3/users/me`, read once per configuration -- a group or placeholder
user is someone else. An adapter that cannot read the user throws rather than
file every task under the wrong owner.

The scope decides which tasks are fetched; it does not touch the project list,
which a provider returns whole. "Only projects with tasks"
(`src/shared/project-filter.ts`) is what hides the projects the scope left
empty, in the window's lists and the bar's picker alike. It counts the open
tasks the lists would show: `openTaskCount` always, and `openUnassignedCount`
and `openOthersCount` when the task visibility (`src/shared/task-visibility.ts`)
shows those owners. Both lists order tasks with `orderTasksForSelection`
(`src/shared/task-order.ts`): the user's own in progress, then to do, then
unassigned to do and in progress, a teammate's in progress, and finished work
last.

---

## The BUSY Bar device contract

**Source:** `src/main/hardware/busybar-driver.ts`, and
[the developer guide](BUSY%20Bar%20API%20%26%20Display%20Technical%20Developer%20Guide.md)

The bar answers on **`10.0.4.20`** over USB and needs no token there. That is
the device's own default — but it is the app's *default*, not a constant, and
both the address and the token are configurable in Settings › Device.

> [!IMPORTANT]
> **Never hardcode the device address.**
> Two situations put the bar somewhere else. Over Wi-Fi it holds a DHCP lease.
> And when a host's USB CDC-NCM driver refuses to start the network interface —
> a real failure on Windows 25H2 with Intel 700-series xHCI, where the device
> enumerates cleanly and the adapter fails with Code 10 — the working recovery
> is to reach the bar through a proxy on a different address. Read
> `DeviceConfigDTO.ipAddress`, never `DEFAULT_USB_IP`.

`DeviceConfigDTO.enabled` is no-bar mode when false: the driver does not dial,
and `DeviceStatusDTO.enabled` reports the same so the renderer can hide the
bar's screens. A missing field reads as `true`. `SET_DEVICE_CONFIG` turns the
bar off before retargeting and on after, so it never dials an address it is
leaving; `BusyBarDriver.setEnabled()` does the switch in place.

Changing either value calls `BusyBarDriver.reconfigure()`, which tears down the
ping loop and StateStream socket, re-points the driver and reconnects, without
restarting the app. A host is validated with `isValidDeviceHost` before it is
used: an IPv4 address or hostname only, since the value is concatenated into
`http://${host}/api/...` where a stray `/` or `@` retargets every request.

The API token, when set, is sent as `x-api-token` — as a header on HTTP calls
and as a **query parameter** on the StateStream WebSocket URL. Anything logging
that URL must pass it through `redactTokenInUrl` first; console output is
captured into the diagnostics bundle users attach to bug reports.

Violating the rules below does not produce a helpful error. Some of them reboot
the device.

| Rule | What happens if you break it |
| :--- | :--- |
| Colours are `#RRGGBBAA` — exactly 8 hex digits | The **entire** draw call 400s, so one bad element takes down the whole frame |
| Text is printable ASCII (`0x20`–`0x7E`) | Smart quotes and emoji corrupt the display. Use `sanitizeAsciiText`, which transliterates rather than substitutes |
| A solid fill takes exactly one colour; a gradient exactly two | **Reboots the device.** `formatHardwarePayload` normalises this — do not bypass it |
| The field is `application_name`, not `app_id` | `app_id` is a legacy name the firmware ignores |
| Asset filenames match `^[a-zA-Z0-9._-]+$` | No paths, no spaces. Firmware 1.2.3 does accept a subdirectory and creates it, but the strict rule holds on every firmware and nothing here needs one |
| Draw priority ≥ 95 | The app does not hold the display |
| RTC timestamps need a numeric UTC offset, not `Z` | The device applies no conversion, so `toISOString()` leaves the bar showing UTC |
| The device's clock is not the host's | A measured bar ran 19s behind. Anything that lets the *device* do the time arithmetic is wrong by the skew, and nothing reports it — see below |

### Status codes carry meaning

See `classifyDeviceResponse`.

| Code | Meaning |
| :--- | :--- |
| `409` | Priority conflict — something else owns the display. **Not a failure** |
| `413` | Payload too large. **Permanent** — retrying sends the same bytes |
| `503` | Retry |

### How the driver reports failure

`BusyBarDriver`'s commands **throw** when the device did not do what was asked.
The error is a `DeviceRequestError`, and its `kind` gives the reason:

| `kind` | Meaning |
| :--- | :--- |
| `disconnected` | The driver is not connected, so nothing was sent |
| `unreachable` | Sent, no answer: timeout, refused connection. The message carries the transport cause |
| `conflict` | `409` on a request that is not a draw |
| `too_large` | `413`. Permanent |
| `busy` | `503`, still busy after the driver's own retry |
| `rejected` | Any other non-2xx; `status` holds the code |

A bad asset filename throws `ArgumentException` before anything is sent.

Draws return a value instead of throwing for the answers that are not failures:

| Call | Resolves to |
| :--- | :--- |
| `sendDisplayPayload` | `'drawn'`, or `'conflict'` when another application owns the display |
| `drawOverlay` | The same, for elements laid **over** the screen. Unlike `sendDisplayPayload` it does not supersede a frame whose upload is in flight |
| `sendPixelFrame` | `'sent'`; `'queued'` (disconnected or another frame in flight, so it is sent next); `'superseded'` (a clear landed mid-upload, **the device is not showing it**); `'conflict'` |
| `clearDisplay` | `'cleared'`; or `'superseded'` when a draw landed while it waited its turn or took the images down, in which case the display is **not** released. Clears run one at a time; one that finds the panel already emptied, with nothing drawn since, sends nothing and answers `'cleared'` |

`removeDisplayElements(app, ids)` takes the named elements off the screen and
nothing else. **An animation is put to rest, not removed**: the driver draws
the empty animation (`blank_16x16.anim`, one transparent frame) under its id
and layer, because removing a playing animation by id hangs firmware 1.2.4 now
and then. The element stays listed in `shownElementIds`, showing nothing, until
the screen closes; the next icon or scene is drawn over it. An animation
already at rest resolves without a request, and a park held off by a 409 is
left as it was. Everything below is about the other elements.

An id the device does not hold answers **400**, so it throws `rejected`;
a caller removing something that may already be gone has to read that as
success -- `isElementAbsent(err)` says so, for a 400 and nothing else. The
driver logs that 400 on a single id as "already gone", not as a warning. A
single id the driver *knows* is absent -- the panel was cleared and the element
not drawn since -- resolves without a request. **Several
ids in one call are all or nothing**: one missing id fails the request and
removes none of the others, so remove one id per call when any may be gone.
A removal that could empty the panel waits, like a clear, for the settle after
the last removal.

`uploadAsset` over the `.anim` an element is playing resolves without a
request: the device would answer 508, and holds the file already. That
includes a file an element *may* be playing, after a draw over it got no
answer.

`uploadAsset` of an `.anim` whose signature is not the one this bar's
firmware reads throws `rejected` without a request -- see the next section.
`getAnimationFormat()` answers which that is: `0` (`bicycle0`) for firmware
1.2, `1` (`bicycle1`) for 1.3, or `null` while the bar has not reported a
version the app can read, which means send no `.anim` at all.

**The driver emits `reconnected` when the bar answers again after an outage**
-- a failed ping, or any request that got no answer between two good pings --
and when no-bar mode is turned off. It has forgotten what the panel holds and
dropped the frame left pending; `DisplayRenderer` redraws the current screen.
The pending frame is never replayed: it was a screen from before the outage.

**Every display and asset request is queued.** Draws, frames, overlays,
removals, clears and uploads go out one at a time, whoever asks, and each
one's guard -- superseded, already absent, already empty, still settling --
is decided when its turn comes, after every earlier request has answered.
Status, brightness, audio, keys and time are not queued.

`getDeviceStatus().displayHealth` reports what came before every measured
hang: the median and the last ten asset upload times, `latencyWarning` while
that median is above 250 ms (withdrawn below 125), the screen closes of the
last hour, and since start the requests answered without sending, the
removals the device answered 400, and the longest queue. Observation only:
nothing the driver sends depends on it.

`shownElementIds(app, type?)` lists what the driver has drawn for an
application and not yet removed -- id and element type, from its own
successful draws and removals, since the device has no endpoint that lists
them. It can only be stale in one direction (an element the device dropped by
itself), and a removal of such an element answers 400, which reads as gone. A
draw or a clear that got no answer may or may not have landed, so the panel
is no longer vouched for, and nothing is skipped on it until the next clear.

### Emptying the panel closes the device's screen

When an application's element set becomes empty -- a full `DELETE
/api/display/draw`, or removing its last element by id -- the firmware closes
its screen, and reopens it on the next draw.

> [!CAUTION]
> **On firmware 1.2.4, closing the screen after an image and an animation have
> shared it hangs the bar within a few cycles.** Measured 2026-09-30: a clear
> with both on the panel hung it on round 3 and round 4; removing the
> animation by id and clearing at once hung it on round 6. Uploads slowing
> from ~50 ms to several hundred came first. An animation alone, and every
> sequence that never emptied the panel, ran ten rounds clean.

> [!CAUTION]
> **Removing a playing animation by id hangs firmware 1.2.4 now and then, with
> no warning.** Measured 2026-10-07 without the app: the gear icon froze the
> bar on its 30th removal, and on its 59th when uploaded again each round; the
> app froze it after about 13 and 36. Uploads stayed flat at ~23 ms up to the
> hang. Drawing another animation under the same id survived 200 swaps, and
> closing the screen with only animations on it survived 100 rounds.

So the app never empties the panel to change screens:

| Transition | How |
| :--- | :--- |
| Into a full-panel scene | Draw `hardware_anim` at `z_index` 0, under the frame; then remove `px_matrix_img` |
| Out of it | The next frame lands at `z_index` 1 over the scene; once it is `sent`, put `hardware_anim` to rest |
| Scene to scene, icon to icon | Same element id, so the draw replaces it in place |
| Release for the idle clock, and quit | `clearDisplay`, one at a time: the images beside any animation removed by id, `ANIMATION_TEARDOWN_SETTLE_MS` after the last removal, then the full DELETE on the animations alone |

That last row is the only close left. `pnpm probe:busybar --teardown-soak
--park` ran it 100 times in a row on firmware 1.2.4 (2026-10-07), and again
on 1.3.1 (2026-11-04). A close
without the 500 ms pause after a removal has not been measured: re-run that
soak before changing the pause.

Uploading over an `.anim` the device is playing answers **508**, so a scene
still on the panel is redrawn from the copy the device holds rather than
uploaded again.

`connect()` and `reconfigure()` answer a boolean and never throw. They are
probes, and "the bar is not there" is a normal answer for them.

> [!IMPORTANT]
> **The driver used to answer `Promise<boolean>` for every command and never
> throw.** A `.catch()` on one of those calls was therefore dead code for the
> failure that actually happens, and `.then()` ran regardless. That is how the
> Away animation stayed dark while the emulator played it. `.then(` is now an
> ESLint error under `src/main/hardware/**`. Await each step so a failure names
> the step that failed.

### The `.anim` format is the firmware's

An `.anim` file starts with an 8-byte signature, and the firmware's loader
accepts exactly one: 1.2 reads `bicycle0`, 1.3 reads `bicycle1`, which added
interframe compression and makes the files about four times smaller.

> [!CAUTION]
> **A file in the other format is not refused.** The upload stores it and the
> draw answers 200, and the panel shows the firmware's 9×9 load-error icon
> where the animation should be. No status code says the file was wrong, so
> the fallbacks for a refused file -- the static icon, the streamed frames --
> never take over. Read from the firmware's source and its own display tests
> (1.3.1, 2026-11-04), and measured on a bar running 1.3.1 the same day:
> `pnpm probe:busybar` draws the gear as `bicycle0` and reads back a 9×9
> still at (0,0) ("Animation in another format").

So every animation ships in both formats, side by side:

| On disk | Signature | Compiled by | Played on |
| :--- | :--- | :--- | :--- |
| `Animations/<id>/<id>/<id>.anim` | `bicycle0` | `seq2anim.py` (firmware 1.2.3's) | firmware 1.2 |
| `Animations/<id>/<id>/<id>.v1.anim` | `bicycle1` | `seq2anim_v1.py` (firmware 1.3.1's) | firmware 1.3 |

The name on the device is `<id>.anim` for both. The format is chosen from the
version in `GET /api/status` (`firmware.version`), read again at every ping:

- **A version no number can be read from, or none**, means no `.anim` is
  sent. A scene streams its PNG frames and an animated icon stays still.
- **A failed ping forgets the format** until the next ping reads it, since
  the bar may have been away installing an update. That ping reads the
  version before `reconnected` asks for the redraw.
- **A version that changed means the bar rebooted**: nothing of the app's is
  on the panel, and the files it holds are the old firmware's. The driver
  forgets them, so the redraw uploads each file again in the new format
  rather than drawing the old one stored under the same name.
- **A firmware newer than 1.3** is assumed to read `bicycle1`. Run
  `pnpm probe:busybar` after a release: its animation check reads the panel
  back, and a still placeholder fails it.

### Frames

The front display is a rasterised **72×16 PNG**. Every frame is an asset upload
plus a draw — two HTTP requests. `transmitFrame` hashes the frame and skips an
identical one, so before adding anything that redraws on a timer, check what
actually changes. This is why the session timer shows `HH:MM` and not seconds.

### Reading the panel back

`GET /api/screen?display=0` returns the front panel. It is the only way to check
a *layout*, and `pnpm probe:busybar` uses it to measure element sizes.

> [!WARNING]
> **The response is not what its content type claims.** It answers
> `Content-Type: image/bmp`, and the firmware's own `streaming.yaml` types the
> body as base64 — but on 1.2.3 what arrives is base64-encoded **raw** pixels
> with no BMP header: 4608 characters decoding to 3456 bytes, which is
> 72 × 16 × 3. The channel order is **BGR**, and rows are **top-down**. Both
> were established by drawing a known block and reading the bytes, because
> either mistake still produces a plausible image — one with the colours
> swapped, the other upside down.

### Letting the device keep time

`CountdownElement` draws a timer the device advances by itself, at no upload
cost — against the two HTTP requests per frame the app pays to animate one.
Measured on 1.2.3: **17×5px** for `01:06`, which fits beside a 16px icon with
39px of the field to spare, and it has no `font` field to configure.

> [!CAUTION]
> **It counts against the device's RTC, not yours.** A countdown built from
> `Date.now()` on a bar running 19 seconds behind displayed `00:47` for a
> 65-second interval. The element is correct; the clocks disagree, and the
> element believes the device. Read `GET /api/time`, compute the offset, apply
> it to the timestamp, and re-read it periodically — RTC drift is what produced
> the skew in the first place. Nothing surfaces this error on its own: the bar
> simply shows a confidently wrong time.

The app draws nothing on the rear 160×80 display: the firmware mirrors the
front there, and shows its own clock when the front is empty. What the rear
accepts, measured on 1.2.4 with `pnpm probe:busybar --rear`: `image` and `text`
elements with `display: 'back'`; a status column the firmware draws over
x 148-159; 16 levels of grey, with colour converted to luminance; and
`GET /api/screen?display=1` answering 6400 bytes of 4-bit grey, base64,
high nibble first.

### Checking the contract after a firmware release

`pnpm probe:busybar` runs the calls above against a real bar and reports the
firmware version alongside the result. The test suite mocks the driver, so it
proves what this app *sends* and nothing about what the device does with it —
every hardware defect in this project's history was found by running the app and
reading a console.

Verified on **firmware 1.2.3** (2026-09-09) and again on **1.2.4**
(2026-09-29): everything above still holds, and two additions are available
that were not before.

| Field | Where | What it enables |
| :--- | :--- | :--- |
| `z_index` | On any display element | Integer, higher drawn on top. Elements at the same priority can be layered instead of overwriting one another |
| `element_ids` | `DELETE /api/display/draw` | An array of element ids to remove, with `application_name` as a sanity check that you own them. Omit it to remove everything |

Both are used for animated icons and scenes (`FRONT_LAYER_Z`,
`FRONT_ELEMENT_IDS`). A full-panel scene, `hardware_anim`, is drawn at
`z_index` 0; the screen, `px_matrix_img`, at 1; the icon, `icon_anim`, at 2
over it. Each is removed on its own with `element_ids`. Without them an
animation was all-or-nothing across the whole panel, and changing screens
meant emptying it -- see above for why that is no longer done.
