# The 2026-11 redesign: implementation plan

Written 2026-11-10, after thirteen review rounds. This is the plan of record
for building the redesign. Unlike `design-history/`, it is **maintained**:
each phase updates its status here, in the same commit that lands it, and an
abandoned step says so rather than disappearing.

**What it builds.** The target is three documents, read in this order:

- [`design-history/Redesign-2026-11-screens.html`](design-history/Redesign-2026-11-screens.html)
  -- 41 screens (S1–S31), the glossary, and the table of states × surfaces.
  Where the plan and the screens disagree, the screens win, and the plan is
  corrected.
- [`design-history/Redesign-2026-11.md`](design-history/Redesign-2026-11.md)
  -- why each screen is the way it is. §34 (interruptions in a row), §37
  (one model, one word) and §39–§41 are the latest word.
- `CLAUDE.md` -- the rules every phase must keep, §4 and §5 above all.

**How it is built.** Fifteen phases, each landing working, tested and
documented on its own. Most of the order is forced:

- the send pipeline and the interruption model come before the screens that
  show them;
- the devices come last, because they show what the app decides.

Six decisions shape the phases (§2). The user took all six, as
recommended, on 2026-11-10.

---

## 1. Where we start

### 1.1 What is built

What the redesign can stand on:

- **Interrupt** (`df31d74`, 2026-11-09): migration 13 (`tasks.unsorted`),
  `ContextScheduleService.switchSettingAside`, Interrupt on the window, mini
  timer, tray, bar paused menu and deck, and rename / assign / move of an
  interruption.
- **Any worklog can move** (`6198cf6`): DELETE, then a CREATE held behind it,
  through the queue (`WorklogCorrectionService.reassign`).
- **A closed week warns** (`b569fdc`, `shared/closed-week.ts`).
- **The Interrupt shortcut** (`c14c86e`, `InterruptShortcutService`; off by
  default today).
- **Interruptions already follow each other.** Interrupting an interruption
  ends the first and starts the next, and the set-aside keeps the original
  task (`InterruptDuringAnInterruption_AsksAboutTheFirstTask`). What is
  missing is the link between the fragments, and holding the task instead of
  logging it.

### 1.2 What is pending, outside `main`

Work that sits in side worktrees, uncommitted, as of 2026-11-10:

| Worktree | What | State |
| :--- | :--- | :--- |
| `.claude/worktrees/busy-euclid-228d43` | Removing all Unity support (§10.4 of the proposal) | ~100 files changed, uncommitted |
| `.claude/worktrees/trusting-goodall-74b184` | Unity removal, plus the stand-up stress cases | ~105 files changed, partly staged |
| `.claude/worktrees/dreamy-leavitt-ddc9a0` | A banner queued during a screen: `display-renderer.ts` fix and its scripted case | 3 files, uncommitted |

The redesign itself is uncommitted too: rounds 7–13 of the proposal and the
screens, since `d82ce55`.

### 1.3 The size of the gap

From the code map of 2026-11-10:

- **Renderer** (`src/renderer`, ~9,900 lines in 55 files).
  - There is no router: `App.tsx` (438 lines) switches on `activeTab` across
    nine tabs and owns every modal flag.
  - Colours are Tailwind tokens (`tailwind.config.js`), so the palette swap
    is cheap for the names. It is expensive for meaning: `accent-blue` has
    223 uses and `accent-purple` 75, mostly meaning "selected" or "primary".
  - 200 `font-mono` classes, whole views included, wait for the move to
    Inter.
  - 224 tests query by visible text, so every change of wording breaks some
    of them.
- **Main.**
  - An interruption **stops and logs** the task it interrupts. The redesign
    holds it.
  - Lunch **stops** the session. The redesign pauses it.
  - Sends leave at once, with no undo.
  - In Progress and assignment happen at the start, not after two minutes.
  - Done is set per provider, not per project.
  - Missing entirely: stars, recent, previous task, add time, split, any
    overlap rule, close to the tray, a standalone picker window, Back /
    Switch / Previous shortcuts, a crash during the day, and every "still
    …?" reminder.
- **Bar.**
  - The picker is project → task, with no Recent or Starred.
  - A wheel click while idle opens two pickers: the bar's, and the window's
    through `TRIGGER_TASK_SELECTOR_MODAL`.
  - The window is raised without `ForegroundRaiser`.
  - Several of the screens' labels do not fit (D5).
- **Deck.**
  - The protocol (`DECK_PROTOCOL_VERSION` 1) carries no interruption, owner,
    count or previous task.
  - B reads NOT DONE.
  - DONE takes two presses only for a task that is not yours.

---

## 2. Decisions to take first

Each phase names the decisions it rests on. The decision taken is in bold.

| # | Decision | Why it is open | Recommendation | Blocks |
| :--- | :--- | :--- | :--- | :--- |
| D1 | **Lunch and Away pause the task** instead of stopping it | §5 of `CLAUDE.md` is written around Lunch *stopping* the session: `lunch_resume`, `lunch_skipped_date`, "Lunch stops the session under Away too". Pausing rewrites those rules and 29 `lunch-resume` tests | **Pause**, as the screens say: one entry per morning, no restart. A pause of 15 min or more still splits the worklog (`splitPauseMinutes`), so Jira's timesheet is unchanged | P8 |
| D2 | **An interruption holds the task as it was**: no log or send at the start, and Back resumes it running or paused | Today the start stops, logs and queues the task (`INTERRUPTED`). Holding it needs a new model (§7.1) and a migration | **Hold**, with fragments in their own table (§7.1) | P6, P13, P14 |
| D3 | **The stand-up is timed on a task you choose** (e.g. OPS-4) and sent | Today it is the local ad-hoc "Daily Standup", never sent | **Optional**: no task chosen keeps it local as today; a chosen task sends it like any entry | P8 |
| D4 | **What the bar shows when nothing is timing in working hours** | S28 draws NOTHING TIMING and an app-drawn "17:42 / 3 TO PLACE". That replaces the firmware clock (`clearDisplay`, the one deliberate screen close), adds a frame upload every minute all day, and moves screen closes to the hours boundary (§4) | **Keep the firmware clock.** NOTHING TIMING is drawn once when the "nothing timing" reminder fires, and released at the answer, with no clock of our own. No count on the idle clock | P14 |
| D5 | **The bar's words that do not fit** (measured 2026-11-10): "3 TO PLACE IN APP" (61 px of 55), "NOTHING TIMING" (63), "STAND-UP 00:11" (58), "BACK TO SPR-1428" (60) | Measured from the generated fonts | **Shorter words, chosen on the bar** with `pnpm probe:busybar --font-sheet`: "3 TO PLACE", NOTHING TIMING without the icon, STAND-UP over a row-1 time, BACK + key cut by `fitToWidth` | P14 |
| D6 | **Undo on Windows toasts** | Electron's plain `Notification` has no buttons. Actions need `toastXml`, untested here; the AUMID trap of §5 applies | **Undo lives in the app**: a bar at the foot of the window and a row on the mini timer, for 10 s. The toast's click opens it there. A `toastXml` Undo button is a spike, kept only if it works on a packaged build | P5 |

**Decided 2026-11-10 by the user: all six, as recommended.**

On D1 the user noted why Lunch stops today: stopping logs the morning at
once, for precise tracking, and a pause logs nothing. **Pausing keeps the
time exactly as precise.**

- The lunch pause is excluded from the session.
- At the stop, the session is split at any pause of `splitPauseMinutes` or
  more (15 by default). The provider gets the same two entries as today,
  09:00–12:30 and 13:30–the stop, to the second.

What changes is **when** the morning is sent: at the task's stop, not at
12:30. Until then it sits in the open session, which is stored in the
database, so a crash over lunch loses nothing.

If seeing the morning in Jira at lunchtime matters, P8 can log and send the
finished piece at the start of the lunch pause and keep the session paused.
That is noted here as an option, not planned.

Smaller defaults the plan assumes, to be confirmed in passing:

- **Undo of Stop reopens the session as it was**, so the timer runs on.
- **Undo of Discard brings the session back.**
- **Undo of End my day reopens the day:** nothing sent, no shutdown.
- **Saved bar bindings are reset once to the new defaults on upgrade.** The
  `hardware_bindings` setting holds user overrides, so an old binding would
  otherwise fight the new menus. The release note says so.
- **The shortcuts are on by default:** Interrupt Ctrl+Alt+Shift+I, Switch S,
  Previous P, Back B. A chord another app holds reads "taken", never on
  (`InterruptShortcutService` rule).
- **Close hides to the tray** (decided in the proposal, §3.5). Quit is in
  the tray's menu, and only Quit clears the bar.

---

## 3. Rules every phase keeps

From `CLAUDE.md`, restated where they bite here:

- **Documentation in the same commit** (§9). Each phase lists its documents.
  Wording changes update `USER-GUIDE.md` and remake the pictures
  (`pnpm docs:images`, which needs SprintTicker closed; run without asking
  since 2026-11-12, the user's choice).
- **Never delete the working path in the commit that adds the new one**
  (§6). The new picker, prompts and interruption model land beside the old
  ones, behind the new screen. The old path is removed in a later commit,
  once the new one has run.
- **Every migration is checked on real data before it ships**
  (`pnpm db:check-migration`, run by the user from an ordinary terminal). An
  agent's shell may not see the real database (§7).
- **A rule kept by callers is kept by luck.** New rules go in `src/shared/`
  as pure functions, read by the renderer, main, the bar and the deck:
  the word for a state, whether an entry may be sent, what "previous task"
  is. The deck imports only `shared/deck-protocol.ts`.
- **One event, one `evaluateRequest`; its end, one render** (§5). Every new
  bar menu, question and hand-back is checked against it, and against the
  `queueMicrotask` trap for anything started from an engine listener.
- **Bar changes are measured on a real bar** (§4), one at a time, asking
  first. Deck changes are tried on Stream Deck Mobile, with the plugin
  version raised.
- **Tests** are named `Method_State_Expected`. A failure branch gets a test
  that reaches it. Display tests run on `FirmwareSimulator` and end with
  `expectClean()`. A bug a stress seed finds becomes a scripted case in
  `display-handback.test.ts`. A bridge method added to the preload is added
  to `tests/renderer/electron-api-mock.ts`.
- **Coverage stays at or above the floor** (92 / 93.5 / 90 / 85). The
  renderer is outside `coverage.include`, so its tests are the only guard on
  it: each new view gets one.

---

## 4. The phases at a glance

| Phase | What | Depends on | Size | Release |
| :--- | :--- | :--- | :--- | :--- |
| P0 | Land the pending work; commit the redesign | -- | S | -- |
| P1 | Shared vocabulary, provider names, capabilities | P0 | S | 1.5 |
| P2 | The grey look and the type | P1 | M | 1.5 |
| P3 | The shell: four places, header, Settings in six groups, developer tools hidden | P2 | L | 1.5 |
| P4 | Data for the new flows: stars, recent, previous, provider name, settings | P1 | M | 1.6 |
| P5 | The send pipeline: 10 s hold and undo, overlaps, delayed side effects, Done per project | P4, D6 | L | 1.6 |
| P6 | Interruptions in a row: the model, Back, Another, place, keep off | P5, D2 | L | 1.6 |
| P7 | One picker, its own window, and the command palette | P4 | L | 1.6 |
| P8 | Today and the prompts: cards, no focus stealing, Lunch / Away / stand-up, reminders | P6, P7, D1, D3 | L | 1.6 |
| P9 | History: day, timeline, week, Check my week, add time, split | P5 | L | 1.7 |
| P10 | End my day, overnight and crash | P5, P8 | M | 1.7 |
| P11 | First run, and the states that are not normal (S31) | P3, P7 | M | 1.7 |
| P12 | Outside the window: close to tray, tray, toasts, mini timer | P6, P8 | M | 1.6 |
| P13 | Stream Deck plugin 0.6.0 | P6, P8 | M | 1.7 |
| P14 | The bar | P6, P8, D4, D5 | L | 1.7 |
| P15 | Documents, pictures, release | each phase | M | each |
| P16 | Tasks and Settings, rebuilt as their screens | P3, P4, P5, P7 | L | 1.7 |

Phases that can run side by side, in separate worktrees, once their
dependencies have landed:

- P2 and P4;
- P7 and P5;
- P9 with P10–P12;
- P13 and P14;
- P16 with P9–P12 (it owns the Tasks view and Settings' cards).

Two writers never touch the same files: P3 owns `App.tsx` and the views'
layout, P6 owns `time-tracking-engine.ts`, and P14 owns `input-decoder.ts`
and `display-renderer.ts`.

Three releases, so that a user meets one change of habit at a time:

- **1.5 -- the new face.** Looks and places change; behaviour does not.
- **1.6 -- the new flows.** Undo, interruptions in a row, the picker, the
  prompts, the tray. The Stream Deck keeps working with protocol 1.
- **1.7 -- the rest.** History, End my day, first run, and the devices.

---

## 5. P0 -- Land the pending work

**Goal:** `main` holds everything the redesign builds on, and nothing
half-done sits in a worktree.

1. **The Unity removal** (worktree `busy-euclid-228d43`, or its sibling
   `trusting-goodall-74b184`, whichever is the finished one).
   - Review the diff and run `pnpm test`, `pnpm typecheck` and `pnpm lint`.
   - Check that `WebhookServer` still hosts the deck socket. Its Unity routes
     go; the socket stays.
   - Check that `tests/support/desk.ts` and `display-stress.test.ts` no
     longer build a Unity service.
   - Merge only on the user's word (side branches are merged by the user's
     decision).
2. **The banner fix** (worktree `dreamy-leavitt-ddc9a0`). Same checks, and
   its scripted case must fail on the code before the fix.
3. **Commit the redesign documents**: rounds 7–13, the screens, and this
   plan.
4. ~~**Close the pending decisions** of §2.~~ Done 2026-11-10: all six
   taken as recommended.

**Done when:** `main` is green and the worktrees are cleaned up.

---

## 6. P1 -- Shared vocabulary, provider names, capabilities

**Goal:** the words, the provider's name and what the provider can do are
decided in one place, so every later phase only reads them.

- **`src/shared/words.ts`** (new): the glossary of the screens as constants
  and small functions, never as copies in views.
  - The verbs: Start, Switch, Previous, Pause, Resume, Stop, Done, Discard,
    Interrupt, Another, Back, Place, Move, Keep off, Later, Not now.
  - The states: Nothing timing, Running, Paused, To place, Waiting, Sent.
  - Their bar and deck forms: STOP, DISCARD ⚡, NOT TIMING, NOTHING TIMING.
  - `keepOffLabel(providerName)` → "Keep off Jira".
  - A test pins each bar and deck string's width in its font
    (`measureText` with `ROW0_FONT` / `ROW1_FONT`), so a word that stops
    fitting fails here, not on the bar.
- **`src/shared/provider-names.ts`** (new): `providerDisplayName(providerId,
  settings)`.
  - Jira → "Jira", OpenProject → "OpenProject".
  - A custom server → the name the user gave it, or the server's own.
  - It replaces the hard-coded `providerName` strings ("Jira Cloud",
    "Ad-Hoc / Custom Fallback"), the fixed list in `provider:get-all`,
    `SettingsView`'s `PROVIDER_NAMES`, and the literal "Jira or OpenProject"
    in `EditWorklogModal`, `TaskSelectionModal`, `CeremoniesView` and
    `EodWrapUpModal` ("logged to Jira").
- **`ProviderCapabilitiesDTO`** (new, in `shared/dtos.ts`), from the active
  provider's optional methods: `canAssign`, `canTransition`, `canFindWorklog`,
  `canFetchByKey`, `hasHolidays`.
  - New IPC `provider:get-capabilities`, added to the preload, the typed
    bridge and the renderer mock.
  - A capability the provider lacks hides its control (never greyed). The
    proposal's rule.
- **`'MISC-1'`**, hard-coded three times in the renderer, reads the default
  from `shared/provider-settings.ts`.

**Tests:**

- `words.test.ts`: widths; one word per state; no smart quotes or non-ASCII
  in bar strings (`sanitizeAsciiText` would change them).
- `provider-names.test.ts`.
- The registry test for the new channel.

**Docs:** `API.md` (the channel), `ARCHITECTURE.md` (where words and names
live), `CLAUDE.md` (a line: words and the provider's name come from shared,
never from a view).

**Done when:** no view or service spells a provider's name or a state's word
itself. Check with a grep for `'Jira'` in `src/renderer` and `src/main`
outside the providers.

**As landed (2026-11-10):**

- The provider's name: done. What `'Jira'` still matches in the renderer is
  Jira's own settings (its site, its token, its transitions, its event
  note), which name Jira because they are Jira's. `EodWrapUpModal` no longer
  exists; its "logged to Jira" went with it.
- The adapters' `providerName` reads `providerDisplayName`, so toasts and
  the log say "Jira", not "Jira Cloud". The ad-hoc provider reads "This
  computer" in the provider choice.
- The words: `words.ts` holds the glossary and the bar's D5 forms, each
  measured. The views, the bar and the deck still spell their current words
  (DROP, FINISH, NOT DONE among them). Each adopts `words.ts` when its phase
  rebuilds it -- the window in P3 and P7–P8, the deck in P13, the bar in
  P14 -- rather than in a sweep here that those phases would redo.
- The deck's words are `DECK_WORDS` in `deck-protocol.ts`, re-exported by
  `words.ts`: the plugin may import that file alone (`CLAUDE.md` §3).
- `canFetchByKey` reads an optional `getTaskByKey`, declared on
  `ITaskProvider` and implemented by no adapter until P7, so it is false
  everywhere today. `canTransition` reads `movesTaskStatus`, false on the
  ad-hoc provider only.
- `'MISC-1'` is read from `PROVIDER_SETTING_DEFAULTS` in the renderer and
  in main (the ad-hoc adapter, `createAdHocTask`).

---

## 7. P2 -- The grey look and the type

**Goal:** the app looks like the screens, and nothing else changes: same
places, same flows. The proposal's §5 has the tokens.

- **`tailwind.config.js`**: the new hex values under the existing token
  names (`dark.900/800/700`, `border.dark`, `text.*`), plus a `muted` token
  and `primary` (light grey, dark text). `accent.blue` and `accent.purple`
  are **not** remapped to grey wholesale. Each of their ~300 uses is one of
  three things:
  - a primary button → `primary`;
  - selection or focus → the new outline and fill tokens;
  - a meaning → green, amber or red.

  Do them file by file, starting with the heaviest: `SettingsView`,
  `NotificationSettingsView`, `DeviceDiagnosticsView` and
  `ProjectTaskManagerView`.
- **`index.css`**: body and scrollbar colours from the tokens. Remove the
  blue `#3B82F6` scrollbar hover.
- **Type**:
  - Inter by default.
  - `font-mono` only on times and task keys. Remove the view-level
    `font-mono` wrappers, about 200 uses.
  - No uppercase-tracked headings except a page's kicker (39 `uppercase`).
- **Broken classes the swap would otherwise hide**:
  - `bg-dark-600` and `text-dark-400` / `dark-500` are not defined.
  - `animate-in fade-in slide-in-*` needs a plugin that is not installed:
    drop it or install `tailwindcss-animate`, subject to the release-age rule
    of `CLAUDE.md` §2.
  - The typo `text-text-text-secondary` (`WorklogHistoryView`, line 275).
- **Hard-coded colours**:
  - ~65 default-palette classes (`bg-blue-600`, `text-purple-400`, …) go to
    tokens.
  - The 22 hex values in TSX stay only where they are the bar's own colours
    (`HardwareDisplayEmulator`, `AnimationDebugPanel`). The LED preview
    shows what the bar shows.
- **Purple goes.** The wrap-up is grey; high priority is amber
  (`PriorityRulesView`).

**Tests:** the renderer suite still passes. The look has no unit test; the
check is visual, one screenshot per tab against the screens, in the
packaged app run on a database copy.

**Docs:** `USER-GUIDE.md` pictures (`pnpm docs:images`, asked first);
`README.md` screenshot.

**Done when:** a grep finds no `accent-blue`, `accent-purple` or default
blue or purple classes in `src/renderer`, and the tabs match the screens'
colours.

**As landed (2026-11-10):**

- The tokens are the screens' (`--muted` is `#8A8A92`, the screens' value,
  not §5's `#6B6B72`, for contrast). `accent.blue` and `accent.purple` are
  deleted from `tailwind.config.js`, so a class naming one draws nothing
  and the grep above finds it; there are none left.
- The mapping, by what a use meant: a solid accent background is a primary
  button (`bg-primary text-dark-900`); a tinted one, or a selected item, is
  `bg-select` with a `border-focus` outline; a focus border is
  `focus:border-focus`; an accent text or icon is `text-text-primary`. The
  high-priority level in Notifications is amber.
- Broken classes fixed rather than hidden: `bg-dark-600` (now the hover
  grey), `dark-950`, `text-dark-400` / `-500` (now `text-text-muted`),
  `accent-emerald`, `-yellow`, `-gold` and `-cyan` (never defined; now
  green, amber, amber and primary text), the `animate-in` family (no plugin;
  dropped, so nothing was installed) and `text-text-text-secondary`.
- `font-mono` stays on 41 elements, each a task key or a time; the others,
  about 160 wrappers, are gone. Uppercase stays on key inputs and log
  badges only.
- Checked in a browser on the renderer alone, with a stub bridge, for
  Today, Tasks and Settings. The pictures in `USER-GUIDE.md` and the README
  are not remade: `pnpm docs:images` needs SprintTicker closed, so it waits
  for the user, with P3's.

---

## 8. P3 -- The shell: four places, the header, Settings in six groups

**Goal:** Today, Tasks, History and Settings, as in S4–S24, with every
existing feature in its new home. The flows are still today's (the picker,
the end dialog and the prompts change in later phases), so this phase is
moving, not rewriting.

- **Split `App.tsx`**:
  - `AppShell` (sidebar, header, and the view switch, still without a
    router);
  - `TodayView`, which takes the inline "Today's work" table out of
    `App.tsx`, lines 155–210;
  - a `useModals` hook for the global modal flags.
- **Sidebar**: Today (with the ⚡ count), Tasks, History, and Settings at
  the bottom. `BAR_ONLY_TABS` goes: nothing appears or disappears without a
  bar (proposal §2.3).
- **Header** (S5):
  - the logo;
  - the LED preview, only with a bar, with the remote pad moved out;
  - the **mode chip** Work / Lunch / Away, with its menu and tooltips. It
    replaces the mode switch hidden in `PriorityRulesView`, and reads and
    writes through `priority:get-user-mode` / `set-user-mode`;
  - **▭ Mini timer**;
  - **☾ End my day** (it opens today's `EodWrapUpModal` until P10);
  - the **status entry**, "All good ▾", which opens the panel of S27.
- **The status panel** (`StatusPanel`, new). The rows S27 shows, each from
  an existing source:
  - the bar's state (`useDeviceStatus`);
  - entries waiting (`provider:get-sync-queue`);
  - the update (`updates:*`);
  - "What you missed": the provider events and mirrored notifications
    already logged (`provider-events:*`, `notifications:*`).

  The header's word follows the worst row: "All good", "2 waiting",
  "Sending stopped", "Update". The old badge's tooltip pointed at "the sync
  queue in Settings", which no longer exists.
- **Settings in six groups** (S19–S24), one page each with a side list and a
  search box. Every existing card moves; none is rewritten:
  - **General**: `LaunchAtLoginCard`, `InterruptShortcutCard`,
    `UpdateSettingsCard`, close behaviour (P12), Run setup again.
  - **Account**: `SettingsView`'s provider, credentials, scope, transitions,
    ad-hoc key, `ProviderEventsSection`. `SyncQueuePanel` is folded.
  - **My workday**: `CeremoniesView`, whole.
  - **Desk devices**:
    - from `DeviceDiagnosticsView`: status, key colour, connection (folded),
      idle clock, use without a bar;
    - `NotificationSettingsView` (the per-app rules);
    - `PriorityRulesView` as "What the bar shows first", without its mode
      switch;
    - the Stream Deck block.
  - **Data**: Export logs, Erase everything.
  - **Developer**, hidden until "Show developer tools" (General): the remote
    pad, `AnimationDebugPanel`, the notification debug triggers, the input
    console, the listener diagnostics, display health.
- **The fixes of the proposal's §7 that this phase touches**:
  - `AnimationDebugPanel` stops calling the real `pauseSession` and
    `setUserMode`, or says plainly that it does (S24 keeps the warning).
  - "Build 2026.07" is replaced by the bar's reported firmware.
  - The wizard's dead links ("Settings > Device", "Settings > Task
    Providers") point at the new homes.
  - Project edit and delete stop being hover-only, and deleting a task asks
    first.
- **The bar's two pickers**: `App.tsx` stops opening the window's picker on
  `TRIGGER_TASK_SELECTOR_MODAL` when the bar has opened its own (the
  decoder sends that action only when the window's picker is meant). The
  rest of the bar waits for P14.

**Tests:**

- The existing renderer tests move with their components. Text queries
  change only where a label moved, not where it was reworded.
- New tests: `app-shell.test.tsx` (four places, no tab hidden without a
  bar), `status-panel.test.tsx` (the worst row wins), and
  `settings-groups.test.tsx` (every former setting is reachable; search
  finds it).

**Docs:** `USER-GUIDE.md` (structure and navigation), `ARCHITECTURE.md`
(renderer layout), `README.md` (feature list), `CHANGELOG.md`.

**Done when:** every item of the proposal's §8 inventory has its home
(checked off in the PR), and a run without a bar shows the same four
places.

**As landed (2026-11-10):**

- `App.tsx` is the place, the session and the modals; `AppShell`,
  `TodayView`, `useModals`, `ModeChip`, `StatusPanel` (with
  `utils/status-summary.ts`), `BarRemotePad` and `SettingsPage` (with
  `settings-groups.ts`, the index the search reads) are new. The existing
  views mount whole or by a `part` prop (`DeviceDiagnosticsView`,
  `NotificationSettingsView`), so no card was rewritten.
- The header word's ties go sending > bar > update: time not reaching the
  provider is worse than a bar out.
- **Not done here:** "What you missed" lists the mirrored notifications
  from the listener's log only -- nothing lists past provider events yet,
  so those wait for a store (P4 or later). The status panel's update row
  has no "Get it"; `UpdateBanner` stays above the place. Close behaviour is
  P12's. `AnimationDebugPanel` still acts on the real timer and mode, and
  the Developer group says so (S24's warning), rather than being cut off.
- The inventory check is the search index: every former setting has an
  entry with its old name among its keywords, and
  `settings-groups.test.tsx` finds the old names. There is no PR to tick,
  since phases are committed locally.
- Checked in a browser on the renderer alone, with a stub bridge: the
  header, Today, Tasks, Settings' groups and the status panel. Pictures
  wait for `pnpm docs:images`, with P2's.

---

## 9. P4 -- Data for the new flows

**Goal:** the stores the new flows read, in one migration, before any screen
needs them.

**Migration 14:**

- `task_stars (provider_id, task_key, task_id NULL, starred_at_utc)`. Keyed
  by provider and **key**, not id alone, so a star survives a task being
  retired and fetched again. "Starred" reads join on key.
- `active_sessions.previous_task_id`: the task the session replaced, set by
  `startTask` when it stops one. "Previous task" is the most recent
  completed session's task that is not the current one: a pure function in
  `shared/previous-task.ts` over the last sessions, with the stored column as
  its fast path.
- Settings keys (`settings` table, JSON; no schema change):
  - `provider_display_name`;
  - `start_side_effects` `{ enabled: boolean, afterSeconds: 120 }`;
  - `done_state_by_project` `{ default, overrides: { [projectId]: state } }`;
  - `prompt_delays` `{ nothingTiming: 10, longPause: 30, standupRunning: 25,
    interruptionRunning: 20 }` (minutes);
  - `shortcuts` `{ interrupt, switch, previous, back }`;
  - `close_to_tray: true`;
  - `standup_task`.

**Recent tasks** need no table: the last six distinct tasks from
`active_sessions`, newest first. Unnamed interruptions are left out (S7).
This is `TaskRepository.getRecent(limit)`.

**IPC (new):** `tasks:star`, `tasks:unstar`, `tasks:get-starred`,
`tasks:get-recent`, `session:get-previous`. Each goes in the preload, the
bridge and the mock.

**Tests:**

- `migrations.test.ts`: 14 applies on 13; stars survive retire and re-fetch.
- `previous-task.test.ts`.
- `TaskRepository` recent and stars tests.
- `pnpm db:check-migration` run by the user on a copy of the real database:
  no worklog or second lost.

**Docs:** `ARCHITECTURE.md` (data model), `API.md` (channels).

**As landed (2026-11-10):**

- A star is kept by provider and key, except an ad-hoc task's: every one
  shows the configured key (`MISC-1`), so its star is kept by its id under
  `adhoc` (`shared/task-stars.ts`). A task whose project has no row stars
  under `local`, the unknown provider.
- "Can be offered" -- for Recent and Previous alike -- is listed (not
  archived) and named (not an unsorted interruption): `isOffered`. A
  teammate's task in progress is listed, so it can be recent.
- `previous_task_id` is not written when a task is started again over
  itself. Ended sessions are looked through 20 deep for the fallback.
- `tasks:star` and `tasks:unstar` answer the starred list, so a view
  needs no second read.
- The settings keys have readers, not IPC: `shared/flow-settings.ts`,
  each answering a whole value from whatever is stored. A stored chord that
  could not register (`chordProblem`) reads as the default. The phases
  that use a key wire it; P6, which builds `ShortcutService`, also
  decides how the existing `interrupt_shortcut` carries over.
- `pnpm db:check-migration` on a copy of the real database, run by the
  user from an ordinary terminal: schema 13 to 14, 20 worklogs and 7 queue
  rows kept, nothing orphaned (2026-11-10).

---

## 10. P5 -- The send pipeline

**Goal:**

- every send waits 10 s and can be undone;
- an overlap holds its later entry;
- In Progress and assignment wait for two minutes of timing;
- Done goes to the project's own state.

The glossary's "Logged · Sent · Waiting" becomes true.

### 10.1 The hold and the undo

- **Queue rows get a hold.** `enqueue` writes `next_attempt_at_utc = now +
  UNDO_WINDOW_MS` (10 000, in `sync-constants.ts`) for every CREATE, UPDATE
  and DELETE that comes from a user action. `getPendingQueueItems` already
  skips rows not yet due, so the worker needs no new branch. The immediate
  `processPendingQueue` after `finishSession` becomes a dispatch at the end
  of the hold.
- **`UndoService`** (new, `src/main/services/undo-service.ts`): holds the
  last action for 10 s, as `{ kind, label, expiresAt, undo() }`.
  - **Stop** → delete the queue rows and worklogs written by `finishSession`
    and reopen the session. Same id, pauses kept.
  - **Discard** → `discardSession` becomes a soft delete for 10 s.
  - **Place / Move / Correct / Delete** → drop the queued rows and restore
    the local rows.
  - **End my day** → the stop's undo, plus no shutdown (P10, §15).

  Only one action is undoable at a time. A new one commits the previous at
  once, so two holds never chain.
- **No undo after the hold.** A row the worker has claimed
  (`claimSyncItem`) cannot be undone. The undo's expiry and the claim read
  the same clock, so there is no race. A test proves an undo at 9.9 s wins
  and one at 10.1 s is refused.
- **Where Undo shows** (D6): a bar at the foot of the window, a row on the
  mini timer, and the OS toast's click (which opens the window on that bar).
  IPC: `undo:get`, `undo:run`, `undo:on-changed`.

### 10.2 Overlaps

- **`shared/overlap.ts`** (new): `findOverlaps(worklogs)` on local wall
  time, and `heldByOverlap(worklog, sameDay)`. The **later** entry of an
  overlap is held (S15b: "the later entry is not sent until the overlap is
  fixed").
- `getPendingQueueItems` skips CREATE rows whose worklog is held. The
  worklog's `syncState` reads a new value, `held-overlap`, which shows as
  "waiting · overlaps PF-31".
- **Add time and Correct warn before saving** (S16, S16b). Saved anyway, the
  entry is held. Fixing the overlap releases it at the next dispatch.
- Overlaps already sent stay sent. The rule applies to what is not yet
  sent, and Check my week lists both kinds.

### 10.3 Side effects after two minutes

- `TimeTrackingEngine.takeUpTask` and `claimTask` no longer run in
  `startTask`. A `SideEffectScheduler` (new, owned by the engine) fires them
  once a session has been **TRACKING** for `start_side_effects.afterSeconds`
  in total. Paused time does not count, and a stop or switch before then
  cancels them: "a glance moves nothing" (S20).
- `start_side_effects.enabled = false` → neither ever runs. The setup
  question (S1) and Settings › Account write it.
- The toast "Started MG-15 · After 2 min of timing it moves to In Progress"
  (S26) is the scheduler's first fire.

### 10.4 Done per project

- `done_state_by_project`: Jira's `configuredTransitionFor` and OpenProject's
  completion action read the project's override, then the default. The UI is
  S20's "All projects: To Review ▾ · 3 projects differ…".
- A state the project's workflow lacks fails the transition. That is
  reported like any failed transition, and the time is still sent.

**Tests:**

- `sync-queue.test.ts` (rows are not due before 10 s; dispatch at the end of
  the hold), `undo-service.test.ts` (each kind; the 9.9 s / 10.1 s boundary;
  one undo at a time), `overlap.test.ts`, `side-effect-scheduler.test.ts`
  (fires after 120 s of tracking; never after a stop at 119 s; paused time
  does not count), and the existing `task-claim` and
  `tracked-task-reassigned` suites adjusted.
- `display-stress`: Stop and Undo crossing a dispatch.

**Docs:**

- `ARCHITECTURE.md`: the send pipeline.
- `USER-GUIDE.md`: Undo, waiting, overlaps.
- `CLAUDE.md`, three rules:
  - every user send waits `UNDO_WINDOW_MS`, and only `UndoService` undoes;
  - side effects run from the scheduler, never from `startTask`;
  - an overlapping entry is held, never sent.

**As landed (2026-11-10):**

- Undo is generic: each action records a `RestorePoint` (the rows it
  touches, before and after, rowids kept) and Undo puts "before" back, or
  refuses when any queue row moved meanwhile. No action has a hand-written
  inverse. A Done transition is held with its stop (`holdRemote`) and runs
  when the action is final; starting a session makes a held stop final.
- Undoable: Stop, Done and Discard from the window, the mini timer and the
  deck; correct, move and delete from History. End my day has its kind
  (`end-day`) but is offered by P10. **Not yet:**
  the bar's own STOP and DROP (P14), and the OS toast's click (no toast is
  posted for an action yet). The S26 toast for the first side effect is not
  posted either.
- The overlap rule is TypeScript (`shared/overlap.ts`) and SQL
  (`getPendingQueueItems`), both run by `overlap.test.ts`; the History badge
  reads "Waiting · overlaps KEY", and Correct warns before saving.
- The side-effect wait is `start_side_effects` (2 min by default), set in
  Settings, Account, *When I start a task*: off, or right away, 1, 2 or 5
  min. The setup question (S1) that also writes it comes with P7.
- Done per project: `done_state_by_project.overrides`, set per project
  under each provider's completion action. Its `default` stays null from
  the window -- the completion action is the choice for all projects, so
  there is one place for it, not two.
- Flow settings reach the window through `flow-settings:get` / `:save`,
  each value made whole by its reader before it is stored. Later phases
  wire their keys through the same pair.
- `display-stress` has no "Stop and Undo crossing a dispatch" case: an undo
  touches the queue and the session, never the display directly, and the
  engine's notification after it is the one a resume already makes.

---

## 11. P6 -- Interruptions in a row

**Goal:** the model of §34 and S9–S12b. The interrupted task waits as it
was, each ⚡ is a fragment in a row, and each fragment is placed on a task,
kept off the provider, or left for later.

### 11.1 The model (D2)

An interruption is no longer a session on an ad-hoc task. It is a
**fragment**, and the interrupted session is **paused, with a reason**:

- **Migration 15: `interruptions`.**
  - Identity and time: `id`, `started_at_utc`, `ended_at_utc NULL`.
  - Description: `name NULL`, `source` (`window | mini | tray | bar | deck |
    shortcut | notification`).
  - Its run: `interrupted_session_id NULL`, `interrupted_was_paused`, and
    `after_id NULL` (the fragment before it in the same run).
  - Its fate: `placed_task_id NULL`, `placed_worklog_id NULL`, `kept_off`,
    `discarded_at_utc NULL`.
- **`paused_intervals.reason`**: `user | interruption | lunch | away`,
  default `user`. The interrupted session gets a pause with reason
  `interruption`, started at the fragment's start, so backdating is
  `pauseSessionAt`, which already exists.
- **One fragment runs at a time.** A unique partial index on
  `ended_at_utc IS NULL` enforces it, as migration 6 does for sessions.
- **Placing** writes a worklog on the chosen task (the fragment's span and
  name as the note) and queues it, with the hold of P5. **Keep off** writes
  nothing to the provider: the fragment stays in history. **Later** is
  simply unplaced.
- **Legacy data.** Unsorted ad-hoc tasks (migration 13) with their worklogs
  become fragments, placed or not. The ad-hoc tasks and rows are kept until
  `db:check-migration` proves the copy loses nothing; a later migration
  retires them.

### 11.2 The actions

These go in `InterruptionService` (new). `ContextScheduleService.interrupt`
calls it instead of `engine.startInterruption`.

| Action | Effect |
| :--- | :--- |
| **Interrupt** (`startedAt?`) | Pause the running session with reason `interruption` at `startedAt` (default now; never before the session's start); open a fragment. Nothing is logged or sent |
| **Another** | Close the running fragment; open the next, `after_id` set, same interrupted session |
| **Back** (`addGapMinutes?`) | Close the fragment; resume the interrupted session if it was running, leave it paused if it was paused. "Back +6m" ends the pause 6 min earlier |
| **Stop** | Close the fragment; the interrupted session stays paused; "Back?" is asked (S10) |
| **Switch task** (`taskId`, `takeAlong`) | Close the fragment; stop the interrupted session (it stays open at the provider); start `taskId`. With `takeAlong`, place the fragment on `taskId` |
| **Discard** | Mark the fragment discarded; 10 s undo |
| **Rename, Place, Keep off, Later** | On any unplaced fragment, any day |

- **`switchSettingAside` is not used by interruptions any more.** It stays
  for the stand-up, and Lunch keeps its rule of taking over a set-aside
  task. The interaction rules of `CLAUDE.md` §5 ("once, the same day, not over an open
  session, Lunch takes it over") are re-read against the new model, and
  `CLAUDE.md` §5 is rewritten in the same commit.
- **Time adds up.** The interrupted session's total excludes the fragment,
  because it was paused. The fragment's time is its own. Nothing is counted
  twice, and `splitWork` still splits the session at a pause of
  `splitPauseMinutes`.

### 11.3 The prompts and shortcuts it brings

- **"Back to MG-12?"** (S10): after Stop, once, with "↩ Back", "↩ Back, add
  the 6 min" and "Not now". A toast after 10 min with no answer in working
  hours. `ResumePromptDTO.after = 'interruption'` keeps its name.
- **"Still on it?"** after `prompt_delays.interruptionRunning`: once per
  fragment.
- **Shortcuts.** `InterruptShortcutService` becomes `ShortcutService`, with
  four chords from `shortcuts`:
  - **Back** does nothing outside an interruption;
  - **Interrupt** during an interruption is Another;
  - **Switch** opens the picker (P7);
  - **Previous** switches to the previous task (P4).

  Its recording and "taken" rules apply to each chord.

### 11.4 What the surfaces read

`ActiveSessionDTO` gains:

- `interruption { id, name, startedAt, index, ofRun, source, interruptedTaskKey }`;
- `toPlace { count, seconds }`;
- `previousTask`.

The renderer, the tray, the mini timer, the bar and the deck read only
these. Nothing re-derives them.

**IPC (new):** `interruption:start` (replaces `session:start-interruption`,
which stays as an alias for one release), `another`, `back`, `stop`,
`switch`, `discard`, `rename`, `place`, `place-many`, `keep-off`,
`get-to-place`, `on-updated`.

**Tests:**

- `interruption.test.ts`, rewritten around the model: the Marc, Ana, Marc
  case gives 3 fragments; Back resumes a running task, and leaves a paused
  one paused; backdating comes off the task; Switch with and without
  `takeAlong`; Stop then Back +6m; Lunch during an interruption.
- `migrations.test.ts`: legacy unsorted tasks become fragments.
- `interrupt-shortcut.test.ts` grows into `shortcut-service.test.ts`.
- `display-stress`: Interrupt, Another and Back join the sources, through
  `InputDecoder` as well as IPC.
- `pnpm db:check-migration` by the user.

**Docs:**

- `ARCHITECTURE.md`: the interruption model.
- `USER-GUIDE.md`: interruptions in a row.
- `API.md`: channels.
- `CLAUDE.md` §5: interruptions are fragments; the interrupted session is
  paused with a reason, never stopped.
- `AUDIT-INTERRUPTIONS.md`: a status line saying the model was replaced.

**As landed (2026-11-10):**

- The model is as planned: migration 15 adds `interruptions` and
  `paused_intervals.reason`, one fragment at a time by a partial unique
  index, and the held session is paused with reason `interruption`, never
  stopped. Unsorted ad-hoc worklogs became fragments with
  `legacy_worklog_id`; the ad-hoc rows stay until a later migration retires
  them.
- **The running fragment is the engine's, not `InterruptionService`'s.**
  While one runs, `getCurrentSession()` answers it as an ad-hoc session
  with `interruption` set, and the engine routes every command to it --
  pause, Stop and Done are Stop, resume is Back, a start is a switch,
  assigning is a switch taking it along, Interrupt is Another. The bar,
  the deck, the tray and the mini timer keep working until P12-P14 rebuild
  them. `InterruptionService` handles only the ones that ended: rename,
  place, place many, keep off, discard, each behind a restore point.
- `ActiveSessionDTO` gains `interruption` only. `toPlace` is read through
  `interruption:get-to-place` and pushed on `interruption:on-updated`, and
  `previousTask` through P4's channels: the session DTO goes out every
  second, and neither changes that often.
- **Keep off** is a local ad-hoc worklog, never queued. Placing an
  interruption of the model before moves its worklog
  (`WorklogCorrectionService.reassign`).
- The set-aside stays for the stand-up, and for entries an interruption of
  the model before stored. Lunch during an interruption stops it, and stops
  the held task if it was running, keeping its restart; the wrap-up stops
  both.
- **"Back, add the 6 min"** is a second action on the existing resume
  prompt, "Resume, and count the time since as work", with the minutes
  read at the click from `interruptionEndedAtUtc`. P8 rebuilds the prompt
  as S10's card.
- The window: the session card and the mini timer show Back, Stop and
  Another during an interruption, never Pause or Finish; the tray menu
  follows the engine (Back to KEY, Stop the Interruption, Another
  Interruption). History and the wrap-up share one list,
  `InterruptionsToPlace`: rename, Place…, Place all, Keep off, discard.
- `pnpm db:check-migration` passed on the real database, run by the user:
  13 to 15, 20 worklogs and 7737 s kept, 7 queue rows, no foreign key
  broken.
- **Not yet:**
  - `ShortcutService` and its four chords. `InterruptShortcutService` still
    owns the Interrupt chord, which is Another during an interruption, and
    its toast says which task waits. Back, Switch and Previous chords move
    to P12, which owns everything outside the window.
  - "Still on it?" and the "Back?" toast after 10 min go to P8, with the
    other prompts and reminders.
  - `display-stress` has no Interrupt, Another or Back source yet; P14 adds
    them with the bar's own controls.

---

## 12. P7 -- One picker, its own window, the command palette

**Goal:** S7–S8 and S12–S12b. One picker, for Start, Switch, Place and
Move, opened in the window, or as its own small window from the tray, the
mini timer and the deck.

- **`TaskPicker`** (new, replacing `TaskSelectionModal`'s two steps). Modes
  `start | switch | place | move | place-many`. Search first, across all
  projects. The groups, in order:
  - the previous task;
  - Recent (6);
  - Starred (★, ☆ on hover);
  - Assigned to me, open across projects (in progress first, then to do by
    priority);
  - All projects, starred first, then most used.

  The rules:
  - **Typing a key and a space filters to a project** (S7c).
  - The show pills (mine / unassigned / teammates') are
    `shared/task-visibility.ts`, unchanged. The order is
    `shared/task-order.ts`.
  - **"Fetch MG-77 from Jira"** appears when the search looks like a key and
    nothing matches. It needs `ITaskProvider.getTaskByKey?` (new, optional;
    Jira `/issue/{key}`, OpenProject by id), and `canFetchByKey` hides it.
  - **"Put 'Call with Marc, again' on it too"** (S7) shows only when opened
    from an interruption. It maps to P6's `takeAlong`.
  - **Place mode** (S12b): each row's menu opens on Starred, then Recent with
    the tasks just chosen first. Nothing is preselected (§19 and §29 of the
    proposal). An unnamed fragment asks for a name when its task is chosen.
  - The old "Create Custom / Ad-Hoc Task" path stays, as "+ A task of my own".
- **A picker window**: `PickerWindowManager` (new, `src/main/windows/`),
  a small frameless window loading the same bundle at `#picker`, as the
  mini timer does at `#mini`.
  - The tray, the mini timer, the deck, the shortcut and the bar's "open in
    the window" open it.
  - It is raised with `ForegroundRaiser`, never `focus()` alone. The press
    reaches another app (`CLAUDE.md` §3).
  - `openTaskPickerInMainWindow` stays as the fallback until the window has
    run on a packaged build.
- **The command palette** (S30, Ctrl+K in the window): renderer only. It
  lists the actions of the glossary that the current state allows, from
  `shared/words.ts` and the session DTO, and the settings by name. Typing
  "sort" or "assign" finds Place: synonyms are listed, so the old words still
  lead somewhere.
- **The Projects tab's own Start / Switch buttons and its second
  `FinishSessionModal` go.** The rows open the picker's actions, so there is
  one flow.

**Tests:**

- `task-picker.test.tsx` (each mode; groups and order; a key and space;
  fetch by key shown only with the capability; nothing preselected in place
  mode; just-chosen first), `picker-window.test.ts` (the window opens, is
  raised with `ForegroundRaiser`, and falls back), `command-palette.test.tsx`
  and `jira-provider` / `openproject-provider` `getTaskByKey`.

**Docs:** `USER-GUIDE.md` (finding a task), `API.md` (`getTaskByKey`,
channels), `PROVIDER-API.md` (fetch one task by key, **before** the client:
`CLAUDE.md` §9).

**As landed so far (2026-11-10): P7a, `12bca71`.**

- `TaskPicker` (`src/renderer/components/TaskPicker.tsx`) replaces
  `TaskSelectionModal`, which is deleted. Modes `start | switch | assign |
  place | move`; `place-many` is "Place all" choosing one task, not yet S12b.
  It reads one snapshot, `tasks:get-picker` (`PickerDataDTO`), and groups it
  with the pure rules of `shared/task-picker.ts`: previous (switch only),
  Recent, Starred, Assigned to me (preview 5, then "all N"), All projects
  (starred first, then seconds logged over 30 days), own work. Place opens on
  Starred, then Recent with `justChosen` first, and offers Keep off.
- Inside a project the list is **one ordered list** (`task-order.ts`, yours
  first), not status sections as S7c draws: sections put a teammate's task in
  progress above the user's to do, against the lists' one order.
- Fetch by key: `task_by_key` (PROVIDER-API 7.9), `getTaskByKey` in Jira
  (`/issue/{key}`) and OpenProject (`OP-1234`, `#1234`, `1234`; an epic or
  milestone is none), `tasks:fetch-by-key`, which keeps the task and refuses
  one in a project not listed. The fakes now name each task's project.
- Take-along when switching from an interruption is unticked by default;
  the pick goes to `interruption:switch`.
- The picker lists only projects with a task, always; the "only projects
  with tasks" switch stays in Tasks and the bar's picker.

**As landed: P7b, the picker window (2026-11-11).**

- `shared/picker-window.ts`: `PICKER_WINDOW_HASH`, `pickerWindowHash(mode)`
  and `readPickerWindowHash`; `#picker` or `#picker?mode=assign`, read by
  `main.tsx`, which mounts `components/PickerWindow.tsx` (`TaskPicker
  asWindow`; Start or Switch from the session, Assign from the hash).
- `src/main/windows/picker-window-manager.ts`, as designed, with two
  departures: the window is centred on the display **under the pointer**,
  not the primary one -- the tray, the mini timer and the user are there --
  and it **closes on `blur`**, as a launcher does, so a picker forgotten on
  top of the user's work does not stay. Opening it again in the same mode
  brings it forward; in the other mode, replaces it. The raise is asked
  only for the deck (`{ raise: true }`): a click on the tray or the mini
  timer already gives the app the foreground, and each raise is a
  PowerShell process.
- `pickTask` moved to `renderer/utils/pick-task.ts` and now settles once
  main has answered; the window closes after that, never before.
- Callers: the tray's picker entry (a sixth, optional `TrayManager`
  argument), the deck's `openPicker`, `mini:open-task-picker` and
  `mini:open-assign-picker` (`pickerWindow`, an optional registry dep). The
  bar still raises the dashboard with its picker (P14). The tray entry keeps
  its old label until the tray's phase.
- Checked against S7 in the browser pane, at the window's 600 × 640: the
  same groups and order; a border was added, the window's only edge.
  Still unlike S7, from P7a: the footer has no "A click starts the task"
  hint, and the Starred heading no "hover a task, click its ☆".

**As landed: P7c, the palette, the Tasks rows and S12b (2026-11-11).**

- **The command palette** (`components/CommandPalette.tsx`, rules in
  `renderer/utils/palette-actions.ts`), Ctrl+K on the window (a `keydown`
  listener, never a global chord). Actions from the session and the words
  of `words.ts`, each with synonyms; settings by name from
  `settings-groups.ts` once something is typed; tasks by `matchesSearch`
  under the task visibility, six at most, "switch to it" / "start it".
  Done and Discard are left out: each asks a question first, and P8's
  Stop ▾ is their place. S30's "Check my week" waits for P9.
- **Tasks**: the rows' Start / Switch go through `pickTask` (so during an
  interruption it is `interruption:switch`), Stop is one click
  (`completeSession(undefined, false)`, undoable), and the second
  `FinishSessionModal` is gone. Today's still holds it until P8.
- **S12b** (`components/PlaceInterruptionsDialog.tsx`): "Place all" opens
  one row per interruption with its own choice, made in the place picker
  (`justChosen`, the latest first), not an inline menu as drawn. Context:
  time, length, "during", and "after '…'" while the one before is still
  listed, else "N of M"; "from the bar" for an unnamed one. An unnamed row
  asks a name once its task is chosen; left blank, it goes as it is.
  Names are sent first, then one place per task, then the rows kept off;
  a closed week asks once. Each place is its own undo: Undo takes back the
  last one only.
- Checked against S30 and S12b in the browser pane on a stub bridge: the
  same layout and words; the subtitle's provider name was lowercased and
  is fixed.

---

## 13. P8 -- Today and the prompts

> **From P6 (2026-11-10):** "Still on it?" after `prompt_delays.interruptionRunning`, and the "Back?" toast after 10 min, are this phase's. The resume prompt's "Resume, and count the time since as work" becomes S10's "↩ Back, add the 6 min".

**Goal:**

- S4–S6 and S25's prompt rows;
- a prompt never takes the focus;
- Lunch and Away pause;
- the stand-up has "joined ▾";
- the reminders ask once.

### 13.1 Today

- **The session card** (S5):
  - Pause / Resume;
  - **■ Stop ▾**, a split button whose menu (S11) holds ✓ Done and
    Discard…, replacing "Finish & Log Hours" and `FinishSessionModal`'s
    three choices;
  - ⚡ Interrupt, ⇄ Switch task, "Previous task: PF-31";
  - "sent to Jira when you stop, after 10 s to undo".

  During an interruption it becomes S9: the name, "started now ▾", Back,
  Switch task…, Stop and ⚡ Another.
- **The interruptions card**: to place, from any day, with ↳ Place… and ⋯
  (Rename, Keep off), Place all, and ticked rows.
- **Today's entries**: one row per entry, with ⋯ (Correct, ↳ Move, Delete),
  and a Jira column (sent / waiting / held).
- **The morning card** (S4b), the first time the window opens on a working
  day:
  - Continue the last task;
  - yesterday's fragments to place;
  - the stand-up's time;
  - the tasks in progress.
- **The reassigned card** (S5b): Keep timing / ↳ Move my 1h 24m… / ⇄ Switch.
  The owner is checked **every minute** for the running task, not only after
  a sync. A single-task read (`getTaskStanding`) on a timer in the engine,
  skipped when the provider cannot answer it.

### 13.2 Prompts without focus

- **Remove `show()` + `focus()`** from `triggerStandupPrompt`,
  `triggerEodPrompt`, `ForgottenSessionService.send(bringForward)` and the
  bar's window callback. A prompt is:
  - a card on Today;
  - a row on the mini timer;
  - a toast, only if the window is hidden.

  The toast's click opens the window on the card (P12).
- `StandupPromptModal` (closes itself after 10 s) becomes a card that stays
  until Join, Skip or Remind me in 10 min.
- `ResumeAfterLunchPrompt` becomes the Lunch / Away card and the "Back at
  your desk?" row.

### 13.3 Lunch, Away and the stand-up (D1, D3)

- **Lunch pauses** the running session with reason `lunch`:
  - `enterLunchMode` pauses instead of stopping;
  - `exitLunchMode` asks "Back at your desk?" (Resume / I worked through it
    / Not now). "I worked through it" withdraws the lunch pause
    (`withdrawPause` exists) and resumes.
  - The rules of `CLAUDE.md` §5 are rewritten with it: "a session going
    TRACKING during lunch ends Lunch for the day", "Lunch stops the session
    under Away too", and "AWAY to LUNCH lets go of Away's lock". The
    priority-engine side (locks, `setUserMode`) does not change; only what
    happens to the session does.
- **Away pauses** with reason `away` and shows its card (S6). Leaving Away
  asks the same question.
- **Presence still never pauses** (proposal §31). Away is the mode, entered
  by locking the PC or by the chip; being away from the PC is not.
- **The stand-up**:
  - `joinStandup` takes `joinedAt` ("joined ▾ now / 2 / 5 / 10 / other…").
    The minutes come off the task, as an interruption's do.
  - `standup_task` set → the stand-up is timed on that task and sent;
    unset → the local "Daily Standup" as today.
  - "Still in it?" after `prompt_delays.standupRunning`; ending it then can
    end it at its usual length.
- **A question during an interruption** (S25): "Start lunch? It ends 'Call
  with Marc'" / "Join? It ends …". Answering yes closes the fragment, which
  waits to be placed.

### 13.4 The reminders

`ReminderService` (new; evaluated on `ContextScheduleService`'s 30 s tick,
in working hours only) asks each of these **once**:

- **Nothing timing** for `prompt_delays.nothingTiming`;
- **Still paused?** after `longPause`;
- **Still on it?** for an interruption (P6);
- **Still in the stand-up?**

Each is a row on the mini timer, a card on Today and, with the window
hidden, a toast. "Not now" is final for that occurrence; the tray stays
amber while nothing times.

**Tests:**

- `lunch-resume.test.ts`, rewritten for pause: one entry per morning, split
  at the lunch pause; I worked through it; Lunch under Away; a session
  started during lunch.
- `standup-switch.test.ts` (joined at; on a task; local).
- `reminder-service.test.ts` (each once; working hours; Not now).
- `no-focus.test.ts` (no prompt path calls `focus()`).
- `display-handback.test.ts`: Lunch pausing while the bar shows the task.
  The sandwich scene and the paused frame must not cross, so this has a
  scripted case.
- The renderer tests for every card.

**Docs:** `USER-GUIDE.md` (Lunch, Away, the stand-up, reminders),
`ARCHITECTURE.md`, `CLAUDE.md` §5 (Lunch and Away pause; prompts never take
focus).

**Split (2026-11-11), each committed on its own:** P8a the session card
(S5, S9's buttons, S11); P8b Lunch and Away pause (13.3's first half, with
`CLAUDE.md` §5); P8c prompts without focus and the stand-up (13.2, the rest
of 13.3 -- itself split on 2026-11-11 into P8c1, the prompts without focus
and the cards, and P8c2, the stand-up's joined-at and task, S25's question
during an interruption; S9's extras moved to P8e); P8d the reminders
(13.4); P8e Today's other cards (entries, the morning card, the reassigned
card with its minute check, the interruptions card's ticked rows and ⋯) and
S9's extras (the name field, "started now ▾", the task chips, the
first-interruption line).

**As landed: P8a, the session card (2026-11-11).**

- `ActiveTaskHeroCard` rebuilt: the state word (Running / Paused / Nothing
  timing, `StateWord`), the key and the task page, "sent to Jira when you
  stop, after 10 s to undo" (or "kept on this computer, never sent" for
  ad-hoc and own-project work), the title, the time, and one row of verbs
  from `words.ts`.
- **`StopMenu`** (new, S11): ■ Stop in one click (`complete(undefined,
  false)`); ▾ opens ✓ Done (two clicks; "no longer yours" asks first, with
  Back, Stop instead, or Mark it done anyway) and Discard… (asks once,
  naming the time). Done is hidden where the provider has no
  `canTransition`, and kept for work kept here. The day-split note of the
  old dialog moved into the menu. `FinishSessionModal` and its test are
  deleted; the window has no other finish dialog.
- **Previous task: PF-31** reads `getPreviousTask` when the running task
  changes and starts it in one press. Hidden during an interruption.
- During an interruption the row is S9's: Back to KEY, Switch task…, Stop,
  Another. "Assign to Task" there is gone: Switch task… with the picker's
  take-along does it. S9's name field, "started now ▾", the task chips and
  the first-interruption line are not built yet (P8c).
- Not as drawn: no project name beside the key (the session DTO has none),
  and the picture `app-session-tracking.png` still shows the old card --
  `pnpm docs:images` must run with SprintTicker closed, the user's call.

**As landed: P8b, Lunch and Away pause (2026-11-11).**

- `ContextScheduleService.pauseForBreak(reason)` replaces the stop for
  lunch: a running session is paused with reason `lunch` or `away` before
  the mode switches, and `lunch_resume` keeps `heldSessionId` and
  `pausedFor`. Lunch under Away relabels the entry; an interruption ends at
  lunch and its held task takes Lunch's pause (`relabelPause`, new on the
  engine); Away leaves an interruption running. The stand-up running at
  lunch is still stopped, its set-aside task becoming lunch's restart.
- "Back at your desk?" (`ResumePromptDTO.after` gains `'away'`, `held:
  true`) is asked when lunch or Away ends, only while that session is open
  and paused. Resume, **I worked through it** (`withdrawPause`, which now
  deletes the open pause row, `deleteOpenPause`) or Not now. The IPC answer
  takes a third argument, `workedThrough`. The bar shows the task's key with
  BACK? OK=YES.
- `CLAUDE.md` §5 rewritten: "Lunch and Away pause; they never stop", and
  "Lunch takes over Away's pause".
- Not yet: S6's Away card on Today, and prompts that never take focus
  (P8c).

**As landed: P8c1, prompts without focus (2026-11-11).**

- `PromptOutlet` (`windows/prompt-outlet.ts`, new): `send` to every window,
  `announce` a toast only while the dashboard is hidden or minimised, its
  click opening it (`ToastRequest.onClick`, new). `ContextScheduleService`
  and `ForgottenSessionService` take it by setter; neither calls `show()`,
  `focus()` or `restore()` any more.
- The ceremony is kept in main (`CeremonyPromptDTO`, `getCeremonyPrompt`,
  `schedule:get-ceremony-prompt`), closed by Join, `skipStandup`, snooze and
  `closeEodPrompt`. `CANCEL_STANDUP_PROMPT` no longer renders the session
  after its release (the double render of `CLAUDE.md` §5).
- Today: `StandupCard` (Remind me in 10 min / Skip today / Join; stays
  until answered), `BreakCard` (Lunch until 13:30 / Away since, with Resume
  or Back: resume, which also leaves Away; "I'm back" with nothing paused),
  and `ResumeAfterLunchPrompt` as a card instead of an overlay.
  `StandupPromptModal` and its test are deleted.
- The mini timer: `MiniPromptRow` takes the row while a question is open
  (the stand-up, Back at your desk?, Back to MG-12?, Resume it anyway?).
  The key moved into the heading to fit 360 px.
- The bar: OK on the stand-up's prompt and START pausing no longer raise the
  window. The wrap-up's confirm and a wheel click while timing still do.
- The mode chip's hints are S6's.
- Not as drawn: the wrap-up is still its dialog (opened in place, not a
  card); the forgotten-session question is still its dialog, unraised, with
  no mini timer row; Today's cards show only on Today, where the dialogs
  showed on every page; S25's "joined now ▾" is P8c2.

**As landed: P8c2, the stand-up and lunch during an interruption
(2026-11-11).**

- `startTask` takes `{ startedAt }` (`StartOptions`): the session starts
  then, held between the start of what it replaces and now, and what it
  replaces stops there (`stopSessionAt`), or the interruption it closes
  ends there. `startNamedAdHocTask` passes it on.
- `joinStandup(joinedAt?)`, from `schedule:join-standup`'s ISO argument.
  The card's "joined ▾" offers now, 2, 5, 10 and 15 min ago -- no "other…"
  yet.
- `standup_task` (`StandupTaskDTO`, `get/setStandupTask`, two channels): the
  stand-up runs on that task when it is still listed, else on Daily
  Standup. `isStandupSession` knows both. Chosen in Settings, My workday
  (`StandupTaskSetting`, the picker in place mode); S21's "Show me" is P16.
  The bar's meeting icon still follows a title containing "standup", so a
  chosen task shows the stopwatch.
- S25's question: a `LUNCH` ceremony prompt ("Start lunch? It ends …") on
  Today (`LunchQuestionCard`) and the mini timer, with a toast; Not now
  stores `lunch_skipped_date`. The stand-up's card and row say "Join? It
  ends …" during an interruption. The bar does not ask; it keeps the
  interruption's screen.
- "Still in it?" for the stand-up is P8d's, with the other reminders.

**As landed: P8d, the reminders (2026-11-11).**

- `ReminderService` (new) with the pure `dueReminder` and `inWorkingHours`,
  evaluated on `ContextScheduleService.onChecked` (new). Working hours are
  the stand-up's time to the wrap-up's, on a working day, in WORK.
  `ReminderDTO`, `reminders:get` / `reminders:dismiss` /
  `reminders:on-changed`.
- Today's `ReminderCard` and the mini timer's row share `reminderView`; the
  acting answers call resume, Back, Stop the interruption, or Stop
  (`completeSession`) for the stand-up.
- "Back to MG-12?" unanswered for `nothingTiming` minutes: one more toast
  (S10).
- `readStandupTask` now reads the `{ taskId, taskKey, title }` P8c2 stores;
  it still read a bare id, so `flow:get standup_task` answered null.
- Not yet: the tray's amber "nothing timing" mark (P12, with the tray's
  icon states); "End stand-up ▾" at its usual length (only End now); the
  delays in Settings (P16); the bar's NOTHING TIMING screen (P14). The
  asked ids are in memory, so a restart may ask once more.

P8e was split on 2026-11-11 into P8e1 (Today's entries and the
interruptions card), P8e2 (the morning card, the reassigned card and its
minute check) and P8e3 (S9's extras).

**As landed: P8e1, Today's entries and interruptions (2026-11-11).**

- `TodayEntries` (new) replaces Today's table: newest first, Task / Note /
  Time / Started / the provider's name, `SyncBadge` and ⋯ (`EntryMenu`:
  Correct…, ↳ Move…, Delete…), ⚡ and its legend, five rows then "+ N more
  · show all". The heading counts entries + the session running + today's
  interruptions to place, the sent part, and the part to place.
- Shared with History: `useEntryActions` (the dialogs, the closed-week
  question, the move one entry after another) and `SyncBadge`, moved out of
  `WorklogHistoryView`; `RowMenu` for every ⋯.
- `WorklogDTO.fromInterruption`, read from `interruptions.placed_worklog_id`
  / `legacy_worklog_id` (a kept-off one counts too).
- `InterruptionsToPlace` on Today: "· 3 · 45m" in its heading, tick boxes
  and "↳ Place N…" for the ticked, "Place all N…", the source
  (`INTERRUPTION_SOURCE_WORDS` in `shared/words.ts`), and ⋯ with Rename…,
  Keep off and Discard; `useInterruptionsToPlace` is its list.
- Not built: S5's "+ Add time" (no manual entry exists yet; P9's) and the
  bar against a daily target (no target setting; P16 if wanted). History's
  rows keep their own icons until P9.

**As landed: P8e2a, the morning card (2026-11-11).** P8e2 split in two: the
morning card here, the reassigned card with its minute check next (P8e2b).

- `MorningService` (new): `morning:get` / `morning:seen`, `MorningDTO`,
  `morning_seen_date`; `WorklogRepository.getLastEndOf`.
- `MorningCard` on Today, above the questions, while nothing runs:
  Continue, the earlier interruptions (Place them… scrolls to their card),
  the stand-up's time, the tasks in progress as one-press chips, Pick
  another…, and × to put it away. `useMorning` drops it at the first
  session update that carries a session, wherever it started, and tells
  main.
- "The first time the window opens" is read as the first look at Today
  before anything is timed: a card not seen stays until something starts.
- Not built: the target in "Nothing logged yet · target 7h 30m" (no target
  setting; with P8e1's).

**As landed: P8e2b, the reassigned card and the minute check (2026-11-11).**

- `getTaskStanding` answers `TaskStanding` (`state`, and an open task's
  `ownership` / `assigneeName`), both adapters reading the assignee in the
  same request; Jira checks `/myself` first (cached), so a refused token
  never reads as `gone`.
- `OfflineSyncWorker.checkStanding` and the engine's
  `checkStandingEveryMinute` (`TASK_STANDING_CHECK_MS`, first read a
  minute in, not during an interruption, never for ad-hoc work or own
  projects); `TaskRepository.setOwnership`; `taskLeftAtUtc` on the session.
- `TaskLeftCard` on Today (reassigned, closed or gone): Keep timing on it
  (remembered per session and reason in `sessionStorage`), ↳ Move my
  1h 24m… (`session:move-to`, `engine.moveSessionTo`: stop, `reassign`
  each entry, start), ⇄ Switch task.
- "1 min ago" is "at 14:32": a clock time needs no re-render each minute.
- Not yet: the mini timer's amber "MG-12 · Rin's now" (P12) and the bar's
  "MG-12 > RIN" (P14); they show their existing "left your list" marks,
  now within a minute too. The move offers no Undo: its entries' sends are
  held as any stop's, but no restore point is taken for the whole.

**As landed: P8e3, S9's extras (2026-11-11).**

- `InterruptionDetails` replaces the session card's title and amber line
  during an interruption: "MG-12 waits, as it was", the name field (saved on
  Enter or blur through `interruption:rename`), "Started now ▾" (2/5/10 min
  ago; first of a run only), "Which task is it for?" with Choose a task… /
  Change… / Later, and the first-interruption line with Got it
  (`first_interruption_seen`, a flow setting).
- Engine: `moveInterruptionStart` (floors: the held session's start and
  last pause, the previous fragment's end; the held task's open pause moves
  with the first of a run, `SessionRepository.moveOpenPauseStart`,
  `InterruptionRepository.setStart`) and `chooseTaskForInterruption`, placed
  at the end by `tellInterruptionEnded` (not at a discard). The choice is in
  memory; `RunningInterruptionDTO.chosenTask` carries it to every surface.
- Channels `interruption:move-start` and `interruption:choose-task`.
- Not as drawn: "other…" in the start menu (only now, 2, 5, 10); the task
  chips are one button and the chosen task, not a row of chips; the mini
  timer and the bar show the choice nowhere yet (P12, P14).

---

## 14. P9 -- History

**Goal:** S14–S16c. The day as a list and as a timeline, the week as a
timesheet, Check my week, and the corrections that were missing.

- **IPC (new)**:
  - `worklogs:get-range(from, to)`;
  - `worklog:create-manual` (Add time);
  - `worklog:split(id, at, taskId)`, which shortens one entry and creates
    another, in that order, through the queue;
  - `worklogs:export-csv(from, to)`.
- **The day** (S14): summary, per-task breakdown, the list with ⋯
  (Correct, Move, Delete), the older fragments to place, and the Jira
  column. Pieces already in `WorklogHistoryView` (metrics, breakdown,
  `SYNC_BADGE`) move to `shared/` where main or Check my week also need
  them.
- **The timeline** (S14b): the working hours as a strip.
  - Each block names its task; ⚡ marks a fragment; untracked time is
    hatched.
  - A click on a gap opens Add time, pre-filled.
  - Gaps come from `shared/day-gaps.ts` (new; working hours minus entries
    minus lunch).
- **The week** (S15): grouped by project with subtotals. A Day row and an
  "In Jira" row, which leaves out what is held, waiting or to place. The
  amber cells say why.
- **Check my week** (S15b): `shared/week-issues.ts` (new, pure) lists, each
  with its fix:
  - fragments to place;
  - unsent corrections;
  - days under target;
  - overlaps;
  - changes to a closed week.

  The week's close (`onWeekEnded`) opens it.
- **Add time** (S16b), **Split in two** (S16c) and **Correct** (S16) warn
  about an overlap and a closed week before saving (`isInClosedWeek`, which
  warns and never refuses).

**Tests:**

- `week-issues.test.ts`, `day-gaps.test.ts`, `worklog-split-manual.test.ts`
  (order of the queue rows; a closed week warns).
- `worklog-correction` additions.
- Renderer tests for the timeline (a gap opens Add time with its times) and
  the week (In Jira excludes held entries).

**Docs:** `USER-GUIDE.md` (History), `API.md`.

**Split** (2026-11-11), each its own commit:

- P9a: the day (S14) and Add time (S16b), on History and Today.
- P9b: the timeline (S14b) and `shared/day-gaps.ts`; a gap opens Add time.
- P9c: the week (S15), `worklogs:get-range`, `worklogs:export-csv`.
- P9d: Check my week (S15b), `shared/week-issues.ts`, opened at the week's
  close.
- P9e: Split in two (S16c), `worklog:split`.

**As landed: P9a, the day and Add time (2026-11-11).**

- History's day: the date as "Tuesday, November 10" between ‹ and › (the
  date input sits under it), **Today** when away from it; the summary line
  and the sends (`shared/day-summary.ts`: `summarizeDay`, `describeSends`,
  `BREAKDOWN_SHOWN` 4); the per-task line; the entries oldest first in
  `EntryRow`, shared with Today's list, with ⋯ (`EntryMenu`) in place of the
  three icon buttons. The three metric cards and the breakdown cards went;
  the day is counted from its entries, not `worklogs:get-daily-summary`.
- `worklog:create-manual` → `WorklogCorrectionService.add` /
  `addUndoably` (Undo kind `add`, "Added to PF-31 · 30m"). The manual entry
  has a session id `manual_…`; an empty note is `WORKLOG_COMMENTS.ADDED`.
  `checkManualWorklog` adds "ends on the day it starts" to a correction's
  rules.
- `AddTimeDialog` (S16b): the picker in `move` mode, hours and minutes, the
  start, the note; the overlap note offers "End it at 08:45 (15m)" when it
  starts before the other entry and "Start it at 09:30" when inside it; the
  closed-week note. It reads the entries of the start's own day.
- Not as drawn: no Day | Week switch yet (P9c brings the week), and the
  older-interruptions line is the existing "Interruptions to place" list.

**As landed: P9b, the timeline (2026-11-11).**

- `shared/day-gaps.ts`: `workingWindow` (the stand-up to the wrap-up on a
  working day -- the reminders' hours, so there is one definition; lunch
  clipped to them), `dayGaps` (less lunch, less every span, cut at now on
  today, stretches under `DAY_GAP_MIN_SECONDS` (5 min) dropped),
  `gapSeconds`, `spanOf`.
- `DayTimeline` in History's day card, between the per-task line and the
  list: the header "6h 50m logged · 40m untracked in working hours" and the
  hours; blocks named by task key (⚡ for a placed interruption, the label
  dropped under 4% of the strip), lunch, the running session on today
  (green), hatched gaps; marks every two hours; each gap again as
  "▨ 09:00–09:30 untracked · add time" with the legend. A gap opens Add time
  pre-filled; a block opens Correct.
- History reads the schedule and, on today, the session with the day; an
  unread schedule leaves the strip without hours, never the day without
  entries. Holidays are not read: a holiday on a working weekday shows its
  hours as untracked.
- Not as drawn: the mockup's working hours start before its stand-up (09:00
  against a 09:30 stand-up); no separate work-start setting exists, so they
  start at the stand-up. The strip and the list show together rather than
  behind a Day | List switch.

**As landed: P9c, the week (2026-11-11).**

- `worklogs:get-range` (`WorklogRepository.getWorklogsBetween`) and
  `worklogs:export-csv` (`shared/worklog-csv.ts`, the save dialog in main).
  Worklog reads now carry `projectId`, `projectName` and `providerSeconds`
  (the last `SYNCED` row on the worklog's task; no migration).
- `shared/week-sheet.ts`: `buildWeekSheet` (projects and tasks most time
  first, per day; Day; provider; to place), `dayNotes` (the amber cell's
  words) and `describeWeekExceptions` (the sentence under the sheet).
- `WeekView` under a Day | Week switch in History's header; the date stays
  one, so switching keeps the place, and ‹ › step a week. Monday to Friday
  always, a weekend day when it has time. The largest project opens, three
  are listed before "▸ N more projects · show all". A day's total or a task's
  cell opens the day. Export CSV saves the week shown.
- Not as drawn: no target in the Day row ("Day / 7h 30m", "37h 20m / 37h
  30m") -- there is no daily target setting (§13, P16 if wanted); no "closed
  Friday 17:30" in the header; the To place row has no "Place all…" (the
  list above the sheet places); Check my week… comes with P9d.

**As landed: P9d, Check my week (2026-11-12).**

- `shared/week-issues.ts` (`checkWeek`, `describeWeekCheck`): each fragment
  of the week to place (Place… opens S12b's dialog on the week's), the
  corrections not answered and the entries refused (Send now is
  `retryFailedWorklogs`, which requeues every `FAILED` row, corrections
  included), each working day with untracked time (Open <day>), each
  overlapping pair (Fix… opens its day), and, in a closed week, the changes
  queued since it closed.
- `worklogs:get-week-changes` (`WorklogRepository.getQueuedChangesBetween`,
  `ContextScheduleService.weekClosedAt`): the queue rows for the week's time
  created after the wrap-up of its last working day; null while open. No
  migration: the close moment is computed, not stored.
- `CheckWeekDialog`, from "Check my week…" beside Export CSV in History's
  week, and from the week's close: `WeekEndedNotice`'s button is now "Check
  my week" and opens History on that week with the dialog (`checkWeekOf`,
  a remount per request).
- Not as drawn: no "under your day" -- there is no daily target, and the
  user chose gaps only (2026-11-12): "Wednesday has 35m untracked · 1 gap ·
  16:55–17:30", or "Nothing logged on Monday". The header says "37h 20m
  logged", without "against 37h 30m".

**As landed: P9e, Split in two (2026-11-12).**

- `worklog:split(worklogId, atUtc, taskId)` (`WorklogCorrectionService.split`,
  `splitUndoably`): `correct` shortens the entry, then the rest is written
  on the task chosen, from the same session and with the same note, in one
  transaction. `shared/worklog-correction.ts` `splitPieces` cuts at the same
  second in the window and in main.
- The order at the provider: the second piece's `CREATE` waits for the
  first's `UPDATE` (`enqueueSyncItem`'s `waitsFor`, stored in
  `origin_sync_id`; a rule in `getPendingQueueItems`). An entry not sent yet
  has its send rewritten, and the two go out alongside. A shortening refused
  keeps the second from being sent. No migration.
- `SplitWorklogDialog`, from "Split in two…" in Correct (entries of two
  minutes or more): a slider by the minute, starting at the middle, the two
  rows, "Choose a task ▾" opening the picker (move mode); nothing
  preselected. Closed-week warning; Undo `Split MG-12 · 2h 00m`.
- Not as drawn: the slider is the native range input rather than the drawn
  bar.

P9 is complete.

---

## 15. P10 -- End my day, overnight, and a crash during the day

- **End my day** (S17) replaces `EodWrapUpModal`:
  - it lists **every** entry, with nothing folded;
  - it places the fragments, one menu per row;
  - it shows the gaps as a hint;
  - its button says exactly what it sends: "End my day · send 1h 45m · 45m
    left to place".

  It stops the session through `stopForWrapUp`, which drops every stored
  restart.
  - The hard-coded checklist (`http://localhost:8081`, "saveAll CLI") and
    "logged to Jira" go.
  - The Unity scene save went in P0.
- **The PC shutdown is optional** and never ticked for you. It runs only
  after the 10 s undo has passed and the queue has answered:
  `SystemAutomationService.scheduleShutdown` is called from the undo's
  expiry plus a queue drain with a timeout (30 s, then shut down anyway with
  the entries kept). Today it runs right after the stop.
  - `App.tsx` ignores `shouldShutdown` today (code map); fix it here.
  - Undo of End my day cancels the shutdown.
- **Overnight** (S18): `ForgottenSessionService` gets "Decide later". The
  timer stays paused at the last activity, nothing is logged, and the card
  stays on Today and the mini timer. Its answers are unchanged.
- **A crash or close during the day** (S31):
  - at start, `TimeTrackingEngine.reconcileStartupState` compares the last
    presence (`last_user_presence_utc`) with now;
  - a gap of more than `FORGOTTEN_MIN_GAP_MS` on the same day pauses the
    session at the last activity and asks the overnight question, worded for
    the day;
  - today the gap silently counts as work.

**Tests:**

- `eod.test.ts`: the shutdown waits for the undo and the drain; Undo
  cancels it.
- `forgotten-session.test.ts`: Decide later; the crash during the day.
- Renderer tests for End my day: the button's figures match the list.

**Docs:** `USER-GUIDE.md`, `ARCHITECTURE.md`, `CLAUDE.md` (the shutdown
waits for the undo and the drain).

**Split** (2026-11-12), each its own commit:

- P10a: End my day (S17) and the shutdown after the undo and the drain.
- P10b: overnight, Decide later (S18).
- P10c: a crash or close during the day (S31).

**As landed: P10a, End my day (2026-11-12).**

- `views/EOD/EndMyDayDialog.tsx` replaces `EodWrapUpModal`: the
  interruptions to place (`InterruptionsToPlace`, its own menu per row),
  every entry of today with its state and the running session, the gaps up
  to now in the working hours (`day-gaps`; Skip, Check them… opens
  History), the shutdown checkbox, Later (15 min, the snooze) and the button
  from `endOfDayFigures` (`shared/day-summary.ts`). One click in the window;
  the bar keeps START twice, BACK closes.
- Main: `endDayUndoably` (Undo `Day ended`, during an interruption too) and
  `EndDayShutdown` (the undo's commit, a drain of 30 s at most, then
  `scheduleShutdown`; Undo and cancel abort it). Open editors are still
  saved, silently (the user's choice, 2026-11-12). `App.tsx` no longer calls
  `complete` after the wrap-up.
- The "Shut down by default" setting is gone (the user's choice,
  2026-11-12): the checkbox is never ticked for you; a stored value is
  ignored. The checklist (`saveAll CLI`, "logged to Jira") went with the
  wizard.

**As landed: P10b, Decide later (2026-11-12).**

- `ForgottenSessionService` takes two more actions, `later` and `ask`, which
  answer nothing: `later` stores the question `deferred`, `ask` clears it and
  brings the dashboard forward (`setPromptOutlet(outlet, openDashboard)`).
  The question survives a restart deferred, and is not asked again.
- `ForgottenSessionModal` is S18: *MG-12 ran all night*, five choices --
  the last activity, the end of the day, another time, all along, Discard
  it -- and Decide later, Log and restart MG-12, Log and stop. With *all
  along* the second is **Keep MG-12 running** (`keep`, unchanged) and Log
  and stop ends now; with *Discard it* one red Discard, which still asks.
- Deferred, Today has `ForgottenSessionCard` and the mini timer a row
  (`MiniPromptRow`'s `forgotten`), both with Answer; the mini row shows the
  question asked or deferred, since the dialog is the dashboard's. The
  card says the day and time paused, not "yesterday", which goes stale.
- **Deviation:** the mockup's "Discard it · 10 s to undo" is not built. A
  discard is undone by restoring the session's rows, and the stored question
  would need restoring with it; the discard asks first instead, as before.

**As landed: P10c, a close during the day (2026-11-12).**

- Not in `reconcileStartupState`, as planned, but in
  `ForgottenSessionService.check({ atStart: true })`, the call already made
  before the first render: the engine has no presence, and the question,
  its storage and its answers are the service's. `detectClosed` asks when
  the last activity falls the same day and at least `FORGOTTEN_MIN_GAP_MS`
  ago, whoever is at the machine; across midnight the overnight path asks.
- The question carries `cause: 'closed'` (shared `forgottenHeading`):
  *SprintTicker closed while MG-12 ran*, "all along" reads "all the time it
  was closed". Decide later, the card and the mini timer are P10b's.
- **Deviation:** S31 says "at 14:02, last activity 13:58". Nothing records
  when the app closed -- a crash has no quit to write it, and a heartbeat
  would write every minute -- so the card names the last activity only.

---

## 16. P11 -- First run, and the states that are not normal

- **First run** (S1–S3) replaces `OnboardingWizardModal`. It opens on its
  own at the first launch, and from Settings › General after that.
  - **S1, your tasks**:
    - Jira, OpenProject, a SprintTicker server (shown only once
      `PROVIDER-API.md` §15 ships), or no account;
    - **Test connection**, with its failures written out: an address not
      found, a refused token with "make a new one ↗", and a network error;
    - then the start question ("should SprintTicker change it in Jira?"),
      which writes `start_side_effects`.
  - **S2, your desk**: the bar (USB tested, Wi-Fi asks the address) and the
    Stream Deck ("Install the plugin"). Only what was found starts ticked.
  - **S3, your day**: working days, the stand-up and its task, lunch, the end
    of the day, and the "How it works" card.
  - It ends on Today with the picker open.
  - The Unity step went in P0.
- **S31's states**, each a card with what still works:
  - the first sync's progress;
  - the provider not answering;
  - the token refused;
  - no network;
  - the bar unplugged;
  - updated to a new version;
  - the first-day picker (opens on Assigned to me);
  - the app closed while a task ran (P10);
  - the provider refusing one entry;
  - no account yet.

  **Refusing one entry** needs the worker to tell a permanent refusal (a
  403/400 on that issue) from a failure. It parks the row as `refused` with
  the provider's reason, and the entry offers ↳ Move… or Keep off. If the
  queue's status column is constrained, this is a migration, checked like
  the others.

**Tests:**

- `first-run.test.tsx`: opens once; each failure message; the question
  writes the setting.
- `sync-queue.test.ts`: a refused entry is parked, not retried.
- Renderer tests for the S31 cards.

**Docs:** `USER-GUIDE.md` (getting started, troubleshooting), `README.md`.

**Split** (2026-11-12), each its own commit:

- P11a: the first run (S1–S3), with Test connection's failures written out.
- P11b: S31's cards on Today -- the first sync, the provider not answering,
  the token refused, no network, the bar unplugged, updated, no account, the
  first-day picker.
- P11c: one entry refused (`refused`, Move… or Keep off).

**As landed: P11a, the first run (2026-11-12).**

- `components/FirstRun/` replaces `OnboardingWizardModal`: `YourTasksStep`
  (S1), `YourDeskStep` (S2), `YourDayStep` (S3), in `StepFrame`. Each step
  saves when left forward. Set up later and Start my first task both call
  `finishFirstRun`; the second ends on Today with the picker open.
- Main: `FirstRunService` and five channels (`first-run:*`). Test connection
  runs a fresh adapter (`getUserName`, new on both, then `getProjects`),
  saving nothing; `shared/first-run.ts` words its failures. An install with
  credentials or a worklog is marked done and never sees it.
- S2: the bar is found by the driver's status; the deck by
  `%APPDATA%\Elgato\StreamDeck` or a connected deck, polled every 2 s while
  the plugin installs. **The installer carries the plugin** (the user's
  choice, 2026-11-12): `extraResources`, `package:win` packs it first,
  `verify:packed` checks it.
- S1's start question writes `start_side_effects.enabled`; S3 reuses
  `StandupTaskSetting` for "on: Choose a task".
- **Not built:** the SprintTicker server choice (PROVIDER-API §15 has not
  shipped), and a Stream Deck layout installed with the plugin -- asked for
  by the user (2026-11-12), deferred to P13: a `.streamDeckProfile` per
  model, Stream Deck Mobile and Mini, bundled through the manifest's
  `Profiles`; its format is Stream Deck's own, so it is exported from the
  app rather than generated.
- The pictures `app-setup-wizard*.png` keep their names; `capture-app.js`
  now shoots S1 and S2 (neither device); remade on 2026-11-12, after P12b.

**As landed: P11b, S31's cards (2026-11-12).**

- `components/StatusCards.tsx`, on Today under the overnight card: No
  network (`navigator.onLine`, which hides Not answering), Refused, Not
  answering · since, First sync with its progress, BUSY Bar unplugged (after
  `BAR_UNPLUGGED_GRACE_MS`, 10 s, so a start or a re-dial says nothing),
  Updated to, No account yet. The waiting entries come from the queue.
- Main: `OfflineSyncWorker` keeps the sync's health (`sync:get-health`,
  `sync:on-health`); `NoticeService` the one-time notices (`notices:*`).
- The first-day picker: with no Recent and no Starred, "Assigned to me"
  says its order and where the other two will come.
- **Deviations:** "Updated to 1.5.0 · 3 things changed" has no count --
  the app does not carry its release notes, and What's new opens the
  release page. The first update to this version announces nothing: the
  version seen before it was never recorded. "No account yet" can be put
  away for good, or it would stay on a deliberate no-account user's Today.
  "Your team's server" is left out of it until PROVIDER-API §15 ships.

**As landed: P11c, one entry refused (2026-11-12).**

- **Migration 16**: `worklog_sync_queue.refused_at_utc`. A refused row
  stays FAILED, so every path that reads an unsent row as unsent still
  does; the column keeps it out of `requeueFailedItems`. `pnpm
  db:check-migration` passed on the real database (13 to 16: 21 worklogs,
  7 queue rows, nothing lost), 2026-11-12.
- The worker refuses a send on a permanent 4xx from the POST itself
  (`isRefusal`: not 401/403, 408, 429), never from the marker search before
  a resend. The worklog reads `refused` with the provider's answer
  (`refusal`, `shared/refused-entry.ts` words it).
- Today's card "Jira refused 1 entry" lists each with ↳ Move… and Keep off
  Jira; the entry's ⋯ offers Keep off too, on a refused entry only. Move
  retargets the refused row (it made no entry); Keep off drops it, undoable
  (`keepOffUndoably`). Check my week lists them, opening their day.
- `readErrorDetail` reads Jira's `errors` object too: a field's refusal
  leaves `errorMessages` empty, and it is the reason the card shows.
- Tests: `refused-entry.test.ts` (refused, not requeued; a refused search
  or token is parked; Move, Keep off, Correct, Delete), the card in
  `status-cards.test.tsx`, ⋯ in `today-entries.test.tsx`, migration 16.
- **Not changed:** a 403 on one issue still reads as the token refused --
  the status alone cannot tell them apart.

---

## 17. P12 -- Outside the window

> **From P6 (2026-11-10):** `ShortcutService` and its four chords (Interrupt, Back, Switch, Previous) are this phase's; `InterruptShortcutService` still owns the Interrupt chord.

- **Close hides to the tray.**
  - `window-all-closed` no longer quits. The first close shows "SprintTicker
    is still running".
  - Quit is in the tray's menu, and does what quitting does today: clears
    the bar, stops the socket.
  - Electron does not await `will-quit`, so keep `preventDefault()` +
    `app.exit(0)` (`CLAUDE.md` §6).
  - A setting in General: "When I close the window: Keep running ▾".
- **The tray** (S26):
  - **Click.** A single click opens the window.
  - **Menu.**
    - Open SprintTicker;
    - Switch task…;
    - Previous task (hidden during an interruption);
    - Pause / Resume;
    - Stop;
    - Interrupt, or ↩ Back to MG-12 during an interruption;
    - Lunch, Away, End my day…;
    - ✓ Mini timer, ✓ Start with Windows;
    - Quit.
  - **Icon.** A mark as well as a colour (▶ ⚡ ❚❚ ! ○), drawn as small
    images in `build/`, plus a number for the entries waiting.
- **Toasts that lead somewhere.**
  - `ElectronToastPresenter` handles the click by opening the window on the
    toast's subject (a route: `today`, `undo`, `account`, `history/<day>`).
    Provider events still open the provider's page.
  - Every toast of S26 maps to one route.
  - The AUMID rule of `CLAUDE.md` §5 is unchanged.
- **The mini timer** (S25): its states come from the session DTO of P6:
  - running, paused, an interruption with its name field and "started now ▾";
  - from the deck, nothing timing, Back? with +6m;
  - not yours, the lunch and stand-up questions, still paused, still on it,
    still in the stand-up;
  - stopping, in the devices' order: Done / Stop / Discard;
  - the Undo row.

  Its size grows for the name field. `MINI_WINDOW_SIZE` and the comment that
  still says 360×56 are corrected together.

**Tests:**

- `tray-manager.test.ts` (menu per state; single click).
- `toast-presenter.test.ts` (each toast's route).
- `mini-window.test.ts` and `mini-bar.test.tsx` (each state's buttons).
- `main-window-close.test.ts` (close hides; Quit clears the bar).

**Docs:** `USER-GUIDE.md` (the tray, the mini timer), `CLAUDE.md` (close
hides; only Quit clears the bar).

**Split** (2026-11-12), each its own commit:

- P12a: close hides to the tray, the setting, the first-close toast; the
  tray's single click and its menu of S26.
- P12b: the tray icon's mark (▶ ⚡ ❚❚ ! ○) and the number waiting.
- P12c: toasts that lead somewhere, a route each.
- P12d: the mini timer's states of S25.
- P12e: `ShortcutService` and its four chords (moved here from P6).

**As landed: P12a, close hides to the tray (2026-11-12).**

- `MainWindowCloseGuard` (`windows/main-window-close.ts`): the close is
  prevented and the window hidden, unless quitting (`before-quit`,
  `query-session-end`, `session-end`) or `close_to_tray` is off. The first
  hide says "SprintTicker is still running" (`close_to_tray_told`, set only
  once Windows took the toast); its click opens the window.
- *Settings › General › When I close the window*: Keep running (default) or
  Quit SprintTicker (`CloseToTrayCard`, the `close_to_tray` flow setting P4
  added).
- `TrayManager`: a single click opens the window; the menu of S26 is built
  at each right-click (`buildMenu`), so nothing rebuilds it on the engine's
  ticks. Stop is Today's undoable Stop; Lunch and Away go through
  `ContextScheduleService.chooseMode`, now shared with the mode chip's IPC;
  End my day… opens the window on it (`window:on-open-route`,
  `shared/window-route.ts`, which P12c's toasts extend).
- **Deviations:** "Windows is asked to keep the icon visible" is not done --
  Windows 11 gives an app no way to promote its own icon out of the
  overflow. During an interruption holding no task, Interrupt reads
  "Another interruption", since there is nothing to go back to.
- Also fixed: Settings › Devices' Stream Deck card still called the plugin
  a separate download, which stopped being true in P11a.

**As landed: P12e, the four shortcuts (2026-11-12).**

- `ShortcutService` (`services/shortcut-service.ts`) replaces
  `InterruptShortcutService`: the four chords of the `shortcuts` flow
  setting, on by default (§2). Interrupt is Another during an
  interruption; Switch opens the picker window, raised as the deck's is;
  Previous starts the task before (none during an interruption, as the
  tray's); Back ends the interruption holding a task, and does nothing
  otherwise. Each acts through the command the other surfaces use, and
  says what it did in a toast when nothing shows it.
- The recording and "taken" rules apply to each chord; a chord another
  shortcut holds is refused. The old `interrupt_shortcut` (off by
  default) is carried over once -- on, off or another chord -- then
  cleared.
- `app:get-shortcuts`, `app:set-shortcut`, `app:set-shortcuts-recording`
  replace the three Interrupt channels; *Settings › General › Shortcuts*
  (`ShortcutsCard`) lists the four with Change, a switch and "taken".
- **Not measured:** whether a chord's press gives SprintTicker the
  foreground on its own; Switch raises the picker with `ForegroundRaiser`
  meanwhile (~0.8 s, a PowerShell), as a deck press does.
- P12 complete.

**As landed: P12d, the mini timer's states (2026-11-12).**

- `MiniBar` shows every state of S25: running with **⚡3** (to place) and
  ⟲ Previous, in S25's order ❚❚ ■ ⚡ ⇄ ⟲ ✕; paused ("❚❚ Paused · MG-12");
  an interruption (↩ ↳ ⇄ ⚡ ■, "⚡ to place · during MG-12") and, started
  from the bar, the deck or the shortcut, "⚡ from the deck · started now ▾"
  (`STARTED_AGO_CHOICES`, `interruption:move-start`); nothing timing, loud
  in working hours (`schedule:get-working-now`) with "⚡ 3 to place" and
  ▶ Start…; "MG-12 · Rin's now"; the stand-up running, "then back to MG-12,
  as it was", End stand-up (`schedule:get-standup-running`,
  `ContextScheduleService.standupRunning`); stopping, "Stop MG-12 · Done or
  Stop logs 1h 24m · Discard keeps nothing", Done / Stop / Discard…; the
  Undo row. "Back to MG-12? 6 min untracked" with **↩ Back +6m** in
  `MiniPromptRow`. The other questions were P8's and stay as they were.
- ↳ opens the picker window in a third mode, `place`
  (`mini:open-place-picker`), which chooses the interruption's task.
- `MiniOnInterruption`: an interruption from the bar, the deck or the
  shortcut opens the mini timer without the focus (`openQuietly`,
  `showInactive`), once per interruption, unless the dashboard is on
  screen. `UndoToasts` counts the mini timer as on screen.
- The one-line tour of the buttons on the first open
  (`mini_tour_seen`, a flow setting); hover labels name every button.
- `MINI_WINDOW_SIZE` is 560 × 56 (was 480): six buttons, the count and
  the deck's "started now ▾" beside the timer. The stale "360x56" comments
  are corrected.
- `pnpm docs:images` sets the throwaway profile's schedule around the
  time it runs (stand-up behind, lunch and the wrap-up ahead): run at
  13:00, the default lunch paused the session and the capture failed. It
  also puts the mini timer's tour away before its picture.
- **Deviations:** the name field is the existing click-to-rename title
  rather than an always-open input -- a field open in an always-on-top
  window would take keystrokes meant for the app in front. The stopping
  row offers Done / Stop / Discard… with ✕, without S25's separate
  confirmation layout beyond Discard's Yes.

**As landed: P12c, toasts that lead somewhere (2026-11-12).**

- `ToastRequest.route` (`WindowRoute`, now `today`, `end-day`, `undo`,
  `account`): `ElectronToastPresenter` opens the window there on a click
  (`openWindowOn`), unless the toast carries a provider's `url`, which
  still wins. `onClick` is gone; every toast names a place instead.
- The prompts (`WindowPromptOutlet.announce`) open Today, where they wait
  as cards; a task taken or not assigned, the interrupt chord's toast and
  "still running" open Today; "Sending time stopped" opens Settings ›
  Account and says "Click to enter them again".
- `UndoToasts`: an action Undo can take back, offered while the dashboard
  is not on screen -- the tray's Stop, the deck, the bar -- says its label
  and "Click within 10 s to undo" (a discard: "Nothing kept or sent"),
  routed to `undo`, which focuses the Undo bar's button.
- **Deviations:** no `history/<day>` route -- no toast of S26 is about a
  day. Not added: "Started MG-15" (a toast at each start from the deck or
  the bar would be noise; the device shows the start) and "MG-12 is now Rin
  Okada's" while the window is hidden (the mini timer's states, P12d, show
  it). P12d's Undo row on the mini timer should join
  `isDashboardOnScreen`, so the two do not both say it.

**As landed: P12b, the tray icon (2026-11-12).**

- `shared/tray-state.ts`: `trayMarkOf` (interruption ⚡, timing ▶, paused or
  Lunch/Away ❚❚, nothing timed in working hours !, outside them ○) and
  `trayBadgeOf` (1-9, then 9+).
- `tray/tray-icon.ts` draws it -- a disc in the window's token colour with
  the mark in ink, a ring for ○ -- at 16 and 32 px, the number as paper
  digits on an ink plate in the corner; `encodePng` hands it to
  `nativeImage`. Redrawn only when the mark or the number changes; read on
  every engine notification and every 5 s. The tooltip says the number.
- The number is `countUnsent`: what the header counts as waiting or not
  sent, so the two agree.
- **Deviation:** drawn in code rather than "small images in `build/`": the
  number sits over every mark, which files would have to multiply.
  `build/tray-icon.png` stays as the fallback.

---

## 18. P13 -- Stream Deck plugin 0.6.0

**Goal:** S29 and the deck column of the states table.

- **Protocol 2** (`shared/deck-protocol.ts`, `DECK_PROTOCOL_VERSION = 2`).
  - `DeckSession` gains `interruption`, `toPlace`, `previousTask`,
    `ownerName`, `standupRunning` and `nothingTimingInHours`.
  - The app answers a version-1 plugin with the version-1 state, so a user
    who updates the app first keeps a working deck.
- **The keys**:
  - **A, says yes.** DONE takes **two presses always**. The app's
    `act('finish')` refuses an unconfirmed finish always, not only when
    `finishNeedsConfirmation`, so the plugin cannot skip it. A is also BACK
    during an interruption, JOIN, RESUME, END STAND-UP and DONE ANYWAY.
  - **B, stops or waits.** It reads **STOP**, not NOT DONE. It is also SKIP
    and NOT NOW.
  - **C, throws away.** DISCARD, or **DISCARD ⚡** during an interruption,
    and blank when there is nothing to discard.
  - **Interrupt** reads ANOTHER during an interruption, and carries "3 to
    place".
  - **Session** reads NOT TIMING (amber, press opens the picker) in working
    hours, the ⚡ timer during an interruption, and NOT YOURS (amber) for a
    reassigned task.
  - **Previous task**: a new action, `previous`. Hidden during an
    interruption.
  - **Recent 1–3**: optional actions, `start-recent`, which start the n-th
    recent task.
  - New `DECK_ACTIONS`: `back`, `another`, `previous`, `start-recent`,
    `end-standup`. `DeckActionService` maps each to the service the window
    uses (`InterruptionService`, `startTask`), so no rule is copied
    (`CLAUDE.md` §3).
  - Nothing is removed. The five hidden actions stay hidden.
- **The version**: 0.6.0, in `manifest.json` and `package.json` together
  (`package.test.ts`). `check-deck-release.js` refuses the tag otherwise.
- **Tried on Stream Deck Mobile**: every state of S29, reconnecting after
  either app restarts, and a version-1 plugin against the new app.
- **A layout installed with the plugin** (the user's request, 2026-11-12):
  a `.streamDeckProfile` for Stream Deck Mobile and for the Mini, placed
  with Session, Interrupt and Answer A/B/C, listed in the manifest's
  `Profiles` so installing the plugin offers it. Exported from the Stream
  Deck app, not generated: the format is Stream Deck's own.

**Split** (2026-11-12):

- **P13a, protocol 2 and the app side.** The state, the new actions and
  DONE asked always, with a plugin 0.5 still served protocol 1.
- **P13b, the plugin's keys.** Faces and presses for every row of S29,
  Previous and Recent 1-3, 0.6.0, `deck:validate`.
- **P13c, on the deck.** Stream Deck Mobile through every state, and the
  `.streamDeckProfile` layouts -- both need the user.

**As landed: P13a, protocol 2 and the app side (2026-11-12).**

- **The plugin names its protocol** in the socket's URL (`?protocol=2`,
  `deckUrl`). Plugin 0.5 names none -- it reads only the hello and refuses
  any version but 1 -- so a socket without it is spoken to in 1: its state
  through `deckStateForProtocol` (no new field, `back` read as `resume`, no
  `lunch`), its `finish` under 1's rule. Each socket keeps its own.
- **The new fields sit on `DeckState`, not `DeckSession`**, except
  `interruption` (`{ title, backToKey }`) and `ownerName`: to place,
  previous, recent, the stand-up running and nothing timing in working
  hours are true with no session too. `recent` (up to 3, never the task
  open) was added for the Recent keys to show their task.
- **Two prompts:** `back`, the resume question after an interruption, and
  `lunch`, the window's "Start lunch?", answered through
  `answerLunchQuestion`.
- **New actions** `back`, `another`, `previous`, `start-recent` (with
  `index`), `end-standup`; each calls what the tray, the mini timer or the
  window calls. A new refusal, `no-task`.
- **DONE is asked always in protocol 2.** Plugin 0.5 stays on protocol 1
  (`PLUGIN_PROTOCOL`) until P13b.
- **Colours for P13b:** S29's three, from the window's tokens -- A green,
  B the blue-grey `#94A3B8` (slate, never the idle grey), C red; the
  plugin's blue `#3B82F6` goes, as the window has no blue.

**Tests:**

- `faces.test.ts` (every kind × state, including DISCARD ⚡ and NOT
  TIMING), `controller.test.ts` (two presses for DONE always), and
  `deck-action-service.test.ts` (unconfirmed finish refused; back, another,
  previous).
- `deck-protocol.test.ts` (a version-1 state for a version-1 plugin), and
  `package.test.ts`.
- `pnpm deck:validate`.

**Docs:** `USER-GUIDE.md` (the deck), `API.md` (protocol 2),
`streamdeck-plugin/README`, `CLAUDE.md` §3 (DONE always takes two presses).

---

## 19. P14 -- The bar

> **From P6 (2026-11-10):** `display-stress` gains Interrupt, Another and Back as sources here, through `InputDecoder` as well as IPC.

**Goal:** S28 and the bar column of the states table, within the hardware
contract.

Each item below is one change, measured on the bar before the next. The
display rules are `CLAUDE.md` §4–§5:

- one `evaluateRequest` per event, and one render at its end;
- menus are renderer sub-states or `BAR_MENU_EVENT` background screens,
  never queued;
- no picker-style BACK that draws twice.

1. **The two pickers** (started in P3): the decoder stops sending
   `TRIGGER_TASK_SELECTOR_MODAL` when it opens its own. The window is raised
   with `ForegroundRaiser` wherever the bar raises it.
2. **The picker's levels**:
   - RECENT (1/6), STARRED, MINE, then "15 PROJECTS / MORE: IN WINDOW";
   - BACK goes up one level.
   - From `getRecent`, the stars and `orderTasksForSelection`; nothing is
     copied.
3. **The wheel menu while timing**: INTERRUPT, PAUSE, PREV, SWITCH, STOP. A
   renderer sub-state of `ACTIVE_TRACKER_EVENT`, like the paused menu. It
   shows two choices at a time with more-markers, as the paused menu does.
4. **The paused menu**:
   - DONE / STOP / DISCARD (A, B, C's order), then INTERRUPT, opening on
     STOP;
   - DROP becomes DISCARD;
   - `PAUSED_CHOICES` and `PAUSED_MENU_OPENS_ON` change, and
     `paused-menu-layout.test.ts` with them.
5. **During an interruption**: BACK TO MG-12 (the key cut by
   `fitToWidth`), ANOTHER, SWITCH, STOP. A ⚡ icon needs:
   - a new `.anim` in **both** formats (`build-anims.js`);
   - its first frame equal to the static icon (`animation-assets.test.ts`);
   - drawing from scratch, per `packages/anim-studio/STYLE-GUIDE.md`.
6. **Hold BACK opens the end choices** instead of marking the task done
   (proposal §3.2). The `hardware_bindings` defaults change, and saved
   bindings are reset once (§2).
7. **❚❚ on the paused screen**: the fonts are ASCII only, so ❚❚ is two
   drawn rectangles (as `paintMoreMarker` draws), not text. Paused row 0 is
   already full for an 8-character key, so the key is cut by `fitToWidth`
   with the font it is drawn in.
8. **The words of D5**, each measured, then pinned by `words.test.ts` (P1):
   - "3 TO PLACE" on the timing screen moves the time to row 0, as the
     paused layout does;
   - "MG-12 > RIN";
   - STAND-UP with the time on row 1 and OK=END;
   - NOTHING TIMING / MG-12? OK=YES.
9. **Nothing timing in working hours (D4)**: by the recommendation, one
   frame when the reminder fires, released at the answer through the
   existing hand-back (`releaseActiveLock` → the mode). The firmware clock
   stays the idle screen; no app-drawn clock.

**Tests:**

- `hardware-decoder.test.ts` (each state's inputs), `paused-menu-layout`,
  `display-renderer`, and `proportional-text` (every new string with its
  font).
- `display-handback.test.ts`: a scripted case for each new menu and
  question, including a banner arriving under each.
- `display-stress.test.ts`: the new inputs (wheel menu, Back, Another,
  Previous) as sources, on both firmware versions, ending with
  `expectSettledScreen`.

**On the bar**, asked first, one at a time:

- `pnpm probe:busybar --font-sheet` for the new words;
- a real day on the packaged build with a database copy: upload medians
  in `displayHealth`, no screen close outside `clearDisplay`, no hang.

**Docs:** `USER-GUIDE.md` (the bar), `API.md` (the device contract, if a
draw changes), `CLAUDE.md` §4 (the new menus and their lock rules).

---

## 19b. P16 -- Tasks and Settings, rebuilt as their screens

Added 2026-11-10, after the pictures of P2-P5 were compared with the
screens: P3 moved every card into Settings unchanged ("none is
rewritten"), and no phase rebuilt them, nor the Tasks place. Both still show
the old panels -- "TASK PROVIDERS & ACCOUNT CONFIGURATION", "AGILE
CEREMONIES…" in capitals, raw forms, and the "Project & Task Manager".

**Goal:** S13 and S19-S24 as drawn: a page of rows, each a name, one
sentence and a control at the right, in the words of the glossary.

### 19b.1 Tasks (S13)

- **Projects**, a column: a search box, *Starred* then *All · N* with
  "Hide empty", each with its open count, and "+ A project of my own".
  A project's ⋯ holds Import, Rename and Delete; nothing is hover-only.
- **Tasks**, a table: ☆, Key, Title, the provider's status, Who (me, a
  name, nobody), and Stop / Switch. Above it a search, the pills *mine*,
  *unassigned*, *teammates'* (the task visibility of today) and an
  *Open ▾* state filter; "+ Task of my own"; a project's ⋯ again.
- Only a task of the user's own can be deleted, and deleting asks first.
- Stars are P4's (`tasks:star`); the order is `shared/task-order.ts`.

### 19b.2 Settings, one row per setting (S19-S24)

- **A `SettingRow`** (name, sentence, control; a fold for "Advanced") is
  the one layout; the old cards' titles and their "Changes save
  automatically" go.
- **General** (S19): Start with Windows, the shortcuts (P6's four chords),
  Close to tray (P12), Check for updates, Set up again, Show developer
  tools.
- **Account** (S20): the refused-credentials banner with "Save and send";
  the account line (site, user, projects, tasks, last refresh; Refresh
  now, Change account); Tasks to fetch; When I start a task (P5c); When I
  mark a task done (P5d's per-project list behind "N projects differ…");
  the provider's notifications (Choose…); *Advanced*: custom query, the key
  for tasks of my own, entries waiting to send.
- **My workday** (S21): working days, the stand-up (time, task, Show me),
  lunch, end of day, the week's close, the four prompt delays
  (`prompt_delays`, P8), a timer left overnight, the long pause that starts
  a new entry.
- **Desk devices** (S22): the bar's line (connected, firmware, battery,
  brightness; Use without a bar), task key colour, when nothing runs,
  Windows notifications (Grant access, Choose apps…), what the bar shows
  first (Open…), *Connection* folded, and the Stream Deck's line.
- **Data** (S23) and **Developer** (S24) as drawn.
- Every setting keeps its search entry (`settings-groups.ts`) and its
  storage: this is a view, not a migration.

**Tests:** a renderer test per group that every row of its screen is there
and saves through the bridge; `settings-groups.test.ts` still finds every
setting; the Tasks view's filters, stars and delete-asks.

**Docs:** `USER-GUIDE.md`'s Tasks and Settings sections; the pictures
(`pnpm docs:images`); `CHANGELOG.md`.

---

## 20. P15 -- Documents, pictures, release

Each phase updates its documents as it lands (§3). This phase does what is
left once the screens are real:

- **`pnpm docs:images`** for every changed screen (it needs SprintTicker
  closed, and never captures the real profile). The user lets it run
  without asking (2026-11-12).
- **`USER-GUIDE.md`**, read end to end as the newcomer of the reviews,
  against the glossary: one word per action.
- **`README.md`**: the feature list, the requirements, and any figures
  quoted. Grep for each old value: `CLAUDE.md` §9.
- **`CHANGELOG.md`**: one entry per release (1.5, 1.6, 1.7), written for a
  user who has the previous version, with the reset bar bindings and the
  changed Lunch named.
- **`docs/index.html`**: `pnpm docs:build`, then `pnpm docs:check`.
- **A release candidate on the real bar and Stream Deck Mobile**, as 1.3.0
  was: a day's use, a database copy, and the packaged build.
- **A review with the design skills** (the user's request, 2026-11-12),
  once P16 has landed: `design-skills:design-critique` and
  `design-skills:ux-writing` against the mockups and the glossary,
  `design-skills:accessibility-audit` on every screen. Findings are fixed
  or listed, never silently left.
- **A dry run at scale** (the user's request, 2026-11-12), after the
  review and before the video: 20 projects of 50 tasks each, on a
  throwaway profile under `--mock-hardware` (never the real database), and
  simulated working days played through it -- the stand-up, starts,
  switches, interruptions placed, Lunch and Away, corrections, End my day,
  a week checked. The question is whether it stays smooth for the user: the
  picker and its search, Today, History's day and week, Tasks, the first
  sync of 1,000 tasks, the tray and the mini timer. Anything slow or
  awkward is measured, fixed or listed, as the review's findings are.
- **A short motion video presenting the app and its features** (the user's
  request, 2026-11-12), the last item: made with the Remotion skills, from
  the real screens and the bar's own animations, on the invented data of
  `pnpm docs:images` -- never the real profile.

---

## 21. Verification, all phases

| What | How | When |
| :--- | :--- | :--- |
| Unit and component tests | `pnpm test`, `pnpm typecheck`, `pnpm lint` | every commit |
| Coverage floor | `pnpm test:coverage`, 92 / 93.5 / 90 / 85, never lowered | every phase |
| Migrations on real data | `pnpm db:check-migration`, run by the user | P4, P6, any later migration |
| Display rules | `FirmwareSimulator` + `expectClean()`, `display-stress` (`STRESS_RUNS=2000` before a release) | P6, P8, P14 |
| The bar | `pnpm probe:busybar` and a real day, asked first | P14, the release candidate |
| The deck | Stream Deck Mobile, every state | P13 |
| The look | screenshots against the screens, packaged build on a database copy | P2, P3, each release |
| Real use | the user, a few days on each release candidate | 1.5, 1.6, 1.7 |

---

## 22. Risks

- **The interruption model (P6) touches the engine's core.** The set-aside,
  Lunch and the stand-up all interact with it, and `CLAUDE.md` §5 records
  how often that has shipped bugs. Mitigation:
  - the old path stays reachable until the new one has run;
  - the stress test gains the new sources before the old path goes;
  - every bug a seed finds becomes a scripted case.
- **Lunch as a pause (D1)** changes what a user's morning looks like in
  Jira. Split at 15 min, it is the same two entries, but a user with
  `splitPauseMinutes = 0` gets one entry spanning lunch with the lunch
  excluded. The release note says so.
- **The undo hold delays every send by 10 s.** A crash inside the hold must
  not lose the row: the row is written before the hold, and on restart a row
  past its hold is simply due.
- **The bar's words and menus** cannot be judged off the device. D5 and
  P14 are measured, and nothing ships on a width computed alone.
- **Text-based renderer tests** (224 queries by text) break with every
  wording change. Rewrite them against the glossary's constants, so the next
  wording change is one edit.
- **Three releases** mean three upgrades for the user. Each must be usable
  alone: 1.5 changes nothing in behaviour, and 1.6 keeps the deck on
  protocol 1.

---

## 23. Out of scope

From the reviews, kept out on purpose (proposal §38 and §40):

- suggesting a task for an interruption;
- placing from the bar or the deck;
- merging a task's entries within a day;
- pausing on a break, since presence never pauses;
- refusing changes to a closed week;
- sprint and due-date views, calendar import, statistics per colleague.

---

## 24. Status

| Phase | Status | Landed in |
| :--- | :--- | :--- |
| P0 | done; side sessions archived, worktrees removed | `05e0958`, `38f080c`, `765c524`, `89d4768` (2026-11-10) |
| P1 | done; the views, the bar and the deck adopt the words as P3, P13 and P14 rebuild them | `4adb117` (2026-11-10) |
| P2 | done; pictures remade after P5 | `ce36fe4` (2026-11-10) |
| P3 | done; provider events in "What you missed" and the update's "Get it" deferred; pictures remade after P5 | `1e3481e` (2026-11-10) |
| P4 | done; `pnpm db:check-migration` passed on the real database (13 to 14: 20 worklogs, 7 queue rows, nothing lost), run by the user | `e9e2e38` (2026-11-10) |
| P5 | done; the bar's own STOP and DROP not undoable yet (P14), no Undo on the OS toast, no S26 toast | `ff15f2c`, `433b0f3`, `4dd1cf5`, `3cc7caa` (2026-11-10) |
| P6 | done; four-chord `ShortcutService` moved to P12, "Still on it?" to P8, stress sources to P14; `pnpm db:check-migration` passed on the real database (13 to 15: 20 worklogs, 7 queue rows, nothing lost), run by the user | `9c6d0d0` (2026-11-10) |
| P7 | done: the picker and fetch by key (P7a), the picker window (P7b), Ctrl+K, the Tasks rows and S12b (P7c) | `12bca71` (2026-11-10), `621c67a`, `b764bcf` (2026-11-11) |
| P8 | done: P8a-P8e3 (the session card, Lunch and Away pause, prompts without focus, the stand-up, the reminders, Today's entries and interruptions, the morning card, the reassigned card, S9's extras) -- see §13 "Split" and each "As landed" | P8a-P8e3 (2026-11-11) |
| P9 | done: P9a (the day, Add time), P9b (the timeline), P9c (the week, CSV), P9d (Check my week), P9e (Split in two) -- see §14 "Split" and each "As landed" | P9a-P9c (2026-11-11), P9d-P9e (2026-11-12) |
| P10 | done: P10a (End my day, the shutdown after Undo), P10b (Decide later), P10c (a close during the day) -- see §15 "Split" and each "As landed" | `3c831ee`, `2b9730d`, P10c (2026-11-12) |
| P11 | done: P11a (the first run), P11b (S31's cards), P11c (a refused entry); `pnpm db:check-migration` passed on the real database (13 to 16: 21 worklogs, 7 queue rows, nothing lost) -- see §16 "Split" | P11a `ac2373c`, P11b `d7b1238`, P11c `0661a56` |
| P12 | done: P12a (close hides to the tray, the menu of S26), P12b (the tray icon), P12c (toasts that lead somewhere), P12d (the mini timer's states), P12e (the four shortcuts) -- see §17 "Split" | P12a `a22383b`, P12b `aac267e`, P12c `ab2ee71`, P12d `36801e0`, P12e (2026-11-12) |
| P13 | in progress: P13a (protocol 2 and the app side) done; P13b (the plugin's keys) next, P13c (on the deck, with the user) after -- see §18 "Split" | P13a (2026-11-12) |
| P14 | not started | |
| P15 | not started | |
| P16 | not started; added 2026-11-10 | |
