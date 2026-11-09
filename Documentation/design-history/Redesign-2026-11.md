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
