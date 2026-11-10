# SprintTicker redesign -- proposal for review (2026-11-09)

A proposal, not a plan of record: nothing here is built. Once it is approved
and built, this file stays as written, like the rest of `design-history/`.
The mockups are in [Redesign-2026-11-mockups.html](Redesign-2026-11-mockups.html).

## 0. The brief

The user's rules:

1. **Simple to use even without knowing how it works.**
2. **Modern and practical layout.**
3. **Every feature listed, grouped into categories, with natural flows
   between windows.**

The answers to the scoping questions:

- **Review first, no code** before the proposal is approved.
- **Every surface** is in scope: the main window, the mini timer and tray,
  the bar and the Stream Deck.
- **Built for a new colleague** who installs it and never reads the guide.
  Advanced settings move out of the way.
- **Dark, in greys.** The blue accent goes.

The test applied to every change below: *could a colleague who has a Jira
account, never read the guide, and just installed this get through their
first day?*

## 1. What a newcomer meets today

These are the findings that shape the structure. The full inventory, by
surface, is in §8.

- **Nothing guides the first run.** The setup wizard opens only from a header
  button, and the app opens on an empty session card.
- **Closing the window quits the app**, and the mini timer goes with it. The
  tray suggests the app keeps running, but it does not.
- **Nine tabs, named after how the app is built**, not after what the user
  wants: "Task Providers", "Ceremonies", "Priority Rules", "Device
  Diagnostics". Three of them disappear without a bar.
- **Settings are scattered.** Start with Windows, the Interrupt shortcut,
  updates, the key colour and the factory reset all sit on the hardware
  diagnostics page. The worklog split rule is in Ceremonies. The Work / Lunch
  / Away switch, used every day, is inside the technical Priority matrix.
- **Developer tools are on every user's screen**, and some of them change
  real data:
  - the header's remote pad and "Ping:";
  - the animation debugger, whose "Pause Task", "Stop Task (LOGGED)",
    "Lunch" and "Away" act on the real session and mode;
  - the notification debug triggers, the input console and the listener's
    `sqlite3 | wpndb`;
  - the Unity junction injector and the raw sync-queue errors.
- **One action, many names.**
  - Ending a session is "Finish & Log Hours", "Remain 'In Progress'", "Not
    done", "STOP", "LOGGED" or "Stop".
  - Throwing it away is "Discard" in the window and "DROP" on the bar.
  - Putting time on a task is "Assign", "Move" or "Switch", depending on the
    screen.
- **Every road leads to the main window.** The tray, the mini timer, the
  deck and the bar all open the window to pick a task. A wheel turn on the
  bar only raises the window, and the bar's wheel click opens two pickers at
  once.
- **Prompts take over.**
  - The stand-up, the wrap-up and the forgotten-session dialog steal the
    focus from whatever you are typing in.
  - The stand-up dismisses itself after 10 s.
  - Lunch starts and ends with nothing on screen unless you have a bar or
    the mini timer.
- **Toasts lead nowhere.** "Sending time to Jira stopped" names a tab but
  opens nothing, and no toast ever opens SprintTicker.

## 2. The new structure

### 2.1 Four places, named for what you do

| Sidebar | What it is for | What moves into it |
| :--- | :--- | :--- |
| **Today** | What runs now, and what I did today | Active Session, today's worklogs (now with the History row actions), today's interruptions to sort |
| **Tasks** | Find and start work | Projects & Tasks. Import and the project editor move into a "⋯" menu |
| **History** | Check and correct what was logged | Work History, a week view (the timesheet), the "sending" state per entry |
| **Settings** | Everything set once | All the other tabs, regrouped in §2.2 |

The header is no longer a toolbar:

- **The mode chip** (Work · Lunch · Away) is always visible and always
  clickable, bar or not. Today the switch is hidden in Priority Rules.
- **"End my day"** replaces "EOD Wrap-Up".
- **The mini timer** button.
- **One status dot** (bar connected, sending stopped, update available)
  opens a small panel saying what is wrong and where to fix it.
- **The LED preview**, smaller, only when a bar is set up.

The remote pad, "Ping:" and the Setup Wizard button leave the header.

### 2.2 Settings, in six groups

Settings has its own short side list. Each group is one page, with plain
labels and one sentence per setting. Advanced options are folded at the
bottom of their group.

| Group | Contains |
| :--- | :--- |
| **General** | Start with Windows, the Interrupt shortcut, updates, "Run setup again" |
| **Account** | Jira / OpenProject / no provider. Credentials with a "Test connection" button. Which tasks I see. What happens to a task when I start or finish it. Notifications from Jira/OpenProject. *Folded:* custom JQL or filter, the status IDs, the sync queue in full |
| **My workday** | Working days, the stand-up, lunch, the end-of-day time and its options, "ask about a session left running overnight", "a pause of N minutes starts a new entry" |
| **Desk devices** | **BUSY Bar**: add or remove a bar. Connection, token, Reset to USB default. Task key colour. Show the bar's clock when idle. **Windows notifications on the bar**, with Grant Windows access and the per-app rules. **What the bar shows first**, Priority Rules, with its levels and arrows kept as decided. **Stream Deck**: connected or not, the plugin's version, Install the plugin |
| **Data** | Export logs, factory reset |
| **Developer** | Hidden until switched on in General ("Show developer tools"). Remote pad, display debugger, notification debug triggers and logs, input console, Display Health |

Each feature appears **once**. The places that duplicated something now link
to its one home:

- The tray's "Start with Windows" stays, because a tray checkbox is the
  Windows convention, and links to the same setting.
- The task visibility toggles stay above the lists that use them, as today,
  where their effect can be seen.

### 2.3 Without a bar

The BUSY Bar group stays, showing "No bar -- Add a BUSY Bar". Nothing else
appears or disappears. Today three tabs vanish and a fourth is renamed, so
the app looks different on two machines.

## 3. The flows

Each flow is followed from the user's intent, across surfaces.

### 3.1 First run

**Today:** an empty session card, and the wizard only behind a header
button.

**Proposed:** a first-run setup that opens on its own and has three
screens:

1. **Your tasks**: Jira, OpenProject, a server built to the SprintTicker
   Provider API (once §15 of `PROVIDER-API.md` ships), or "No account -- my
   own tasks only". The credentials get a **Test connection** button.
2. **What's on your desk?** Tick any of: a BUSY Bar (USB is tested, Wi-Fi
   asks for the address), a Stream Deck ("Install the plugin" opens the
   bundled `.streamDeckPlugin`), or neither.
3. **Your day**: working days, stand-up, lunch, end of day, pre-filled.

It ends on **Today**, with the picker open and the line *Pick the task you
are working on.* Unity support is dropped (§10.4), so it has no step.

### 3.2 Start, switch, end

- **Start or switch**: one picker everywhere. Search first, then the list
  grouped by project, instead of the two steps (project, then task) of
  today. It opens:
  - in the window from Today and Tasks;
  - as its own small window from the tray, the mini timer and the deck,
    without bringing the whole app forward;
  - the bar keeps its own picker.
- **End**: one dialog, one set of words everywhere -- **Not done** (time
  logged, task stays open), **Done** (time logged, task marked done) and
  **Discard** (nothing kept, asks first). "Finish & Log Hours" becomes
  **Stop…**, and "Remain 'In Progress'" goes.
  - The bar's DROP becomes DISCARD, if the word fits row 1 in the font. It
    has to be measured on a bar.
  - The bar's "hold BACK = Done, without asking" becomes "hold BACK = open
    the end choices". A newcomer should not mark a task done by mistake.

### 3.3 Interruptions

- Interrupt stays everywhere it is.
- **Putting it on a task** is one action, **"Move to a task…"**, wherever
  the interruption shows: Today, the mini timer, History and the wrap-up.
  "Assign" and "Move" both go. Its name is a note sent with the time, and
  no longer sorts it (§10.2).
- "Interruptions to sort" becomes **"Interruptions not on a task yet"** (⚡ on
  the badges), on Today for today and in
  History for older ones, so nothing hides on another tab.

### 3.4 Prompts that arrive by themselves

| Prompt | Today | Proposed |
| :--- | :--- | :--- |
| Stand-up | Takes focus, gone after 10 s | A card on Today and the mini timer; a toast if the window is hidden. It stays until Join / Skip / Snooze |
| Lunch begins / ends | Nothing without a bar | The mode chip turns to Lunch. A toast: "Lunch -- SCRUM-12 paused, back at 13:30" |
| Back to your task? | Dialog | Unchanged, but never steals focus; the mini timer and the toast offer it too |
| End of day | Takes focus | A card "Time to end your day -- Review". The wrap-up opens only when asked |
| Session left overnight | Blocks the window, no way out | Stays, because the session is paused until it is answered, but gets "Decide later" |
| Week over | Card | Unchanged |
| Sending stopped, task taken | Toast, cannot be clicked | The click opens the place to fix it (Account, Today) |

The rule: **a prompt never takes the focus from another app.** It waits
where the user looks next -- the mini timer, Today, a toast -- and the toast
opens SprintTicker on it.

### 3.5 Closing the window

**Proposed:** closing hides the window to the tray. A toast explains it the
first time: *SprintTicker is still running in the tray.* Quit is in the
tray. A single click on the tray icon opens the window; today only a
double-click does.

**This is a decision for you** (§6). It changes what quitting means. Today
quitting clears the bar and hands it back to its own clock, and that would
then happen only from the tray.

### 3.6 Surfaces outside the window

- **Mini timer**: unchanged, except for "Move to a task…" and the prompt
  cards from §3.4.
- **Tray**, in plain words:
  - "Open SprintTicker"
  - "Start a task…"
  - "Pause" / "Resume", whichever applies
  - "Interrupt"
  - "End my day…"
  - ✓ Mini timer
  - ✓ Start with Windows
  - "Quit"
- **Bar**:
  - The wheel no longer raises the window. With the wheel turned while a
    task runs, only the picker opens, on the bar.
  - BACK in the picker steps back to the project list.
  - The answer hints name the real keys: "OK=YES" becomes the wheel's own
    name on the device, which has to be checked there.
  - The stand-up screen shows "STAND-UP".
- **Stream Deck**:
  - The action list names keys by what they do: "Answer: Yes / Done", "Answer: No / Not done", "Discard".
  - "START / pick a task" becomes "PICK TASK".
  - The hidden actions stay hidden, never removed. This is a plugin
    release: the version goes up.

## 4. One vocabulary

| Concept | Word everywhere | Retired |
| :--- | :--- | :--- |
| What the timer runs | **task** | session, ad-hoc (in the UI) |
| A task made in SprintTicker | **my own task** | Ad-Hoc / Custom Local Fallback |
| Logged time | **time entry** | worklog, session record |
| Stop, keep open | **Not done** | Remain 'In Progress', STOP, LOGGED (the scene keeps its picture) |
| Stop, mark done in Jira | **Done**, never for an interruption | Finish & Log Hours, FINISH |
| Throw away | **Discard** | DROP |
| Put time on a task | **Move to a task…** (↳) | Assign, Move, Put on a task |
| End an interruption | **Back to MG-12** (↩) | Done, FINISH |
| Change what runs | **Switch task** | Switch / New Task |
| End of day | **End my day** | EOD, EOD Wrap-Up Sequence |
| Jira / OpenProject | **your account** | task provider |

**"Jira" in the screens is a placeholder for the provider's own name.** The
mock user is on Jira, so the screens read "Keep off Jira", "sent to Jira"
and "Refresh from Jira". The app writes the name of the provider the time
goes to:

- the task's own provider, recorded on the session when it starts;
- for an interruption not on a task yet, the active provider.

So it reads "Keep off OpenProject", or the name a SprintTicker server
gives. With no account, nothing is ever sent, so the words about sending
disappear rather than naming nothing. The toasts already take the name
(`describeSendingStopped(providerName)` in `shared/provider-events.ts`). The
wrap-up's "logged to Jira" does not (§7).

## 5. The look: dark, in greys

The blue accent goes. Colour is kept for **meaning only**: green is
running, amber is paused or waiting on you, red is danger. Everything else
is grey.

| Token | Today | Proposed |
| :--- | :--- | :--- |
| Background | `#0D0F12` (blue-black) | `#0F0F10` |
| Panel | `#16191E` | `#18181A` |
| Raised / input | `#21262E` | `#232326` |
| Border | `#2D3440` (blue) | `#2E2E33` |
| Text | `#F3F4F6` | `#EDEDEF` |
| Secondary text | `#9CA3AF` | `#A1A1A8` |
| Muted | -- | `#6B6B72` |
| Primary button | blue `#3B82F6` | light grey `#E4E4E7`, dark text |
| Selection / focus | blue | `#D4D4D8` outline, `#2A2A2E` fill |
| Running / paused / danger | green / amber / red | unchanged |
| Purple (wrap-up, high priority) | `#8B5CF6` | goes: the wrap-up is grey, high priority is amber |

The type and the layout change with it:

- **Type**: Inter for everything people read. JetBrains Mono only for times
  and task keys, where today every title, label and table is set in mono.
- **Fewer boxes in boxes**: one card per subject, plain rows inside it. Two
  sizes of corner radius. No uppercase-tracked headings, except a page's
  kicker.
- **The bar's own colours stay theirs.** The LED preview shows what the bar
  shows.

## 6. Decisions needed from you

1. **Closing the window hides it to the tray** (§3.5), or keeps quitting as
   today?
2. **A picker window of its own** for the tray, the mini timer and the deck
   (§3.2), instead of raising the whole app?
3. **Hold BACK on the bar opens the end choices** instead of marking the task
   done at once (§3.2)?
4. **Prompts never take focus** (§3.4), including the overnight question?
5. **The vocabulary of §4**, especially "time entry" for worklog and "my own
   task" for ad-hoc?
6. **Developer tools hidden** behind a switch in General (§2.2)?
7. **Interruptions keep a stack** and end with "Back to <task>" (§10.2)?
8. **A discussion task per project**, suggested first when an interruption
   is moved (§10.2)?
9. **"Sorted" means on a task or "Keep off Jira"**: a name alone no longer
   sorts an interruption (§10.2)?
10. **The bar's picker opens on RECENT, then MINE**, and a wheel click
    while timing opens INTERRUPT / SWITCH / STOP (§10.3)? Both need
    measuring on a bar.
11. ~~Unity: drop the linking only, or all of it?~~ Decided 2026-11-09:
    all of it (§10.4).

## 7. Found on the way: bugs, not design

These are worth fixing whatever is decided above:

- **The animation debugger acts on the real session and mode**: "Pause
  Task", "Stop Task (LOGGED)", "Lunch Break", "Away Mode".
- **The wrap-up's checklist is hard-coded**: "http://localhost:8081",
  "saveAll CLI". It says "logged to Jira" whatever the provider.
- **Placeholder values**:
  - the Firmware card shows a fixed "Build 2026.07";
  - the Unity page shows "MyFantasyGame" as "Connected" before any editor
    has spoken.
- **Two pieces with nothing behind them**:
  - the in-app toast component is mounted but never fed;
  - the bar's key bindings can be stored but have no screen.
- **The setup wizard points at places that do not exist**: "Settings >
  Device", "Settings > Task Providers". The sync badge tooltip says "the
  sync queue in Settings".
- **Deleting a task asks nothing**, and the project edit and delete icons
  only show on hover.
- **On the bar, a wheel click while idle opens two pickers**: the bar's and
  the window's.

## 8. The inventory, by surface

Usage: **D** daily, **S** set once, **T** technical. → is the proposed home.

**Main window**
- Session card, Start / Pause / Resume / Stop / Interrupt / Switch / Put on
  a task: D → Today
- Today's work table: D → Today, with row actions
- Projects, tasks, filters, start from a row: D → Tasks
- Import tasks, new or edit project: S → Tasks "⋯"
- Add task: S → Tasks
- Work History, metrics, breakdown, corrections, move, delete, sync badges:
  D → History
- Interruptions to sort: D → Today (today's), History (older)
- Provider, credentials, task scope, transitions, ad-hoc key: S → Settings ·
  Account
- Provider notifications: S → Settings · Account
- Sync queue: T → Settings · Account, folded
- Unity screens and sounds, junction injector, gitignore manager: removed (§10.4)
- Working days, stand-up, lunch, end of day, overnight question, split
  pause: S → Settings · My workday
- Notification listener, per-app rules: S → Settings · BUSY Bar
- Listener diagnostics, debug logs, custom sources: T → Settings · Developer
- Priority rules (levels, arrows, per-mode actions): S/T → Settings · BUSY
  Bar · What the bar shows first
- Work / Lunch / Away: D → header mode chip
- Device status, latency, battery, firmware, display health: T → Settings ·
  BUSY Bar (status), Developer (health)
- Connection, key colour, idle clock, use without a bar: S → Settings · BUSY
  Bar
- Start with Windows, Interrupt shortcut, updates: S → Settings · General
- Export logs, factory reset: S → Settings · Data
- Remote pad, debug triggers, animation debugger, input console: T →
  Settings · Developer
- Update banner: D → the header status dot
- Setup wizard: S → first run, and Settings · General

**Dialogs**
- Picker (start / assign / move): one picker, search first
- Finish: Not done / Done / Discard
- Correct / delete entry: unchanged
- Wrap-up: opened from "End my day" and the card
- Stand-up and resume: cards and toasts, see §3.4
- Forgotten session: kept, with "Decide later"
- Week over: unchanged

**Mini timer**
- Pause / Resume, Stop with Not done / Done / Discard, Interrupt, Switch,
  Move to a task, close: unchanged, plus the prompt cards

**Tray**
- See §3.6

**Toasts**
- Interruption started; sending stopped; task taken / not assigned;
  provider events; first close to the tray. Every one opens SprintTicker on
  its subject, or the provider's page for provider events

**Bar**

| Input | What it does |
| :--- | :--- |
| START | Toggles pause / resume |
| Wheel, idle | Bar picker |
| Wheel, paused | Paused menu: INTERRUPT / STOP / FINISH / DISCARD |
| BACK held | The end choices, as proposed |
| Prompts | Stand-up, resume, wrap-up |

The screens it shows on its own: banners, Lunch and Away, and the
scenes.

**Stream Deck**
- Session: start / pause / resume; held, the picker
- Interrupt
- Answer keys: Yes/Done, No/Not done, Discard. Hidden fixed actions kept

## 9. Build order, once approved

Each step lands working and documented on its own:

1. **The grey palette and the type**, alone: no structure change, every
   picture remade.
2. **Settings regrouped**, the four sidebar places, and the header.
   Developer tools moved behind their switch. The fixes in §7 that this
   touches.
3. **First run.**
4. **The flows**: the picker, the end dialog, prompts without focus,
   closing to the tray -- whichever of §6 you approve.
5. **The vocabulary**, across the window, the mini timer, the tray and the
   toasts.
6. **The bar's changes**, each checked on a real bar, and the plugin release.

## 10. After review (v2, 2026-11-09)

The screens file was reviewed twice: as a newcomer who knows nothing, and
against the inventory with a heavy day in mind -- 15 projects of 30+ tasks
and ten interruptions. Then the user added three points of their own.
`Redesign-2026-11-screens.html` is v2, and each screen it changed says so.

### 10.1 The newcomer review

- **"Done" meant two things**: the end of an interruption and the Jira
  completion. Now an interruption ends with **Back to MG-12** (↩), and Done
  is only the completion.
- **⇄ meant two things**: Switch and moving logged time. Moving is now
  **Move to a task…** (↳), on every surface.
- The header said nothing in words. The mode chip reads **Mode: Work ▾** and
  opens with what each mode does. The status dot has a word. The LED box is
  captioned "on your BUSY Bar" and shown only with a bar.
- A click on a choice acted at once. Choices are now picked, then confirmed
  by a button that says what happens ("Stop -- not done").
- The filter pills showed no state. Each "Not now" said something different;
  they are now **No bar**, **Stay stopped** and **Later**.

### 10.2 The heavy day

**The window and the mini timer hold up**, at about three presses per
interruption. What did not:

- **Placing ten interruptions at 18:00 from memory.** Each now offers its
  likely tasks as it ends, and a **discussion task** per project is offered
  first. A to-sort row says what it interrupted and where it was started.
- **An interruption of an interruption** lost the first task: only one is
  set aside today. A stack, shown as "Go back to" with each step.
- **Nothing running after an interruption ended from the bar or the deck.**
  Prompts no longer take focus, so this state is loud everywhere until
  answered (S10).
- **Done on a catch-all task** would move it to To Review. Interruptions
  never offer Done, on any surface.
- **The bar's picker** took 10 to 60 inputs to reach a task. It opens on
  RECENT, then MINE, then starred, and ends on "MORE: IN WINDOW".

### 10.3 The user's three points

1. **A custom provider in the first run.** Added as "Another tracker,
   through a SprintTicker server", for the Provider API. It appears the day
   the client side ships, not before, and not greyed out.
2. **The desk step asks for a BUSY Bar, a Stream Deck or neither**, as
   ticks. The Settings group becomes **Desk devices**.
3. **Finding a task to do among 450.** Search finds a task you can name, and
   Recent one you used, but not "what do I pick up next". The picker gets
   **Assigned to me · open** (S7b): your open tasks across every project, in
   progress first, then to do by priority -- the order `shared/task-order.ts`
   already applies inside one project. The bar offers it as MINE.

### 10.4 Unity is dropped

**Decided by the user, 2026-11-09:** all of the Unity integration goes. It
served only Unity developers who also own a BUSY Bar. What goes:

- the `packages/unity-plugin` package;
- the editor telemetry and its screens, sounds and display locks;
- the project linking (the junction injector and the gitignore manager);
- the wrap-up's scene save;
- its settings, its tests, and the documents that describe it.

The screens have no Unity left. The removal is its own change, ahead of the
redesign's build order. The priority engine's background-screen mechanism
stays, because the bar's picker and Desk use it too.

### 10.5 Restored after the inventory check

The review found these missing from v1, and v2 has them back:

- Grant Windows access
- notification display time and polling interval
- the updates switch and Check now
- the overnight answer "at the end of that day"
- the bar's token and Reset to USB default
- the day summary in History
- the "left your list" warning
- Refresh from Jira


## 11. Two blind reviews of v2 (2026-11-09)

Two Sonnet agents read a copy of the screens with the design notes taken
out, so neither saw any rationale. One played a newcomer. The other played
a lead with 15 projects, 20 colleagues and ten interruptions a day.

**Newcomer: "mostly" usable without help.** The core loop was clear: start,
interrupt, stop, correct, end the day. Where they stumbled:

- The first run asks too much. Devices looked pre-ticked in S2, and "Where
  do discussions go?" means nothing on day one. Tick only a detected device,
  and move the discussion tasks to the first interruption.
- "To sort", "Keep it here" and ↳ were not understood. The ⚡ is explained
  only in a table footer.
- Text buttons in rows are small. "Change not sent yet" and the clickable
  status are explained only on hover.
- There is no way to add an entry that was never timed. The app has none
  today either.

**Heavy user: "with fixes", about 115 interactions a day**, 55 % of them on
interruptions. Back-to-previous, the stand-up and lunch worked well.

The top three problems:

1. **Interruptions from the bar and the deck arrive unnamed and unplaced.**
   They are sorted on the PC, and anything unsorted is never sent, even
   after End my day.
2. **A reassigned ticket is visible only at Stop**, in the screens. The app
   already marks the session `reassigned`, but no screen draws it while
   timing.
3. **The default destination of an interruption** (OPS-4, pre-ticked) is
   wrong for another project's question.

Also raised:

- Bulk sort grouped by suggested task.
- Project-key search ("pf 40").
- Inconsistent labels: "closed Friday 17:30" against "due Monday 12:00", and
  "sent when you stop".
- A badge on the tray icon for entries waiting to send.
- Missing for this load: undo after Stop/Discard, splitting an entry,
  timesheet CSV export, idle detection during the day.

The last one conflicts with the rule that an absence the same day counts as
work (CLAUDE.md §7), and is the user's to reopen.

## 12. v3: the blind reviews applied (2026-11-09)

The user asked for every fix. The screens marked "new after blind review"
are new, and the rest were edited in place.

**For the newcomer**

- **First run.**
  - Only a device that was found starts ticked.
  - "Where do discussions go?" leaves the first run, and is asked at the
    first interruption instead.
  - The API token is explained where it is typed.
- **Words.**
  - "To sort" becomes **Interruptions not on a task yet**, with ⚡ as the
    badge.
  - "Keep it here" becomes **Keep off Jira**.
  - "Back to PF-31" becomes **Previous task: PF-31**, and is kept apart
    from ↩ Back, which ends an interruption.
  - S9b's ↩↩ becomes **End both, back to MG-12**.
- **What was hidden on hover is now on screen.**
  - "Change waiting for Jira", with its retry.
  - The status shows **All good ▾**.
  - Row actions are real buttons, and Delete asks ("Delete…").
- **End my day.** Its explanation is a sentence, no longer a setting row.
  The button says what it sends.
- **New, S16b: Add time.** Time that was never timed can be added. The app
  has no such thing today.

**For the heavy user**

- **New, S5b: the task you time is given to someone else.**
  - This is said the moment the sync sees it, on every surface: the window,
    the mini timer, the bar ("MG-12 > RIN") and the Session key (NOT YOURS).
  - The engine already knows, through `reassigned` and `taskOwnerName`.
- **An interruption has no default task.**
  - S9 offers, in order: the discussion task of the project interrupted, the
    task interrupted, then starred tasks.
  - Nothing is chosen until clicked.
- **Interruptions from the bar and the deck can be placed where they end.**
  - The bar asks "6M ON?" and offers the suggestions or LATER.
  - The deck's answer keys become A = the first suggestion, B = LATER.
    C stays DISCARD, as the user's rule requires.
  - Both need measuring on the devices.
- **New, S12b: Sort all, grouped by suggested task.** One click per group.
- **End my day shows each unsorted interruption with a suggestion.**
  - Sending them on those suggestions is a tick, off by default (the user's
    choice, 2026-11-09).
  - Left unticked, they stay unsent, and the week's close lists them again.
  - Nothing reaches Jira unless the user placed it.
- **Search and lists.**
  - Search covers teammates' tasks, marked with the teammate's name.
  - A key prefix narrows it ("pf 40").
  - Projects are listed starred first, then most used.
- **The timesheet.**
  - "Timesheet due Monday" is gone. The week closes at the end of the last
    working day, as the code already does.
  - The week has Export CSV.
  - A day's total opens that day.
  - Time not on a task links to it.
- **Undo.** Stopping gives a toast, "Goes to Jira in 10 s · Undo". The send
  waits those 10 s.
- **Split in two** is on the Correct dialog.
- **The tray icon** shows timing, nothing timing in working hours, and
  entries waiting to send.

**Not designed**

- **Idle detection during the day.** It contradicts the rule that a same-day
  absence is work (CLAUDE.md §7). It is for the user to reopen.
- **A calendar link, per-project targets, a "who asked" field.** Out of
  scope.
- **Lunch or the stand-up arriving during an interruption.** The app's
  current rule has to be read from `ContextScheduleService` before a screen
  states it.

**New decisions**

12. ~~End my day sends interruptions on their suggestions by default?~~
    Decided 2026-11-09: **no**, the tick is off by default.
13. **Undo delays every send by 10 s**, or only the send after Discard?
14. **Add time and Split**: build them with the redesign, or later?


## 13. Second blind round, on v3 (2026-11-09)

The briefs and the setup were the same as §11. Neither reviewer saw the
first round.

**Newcomer: "mostly" again, with fewer stumbles.**

- Setup went from "with hesitation" to "easily".
- The token, the overnight question and the Stop dialog were clear.

What remains:

- "Keep off Jira" is explained only by a tooltip.
- The picker is crowded, and it is unclear whether a click starts the task
  or only selects it.
- S16 doesn't warn about a closed week.
- Discard shows no second confirmation on screen.
- Starting a task assigns it to the user, which surprised them.

**Heavy user: "with fixes" again, about 110-130 interactions.**

What improved:

- The reassignment card (S5b), which they named a strength.
- No more wrong OPS-4 default.
- Sort all.
- Previous task.

Their top 3 now:

1. **Not chosen yet, plus the unticked send, makes unplaced time the
   default.** About 45-60 minutes a day ends unsent unless the tick is
   noticed. The newcomer flagged the same tick independently. It is the
   user's decision 12; the cheap fix that keeps it is a button that says so:
   "send 7h 05m · 45m stays here".
2. **The bar and the deck place an interruption on only two suggestions**,
   and cannot name one.
3. **The week's checks are scattered.** The unplaced 18 minutes sit on
   Wednesday in S15 and on Thursday in S14, which is a mock-data error, and
   Sort all can't be reached from the week or from End my day.

Also raised:

- "↩ PF-31" (Previous) and "↩ BACK MG-12" sit side by side on the deck,
  with different meanings.
- Nothing-running needs a reminder after N minutes.
- The picker's teammates filter is off while S8 says search covers
  teammates; the wording should be one rule.
- S6 draws the stand-up over a paused task, which is an artefact of the
  mock.
- The week needs its target total and an unplaced row.

## 14. v3.1: the second round applied (2026-11-09)

**For the newcomer**

- **"Keep off Jira"** is explained in the card's own line.
- **The picker.**
  - It says a click starts the task.
  - Its pills read "Lists show".
  - Search says it covers everyone's tasks.
- **An unassigned task** says "starting it makes it yours" in the row.
- **S16** draws an entry in a closed week, with the warning above the fields
  and "Save the change".
- **S11** draws Discard's second question: "Discard 1h 24m? … cannot be
  undone".

**For the heavy user**

- **Decision 12 stands, and is made visible.**
  - The button reads "End my day · send 7h 05m · 45m stays here".
  - The card has Sort all.
- **The week (S15).**
  - Its total shows against the target.
  - It has a "⚡ Not on a task" row with Sort all.
  - S14 and S15 now agree that the 18 minutes are Wednesday's.
- **↩ only ends an interruption.**
  - Previous task loses the icon in the window and the tray.
  - On the deck it reads PREV PF-31.
- **The bar** turns through every suggestion for an interruption, one at a
  time ("6M ON? 1/5"), and ends on LATER. It cannot type a name, so the
  window shows where the interruption came from.
- **S5b** offers "↳ Move my 1h 24m…".
- **The stand-up card** says the task keeps running until Join.
- **Nothing timing in working hours** asks once after 10 minutes, as a
  setting in My workday. The tray icon stays amber meanwhile.

**Left as it was, on purpose**

- **S9b keeps "Back to the call" as the primary**: a stack goes back one
  step.
- **No default task for an interruption**, so that only the user places
  time.
- **Idle detection during the day**, as in §12.

## 15. Third blind round, on v3.1 (2026-11-09)

| | Round 1 (v2) | Round 2 (v3) | Round 3 (v3.1) |
| :--- | :--- | :--- | :--- |
| Newcomer verdict | mostly | mostly | mostly |
| Heavy user verdict | with fixes | with fixes | with fixes, "better than anything I have used" for Interrupt, Previous and Sort |
| Heavy user interactions a day | ~115 | 110-130 | 85-100 |

**What stays the top issue in every round, for both reviewers:**
interruption time that nobody places stays unsent. That comes from two
rules: no default task (§14) and the send tick off at End my day
(decision 12). Round 3 calls it a blocker.

**Fixed after this round, mock contradictions only:**

- The mini timer and S6 now give one stand-up rule.
- The version shown agrees between S19 and S27.
- "I was working all along" shows its hours.
- The mini timer has Previous (⟲).
- The week's collapsed projects open.
- Search offers Refresh when nothing is found.

**Left for the device limits:** the bar and the deck cannot type a note,
and the deck offers one suggestion.

**Raised, not designed:**

- A live Jira lookup or a pasted key for a ticket made minutes ago.
- The first suggestion following the project named in the note, not the
  one interrupted. S12 already matches a key in the note; S9 does not.
- A reminder on a reassigned task after N minutes.
- A manager-facing week status.

**Decision 12 confirmed after round 3 (the user, 2026-11-09).** The send
tick stays off.

The rule: **only the user decides which task interruption time goes on.**

- The app may suggest a task, but it never picks one, and it never sends
  without the user's act.
- Since every interruption can be placed by hand -- as it ends (S9, S10),
  from Today (S5, S12), with Sort all (S12b), at End my day (S17) and from
  the week (S15) -- unplaced time is the user's choice, not a gap to close
  by default.

A future review that flags it should be answered with this rule, not by
changing it.

## 16. The bar and the deck are shortcuts (the user, 2026-11-09)

**The rule.** The BUSY Bar and the Stream Deck are a real interface of the
app, and shortcuts to it, not a replacement for it.

- **What a device does, in one press:** the most used actions -- start a
  recent task, pause, stop, interrupt, go back after an interruption,
  previous task.
- **What a device shows:** what is running, what needs the user, and the
  notifications.
- **What stays in the app:** naming and placing time. A device brings the
  app to the front, open on the right screen.

The win to protect is stopping or interrupting in one press, and placing
the time in the app after the discussion.

**What it changed in the screens.** v3 let the bar turn through
suggestions ("6M ON? 1/5"), and the deck place on the first one. Both are
gone.

- **The bar** goes back to the task and keeps "6M TO PLACE OK=APP". OK
  brings SprintTicker to the front on that interruption (S12).
- **The deck's** A reads "PLACE 6M IN APP" and does the same, B is LATER,
  and C stays DISCARD.

**For the build.** "Brings to the front" must get past Windows' foreground
lock. A press reaches Stream Deck or the bar, not this app.
`ForegroundRaiser` is the measured way (CLAUDE.md §3), and the picker
opened from the deck already uses it.

The review findings this answers -- the bar and the deck cannot name, the
deck offers one suggestion, the bar cannot reach 450 tasks -- are by design,
not gaps.

## 17. v4: flow improvements (2026-11-09)

Proposed after round 3 and drawn at the user's request. All of them add
to what was decided; none changes it. The screens mark them "new in v4".

1. **The first look in the morning (S4b).** On a working day's first
   opening, Today shows:
   - Continue the task stopped last night, in one press;
   - yesterday's interruptions not on a task;
   - the stand-up time;
   - the tasks in progress.

   The card goes once anything starts.
2. **The day as a timeline (S14b).** History's day shows working hours as a
   strip. An untracked gap is hatched, and a click on it opens Add time
   (S16b) at that time. Nothing is logged on its own: the rule that only
   the user places time holds (§15).
3. **Check my week (S15b).** One list for the week's problems, each with
   its fix:
   - time not on a task;
   - entries not sent;
   - days under target;
   - overlaps;
   - changes to a closed week.

   It opens from the week view and from the week's close.
4. **Keyboard (S30, S19).**
   - Ctrl+K opens a command palette over every action and task.
   - Switch task and Previous task get global shortcuts, off by default
     like Interrupt's.
   - Their chords go through `chordProblem` / `chordCaution`.
5. **What you missed (S27).** The status panel keeps today's notifications,
   since a banner on the bar vanishes while the user is away.
6. **Undo for every change (S26).** Move, Delete, Keep off Jira and Sort
   all get the toast Stop already has. A deletion is told to Jira after the
   same 10 s.
7. **When things are not normal (S31).** Each state says what still works:
   - the first sync;
   - Jira not answering;
   - no network;
   - the bar unplugged;
   - just updated.
8. **Contrast.** The muted grey goes from `#6B6B72` to `#8A8A92`. The old
   one measured about 3.6:1 on the background and 3.35:1 on panels, under
   the 4.5:1 minimum for small text.

**Smaller**

- The picker shows each task's time today.
- Today's total has a progress bar against the working day.
- Settings has a search box.
- One task row is shared by the picker, Tasks and History. That is a rule
  for the build, not drawn.

**For the build**

- The timeline needs the working hours, which My workday already holds.
- "What you missed" needs the listener's mirrored notifications kept for
  the day. Today they are only drawn on the bar.

**Added after the user asked (2026-11-09): the picker filtered to one
project (S7c).**

- A click on a project, or its key and a space ("pf "), filters the picker
  to that project.
- It shows what is left there: in progress, to do by urgency, and done,
  each a pill with its count.
- The search then looks only inside it.
- The project chip switches to another project, and ✕ goes back to all.
- It lasts until the picker closes.

## 18. Fourth blind round, on v4 (2026-11-09)

| | R1 | R2 | R3 | R4 |
| :--- | :--- | :--- | :--- | :--- |
| Newcomer | mostly | mostly | mostly | mostly |
| Heavy user | with fixes | with fixes | with fixes | with fixes |
| Heavy user's day | ~115 | 110-130 | 85-100 | ~93 (Friday ~115) |

**The newcomer** found the core flow clear: setup, start, stop, correct,
the token, overnight. Consequences are written on the buttons. What
remains:

- the bookkeeping of interruptions;
- the unticked send at End my day, which is by rule (§15);
- device words.

**The heavy user** valued Previous task, the morning card and the
closed-week warning. New, valid findings:

- **A bulk move applies one target to rows from different projects (S12).**
  The Marc call (during MG-12) would go to PF-2. Rows from different
  projects should never share a preselection.
- **Suggestions follow four rules on four screens.** The same call was
  OPS-4 in S10 and MG-1 in S17. One suggestion rule is needed, shown the
  same everywhere.
- **The week shows "logged" but not "in Jira" per day**, so the manager's
  figure is unclear.
- **A key typed into search that finds nothing** should offer "Fetch MG-77
  from Jira", not only a task of my own.
- **The bar has no Previous task entry.** The deck has no recent-task keys,
  although S29's own text promises them.
- **Nothing timing is quiet on the devices.** The bar's idle clock looks
  normal.

**Mock contradictions fixed:**

- S6's stand-up text against its paused task;
- S18's "Friday" against S4b's Tuesday;
- S10's suggestions, now the same as S17's;
- "five states" in S25.

**Answered by the user's rules, not reopened:**

- the unticked send and no default task (§15);
- naming an interruption on a device (§16);
- lunch restarting the task (existing behaviour).

## 19. Decisions after round 4 (the user, 2026-11-09)

1. **No suggested, preset or default task for an interruption -- anywhere.**

   The reasons:
   - An interruption can be about anything, and they come one after
     another.
   - When the user is back on the base task, or at the end of the day,
     they decide each one's project and task.
   - A default leads to bad time tracking.

   This withdraws three things:
   - **the per-project discussion task**, with the ⋯ entry in Tasks and the
     "Where discussions go" setting (decision 8);
   - **the suggestion rows and chips** in S9, S10, S12 and S17;
   - **S12b's grouping by suggested task.**

   What replaces them:
   - **S12** is the picker with nothing preselected: Recent, Starred and
     the project filter.
   - **S12b and S17** give each interruption its own "Choose a task ▾"
     row.
   - **The send follows the choice**: an interruption is sent once its task
     is chosen, and one left alone stays here, unsent.

   §16 stands as written: the bar and the deck start and stop an
   interruption, and placing it brings the app to the front.

2. **The Interrupt shortcut is on by default** (`Ctrl+Alt+Shift+I`). This
   supersedes the original "off by default". If another app holds the
   chord, Settings says "taken", as it does today.
3. **"Nothing timing" asks once**, never again.
4. **After lunch the app asks "Back at your desk?"** instead of restarting
   the task. Nothing times until the user answers "Resume".

   This changes `ContextScheduleService`'s restart. The stand-up's restart
   is unchanged.

## 20. More decisions (the user, 2026-11-09)

**The four remaining round-4 suggestions are drawn.**

- **S15:** an "In Jira" row per day, the figure the manager sees, under
  the logged one.
- **S8:** a key typed in full that matches nothing offers "⤓ Fetch MG-77
  from Jira". It reads that one ticket. A task of my own with a key-like
  name is flagged.
- **S28 and S29.**
  - The bar's wheel menu has PREV.
  - The deck has optional Recent 1-3 keys.
  - With nothing timing in working hours, the bar shows "NOTHING TIMING"
    and the Session key turns amber. This is a state, shown until something
    starts or BACK returns the bar to its clock. It is not a repeated
    prompt.

**Decision 13: every send waits 10 s for Undo, except End my day.**

The end-of-day shutdown is a Windows timer (`scheduleShutdown`, 30 s),
independent of the send queue. So:

- **The wrap-up skips the hold**, and sends at once.
- **The shutdown is scheduled after that queue pass**, with a cap, so a
  dead network cannot keep the PC on.
- **Anything unsent stays in the queue** and goes out at the next start, as
  today.

The user asked that the undo delay never break the auto shutdown. This
order is how. It needs a test that ends the day with shutdown on and an
entry inside its hold.

**Lunch during an interruption.**

At lunch time, an interruption that is running asks "Start lunch? It ends
'Call with Marc'". The question appears on the mini timer and in a toast,
never stealing focus.

- **Start lunch** ends the interruption. It waits to be placed, like any
  other. Lunch then begins, and the base task's restart is asked after
  lunch ("Back at your desk?").
- **Not now** keeps the interruption running. Proposed, to confirm: lunch
  is asked again when the interruption ends, if it is still lunch time.

**Decision 14 (the user): Add time and Split both ship with the redesign.**

- **Add time (S16b)** creates a new entry: a CREATE through the queue,
  checked against overlaps, with Undo and the closed-week warning.
- **Split (S16c)** cuts one entry at a chosen time, and the second part
  goes on a task the user picks. Nothing is preselected.
  - It is an UPDATE of the original, then a CREATE held behind it in the
    queue (`origin_sync_id`), the same mechanism as Move (DELETE then
    CREATE).
  - Both parts keep the note.
- **Each needs the tests §6 asks for:** the provider refusing the second
  half, a split of an entry whose CREATE has not arrived yet, and a split
  in a closed week.

## 21. Fifth blind round, on v4.1 (2026-11-09)

| | R1 | R2 | R3 | R4 | R5 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Newcomer | mostly | mostly | mostly | mostly | mostly |
| Heavy user | with fixes | with fixes | with fixes | with fixes | with fixes |
| Heavy user's day | ~115 | 110-130 | 85-100 | ~93 | ~108 (Fri ~126) |

The count rose because placing time is now always the user's own choice
(§19). That is the price of the rule, and the user chose it.

The newcomer called the token fix "the best-handled flow". Their
remaining confusion is the same as before: time not on a task, "Mode", the
closed week, and the device words.

**Mock contradictions fixed:**

- The stand-up wording, on the mini timer against S6.
- The shortcut's tooltip, which still said "once you turn it on".
- S14's "all sent" against MG-14 waiting.
- An interruption shown at 11:05 on one screen and 13:05 on another.
- PF-31's title.
- The picker now highlights the previous task.
- The bar's paused menu starts on NOT DONE instead of DISCARD.

**Valid findings, for the user to decide:**

1. **"Back" after an interruption should return to the previous state.**
   A task paused on purpose stays paused, not resumed.
2. **Undo after starting a task.** A mis-click among 450 tasks moves a
   ticket to In Progress and assigns it, visible to colleagues. The same
   10 s hold as sends would cover the transition and the assignment.
3. **PREV on the deck during an interruption is undefined.** Hide it
   there.
4. **The mini timer shows no count of time to place**, and the bar shows
   only the last interruption ("6M"), not the count.
5. **A running stand-up has no "End stand-up, back to MG-12".**
6. **"Resume MG-12" after nothing ran** should say the gap stays untracked
   and can be added (Add time).
7. **Back-and-forth makes many small Jira entries.** Should adjacent
   entries on the same task be merged?
8. **The deck's Answer A changes meaning:** DONE, then BACK, then PLACE.
   Muscle memory can press DONE. This is the user's layout (2026-11-09),
   so it is raised, not changed.

**Against the user's rules, not reopened:**

- a default task for interruptions, chips of the last used task,
  suggestions from past notes;
- idle detection;
- PLACE IN APP made optional.

## 22. Decisions after round 5 (the user, 2026-11-09)

**Findings 1-6: applied.**

1. **Back returns to the previous state.** Going back after an
   interruption returns the task as it was: running, or paused if the user
   had paused it (S9).
2. **Undo on start (S26).** "Started MG-15 · moved to In Progress and
   assigned in 10 s · Undo". The transition and the assignment wait the
   same hold as sends.
3. **PREV is hidden on the deck during an interruption.** Going back there
   is A.
4. **The count to place is shown.** The mini timer has a ⚡3 badge, and the
   bar reads "3 TO PLACE OK=APP".
5. **A running stand-up has "End stand-up".** It goes back to the task as
   it was (S25).
6. **"Resume" after nothing ran says the gap stays untracked**, and can be
   added with Add time (S10).

**Finding 7: no merge.** Back-and-forth keeps one Jira entry per session,
as today.

**Finding 8: the deck keeps the same logic, with one meaning per answer
key (S29).**

- **A, green, carries on:** DONE, BACK, PLACE IN APP, JOIN, RESUME, START
  LUNCH.
- **B, blue-grey, stops or waits, keeping the time:** NOT DONE, STOP,
  LATER, SKIP, NOT YET, NOT NOW.
- **C, red, throws away:** DISCARD, or blank when there is nothing to
  discard.
- **DONE always asks a second press on the deck** ("DONE? AGAIN"), so a
  habit learned on BACK never marks a ticket done.
- **`resolveKind` keeps mapping A, B and C**, as it does today. What
  changes is the set of answers each state offers, the colours, and
  `needs-confirmation` applying to every DONE from the deck.

## 23. Sixth blind round, on v4.2, and "would you use it daily?" (2026-11-09)

**Would they use it every day?**

- **Newcomer: "Yes, probably, with a trial week."**
  - What wins them: it logs to Jira without fiddling, the Interrupt
    button ("Jira's own timer can't capture" quick questions), and the
    morning card.
  - What would make them stop: a wrong entry the manager sees, too many
    prompts, or sorting becoming a chore.
  - The bar it has to clear: sorting under a minute a day. Without the
    tool they lose 30-60 minutes of small work by logging from memory.
- **Heavy user: "Yes, conditionally."**
  - What wins them: Previous task in one press, the stand-up and lunch,
    Fetch by key, the week against Jira, and timing without the main
    window ("the best part").
  - "This tool cuts the guessing, not the click count." By their count,
    hand-logging 30 worklogs costs 150-180 clicks.
  - They would start daily once backdated starts and interruption presets
    exist. Presets are against §19.
  - They would stop after two or three days of a silently forgotten ⚡
    interruption.

**Verdicts:** mostly / with fixes, as in every round. The heavy user
changed their counting method (about 130 a day), so the figure does not
compare with earlier rounds.

**Mock fixes:**

- "6M TO PLACE" in S28's text;
- the running row's "sent when you end the day";
- the tray's ⓶;
- "I was working all along" now warns in amber.

**Valid findings, for the user to decide:**

1. **A forgotten interruption.** The call ends, coding starts, and ⚡ keeps
   timing. Ask once, after N minutes of an interruption: "Still on 'Call
   with Marc'?" This is the heavy user's "would stop" reason.
2. **A backdated interruption start:** "Interrupt · started 5 min ago".
   Today it needs Split or Correct, about 10-15 interactions.
3. **An unnamed interruption sends "Interruption at 14:02" to Jira as its
   note.** Ask for a name when it is placed.
4. **A toast when the task you time is reassigned.** Today only the card,
   the mini timer, the bar and the deck say so.
5. **The deck's BACK label names the real target in a nested
   interruption** ("BACK CALL"), and STOP in a nested interruption is
   defined.
6. **The stand-up arriving during an interruption** is handled like lunch.
7. **In Move to a task, the task you were interrupted from** is not at
   the top of Recent, so habit doesn't put the call on it.
8. **End my day points to the day's gaps and overlaps** (S14b, S15b)
   before sending.
9. **S29 says that the Session key pauses and resumes**, which the
   reviewer could not find.

**Against the user's rules, not reopened:**

- interruption presets, or rules per person or keyword (§19);
- merging entries (§22).

**Out of scope:**

- a submit or approval state, which is Jira's;
- calendar or Teams detection.

## 24. Round 6 applied (the user: "apply all nine", 2026-11-09)

1. **A forgotten interruption** asks once, after 20 minutes by default (a
   My workday setting): "Still on 'Call with Marc'?", with Still on it /
   ↩ Back. It is shown on the mini timer, never stealing focus.
2. **A backdated start.** S9 has "Started 5 min ago ▾". The minutes are
   taken off the base task, which ran meanwhile, so nothing is counted
   twice.
3. **Names.** An unnamed interruption asks for a name when its task is
   chosen, since Jira shows it as the note. S9 says the name becomes the
   note.
4. **A toast when the task being timed is reassigned:** "MG-12 is now Rin
   Okada's".
5. **The deck in a nested interruption.**
   - A reads BACK CALL, one step back.
   - B stops both, and both wait to be placed.
   - C discards the current one only.
6. **The stand-up during an interruption** asks "Join? It ends 'Call with
   Marc'", like lunch.
7. **In Move to a task, the task interrupted comes after the other recent
   ones**, labelled "the task it interrupted".
8. **End my day lists the day's gaps and overlaps** with "Check them…"
   before sending.
9. **S29 says the Session key pauses and resumes**, and opens the picker
   when held.

**Gaps at End my day are a hint, never a gate (the user, 2026-11-09).**
The line has Skip beside "Check them…". Skipping leaves the gaps
untracked and sends what is on a task.

## 25. Seventh blind round, the last before production (2026-11-10)

The same two Sonnet reviewers and the same briefs as round 6, on the
committed screens.

**Verdicts:** mostly / with fixes, as in every round. The heavy user
counted about 130 interactions a day, the same as round 6 by the same
method. Interruptions take 46% of them, about 6 each.

**Would they use it every day?**

- **Newcomer: "Yes, probably, with conditions."**
  - What wins them: Start, Interrupt and Back replace rebuilding the
    week from memory on Friday. "Sent" on each entry, the week against
    Jira and the overnight prompt show the app cares about accuracy.
  - What would make them stop: Jira statuses and assignments changed
    without asking (In Progress, "assigned to you"), the "not on a task
    yet" reminders after every interruption, or wrong time in Jira.
- **Heavy user: "Yes, with a short list of conditions."**
  - What wins them: one press to start an interruption and one to go
    back, which catches the minutes nobody rebuilds at 17:30.
  - What would make them stop: one week where the manager's figure is
    wrong because a sort was skipped, or a gap nobody noticed.

**Mock fixes:**

- S5's running row started at 16:11 under a timer at 01:24; it now
  starts at 15:30, when OPS-4 ended.
- S17's gaps and overlap named times taken by S5's entries.
- S15b's fixes now say where each opens.
- S31 lacked the refused token, and the header's words lacked "Sending
  stopped".

**Not findings:**

- the newcomer read the Interrupt shortcut as "off by default
  elsewhere", which no screen says;
- they also took the unticked shutdown box for a ticked one.

**Valid findings, for the user to decide:**

1. **Say once, before the first start, that starting changes Jira**
   (In Progress, and assigned to you if nobody has it). This was the
   newcomer's first "would stop" reason. The setting exists (S20), but
   nothing points to it before it happens.
2. **Explain ⚡ the first time.** The first interruption shows one line
   on what happens to its time and the four choices: choose a task,
   later, keep off Jira, sort.
3. **S2 says what the devices are for** and has "I have neither" as the
   plain way on.
4. **S10: "Add the 6 min to MG-12"** beside Resume. The user chooses, so
   nothing is assumed. Today it needs Add time.
5. **The Switch and Previous task shortcuts on by default**, like
   Interrupt.
6. **The window's Stop in one click for "not done"**, a split button, as
   the deck and the mini timer already do.
7. **End my day says what happens to the running task**: it stops, not
   done.
8. **"What you missed" (S27): start a backdated interruption from a
   row**, for a Slack question answered a minute ago.
9. **Naming from the mini timer.** An interruption started from the bar
   or the deck shows a name field on the mini timer, which never steals
   focus. The bar and the deck still only start and stop.

**Against the user's rules, not reopened:**

- gating End my day until every interruption is placed (§19, §24);
- a task pre-filled or suggested for an interruption, or templates
  (§19);
- "nothing timing" repeated, or always shown on the bar (§19);
- merging adjacent entries (§22);
- idle detection.

**Out of scope:** calendar import, a worklog preview in Jira's format,
and bulk edit in History.

## 26. Round 7 applied (the user: "apply all nine", 2026-11-10)

1. **Starting changes Jira, said once.** S4 shows "Starting a task changes
   it in Jira: it moves to In Progress, and becomes yours if nobody has
   it", with Got it and a pointer to Settings › Account. It shows until Got
   it or the first start, and never again.
2. **The first interruption explains itself.** In S9, one line says its
   time comes off the task and nothing goes to Jira until its task is
   chosen. It names the three ways to end it and says several can be
   sorted at once.
3. **S2 says what the devices are for**, and works without them. Neither
   now reads "I have neither: nothing to set up".
4. **S10 offers "↩ Resume, add the 6 min"** beside plain Resume and Stay
   stopped. The user picks; nothing is added by default.
5. **The Switch task and Previous task shortcuts are on by default**
   (`Ctrl+Alt+Shift+S`, `Ctrl+Alt+Shift+P`), like Interrupt. This
   replaces "off by default" in §17.
6. **The window's Stop is a split button.** "■ Stop, not done" stops in
   one click, and ▾ opens S11 for Done or Discard. Done keeps its
   explicit choice in the window and its two presses on the deck.
7. **End my day says what happens to the running task.** MG-12 stops as
   not done, stays open in Jira, and its time is sent.
8. **"What you missed" can start an interruption.** A Slack row has
   "⚡ Interruption since 14:05", backdated and taken off the task that
   ran.
9. **Naming from the mini timer.** An interruption started from the bar
   or the deck shows the mini timer with a name field. It never takes the
   focus, and the name can wait until the time is placed (§24).

## 27. Eighth blind round, on round 7 applied (2026-11-10)

The same two Sonnet reviewers and the same briefs.

**Verdicts:** mostly / with fixes. The heavy user counted about 115
interactions a day, down from about 130. About 70% go to interruptions:
35 to start and end them and 45 to place them.

**Would they use it every day?**

- **Newcomer: "Yes, probably."**
  - Why: it beats rebuilding the day from memory at 17:30, and the 10 s
    undo and "sent" per entry make it feel safe. They would check Jira by
    hand the first week.
  - What would make them stop: wrong time sent unnoticed, interruptions
    piling up "not on a task", or a pause they did not expect.
- **Heavy user: "Yes, with caveats."**
  - Why: they estimate it saves about 20 minutes a day. 1-press
    interruptions and "Check my week" against what the manager sees beat
    hand-logging and Toggl.
  - What would make them stop: a Done pressed by habit on a colleague's
    ticket, or a short week from unplaced time.

**What round 7 changed:**

- "Stop, not done" in one click and the Jira note before the first start
  were read as intended.
- Placing remains the main cost.

**Mock fixes:**

- S25's deck interruption has the same buttons as any interruption.
- S22 says a question or NOTHING TIMING stays on the bar, so it no longer
  contradicts S28.
- S28's wheel menu has PAUSE, as the bar's own rule says.
- S5's placed OPS-4 entry no longer shares Marc's name with an unplaced
  one, which read as double counting.
- S17's task choices include Keep off Jira.
- S29's DISCARD asks a second press, like DONE, as the deck does today.
- S21 says which task the stand-up is timed on, as S3 does.

**Not findings:** the newcomer read S19's toggles as identical. They are
all on now, and the off style differs.

**Valid findings, for the user to decide:**

1. **The ⚡ count includes older unplaced interruptions**, not only
   today's, on Today, the mini timer and the bar. Today a Wednesday one
   shows only in History and can reach Friday unseen.
2. **The bar keeps "3 TO PLACE" on its idle line** while anything is
   unplaced. This shows a state; it is not a prompt.
3. **The running task's owner is checked every minute**, not at the next
   sync. The reassignment was noticed "4 min ago".
4. **The Mode chip explains itself.** A tooltip on Work, Lunch and Away
   says what each does to the timer. This is the newcomer's second round
   asking.
5. **In S18, "Log and restart MG-12" is set apart from "Log and stop".**

**Against the user's rules, not reopened:**

- remembering or suggesting a task per name or person;
- pre-selecting the interrupted task;
- a default task for all rows (§19);
- a nag at a fixed hour (§19);
- an undo on End my day (§20, decision 13);
- idle detection.

**Out of scope:** calendar import, submission or approval status,
rounding, searching descriptions.

## 28. Round 8 applied (the user: "apply the five fixes", 2026-11-10)

1. **The ⚡ count covers every day.** Today, the mini timer and the bar
   count an unplaced interruption from any day until it is placed.
2. **The bar's idle clock keeps "3 TO PLACE"** on its second row while
   anything is unplaced. It shows a state and asks nothing.
3. **The running task's owner is checked every minute**, not only at the
   sync, so S5b reads "1 min ago".
4. **The Mode chip says what each mode does** to the timer, on hover.
5. **S18 sets "Log and restart MG-12" apart.** "Log and stop" is the main
   button on its own; restart sits with "Decide later".

## 29. Favourites instead of presets (the user, 2026-11-10)

The user's answer to the presets that every heavy-user round asked for:
**starred tasks, put first wherever time is placed.**

A preset decides for the user; a star only shortens the list they choose
from. So the rule of §19 holds: nothing is suggested or preselected, and
every interruption still takes a click on its task.

- **Move to a task (S12)** lists Starred first, then Recent, then the
  projects.
- **Each row's menu in Sort interruptions (S12b) and End my day (S17)**
  opens on the starred tasks. Eight are shown and the rest fold under
  "all". Search and Keep off Jira sit below them.
- **Starring is the one way to add a favourite:** ☆ on any task, in the
  pickers and in Tasks.

The usual places, such as OPS-4 "Team discussions and meetings" and PF-2
"support and questions", become one click from the menu: about 2
interactions per interruption instead of 3 or 4.

## 30. Ninth blind round, with starred tasks first (2026-11-10)

The same two Sonnet reviewers and the same briefs.

**Verdicts:** mostly / with fixes. The heavy user counted about 105
interactions on a normal day and about 120 on Friday, down from about 115
in round 8. Interruptions still take 57%, about 6 each, mostly naming and
placing.

**Would they use it every day?**

- **Newcomer: "Yes, with conditions."**
  - What wins them: one click to start, a timer they can see, time
    reaching Jira without typing it, and the week's "In Jira · what your
    manager sees".
  - What would make them stop: unplaced interruptions to keep sorting, a
    Lunch pause when they did not take lunch, or a forgotten timer.
  - What they want: assigning and In Progress asked, not only told.
- **Heavy user: "Yes, conditionally."**
  - What wins them: Previous task, Fetch by key, and the week check
    against Jira ("saves the Friday reconstruction"). It beats Tempo and
    Toggl on interruptions and the devices.
  - What would make them stop: piles of unnamed "Interruption at 14:02",
    hours left unsent, or a mis-pressed DISCARD.

**Mock fixes:**

- S9 had "held and logged" beside "taken off MG-12". It now reads "its
  time so far stays logged" and "those minutes come off MG-12", never
  earlier than its start.
- S26 has the overnight toast, which S18 assumed.
- S3 chooses the stand-up's task, which S6 and S21 used.
- S29's stand-up Session key showed the hour, 09:30, as if it were a
  timer.

**Not findings:** the newcomer again read S19's toggles as all on. They
are on; the job "turn on the shortcut" predates it being on by default.

**Valid findings, for the user to decide:**

1. **Done in two clicks.** ▾ beside "Stop, not done" opens a short menu,
   Done… and Discard…, instead of the S11 dialog. Today Done takes 3
   clicks.
2. **The first start asks, rather than tells**, whether to move the task
   to In Progress and assign it. The answer is saved, and can be changed
   in Settings › Account.
3. **The tray menu gets Stop, not done; Back to MG-12 during an
   interruption; and Lunch and Away.**
4. **The deck and the bar show NOTHING TIMING in working hours, and a
   running stand-up with END.** The bar already shows NOTHING TIMING; the
   deck's Session key does not, and neither device can end a stand-up.
5. **One order for NOT DONE and DONE.** The bar lists NOT DONE first; the
   deck puts DONE on A, the green key that carries on. One surface would
   change.
6. **A 10 s undo on DISCARD**, on the deck, the bar and the window, as
   sends have.
7. **The week's task × day cells open that day** at that task (S15).
8. **End my day lists every row before sending**, instead of "+ 8 more".

**Against the user's rules, not reopened:**

- a task suggested from the name or the person, "same as last time", or
  a hint taken from the active window or Slack (§19, §29);
- the nothing-timing prompt repeated (§19);
- lock or idle detection;
- an undo on End my day (§20).

**Out of scope:** calendar or Teams capture, estimates, sprint ranking,
and submission status.

## 31. Round 9 applied, and three answers (the user, 2026-11-10)

**The eight findings:**

1. **Done in two clicks.** ▾ beside "Stop, not done" opens a short menu:
   Done, and Discard…, which asks once more. The S11 radio dialog is
   gone.
2. **The first start asks**: "When you start a task, should SprintTicker
   change it in Jira?", with Yes, update Jira / No, only time it. The
   answer is kept, and can be changed in Settings › Account.
3. **The tray menu has Stop, not done; Lunch; and Away.** During an
   interruption, Interrupt reads "↩ Back to MG-12".
4. **The deck's Session key reads NOT TIMING in amber** in working hours,
   and a press opens the picker. **A running stand-up ends from the deck
   (A) and the bar (OK=END).**
5. **One order: DONE, NOT DONE, DISCARD**, the deck's A, B and C. The
   bar's paused menu now lists them in that order, with the cursor
   starting on NOT DONE.
6. **DISCARD has a 10 s undo** on the app's toast, from the window, the
   deck or the bar.
7. **A task's cell in the week opens that day at that task.**
8. **End my day lists every entry**, with nothing folded, before
   anything is sent.

**Undo on End my day (replaces the exception of decision 13).** End my
day now waits 10 s for Undo like every send. The PC shutdown is
scheduled only once the undo has passed and Jira has answered, with 30 s
to cancel. So the user's condition still holds: the undo never breaks the
end-of-day shutdown.

**Presence is read, and never pauses (correcting §25 to §30).** The
reviewers listed "lock or idle detection" as missing, and this proposal
filed it under the user's rules. Both were wrong: the app reads presence
already.

- Time is wall clock. An absence during the day counts as work: a
  meeting, a coffee, the toilet.
- Only an absence across midnight is asked about, from the last activity
  (S18).
- S21 now says so, beside the overnight setting.

**Suggestions from the name or the active window are not just against the
rule; they don't work.** An interruption is usually unnamed when it
starts, from the bar, the deck or the shortcut, and is named only when it
is placed. A call runs in Teams whatever project it is about, and a
question at the desk has no window at all. Starred tasks (§29) are the
answer.

## 32. Tenth blind round, on round 9 applied (2026-11-10)

The same two Sonnet reviewers and the same briefs.

**Verdicts:** mostly / with fixes, as in all ten rounds. The heavy user
counted about 115 interactions, against about 105 in round 9. Their
per-flow counts barely moved, so the gap is counting noise. Interruptions
take about 60 of the 115, about 40 of those for placing and naming.

**Would they use it every day?**

- **Newcomer: "Yes, probably, with conditions."**
  - What wins them: one-click start, Previous task, and the end-of-day
    send with an undo window.
  - What would make them stop: the app changing their tickets silently,
    a pile of unsorted ⚡, or a wrong entry going out unnoticed.
  - They trusted it more for the tray behaviour and "Undo for 10 s".
  - What still wears on them: the number of prompts and the words to
    learn.
- **Heavy user: "Yes, but only if placing gets cheaper."**
  - What wins them: Previous task, the Interrupt chord and one-press deck
    keys, "better than anything I have used", and the Friday check.
  - What would make them stop: a missing hour found on Friday with no
    warning, or duplicate or wrong-ticket entries in Jira.

**Mock fixes:**

- S4's question had Yes as the main button, a nudge; both answers now
  look the same.
- S26's toast now says the timer keeps running in the tray.
- S28 said the bar's picker runs Recent, Mine, Starred, while the window
  runs Recent, Starred, Mine; it now matches the window.

**Valid findings, for the user to decide:**

1. **S10's two Resume buttons weigh the same.** Plain Resume as the main
   button reads as "drop the 6 min" by default, and adding them as the
   main button would assume they were work. Equal buttons make it a
   choice.
2. **An overlap is caught when it is made.** Add time, Correct and a
   backdated start warn before saving an entry that overlaps another.
   Today it shows only at End my day and in the week check, by which time
   it may be in Jira.
3. **A new ticket assigned to you offers Start**, on its toast and in
   "What you missed".
4. **In a nested interruption, the deck offers "back to MG-12"** in one
   press, as the window's "End both, back to MG-12" does. Today A goes
   back one step, and B stops both with nothing running.

**Against the user's rules, or shown not to work, not reopened:**

- a task suggested from the note, the project or "same as last time";
- stars learned automatically, which is a suggestion (§29, §31);
- a button that puts the time back on the interrupted task, which is
  already in Recent, labelled;
- the week's close blocked until everything is placed (§24);
- nags at lunch, or a repeated nothing-timing prompt (§19);
- merging adjacent entries (§22);
- a daytime idle prompt (§31: presence never pauses).

**Out of scope:** calendar import, sprint ranking, a weekly target.

## 33. Round 10 applied (the user: "apply all four", 2026-11-10)

1. **S10's "↩ Resume" and "↩ Resume, add the 6 min" weigh the same**, so
   neither is the default.
2. **Overlaps are caught when made.** Add time (S16b) shows the overlap
   and offers to end the entry where the next one starts; Add stays off
   until it fits. Correct (S16) says the same before Save.
3. **A new ticket assigned to you offers Start**, on its toast and in
   "What you missed".
4. **The deck in a nested interruption:** B goes back to MG-12 with both
   left to place, as the window's "End both" does. A still goes back one
   step.

**Open: what Interrupt is (the user, 2026-11-10).** The user's model:

- Interrupt is pressed when someone interrupts, or when something else
  must be done, such as a test.
- Several people may come one after another, for different reasons.
- Each fragment is seen and placed afterwards, one by one.
- Then the user goes back to the base task, or switches to a new one.

The screens differ in two places:

- **"⚡ Another interruption" nests.** It opens S9b, and Back returns to
  the previous interruption, not to the base task. Ana arriving as Marc
  leaves would put Ana on top of Marc, and Back would resume Marc's
  finished conversation.
- **An interruption has no "Switch task".** Its way out is Back, Stop
  (nothing runs, then S10), or Another.

## 34. Interruptions in a row (the user, 2026-11-10)

**What Interrupt is.** It is pressed when someone interrupts, or when
something else must be done, such as a test. Interruptions are fragments
of time that follow each other, and each is placed on its own.

The user's case: they work on MG-12. Marc comes to talk (⚡). While Marc
is there, Ana comes (⚡ Another). Ana leaves and the talk with Marc goes
on (⚡ Another). Marc leaves, and the user goes back to MG-12 (↩). That
leaves **three fragments to place**:

- "Call with Marc", 8m;
- "Ana's question", 5m;
- "Call with Marc, again", 12m.

**What changed:**

- **⚡ Another closes the fragment running and starts the next.**
  Nothing is stacked, and S9b's "interruption of an interruption" is
  gone. S9b now shows a run: the fragments so far, the one running, and
  the ways out.
- **↩ Back always returns to the task the run interrupted**, as it was,
  running or paused.
- **⇄ Switch task leaves the run for another task**, a more urgent one
  for example. The fragment ends and waits to be placed, and MG-12 stops
  as not done, its time logged. This is in S9, S9b and the mini timer;
  the bar's SWITCH and the deck's held Session key do the same.
- **Sort lists each fragment on its own row**, saying which came before
  ("after 'Call with Marc'"). Each row's menu opens on Starred, then
  Recent, with the tasks just chosen above first. So "Call with Marc,
  again" has the task chosen for the first talk one click away, without
  anything being preselected (§19, §29).
- **The devices:** ⚡ during an interruption always starts the next one.
  On the deck, A goes back to the task; the nested-interruption row and
  "BACK CALL" are gone. The bar's wheel menu during an interruption is
  BACK TO MG-12, ANOTHER, SWITCH, STOP.

This replaces the nested model of §17 and the deck rows of §24 and §33.

## 35. Eleventh blind round, on interruptions in a row (2026-11-10)

The same two Sonnet reviewers and the same briefs.

**Verdicts:** mostly / with fixes.

**The heavy user counted about 80 interactions**, against about 115 in
round 10, the largest drop of any round.

- **Interruptions:** about 3 each.
- **An interruption during an interruption:** one press, ⚡ Another.
- **Sorting the seven left at the end of the day:** 2 clicks each.
- **Interruptions and sorting together:** about 50 of the 80.

They call the ⚡ and one-press-back flow "the best thing I've seen in a
tracker".

**Would they use it every day?**

- **Newcomer: "Yes, probably."**
  - Why: the timer, Add time, and the overnight and lunch prompts handle
    forgetting.
  - What would make them stop: the ⚡ badge nagging, time that didn't
    reach Jira, or a surprise change to a ticket.
- **Heavy user: "Yes, conditionally."**
  - Why: Previous task, the bar and deck, the interruption flow, and the
    week check against Jira. About 80 interactions is 4-6 minutes spread
    over the day, against 25-30 minutes of guessing by hand.
  - What would make them stop: Jira transitions on tasks only glanced at,
    deck or bar interruptions that can't be backdated, or 20 unplaced
    items every night.

**Mock fixes:**

- S6 said MG-12 "stays as it is, paused here" until Join, which read as
  paused. S6 and S25 now say it keeps running until Join, as S21's "Show
  me" does.
- S25's "not yours now" mini timer lacked ⚡.
- S15 showed Friday fully in Jira while S15b listed MG-14 unsent that
  day. Friday's In Jira is now 7h 05m (36h 37m for the week), and the
  note names MG-14.

**Not findings:** the newcomer again cited an "off by default" shortcut
the screens never mention.

**Valid findings, for the user to decide:**

1. **Backdating on the mini timer.** An interruption started from the
   shortcut, bar or deck opens the mini timer. Beside its name field, add
   "started ▾ now / 2 / 5 / 10 min ago", which today is only in S9.
2. **Moving to In Progress waits until the task has run a few minutes**
   (2 by default). A task opened for a glance doesn't move on the board;
   assigning it follows the same rule.
3. **The Done transition per project** (S20). With 15 workflows, "To
   Review" is not right everywhere.
4. **The deck shows the count of unplaced interruptions** on the
   Interrupt key, as the mini timer and the bar do.
5. **The mini timer has an idle state**, "Nothing running", with ▶ Start
   and ⚡, instead of disappearing when nothing runs and nothing is asked.

**Against the user's rules, or shown not to work, not reopened:**

- "send all unsorted to my catch-all", or a per-person default task
  (§19, §29);
- stars ranked automatically by use, when Recent already does that and
  stars are the user's choice;
- merging adjacent entries (§22);
- a daytime idle prompt (§31);
- the nothing-timing prompt repeated (§19);
- moving DONE off A on the deck: the A/B/C logic is the user's (§22).

**Out of scope:** calendar import, budgets by project, bulk reassign
across days.

## 36. Round 11 applied (the user: "apply all five", 2026-11-10)

1. **Backdating on the mini timer.** An interruption started from the
   shortcut, the bar or the deck shows the mini timer with its name field
   and "started now ▾" (2, 5 or 10 min ago, taken off the task it
   interrupted).
2. **Jira changes wait 2 minutes of timing.** Starting a task moves it
   to In Progress and takes it only once it has run 2 minutes, a setting
   in Settings › Account. A task opened for a glance and stopped sooner
   leaves Jira untouched.
   - This replaces the 10 s Undo on the "Started" toast (§21): the delay
     does the undo's work.
   - The first-start question (S4) says it.
3. **The Done transition per project.** S20 has one state for all
   projects, and "3 projects differ…" for the workflows that need
   another.
4. **The deck's Interrupt key shows "3 to place"**, as the mini timer
   and the bar do.
5. **The mini timer has an idle state**, "Nothing running", with the
   count to place, ▶ Start and ⚡. It no longer disappears when nothing
   runs.

## 37. One model, one word per action (2026-11-10)

**Why.** After eleven rounds, most of what came back had two causes:

- **No single written model of the flow.** Each of the six surfaces was
  drawn and patched on its own, so every round found contradictions
  between them.
- **Several words for one action.** The newcomer's list of unclear words
  hardly changed from round 1.

The screens page now opens with **"The model, the words and the
states"**, and every screen is checked against it.

**The model, in one sentence, said once in first run (S3):** one timer
runs your task; when something interrupts you, ⚡ times it apart, one
interruption after another; afterwards you place each one on a task, or
keep it off the provider; time reaches the provider when you stop, after
10 s to undo.

**The words, one meaning each, on every surface:**

- **Stop** ■ / STOP ends the timer, and the task stays open. It replaces
  "Stop, not done" and NOT DONE. **Done** ✓ moves the task to its done
  state. **Discard** keeps nothing.
- **Place** ↳ puts an interruption's time on a task; "Place all 3…" and
  "Place interruptions" replace Sort. **Move** ↳ is only for an entry
  already on a task.
- **To place** (⚡ 3 to place, 3 TO PLACE) replaces "not on a task (yet)"
  and "stays here".
- **Back** ↩ returns from an interruption to the task it interrupted,
  including after "Nothing running, back to MG-12?". **Resume** follows
  only a pause, Lunch or Away.
- **Not now** answers no to any question. It replaces "Stay stopped" and
  "Not yet". **Later** only leaves an interruption to place later.
- **Keep off Jira**, Interrupt, Another, Switch, Previous and Mode are
  unchanged; each has one meaning.

**States × surfaces.** One table gives what the window, the mini timer,
the tray, the bar and the deck show and do in each state, with the same
verbs. Eleven states: idle, timing, paused, interruption, back?, to
place, not yours, stand-up, lunch or away, a question during an
interruption, and overnight. A state not in the table does not exist.

**Providers (the user, 2026-11-10).** "Jira" in the screens stands for
the user's provider: Jira, OpenProject, or a custom provider on the
SprintTicker Provider API.

- **A custom provider is given a name** in first run (S1). The default is
  the server's own name, such as "Forge Tracker", and that name replaces
  "Jira" in every label.
- **A step the provider cannot do is not shown:** assignment, the Done
  transition, Fetch by key.
- **Keys follow the provider:** MG-77 in Jira, #1234 in OpenProject.
- **Task** covers a Jira issue, an OpenProject work package and a custom
  provider's task.

**What did not change:** the mini timer's ■ still opens Stop · Done ·
Discard. It is the one place where Done is reached without the window,
so Stop there takes two clicks, against one in the window.

## 38. Twelfth blind round, on the aligned words (2026-11-10)

The same two Sonnet reviewers and the same briefs.

**Verdicts:** mostly / with fixes.

**Did the words help?** The newcomer's list of unclear words shrank.
Stop, Sort, Move, "not on a task", Stay stopped and Not yet no longer
appear in it. "Place", "held" (now changed) and the icons remain.

**The heavy user counted about 145 interactions**, against 80 in round
11. Their per-flow costs did not rise: an interruption still costs 3 to
5 presses, and placing still costs 2 per row. The total rose because
this round counted work earlier rounds left out:

- switching through the bar's wheel, about 18;
- fixing the day's gaps, about 8;
- the whole Friday fix-up, about 30 against 9.

So the two totals do not compare.

**Would they use it every day?**

- **Newcomer: "Probably yes, but not on day one."**
  - Why: the timer, the 10 s undo and the week check mean they never
    rebuild the day from memory. "No account" and "Set up later" make a
    first try low-risk.
  - What would make them stop: wrong time sent unnoticed, or placing
    interruptions feeling like homework. They would answer "No, only
    time it" to the Jira question.
- **Heavy user: "Yes, but only just, after the fixes."**
  - Why: Previous and Interrupt in one key, reassignment noticed, and
    the week's "In Jira" row, "the best feature".
  - The comparison: by hand is about 90 clicks from memory, wrong by
    30-60 minutes; this is about 145, accurate to the minute.

**Mock fixes:**

- S9 and S9b said MG-12 "is held". They now say it "waits", and that ↩
  Back returns to it.
- S18's preselected answer is drawn ●, and Discard says it has 10 s to
  undo.
- The run of S9b and S12b started at 10:32, where S5 had a 25-minute
  "Call with Marc". It now runs from 16:02.
- The tray's Previous task is hidden during an interruption, as on the
  deck.

**Valid findings, for the user to decide:**

1. **Switch from an interruption can put it on the new task.** When ⇄
   is pressed during an interruption, the picker shows an unticked "Put
   'Call with Marc' (12m) on it too". Today the interruption stays to
   place at full length.
2. **Backdating goes past 10 minutes:** "started ▾ now / 2 / 5 / 10 /
   other…". Other takes any time since the task started.
3. **"Still paused?" is asked once** after a pause longer than a set time
   (30 min by default), like "Still on it?".
4. **Today shows a Lunch card**: "Lunch until 13:30 · MG-12 paused · I'm
   back". The newcomer found nothing in the window saying what Lunch
   does.
5. **"Check my week" has a button** on the week view, as well as Ctrl+K
   and the week's close.

**Against the user's rules, not reopened:**

- adding the gap by default in S10 (the user made both buttons equal,
  §33);
- the nothing-timing prompt repeated, or a daily nudge to place (§19);
- remembering who interrupts, autocompleting tasks, or rules and
  templates (§19, §29, §31);
- search on the bar: the devices are shortcuts (§16).

**Out of scope:** calendar import, statistics per person, dragging time
on a timeline.

## 39. Round 12 applied, and the blind rounds stop (the user, 2026-11-10)

1. **Switching from an interruption can take it along.** When ⇄ opens
   the picker from an interruption, the picker shows an unticked "Put
   'Call with Marc, again' (12m) on it too". Left unticked, the
   interruption stays to place.
2. **Backdating goes past 10 minutes:** "started ▾ now / 2 / 5 / 10 /
   other…", any time since the task started. This works in S9 and on
   the mini timer.
3. **"Still paused?" is asked once**, after 30 minutes by default (a My
   workday setting). It shows on the mini timer, with Still paused / ▶
   Resume.
4. **Today shows a Lunch card**: "Lunch until 13:30 · MG-12 is paused,
   its time logged. Lunch is not timed", with ▶ Resume MG-12. The mode
   menu said "starts it again after", which contradicted "Back at your
   desk?". It now says "after, asks if you are back".
5. **"Check my week…" has a button** on the week view.

The states table follows all five.

**The blind rounds stop here.**

- Twelve rounds plateaued at "mostly / with fixes" and "yes, with
  conditions".
- The interaction counts vary by about 50% with what each reviewer
  counts.
- What remains is either the user's accepted cost (placing is the
  user's choice, never suggested), or polish that static screens cannot
  judge.

The next evidence is real use: a few days on the built app.

## 40. Thirteenth round, on Opus 5.5, before the roadmap (2026-11-10)

The user asked for one last pair on a stronger model before the roadmap
and implementation plan. The two briefs are the same as before, with
seven product questions added at the end: UI, UX, execution flow,
incoherences, what is missing, what to remove, and the top 5 changes.

**Verdicts.**

- **Newcomer:** "mostly". Daily use: "probably yes, for a two-week
  trial". They would stop if placing became evening homework, or at one
  surprise in Jira.
- **Heavy user:** "with fixes". Daily use: "not yet". About 127
  interactions a day, 146 on a Friday; interruptions take 65% of them.
  They would stop "the first time my manager sees overlapping worklogs,
  or a lunch I worked through goes missing".

The stronger model found more contradictions between screens than the
previous rounds did. Those were fixed in the mock, as each round's are:

- S6 showed the Lunch card under "Mode: Work", beside a 09:30 stand-up.
  It now has a frame of its own, under "Mode: Lunch".
- S17 said 7h 05m was both "sent" and "to send", and its MG-12 had not
  moved since S5. It now reads 5h 20m sent, 1h 45m to send (MG-12
  running), 45m to place.
- S14b's second gap was S5's 15:10 call. It is now 12:20–12:30, as in
  S17, and the call is drawn.
- MG-14 on Friday was a "change", a "25m" and "1 entry". It is now one
  +25m correction, named the same way in S14, S15 and S15b.
- S14 said the Wednesday interruption was "counted in ⚡ on Today",
  which Today's ⚡ 3 did not count.
- S20's fetch scope left out the teammates' tasks that the picker lists.
  It now says "and teammates' tasks in progress", which is the sync's
  real scope.
- MG-15 had two titles (S13 is now MG-25). S7c's "14 left are yours"
  was S7's figure for 6 projects.
- S7's "click ☆" had no ☆ on any row. The hovered row now shows one.
- S25's stop row is now in the devices' order, Done / Stop / Discard,
  and no longer says "logged either way" beside Discard.
- S29's "A · carries on" column held DONE; A now "says yes".
- S7b and S28 now give the bar's picker order the same way.
- The bar's "3 TO PLACE OK=APP" while a task runs collided with OK
  opening the menu. It now reads "3 TO PLACE IN APP".
- "Nothing running" and "Nothing timing" are now one word: timing.
- S21 said a closed week "asks first"; it warns first. It also used
  "Away" for not being at the PC, which is the mode's word.

**Findings, for the user to decide** (my recommendation in brackets):

1. **Overlaps can be sent.** S17 calls an overlap "only a hint", so
   the same minutes reach Jira twice. [Apply: an overlapping entry
   waits, like one still to place, until it is fixed. Gaps stay a
   hint.]
2. **Lunch worked through is lost.** [Apply: "Back at your desk?" also
   offers "I worked through it", which adds the lunch to the paused
   task.]
3. **The stand-up:** a late Join bills the wait to the task, and a
   forgotten End bills the stand-up all morning. [Apply: "joined at
   ▾", as an interruption's start; and "Still in the stand-up?" once,
   after its usual length.]
4. **"↩ Back, add the 6 min" exists only in the window.** [Apply on
   the mini timer; the bar and the deck stay shortcuts.]
5. **No shortcut ends an interruption.** [Apply: a Back chord, active
   only during an interruption.]
6. **The deck's PLACE IN APP / LATER takes over the answer keys after
   every interruption**, and its C reads DISCARD without saying what it
   discards. [Apply: drop that state. The Interrupt key carries the
   count, and A/B/C return at once.]
7. **When time is sent is not visible**, and "its time so far is
   logged" (S9) reads as sent. [Apply: S9 says "MG-12 waits, as it
   was; nothing is sent", and the running card says "sent when you
   stop".]
8. **S9 shows "5 min ago" as if it were the default.** [Apply: show
   "now"; backdating stays one click away.]
9. **The Jira question (S4) arrives together with the first picker.**
   [Apply: ask it in setup.]
10. **States without an exit or a "when":** Away has no card; "Not
    now", "Later" and "Decide later" don't say when they come back.
    [Apply: an Away card like Lunch's, and each of them says when it
    asks again.]
11. **Colour alone:** the tray dot, the mini timer's stripe, the bar's
    paused state, the toggles, and S14b's grey shades. [Apply: a
    word or a glyph beside each colour; S14b labels its segments.]
12. **S5 is dense:** six buttons, then three text buttons on every row.
    [Apply: rows show ↳ Place… and keep the rest under ⋯.]
13. **States never drawn:** a crash mid-day, Jira refusing one
    worklog, a first-day picker with no Recent, a failed Test
    connection, and connecting Jira later. [Apply: add them to S31,
    reusing S18's question for the crash.]

**Against the user's rules** (my recommendation: do not apply):

- A suggested task per interruption, "Place all as suggested", or a
  default catch-all task. Nothing is preselected (§19, §29).
- Placing from the bar or the deck. Devices are shortcuts, and placing
  happens in the app.
- Merging the same task's entries within a day. The pause split is a
  setting.
- A break counted as a pause. Presence never pauses (§31).
- Refusing changes to a closed week. It warns.
- Removing the PC shutdown. The user kept it, with its undo.
- Sprint and due-date views, calendar import, and statistics per
  colleague. These stay out of scope (§38); they belong on the roadmap
  if anywhere.

## 41. Round 13 applied (the user: "apply the 13 suggestions", 2026-11-10)

1. **An overlapping entry waits.** The later entry of an overlap is not
   sent until the overlap is fixed, so Jira never gets the same minutes
   twice. This is shown on S15b (OPS-4's 20m on Tuesday), on S15 (Tuesday
   In Jira 7h 35m, the week 36h 17m), and on S16, where an entry saved
   with an overlap waits. A gap stays a hint (S17).
2. **"I worked through it"** after lunch, on the mini timer and on the
   toast. It adds 12:30–13:30 to the paused task and resumes it.
3. **The stand-up** has "joined ▾ now / 2 / 5 / 10 / other…", and the
   minutes move from the task to the stand-up. It asks "Still in it?" once,
   after 25 min (a My workday setting), and can end the stand-up at its
   usual length.
4. **"↩ Back +6m" on the mini timer**, beside ↩ Back and Not now.
5. **A Back shortcut**, Ctrl+Alt+Shift+B, on by default. It does nothing
   outside an interruption.
6. **The deck has no "place in app" state.** After an interruption, A/B/C
   are DONE / STOP / DISCARD again at once, and the Interrupt key carries
   the count. During an interruption, C reads DISCARD ⚡.
7. **When time is sent is said where it matters.** The running card says
   "sent to Jira when you stop, after 10 s to undo". The interruption,
   the Lunch card and the toast say "MG-12 waits, as it was; nothing is
   sent".
8. **An interruption starts "now ▾".** Backdating is one click away:
   "set it earlier, and those minutes come off MG-12".
9. **The Jira question moved into setup (S1)**, under Test connection.
   Today no longer asks it.
10. **Away has a card, like Lunch** (S6). Each "Not now", "Later" and
    "Decide later" now says what happens next:
    - Not now is not asked again, and the tray stays amber.
    - Later waits on Today, in End my day and in the week.
    - Decide later keeps the question on Today and the mini timer.
11. **Never colour alone:**
    - the toggles say On;
    - the tray icon carries a mark: ▶ ⚡ ❚❚ ! ○;
    - the mini timer has a "❚❚ Paused" row;
    - the bar's paused screen starts with ❚❚;
    - S14b names each block.
12. **Today is lighter.** An interruption row shows ↳ Place… and ⋯
    (Rename, Keep off Jira). An entry row shows ⋯ (Correct, Move,
    Delete).
13. **S31 draws the missing states:**
    - a failed Test connection;
    - the first-day picker (opens on Assigned to me);
    - the app closed while a task ran (S18's question);
    - Jira refusing one entry (Move or Keep off Jira);
    - no account yet.

**The PC shutdown is optional**, and the screens now say so. It is an
unticked box in End my day, "never ticked for you", and it runs only
after the undo and Jira's answer. The glossary and the states table
follow all of the above.
