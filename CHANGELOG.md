# Changelog

## 2.0.2 — 2026-11-24

### Added

- **Work of your own in a project, in one line.** Type `Dash: Backup files:
  before v2` in the picker and *Start "Backup files" in Dash* starts it,
  with the note; *Add a project or note…* opens the fields. The picker
  shows the syntax under what you type, with a project of yours where you
  have one (*Tip: Dash: Backup files: note*)
  and says *or type a new one* in its field. A project of yours of that
  name takes the task, keyed DASH-1, DASH-2, on Enter; one you do not have
  is the second row, under the line as typed, so a colon in a name
  (*Review: login page*) never makes a project by itself, and is made,
  kept on this computer, when you choose it. Add time, Split and Move take a
  project too, and Undo takes away what they made. The note shows under the
  running task and becomes the entry's comment. A project of yours and an
  online one of the same name are told apart by a mark.
- **One task per name.** Work of your own of the same name in the same
  project, case aside, is one task: starting it again takes it up, and the
  picker says *already yours · 2 entries today, 48m*.
- **Today by task.** *Entries | By task* at the top right of Today shows one
  line per task with the day's sum, unfolding into its entries. Today still
  opens on the entries.
- **History's calendar.** *Calendar*, beside Week, shows the week as
  columns and your entries as blocks. Click an empty slot to add time, or
  drag for its length; select an entry for handles that change its start
  and end; drag it to another hour or day; click it again for Correct,
  Split, Move and Delete, or press Delete. The week's overlaps are listed
  under it with their fixes. Every change has its Undo and asks first in a
  closed week.

## 2.0.1 — 2026-11-24

### Added

- **AI agents can ask SprintTicker.** Turn it on in Settings › Data › AI
  agents and paste the line it shows into Claude Code, or its entry into
  Claude desktop's configuration: the agent then reads what runs now, a
  day, a week, Check my week, the interruptions to place and your tasks,
  worded and counted as the window does. It can
  also start, stop, pause and resume a task and mark one done when you ask
  it to: a stop shows the Undo bar as a click does, and Done waits for your
  yes. The installer carries the `sprintticker` command, run by SprintTicker
  itself, so nothing else needs installing. Off until you turn it on; *Make
  a new one* replaces the token and refuses every agent given the old one.
### Fixed

- **The Status button no longer breaks the window.** Opening it scrolled
  the header out of shape and cut its panel off; the panel, and the Mode
  menu beside it, now open below the header.
- **Split in two is in each entry's ⋯**, beside Correct. It was only a
  link inside Correct, and could not be found there.
- **Split in two, Move and Add time take work of your own.** Their task
  picker left out your own tasks and offered no new one, so time worked on
  something with no ticket could not be split off, moved there or added.
  It now finds your own work by its name and offers *A task of my own named
  "…"*. That time stays in SprintTicker, never sent -- an entry moved there
  from Jira or OpenProject is deleted there -- and Undo takes a task it made
  away again. Your own work is found by the search wherever the picker
  offers a task of your own, Start and Switch too.

## 2.0.0 — 2026-11-19

SprintTicker, redesigned. The window has four places -- Today, Tasks,
History, Settings -- and in greys, colour means one thing: green is running,
amber waits on you, red is danger. Everything you send waits ten seconds for
Undo. An interruption holds your task instead of stopping it. Lunch pauses
instead of stopping, and locking the computer leaves your task timing. History shows each day as a timeline and the week
as a timesheet. End my day replaces the wrap-up wizard. The BUSY Bar's
buttons, the Stream Deck's keys and four keyboard shortcuts each mean one
thing everywhere. Measured with a dry run of 20 projects of 50 tasks and two
months of history: every screen answers within about a tenth of a second.

### Before you update: what changes in your habits

- **The bar's buttons are reset.** **Pause** says yes -- pause, resume,
  join, dismiss. **Pause twice** within 4 s stops the task, or an
  interruption. A **wheel click** starts an interruption, and says no to a question.
  **Turning** the wheel opens a short menu. **Back** does nothing. The bar's
  own task picker, its paused menu and "hold BACK = done" are gone, and with
  them any bindings you had set: choosing a task happens on the computer.
- **Locking your computer no longer stops or pauses your task.** A coffee
  is work: the bar shows Away, and the task keeps timing. Back after 15
  minutes or more, Today and the mini timer ask once *Away 23 min. Was it
  on MG-12?* -- **Keep it**, or **Something else…**, which makes that time
  an interruption to place on another task or keep off. Nothing moves
  unless you say so. The delay is *Back after time away* in Settings › My
  workday. Choosing Away from the mode chip or the tray works the same way.
- **Lunch pauses your task; it no longer stops it.** At the break's
  end the window and the bar ask *Back at your desk?* -- Resume, **I worked
  through it**, or Not now; nothing restarts on its own. Resume times the
  task from the break's end, which the button names, so the minutes before
  you answer are not lost. The morning still
  goes to Jira or OpenProject as its own entry, cut at the break, when you
  stop the task. If *A long pause starts a new entry* is set to **never**
  (Settings › My workday), it is one entry spanning lunch, with lunch left
  out.
- **Every send waits ten seconds**, the time to press **Undo**: Stop, Done,
  Discard, a correction, a move. The entry reaches your provider ten seconds
  later than it did.
- **Interrupt holds your task.** Its time runs on its own and goes nowhere
  until you **place** it on a task, or keep it off. It pauses as a task
  does, and **Stop** ends it and returns to the task you held.
- **Closing the window keeps SprintTicker in the tray.** Quit from the tray
  icon, or change *When I close the window* in Settings › General.
- **Four keyboard shortcuts are on**, from any app: Ctrl+Alt+Shift+I
  (Interrupt), S (Switch task), P (Previous task), B (Back). Change or turn
  them off in Settings › General › Shortcuts.
- **Starting a task moves it to In Progress after 2 minutes**, not at once:
  a glance moves nothing. The delay is *When I start a task*, in Settings ›
  Account.
- **No prompt takes the window any more.** The stand-up, *Back at your
  desk?* and the reminders wait as cards on Today and in the mini timer.
- **The Stream Deck plugin is 0.6.5**, in the installer: the first run
  offers it. A deck laid out with 0.5 keeps working.
- **Unity support is gone** -- see Removed.

### Added

- **A SprintTicker server as your provider.** Beside Jira and OpenProject,
  Settings › Account and the first run offer **A SprintTicker server**: any
  server built on SprintTicker's own contract,
  [`PROVIDER-API.md`](Documentation/PROVIDER-API.md). An address and a
  personal token are all it asks; the server picks your tasks and where a
  finished one goes, and what it can do -- assigning, notifications, days
  off, fetch by key -- shows once it says so. A send whose answer was lost
  is never billed twice: the server knows each send by its reference. For
  the server's builders, `pnpm provider:check` runs the contract against
  their server, and `pnpm mock:provider` is a fake one to try the app on.
- **Stream Deck plugin 0.6.5: one meaning per key.** A says yes -- DONE,
  BACK to your task during an interruption, JOIN, RESUME, END STAND-UP, END MY DAY --
  in green; B stops or waits -- STOP, SKIP, NOT NOW -- in blue-grey; C
  throws away -- DISCARD, or DISCARD ⚡ for an interruption -- in red, and
  is blank when there is nothing to throw. DONE always takes two presses.
  Interrupt reads ANOTHER during an interruption and counts what waits to
  be placed; Session turns amber for NOT TIMING in your working hours and
  NOT YOURS for a task given to someone else. New keys to add: **Previous
  task** and **Recent 1-3**. A deck laid out with 0.5 keeps its keys. A
  ready-made **SprintTicker** profile for the Stream Deck Mini and one for
  Stream Deck Mobile come with it, beside your own profiles. The Session
  key pauses and resumes an interruption, as it does a task.
- **The app speaks the Stream Deck's protocol 2** -- an interruption, what
  waits to be placed, the previous and recent tasks, the stand-up running
  -- which plugin 0.6.5 uses. Plugin 0.5 keeps working as it does: the app
  tells the two apart and answers each in its own protocol.
- **Four keyboard shortcuts, from any app**: Interrupt (Ctrl+Alt+Shift+I),
  Switch task (S), Previous task (P) and Back (B), on by default and each
  changeable in *Settings › General › Shortcuts*. A chord another app holds
  says so rather than seeming to work. If you had set the Interrupt
  shortcut before, your choice is kept.
- **The mini timer shows every state.** ⟲ goes back to the previous task,
  ⚡3 counts the interruptions waiting to be placed, and "Nothing timing" is
  loud in your working hours. An interruption started from the bar, the
  Stream Deck or the shortcut opens the mini timer without taking the focus,
  with "started now ▾" to set when it began and ↳ to choose its task. The
  stand-up says which task it goes back to, with End stand-up; "Back to
  MG-12?" says how long went untracked; Stop offers Done, Stop and Discard
  in the devices' order. The first time, one line names the buttons.
- **SprintTicker's notifications open where they are about.** A question
  opens Today on its card, "Sending time stopped" opens Settings › Account,
  and a Stop from the tray, the Stream Deck or the bar while the window is
  hidden says "Stopped MG-12 · 1h 24m" with ten seconds to click and undo
  it. A notification about a Jira or OpenProject task still opens the task
  there.
- **The tray icon shows where you stand**: ▶ timing, ⚡ an interruption,
  ❚❚ paused or on a break, ! nothing timed in working hours, ○ outside
  them -- a mark as well as a colour -- and the entries waiting to send as
  a number.
- **Closing the window keeps SprintTicker running, in the tray.** The timer,
  the bar and the Stream Deck go on; Quit is in the tray's menu, and a
  setting in General makes ✕ quit instead. The tray opens the window on a
  single click, and its menu has Switch task, Previous task, Pause or
  Resume, Stop, Interrupt or Back, Lunch, Away and End my day.
- **An entry Jira refuses says why, and stops being retried.** Time tracking
  off on an issue, or the issue deleted: Today shows "Jira refused 1 entry"
  with Jira's reason, and the entry offers ↳ Move… or Keep off Jira. It used
  to be sent again with every new token, to the same answer. Schema
  migration 16.
- **Today says what still works.** A card when Jira is not answering (and
  since when), refused your token, there is no network, the bar is
  unplugged, the first sync is under way, you just updated, or you have no
  account yet -- each saying that timing goes on and what waits. The picker
  opens on your own tasks on your first day.
- **A new first run.** Three steps instead of the setup wizard: where your
  tasks are, with **Test connection** saying who you are or exactly what
  went wrong; what is on your desk, ticking only what it finds, with the
  Stream Deck plugin now inside the installer; and your day. It ends on
  Today with the picker open. Installs set up before it never see it.
- **A crash no longer counts as work.** A task running when SprintTicker
  closed -- a crash, a shutdown -- and started again hours later the same day
  is paused at your last activity and asked about, like a night left running.
  The gap used to count as work, silently.
- **Decide later, for a session left running overnight.** The question,
  now *MG-12 ran all night*, can wait: the timer stays paused at your last
  activity, nothing is logged, and a card on Today and the mini timer keep
  it until you answer.
- **End my day.** Replaces the wrap-up wizard: every entry of the day,
  the interruptions to place, the day's gaps as a hint, and a button that
  says what it sends. Undo for ten seconds. The PC shutdown is never ticked
  for you, and waits until Undo has passed and Jira has answered.
- **Split in two.** In Correct, for the time you forgot to switch: choose
  the moment, pick the task the rest goes to. Jira or OpenProject gets the
  first entry shortened, then the second, with Undo for ten seconds.
- **Check my week.** From History's week, or the notice when a week closes:
  every problem of the week in one list -- time to place, corrections and
  sends not answered, untracked time in your working hours, overlaps, and
  changes to a closed week -- each with the button that fixes it.
- **The week as a timesheet.** History's **Week** groups the week by
  project, with a Day row and a row of what Jira or OpenProject actually
  holds -- what your manager sees -- and says on each day why the two
  differ. **Export CSV** saves the week for a spreadsheet.
- **The day as a timeline.** History draws your working hours as a strip:
  each entry a block, lunch, and what no entry covers hatched, with how much
  that is. A click on a hatched stretch opens Add time at its times; a click
  on a block corrects it.
- **History's day, and time you didn't time.** History shows what a day
  adds up to and where its sends stand, each task's share on one line, and
  every entry in the order worked with ⋯ for Correct, Move and Delete.
  **+ Add time**, there and on Today, puts in time the timer never saw: a
  task, a length, a start and a note, sent like any entry with ten seconds
  of Undo, and warned about before it overlaps another or lands in a closed
  week.
- **Done per project.** Each workflow has its own states, so a project can
  send Done somewhere other than the completion transition for all:
  **Settings, Account** › *When I mark a task done* lists your projects, a
  Jira state typed by name or an OpenProject status chosen from the list.
- **A glance moves nothing.** Starting a task moves it to In Progress, and
  takes it if nobody has it, only after two minutes of timing; stopped or
  switched sooner, it stays where it was. **Settings, Account** › *When I
  start a task* sets the wait (none, 1, 2 or 5 minutes) or turns it off.
- **Undo, for ten seconds.** Stop, Done, Discard, and correcting, moving or
  deleting a worklog wait ten seconds before anything reaches Jira or
  OpenProject; a bar at the foot of the window, and the mini timer, offer
  **Undo** meanwhile. A stopped session runs on as if never stopped, a Done
  transition is not sent, and an edited entry is as it was. The Stream
  Deck's keys are undoable the same way.
- **Overlapping entries wait.** Of two worklogs that overlap, the later one
  is not sent until one of them is corrected; History marks it **Waiting to send ·
  overlaps PF-31**, and a correction that would cause an overlap says so
  before it is saved.
- **Interrupt: a timer at once, and the task waits.** When someone comes to
  your desk, one click starts a timer -- on Today's session card, in the
  mini timer, in the tray menu, on the deck or on the bar -- with nothing to
  fill in. The task you were on waits, paused, with nothing logged or sent.
  The interruption is timed like a task you had not planned: **Pause**
  pauses it, and **Stop** ends it and resumes your task where it was, and
  opens a small **Place** window in front -- that run's interruptions,
  each named and placed on its own; **Later** leaves them on Today.
  **Another** starts the next interruption when someone else arrives
  first, so Marc, Ana and Marc again are three interruptions and one Stop. When SprintTicker ends one
  itself -- lunch, the end of your day -- it asks whether to go back, in
  the window and on the bar, with the choice to count the time since as
  work. While one runs, no task can be chosen: end it first. **Keep as its
  own entry** keeps one in your history without a task, never sent. On the
  bar, Interrupt is a click of the wheel.
- **One task picker, search first.** Start, Switch, Assign, Place and Move
  open the same picker: type and it searches every project at once, or pick
  from the previous task, Recent, Starred (☆ on any task), your open tasks
  across projects, or a project -- starred first, then most used. A
  project's key and a space narrows to it. A ticket made since the last sync
  is one **Fetch MG-77** away, from Jira or OpenProject.
- **The picker in its own window.** From the tray, the mini timer and the
  Stream Deck, the task picker opens as a small window over what you are
  doing, on the screen your pointer is on, instead of bringing the whole
  dashboard forward. It closes after a pick, on Escape, or when you click
  elsewhere.
- **Ctrl+K.** A command palette in the window: every action your state
  allows, every setting and any task, by name. The old words still lead
  somewhere -- *sort* finds Place.
- **Place all, one row at a time.** Each interruption gets its own task,
  starred and recent first with the ones you just chose on top, and each
  row its name to type. The rows you leave stay to place.
- **An interruption, told as it runs.** Today's session card asks what it
  is about (the note your provider shows), when it started -- 2, 5 or 10
  minutes ago, those minutes coming off the task that waits -- and which
  task its time goes to when it ends, all without stopping the timer. The
  first one explains itself, once.
- **Your task given to someone else, seen within a minute.** The task you
  are timing is checked every minute; when it is reassigned, closed or
  deleted, a card on Today says so and offers to keep timing, to move the
  time so far to another task, or to switch.
- **A morning card.** The first look at Today on a working day offers to
  carry on with yesterday's last task, points at the interruptions still to
  place, says when the stand-up is, and lists your tasks in progress, each
  one press to start. It goes once anything starts.
- **Today's entries and interruptions, as in History.** Today lists the
  day's entries newest first, with where each stands with the provider and
  **⋯** for Correct, Move and Delete; ⚡ marks time that started as an
  interruption, and the heading counts the day, sent and still to place.
  The interruptions to place are on Today too, each saying where it was
  started; tick some to place them on one task, and **⋯** renames one,
  keeps it off the provider or discards it.
- **Reminders that ask once.** Nothing timing for 10 min, a pause of 30 min,
  an interruption of 20 min, the stand-up at 25 min: each is asked once, in
  working hours, on Today, in the mini timer and by notification while the
  window is hidden. "Back to MG-12?" left 10 min gets one more notification.
- **The stand-up: joined late, and its own task.** "joined 5 min ago" beside
  Join moves those minutes off the task before it. In Settings, My workday,
  the stand-up can be timed on a task of yours and sent like any entry;
  otherwise it stays on the local Daily Standup.
- **Lunch asks before it ends a call.** Lunch's hour during an interruption
  asks "Start lunch? It ends 'Call with Marc'" instead of ending it; Not now
  keeps it going and skips lunch for the day.
- **No prompt takes the window.** The stand-up, "Back at your desk?", the
  wrap-up and a session left running no longer bring SprintTicker up over
  what you are typing. A question is a card on Today and a row on the mini
  timer until you answer it, and a Windows notification while the window is
  hidden. The stand-up's card stays until Join, Skip today or Remind me in 10
  min -- the dialog it replaces closed itself after 10 s. Today also shows a
  Lunch or Away card with Resume.
- **Lunch and Away pause the task, and ask "Back at your desk?"** They used
  to stop it and start it again. Now the task is paused, the break untimed,
  and its time still goes in as two worklogs at the stop. When the break
  ends the window and the bar ask: Resume, **I worked through it** (the
  break counts as work), or Not now. Away -- locking Windows -- pauses the
  same way, and leaves an interruption running.
- **Stop ▾ on Today.** The session card stops in one click, the task left
  open; ✓ Done and Discard… are in the ▾ beside it, each a step away, in
  place of "Finish & Log Hours" and its dialog. The card says when the time
  is sent, and **Previous task** switches back in one press.
- **Tasks: one way to start and stop.** A task's Start or Switch is a pick,
  so it switches from an interruption properly, and Stop is one click with
  Undo -- the second finish dialog is gone.
- **Interruptions to place.** An interruption's time goes nowhere until you
  say where: History lists every one waiting, whatever its day, with what it
  interrupted, and the wrap-up lists them too. **Place…** puts its time on a
  task and sends it, with ten seconds to undo; **Place all** puts several
  on one task; **Keep as its own entry** keeps it local; the bin discards it. A ⚡ beside
  Today counts them. Interruptions from earlier builds are listed the same
  way.
- **Move a worklog to another task.** The arrows on a History row move
  it: deleted at Jira or OpenProject where it was, then created on the new
  task, through the sync queue, so the time is never on both.
- **Time in a closed week asks first.** Moving, correcting or deleting a
  worklog of a week already closed warns that its timesheet may be in, or
  approved, before anything changes.
- **Name an interruption, or assign it to a task, while it runs.** Click its
  title on the session card or in the mini timer to name it, or its name in
  *Still on it?* -- twenty minutes in is when you know what it was; the
  question stays until you answer it. **Assign to
  Task** moves the running session to a task you pick, keeping its start, so
  the whole interruption is logged on that task and sent to its provider.

### Changed

- **The bar's controls are in the app**: Settings › Desk devices › *Bar
  controls* says what Pause, the wheel and Back do, and how to mark a task
  done from the bar.
- **End my day can shut the PC down every day**: *Shut down the PC when I
  end my day*, in Settings › My workday, ticks *Then shut down the PC* for
  you. Off by default; you can still untick it on the day.
- **Nothing timing has a scene on the bar**: NO TASK beside an empty
  office chair that swivels and settles, on amber, like Lunch and Away.
- **Bar health is in Desk devices**, no longer behind the developer tools,
  and the bar's inputs are a chart: the last minute, a lane per input, each
  mark filled when it did something and hollow when it did nothing -- a
  Back, an answer held off -- with what it did on hover. Presses that did
  nothing used to be missing from it altogether.
- **The picker stays quick with a thousand tasks.** A search that finds
  many shows eight tasks of each project and *N more in …*, which opens the
  project with the search kept: the first letter typed used to draw every
  match. Measured with a dry run of 20 projects of 50 tasks and two months
  of history, where every other screen answered within a tenth of a second.

- **A second look at every screen.** With no account set up, the session
  card no longer says the time will be sent: it is kept here until you set
  one up, and the status says so in amber rather than red. The first run
  says that Continue waits for **Test connection**; **End my day** opens on
  *Remind me*, not on the shutdown box; the stand-up comes before "Back to
  MG-12?"; the Undo bar sits at the bottom right, clear of the buttons. The
  comments sent with each entry read *Stopped by End my day*, *Done on the
  BUSY Bar*, *Stopped for lunch*; the queue, the priority panel and the
  mini timer use the same words as everywhere else.

- **Today asks one question at a time.** The stand-up, Back at your desk?,
  a reminder and a task that left your list no longer stack up -- three
  amber cards could contradict each other and push the session's buttons
  down; the most urgent shows, with a line counting the others. The day's
  total keeps the paused task during an interruption, **Switch task** no
  longer offers the task already running, the page scrolls clear of the
  Undo bar, and the running row on Today reads like the others (its time,
  HH:MM, the task page). The status says **Not set up** while no account is
  set up, and its button **Set up**. The mini timer uses ⇄ for Switch and a
  green Back, and the header keeps its words when there is no bar.

- **Usable with a screen reader and at a larger size.** The dashboard zooms
  again -- Ctrl+= and Ctrl+- or Ctrl+wheel, Ctrl+0 to reset -- which went
  with the hidden menu. A screen reader now hears the stand-up, Lunch, Away,
  a reminder and "Back to MG-12?" when they arrive, without the window
  taking the focus, and the Undo bar once rather than every second. In the
  task picker and Ctrl+K the arrows say which row they reached; every
  control has a name, Add time's fields are labelled, an invalid bar
  address says so to the screen reader, and the LED preview, which repeats
  Today, is left out. With Windows' animation effects off, Done throws no
  confetti.

- **Easier to read, and colour means one thing.** **Pause** is grey: a
  running task no longer looks paused, amber being the paused state's
  colour. Red text and the Discard and Delete buttons, the quiet grey text
  and every field's edge now meet the WCAG AA contrast levels -- an empty
  field used to be all but invisible. Checkboxes and radios are drawn in
  the window's grey instead of Chromium's blue and white, "nobody" in Tasks
  is grey, and three headings that fell back to body size are headings
  again.

- **One word for each thing, everywhere.** After an interruption the window,
  the mini timer and the bar all ask **Back to MG-12?** -- **↩ Back**,
  **↩ Back, add the 6 min**, **Not now** -- where the window said Resume it
  and Leave it. The end of the day is **End my day** on every surface, the
  bar included (END MY DAY, where it said EOD WRAP-UP), and the stand-up is
  STAND-UP. **Place** is the one word for putting time on a task (no more
  Assign), Away's card says **Resume**, the confirmations say **Cancel**,
  and "untracked" is **not timed**. The Undo bar says what the action comes
  to -- *Sent in 7 s*, *Kept here*, *Waits to place*, *Nothing kept or
  sent* -- instead of "Sent" for a Discard. The session card names the
  provider the time goes to, the send badges read **Logged here**,
  **Waiting to send** and **Sent**, Correct names its fields as Add time
  does (Duration, Note), the task scope is *Mine, free and in progress*,
  the priority panel's rows have plain names, and a setting that fails
  says why and what to do, rather than "Error invoking remote method".

- **The bar's buttons each do one thing.** **Pause** says yes -- pause,
  resume, join, dismiss -- and with
  nothing running opens the task picker on the computer. **Pause again**
  within 4 s stops the task (its time logged, LOGGED on the bar; the bar
  says AGAIN=STOP meanwhile); an interruption pauses and stops the same
  way, and its Stop takes your task up again. A **wheel click** starts an
  interruption, or the next one, and says no to a question. **Back** is no
  longer used. A press just as a question or a notification appears only
  settles. The paused screen shows ❚❚ and the key, the time below. The
  bar's own task picker, its paused menu and "hold BACK = done" are gone:
  the bar sends no long press, and choosing is the app's.
- **Turning the bar's wheel opens a short menu**, one entry at a time: DONE,
  DISCARD, your previous task and up to three recent ones -- only DISCARD
  during an interruption. Pause picks; DONE and DISCARD
  ask for a second Pause and can be undone in the app; a click, or six
  seconds untouched, closes it. Each entry has its own icon: a bin for
  DISCARD, a back arrow for your previous task, a dial turning back for
  the recent ones. A stand-up prompt that arrived while
  Windows was locked no longer plays over lunch when the menu closes.
- **Settings · General is a page of rows**: each setting a name, one
  sentence and its control at the right -- Start with Windows, When I close
  the window, a row per shortcut with its chord and **Change keys**, Check
  for updates, Set up again and Show developer tools. Switches say On or
  Off. The other groups follow.
- **Settings · Account is a page of rows too**: your account in one line --
  site, email, projects, tasks, last refresh -- with **Refresh now** and
  **Change account**; the tasks to fetch, with a custom query typed under
  the row; when a start moves the task (now one menu, *never* among the
  waits); where a Done goes; the provider's notifications behind
  **Choose…**; and **Advanced** for the state names, the key for tasks of
  your own and the entries waiting to send. When the provider refuses your
  token, a banner on top takes the new one: **Save and send**.
- **Settings · My workday is a page of rows**: working days; the stand-up,
  its time, its task (**on Daily Standup ▾**) and **Show me**; lunch; the
  end of day with **Show me**; when your week closes; how long each of the
  four reminders waits -- nothing timing, a long pause, a stand-up, an
  interruption -- set here at last; a timer left running overnight; and the
  pause that starts a new entry, now a menu.
- **Settings · Desk devices is a page of rows**, a block for the bar and one
  for the Stream Deck: the bar's line (where it answers, firmware, battery,
  brightness) with **Use without a bar**; task key color; when nothing
  runs; Windows notifications on the bar, with its switch, **Grant access**
  while Windows refuses and **Choose apps…**; what the bar shows first
  behind **Open…**; and the connection behind **Change…**, with how long a
  notification stays and how often Windows is read. The Stream Deck's line
  says how many decks are connected and installs the plugin. Without a bar
  its block is one line with **Add**. Adding an app by its id moved to
  Developer.
- **Settings · Data and Developer are rows too.** Data: **Export…** says
  when the file is saved; **Erase…** asks twice, and now erases the
  interruptions and stars as well, which it used to leave behind. Developer:
  the bar remote, the display debugger, test notifications, the
  notification listener and the bar's health, each behind **Open**, one at a
  time. The entries waiting to send, in Account › Advanced, lost their old
  card: one line counts them, with **Sync now** and **Retry failed**.
- **Tasks, rebuilt.** The projects are a column -- a search, *Starred*
  first, then *All* with **Hide empty** and each project's open count --
  and the tasks a table: ☆, key, title, status, who has it (*me*, a name,
  *nobody*), and Start, Switch or Stop. Above it, a search of the project,
  the pills *mine*, *unassigned* and *teammates'*, and a state, **Open** by
  default; a column sorts when clicked. Making, renaming, importing into
  and deleting from a project are offered only on a project of your own,
  behind its **⋯**: on a provider's, the next sync undid them.
- **The bar's words.** The stand-up reads **STAND-UP** over its time; a task
  given to someone else reads **MG-12 > RIN**; interruptions waiting to be
  placed show as **3 TO PLACE** in amber on a task's screen, the time
  moving up beside the key. When the *Nothing timing* reminder asks in your
  working hours, the bar says **NOTHING TIMING** across its width: Pause
  opens the task picker on the computer, a wheel click is not now, and
  either brings the bar's clock back. It ranks 74 in *What the bar shows
  first*, shown in Work only.
- **An interruption has its own icon on the bar**: an amber bolt, a light
  running down it, where the task's stopwatch was -- the ⚡ the window, the
  tray and the Stream Deck already mark one with. The menu's DISCARD during
  an interruption carries it too.
- **Four places instead of eight tabs.** The window is **Today**, **Tasks**,
  **History** (formerly Work History) and **Settings**, the same with or
  without a bar. The header holds the bar's preview, a **Mode** chip for Work,
  Lunch and Away (it used to hide in Priority Rules), the mini timer, **End my
  day**, and one word for how things stand -- *All good*, *2 waiting*,
  *Sending stopped*, *Update*, *Bar offline* -- that opens the details, with
  **Try now** and the last notifications the bar showed. A ⚡ beside Today
  counts the interruptions not placed yet.
- **Settings in six groups** -- General, Account, My workday, Desk devices,
  Data and Developer -- with a search box that also knows the old names
  (*sync queue*, *priority*, *ceremonies*). Task Providers is Account,
  Ceremonies is My workday, Notifications and Priority Rules (now *What the
  bar shows first*) are folded into Desk devices, and Device Diagnostics is
  split between Desk devices, Data and Developer. The developer tools -- the
  bar remote, the display debugger, test notifications -- are hidden until
  **Show developer tools**, and say that they act on the real app.
- **Deleting a project or a task asks first**, and a project's edit and
  delete buttons no longer appear only on hover.
- **A quieter look, in greys.** The blue and purple accents are gone: the
  window is grey, the main button of each screen is light grey, and colour
  is left for meaning -- green running, amber paused or waiting on you, red
  danger. A high-priority notification source now shows amber. Text is set
  in Inter; only times and task keys stay in a fixed-width face, and
  headings are no longer in tracked capitals. A few labels that drew in no
  colour at all, through classes that did not exist, now draw as meant.
- **The app names your provider.** Messages that said "Jira or OpenProject"
  now name the one you use -- "It is also deleted in Jira" -- and the
  provider choice reads OpenProject, Jira and *This computer* (formerly
  "Ad-Hoc / Custom Local Fallback"). Notifications and the log say "Jira",
  not "Jira Cloud". Working Days mentions holidays only for a provider that
  lists them.
- **Plainer wording in the window.** Developer labels are gone -- the
  sidebar's "Modules" header, "UTC Absolute Timestamp Engine", "Display
  Configuration & Debug Output Strategy" -- and settings say what they do:
  *Show the bar's own clock when idle*, *Try the wrap-up*. Notification
  rules read Default and High Priority without their scores, and counts
  read "1 task", not "1 Task(s)".
- **The session card, idle, offers what can be done**: Start a Task and
  Interrupt, rather than Resume and Finish greyed out. Switch / New Task is
  Switch Task, shown while a task runs.
- **One format for time.** A running timer always reads `HH:MM:SS` --
  `05:12` alone could be five hours -- and logged time `1h 05m`, `55m` or
  `40s` everywhere, where Work History said `1h 10m 0s` and the session page
  `0h 55m`. Days read in Windows' regional format, as the date picker does.
- **Room to read.** The mini timer is wider, so a task's title shows rather
  than its first word. In Tasks a key no longer breaks over two
  lines, rows drop the internal project id, and a row offers **Start** when
  nothing runs. Priority Rules says how its arrows and levels relate.
- **The Ceremonies prompt timeout is gone.** It was saved but never read:
  its auto-dismiss and auto-execute never happened.
- **The minimatch advisory is patched** (GHSA-g3hv-75wg-m249), in
  development tools only: ESLint 10.15 asks for the fixed minimatch 11, and
  an override gives it to typescript-eslint and to electron-builder's macOS
  merge step. Nothing in the installed app used it.

### Removed

- **Unity support.** The Unity Editor package is gone, and with it the
  compile, build, bake, Play Mode and exception screens, the Unity Engine
  tab, the setup wizard's Unity step, project linking and the wrap-up's
  scene save. The app's Unity routes now answer 404, so an editor still
  carrying the package is simply not heard. Unity's rules disappear from
  Priority Rules, including from a saved order, and the rest keep their
  levels. `pnpm verify:unity` and `verify-unity.bat` are gone too.

### Fixed

- **The mini timer stays on top.** Another always-on-top window, or a
  sleep, a lock or a monitor change, could leave it behind ordinary windows;
  it now takes the top back on its own, without taking the focus.
- **The mini timer's first tip no longer hides an interruption's name.**
  The tip waits for a task, so the name stays there to click and rename.
- **The bar no longer shows the interruption's ⚡ over Away's coffee cup.**
  After an update, the bar could still be playing animations left by the
  previous version, and the bar's refusal to take the empty animation again
  left the ⚡ playing. On firmware 1.3.1 the same leftovers made the app read
  the bar as dropping out every 3 seconds after start, redrawing each time.
- **The stand-up's meeting table no longer stays under the stand-up's
  timer.** Joining the stand-up in the same instant as another press left
  the table playing behind the timer's screen.
- **A window opened from the bar or the Stream Deck could stay behind**,
  its taskbar button flashing: the helper that brings it forward was
  stopped after 5 s, and it can take longer to start. It now has 15 s.
- **An app's first notification showed the bell, or our drawn icon,** while
  its icon was still being looked up, and its own logo only from the second
  message on: the icons found were forgotten at every start. They are kept
  now, the apps you have met are looked up at start, and an app's very first
  notification waits up to 1.5 s for its icon.
- **The keyboard reaches everything, and Escape closes every dialog.** Add
  time, Correct, End my day and the Tasks dialogs ignored Escape; the others
  heard it only once you had tabbed into them. Every dialog now takes the
  focus when it opens, keeps Tab inside and gives the focus back when it
  closes; every menu (Mode, ⋯, Stop ▾) opens on its first item, moves with
  the arrow keys and closes on Escape. **Change keys** puts the focus in the
  field at once -- the keys pressed used to go nowhere -- and History's week
  reads each time out before saying which day it opens.
- **End my day's Later lets go of the bar.** Putting off the wrap-up closed
  the question in the window but left EOD WRAP-UP on the bar for the
  rest of the day; the stand-up's Remind me did the same with its prompt.
- **The task key's color is kept.** It was forgotten at every restart, the bar
  going back to blue, and the window's list always showed the first entry. The
  list now names the colors it draws: blue, pink, amber, pale cyan.

- **The wrap-up could restart a task overnight.** Joining the stand-up
  stops the task you were on and brings it back when the stand-up ends. A
  stand-up still running at the end-of-day wrap-up ended there -- and the
  task before it came back, running until the next morning. The wrap-up now
  drops every restart waiting on the session before it stops it.
- **A deleted worklog could stay in Jira or OpenProject.** When a send's
  answer was lost -- a timeout, a dropped connection -- the entry may exist
  at the provider while the worklog still reads as unsent. Deleting it then
  sends a deletion that finds the entry by its marker. But if the worklog
  had been corrected first, or "Retry failed" pressed, or its first send
  refused for credentials, SprintTicker took it for one never sent and
  deleted it here only. It now goes by whether a send was ever attempted.
- **A notification held back during lunch never showed.** One whose
  priority makes it wait out Lunch or Away was meant to show when the
  break ended; the bar kept the sandwich or the coffee cup instead, then
  went to the clock, and the notification was never seen. It now shows as
  the break ends, then the bar goes on to your session or the clock.
- **The stand-up prompt could vanish from the bar while it waited.** It
  could come back during Lunch, playing the meeting scene over the break,
  when Away had covered it before lunch began; once lunch ended, the
  timer's screen took its place while it still waited for an answer. It
  now waits through Lunch and shows again after it.
- **A timer screen could land over the stand-up prompt.** When the prompt
  arrived just as the timer redrew, the timer's screen was drawn over the
  meeting scene a moment later and stayed there.

## 1.4.0 — 2026-11-04

Ready for BUSY Bar firmware 1.3. Firmware 1.3 reads its animations in a new
format, and shows an error icon in place of every animated icon and scene
SprintTicker 1.3.0 sends it; 1.4.0 sends each bar the format its firmware
reads, so update SprintTicker before the bar. Checked on a bar updated to
1.3.1: the probe, an animation playing in the new format, and the screen
release the app makes, a hundred times in a row. Firmware 1.3.1 does not fix
the freeze when an animation is removed, so every way around it stays.
Notifications from PowerToys, VS Code and Unity Hub now show their app's
icon rather than a bell.

### Added

- **BUSY Bar firmware 1.3.** Firmware 1.3 stores animations in a new format
  and reads only that one; given a file made for 1.2 it draws a small error
  icon in its place, and says nothing. SprintTicker now carries every
  animation in both formats, reads the bar's firmware version, and sends the
  one it reads -- again after the bar restarts on an update. A version it
  cannot read gets no animation files: scenes play frame by frame from the
  app and icons stay still. Checked on a bar running 1.3.1 with the
  hardware probe, which read the version and played a 1.3 file. The
  animation studio exports both formats and plays its preview in the bar's,
  and the hardware probe checks the bar in its own -- and that a file in
  the other format shows the error icon. The 1.3 files are about
  a fifteenth of the size for scenes, so they upload faster. Firmware 1.3.1
  does not fix the freeze when an animation is removed: SprintTicker keeps
  avoiding it.

### Changed

- **Fifteen more advisories patched in development tools**, none of
  them in the installed app, all by overrides within their majors: undici
  8.12.2, 7.30.1 and 6.29.1 (eight advisories, under jsdom, Electron's
  download at install, and node-gyp), fast-uri 3.1.9 (four, under
  electron-builder's and the Stream Deck CLI's manifest validation),
  follow-redirects 1.16.2 and joi 18.3.1 (under `wait-on` in `pnpm dev`) and
  zod 4.6.6 (under the React hooks lint rules). Two stay open, recorded in
  `pnpm-workspace.yaml`: zod 3, inside the Stream Deck plugin through
  Elgato's own library, has no fixed 3.x release, and minimatch is fixed
  only in a new major four of its users have not adopted.
- **Stream Deck plugin 0.4.1**, rebuilt on Elgato's SDK 3.0.4. Nothing new on
  the keys; the version moves because the bundle did, so that Stream Deck
  installs it over 0.4.0 rather than keeping the old one.

### Fixed

- **Notifications from PowerToys, VS Code, Unity Hub and other apps showed
  a bell instead of the app's icon.** An app installed without MSIX was
  traced to its executable by the name of its Start-menu shortcut, so an
  app whose shortcut is called something else -- `PowerToys (Preview)`,
  `Visual Studio Code` -- was never found. SprintTicker now asks Windows
  which shortcut belongs to the app. The name match that remains for apps
  Windows does not list no longer takes another app's shortcut: on a
  machine with Bitdefender, Windows Security's notifications showed
  Bitdefender's icon.

## 1.3.0 — 2026-10-23

Time that is right, and a second way to drive it. A session across midnight
is now logged under each day, and one forgotten overnight is asked about
rather than billed. A worklog already sent can be corrected or deleted, a
send whose answer was lost is not logged twice, and time goes to the provider
its task came from -- never to Jira for an ad-hoc task. The stand-up switches
the timer to itself and back to your task after it, and working days and
holidays keep the ceremonies quiet on days off. The task lists show work
nobody has taken and teammates' tasks in progress, and starting an unassigned
task takes it. Lunch now starts when Windows is locked or a task runs, and
never undoes what you do. Beside the bar, a Stream Deck plugin puts the
session on six keys, attached to the release, and the app can start with
Windows in the tray.

### Added

- **Start with Windows, in the window.** Device & Logs has a *Start with
  Windows* switch, and so does the tray menu; both read what Windows will
  do, so one switched off in Windows' Startup apps reads off. Started that
  way, SprintTicker opens in the tray with no window over what you open
  first. The portable build registers the file you ran rather than its
  temporary copy, and an entry made by an earlier version is brought up to
  date at the next start. Not offered from `pnpm dev`.

- **The mini timer shows the bar's icon.** Beside the timer, the icon of
  whatever holds the bar: the stopwatch, Unity's gear or hammer, the
  stand-up's meeting, an app's icon during its notification, the burger at
  lunch. Away and SEE YOU! have new icons of their own, a coffee cup and a
  moon drawn from their scenes. Hover it for the screen's text.

- **Working days, holidays and the end of the week.** The stand-up, Lunch and
  the wrap-up used to run every day, weekends included. They now happen on
  the working days picked in Ceremonies (Monday to Friday by default), and
  not on the holidays an OpenProject instance lists, read once a day. The
  wrap-up of a week's last working day -- Thursday's when Friday is a
  holiday -- closes the week: a notice in the window shows the time logged
  in it, until dismissed. A wrap-up missed is caught up the next working
  day, and a week closes only once.

- **Join the stand-up, and get back to your task after it.** The stand-up
  prompt used to leave your task tracking through the meeting. Its new
  **Join** -- or OK on the bar -- switches the timer to a Daily Standup task,
  logging the time before it to your task, and stopping the stand-up starts
  that task again: once, the same day, never over something you started
  yourself, and asking first if the task left your list meanwhile. Dismiss
  keeps things as they were.

- **Correct or delete a worklog already sent.** A wrong duration had to be
  fixed by hand in Jira or OpenProject. Work History now has a pencil and a
  bin on every worklog: the duration, the start and the comment can be
  corrected, and a deletion asks first. The change applies here at once and
  reaches the provider through the sync queue, so it survives a lost
  connection or a restart; a worklog not yet sent simply goes with the new
  values. Each worklog also says where it stands -- sent, sending, not sent,
  local only, or a correction on its way.
- **A session left running is caught, not billed.** A session forgotten
  overnight or over the weekend kept counting -- 62 hours on Monday -- and
  stopping it sent them all to the provider at once. Coming back after your
  last activity on an earlier day, at least two hours before, now pauses it
  at that activity and asks when you stopped: at your last activity, at your
  end-of-day hour that day, or at a time you pick. Then log and stop, log and
  restart it now, discard it, or count it all. Overtime past midnight is never
  interrupted while you are at the keyboard. The question can be turned off in
  Ceremonies.
- **Three ways to end a session, everywhere.** Keep the task open, mark it
  done, or discard the session -- in the Finish dialog, from the mini timer's
  Stop, and on the bar, whose paused menu now reads STOP, FINISH and DROP.
  Discarding keeps nothing and sends nothing, so each place asks first: the
  window names the task and the time, the bar shows **DISCARD?** until the
  wheel's click or BACK answers. The mini timer's Stop used to log the time
  and nothing else.

- **Only projects with tasks.** A provider lists every project you can see,
  while the tasks it fetches are the ones assigned to you, so most projects in
  the pickers held nothing to pick. A switch above the project list -- on by
  default, and remembered -- hides every project with no open task, in the
  Projects & Tasks panel, the task picker and the bar's own picker alike, and
  says how many it hides. The project selected in the panel stays listed while
  empty. When no project has a task for you -- before the first sync, or with
  nothing assigned -- everything is listed and the switch says so; ad-hoc
  work, which stays in progress until finished as done, does not count.

- **Unassigned and teammates' tasks in the lists.** The Projects & Tasks
  panel, the task picker and the bar's picker now list, besides your own
  work, the open tasks nobody is assigned -- and, when you tick
  **Teammates'**, a teammate's task in progress. Two switches above each
  list, **Unassigned** (on) and **Teammates'** (off), are one setting for all
  three, and say how many tasks they hide. Every list follows one order:
  yours in progress, yours to do, unassigned to do, unassigned in progress,
  teammates' in progress, then finished work. The window marks a task that is
  not yours with *Unassigned* or the assignee's name; the bar's second row
  adds `free` or `@` and the first name after the key. **Only projects with
  tasks** counts what the switches show.

- **Open a task on its provider.** An arrow beside a task -- the running
  session, the Projects & Tasks panel, a Work History row -- opens it on
  Jira or OpenProject in the browser. The app builds the address from the
  provider's own site and opens nothing else; ad-hoc work and the app's own
  projects have no arrow.

- **Starting an unassigned task assigns it to you.** It is then moved to In
  Progress like your own. If someone took it between your pick and the start,
  it stays theirs and your session runs anyway: a Windows toast, a **TAKEN**
  banner with their name on the bar, and **Assigned to** them in the panel
  and the mini timer say who has it. A failed assignment is told in a toast
  and not retried. OpenProject's write carries the work package's lock
  version, so an assignee set meanwhile is never overwritten.

- **The app's side of a Stream Deck plugin.** A WebSocket on the app's
  local port, `/api/v1/deck`, pushes what a deck's keys show -- the session,
  the bar's icon, a prompt waiting for an answer -- and takes the keys'
  actions: pause, resume, the three ends of a session, the task picker, and
  yes or no on the stand-up, the wrap-up and the resume question. Each does exactly what the window or the bar does.
  A web page cannot open it.

- **A Stream Deck plugin** (`packages/streamdeck-plugin`, `pnpm deck:pack`).
  Six actions to place on any key, a Stream Deck Mini's six: Session (the
  task, its time and the bar's icon; a press pauses or resumes, or opens the
  task picker when nothing runs; held, it opens the picker), Not done, Done,
  Discard, Yes and No. The picker comes to the front even though the press
  reached Stream Deck rather than SprintTicker. Discard, and Done on a task
  no longer yours, ask on the same key first. Yes and No are separate keys,
  grey while nothing is asked. A key's colour is its state: a coloured glyph
  can be pressed, a grey key has nothing to do, a filled key waits on you.
  Done, Not done and Discard play a short movement of their glyph when
  pressed, and Yes and No when a question arrives. The Session key plays
  the bar's icon as the bar does -- the stopwatch stepping round, the gear
  turning during a compile. Every key turns grey and
  says offline while SprintTicker is closed. Not yet tried on a physical
  deck, and no default profile ships yet. Each release carries the plugin
  beside the installer, as `SprintTicker-StreamDeck-<version>.streamDeckPlugin`,
  under a version of its own.

### Changed

- **The stand-up's icon is animated.** The three people at the table take
  turns to speak, each sitting up a pixel as they talk, with a rest between
  turns. The bar plays it itself, as it does the stopwatch, so it costs no
  request; where the device refuses it, the still icon stays.

- **The sync reads whose each task is.** It now also keeps every open task
  nobody is assigned and a teammate's task while it is in progress, each
  stored with its owner. A task reassigned to a teammate while you
  track it, and still in progress, now reads as no longer yours at once,
  where it used to wait for the provider to say why.
- **The stand-up shows its timer.** Once joined, the bar went on playing the
  meeting scene of the prompt, so a press seemed to do nothing, and a second
  START paused the stand-up. It now shows the session screen -- Daily
  Standup and its time -- with a meeting icon in place of the stopwatch.
- **An ad-hoc task shows its name alone on the bar.** Its key is the
  fallback ticket every ad-hoc task shares, so the top row read "MISC-1:
  Dail..." and lost the name to it. It now reads "Daily Standup". The
  window still shows the key.
- **A session across midnight is logged under each day.** A session was one
  worklog, filed under the day it began: 23:00 to 01:00 put two hours on the
  first day, and the morning after a session paused overnight went on the
  evening before. It is now split when it ends -- one worklog per day, each
  sent on its own -- and the finish dialog says how before it does. A pause
  of 15 minutes or more starts a new worklog too (set in Ceremonies; 0 keeps
  one per day). The pieces add up to exactly what the timer showed, and a
  few seconds past midnight join the evening rather than being refused by
  Jira.

- **Three new advisories patched in development tools**, none of them in the
  installed app: shell-quote 1.12 under `concurrently`, source-map-js 1.2.2
  under Vitest's jsdom, and postcss-selector-parser 7.1.6 under Tailwind 3.
  The last crosses a major, so the renderer's CSS was rebuilt on both and
  compared: byte-identical. Three more -- braces, http-cache-semantics and
  sprintf-js, under Tailwind and electron-builder -- have no fixed release
  yet; `pnpm-workspace.yaml` records why each is out of reach.
- **Electron 44.9.3, Vite 8.3.5 and follow-redirects 1.16.1.** Electron
  could check a WebHID or WebUSB permission against the wrong origin
  (GHSA-fw47-9c62-h3vw); the app requests neither, but the fix ships in the
  installed app. Vite 8.3.5 fixes six advisories in the dev server -- three
  of its own about files outside `server.fs.allow` and cross-origin
  scripts, and three in the `launch-editor` behind its error overlay.
  follow-redirects, under `wait-on` in `pnpm dev`, could pass an
  authorization header to another origin on a redirect. The three without a
  fixed release stay open.
- **Each worklog sent keeps the provider's id for it** (migration 8), the
  groundwork for correcting a worklog already sent. Queued sends are tied to
  the worklog they carry; those from before are tied where the match is
  certain. When Jira or OpenProject answers without an id, none is kept: the
  adapters used to invent one (`jira_wl_<time>`).
- **A worklog belongs to the day it began.** Work History, today's table and
  the end-of-day summary filed it on the day it stopped, so a session from
  17:00 to 01:00 showed under the second day here and under the first in Jira
  and OpenProject. Such a session is now split at midnight besides (above).
- **The README and the user guide show the app.** Screenshots of every panel,
  with a bar and without one, and the bar's own screens as it shows them --
  tracking, paused, Unity, banners, the Lunch, Away, meeting and end-of-day
  scenes -- animated. Troubleshooting entries fold under their question.
  `pnpm docs:images` rebuilds the pictures from a throwaway profile with
  invented projects.

### Fixed

- **The Unity plugin runs.** Unity compiles no script in a package unless an
  assembly definition owns it, and the plugin had none: an editor skipped it
  with a warning in its own console, and the bar heard nothing from that
  project -- no compile, Play Mode or exception screen, and the wrap-up
  saved none of its scenes.
  It now has one, and once compiled it no longer refers to
  `SceneManager.loadedSceneCount`, which Unity 2021.3 does not have, nor
  to a compile event Unity marks obsolete, which warned at every compile.
  Nothing to do in your projects: the plugin is linked, not copied, so they
  pick it up at the next compile.
- **A resend to OpenProject 17.9 finds its entry.** Before sending a time
  entry again, the app looks for it on the server, so a send whose answer was
  lost is not billed twice. That search filtered by work package, a filter
  OpenProject 17.9 no longer has, and a 17.9 instance refused it: every
  retried send there would have failed. It now searches the way 17.9 does, and the old
  way on an older instance.
- **Lunch starts with a task running.** The timer's tick, every second, was
  taken for you starting work in the first seconds of lunch, so lunch was
  skipped for the day whenever a task ran into it -- almost always. Only a
  task you start or resume during lunch skips it now.
- **Unlocking Windows during lunch shows lunch.** The mode became LUNCH but
  the bar kept the Away scene until lunch ended.
- **A task closed after it was reassigned is finished without a
  transition.** Why a tracked task left your list was asked once; a task
  reassigned and then closed still read NOT YOURS, and confirming FINISH
  sent the completion transition to the closed work package. It is asked
  again at every sync while the session runs.
- **Cancelling the wrap-up on the bar draws the screen behind it once.** It
  was drawn twice, and when idle that was two clears of the bar's screen.
- **The bar preview in the window shows animations as LEDs.** An animated
  icon flickered between its LEDs and a flat picture of itself, and scenes
  were drawn as pictures over the matrix. Dark pixels are dim LEDs too:
  every lit LED had the same white core, so a scene's dark background
  looked almost white.
- **No icon left playing over a scene.** Lunch stopping a running task left
  the stopwatch playing over the sandwich for the whole break: the idle
  screen's clear, which takes the icon down with it, was overtaken by
  lunch's scene. An icon whose removal failed while the bar was unplugged
  could likewise play on over the next scene once it was back.
- **The bar's picker no longer hides after Away.** START pressed while
  Windows was locked opened the picker under the Away scene; unlocking then
  showed the clock, Unity or Lunch while the bar went on taking presses for
  the hidden list -- a click could start a task nobody saw. It now comes back
  as soon as Away ends, ahead of Unity, of a banner queued meanwhile and of
  Lunch when you unlock during it.
- **No second clear after a short outage.** When the bar came back between
  two checks, the app forgot what it had just cleared and cleared the empty
  panel again.

- **A session stopped at a chosen time agrees with STOP after a clock
  change.** When the system clock was set back during a pause, ending the
  session from the forgotten-session question logged the jump less than
  STOP did -- 90 minutes of a two-hour session. Both now log the same.
- **You hear when the provider stops accepting your time.** A worklog the
  provider refused on expired or revoked credentials waited in the sync
  queue, visible only there, while every day's time piled up behind it. A
  Windows notification now says sending stopped -- once, not per worklog --
  and that the time is kept until the credentials are entered again.
- **The window follows the five-minute sync.** The project and task lists
  refreshed only after a sync the window asked for, so a task added or
  renamed on the provider appeared when you changed views.
- **Resuming a task that is no longer yours no longer takes it back.**
  Answering yes to "Resume after lunch?", or restarting a forgotten session
  on a task that had left your list, brought it back into your lists and
  moved it to In Progress on the provider -- a task now someone else's, or
  closed. It is now tracked as it is, and finishing it as done still asks.
- **A task renamed while you track it shows its new name.** The session
  kept the key and title it started with, so a task renamed on the
  provider, or moved to another Jira project with a new key, showed its old
  names on the bar and in the window until it ended. The next sync now
  brings them, and the bar redraws once.
- **Time goes back to the provider its task came from.** A session's time
  and its status changes went to whichever provider was active when it
  ended, so switching from Jira to OpenProject mid-session sent the Jira
  issue's id to OpenProject -- where the same number can be a different work
  package. Each session now records its provider when it starts (migration
  9), and holds to that provider's minimum duration too.
- **Time on a project made in SprintTicker stays in local history.** It was
  queued for the active provider, which had never heard of the task, and
  parked as a failure. This holds for projects made from now on: OpenProject
  projects did not say where they came from, so an older project made here
  cannot be told apart from one of theirs, and keeps the old behaviour.
- **A task closed on the provider mid-session is no longer reopened.** It
  read like any task that left the list -- "No longer assigned to you",
  NOT YOURS on the bar -- and confirming FINISH sent the completion
  transition, which on OpenProject moved the closed work package back to
  To Test or To Review. SprintTicker now asks the provider why a tracked
  task left: closed, reassigned, or deleted. A closed one is finished without
  a question and without touching it there.
- **A worklog whose answer was lost is not logged twice.** A send that timed
  out, or that the app closed in the middle of, may already have been
  recorded by Jira or OpenProject, and the retry posted it again: the time
  appeared twice. A worklog sent before is now looked for at the provider
  first, by the tag in its comment (migration 11).
- **A project made in SprintTicker survives the next sync.** The sync
  deleted every project its provider did not list, so one created in the
  Projects panel was gone, with its tasks, minutes later.
- **Two projects may share a key.** A Jira project recreated under a new id,
  or one sharing a key with a project made here, failed to save -- logged,
  never shown -- and was missing from every list (migration 10).
- **Lunch starts even when Windows is locked.** Locked when lunch began, the
  task kept running behind Away and the lunch hour was logged as work. It
  stops at lunch now, Away or not, and comes back after; unlocking during
  lunch shows Lunch at once rather than the work screen first.
- **A lunch window that cannot happen is refused.** One ending before it
  started -- or across midnight -- never matched any minute, so lunch
  silently never began. The Ceremonies panel says why and saves nothing.
- **Lunch never undoes what you do.** A task started or resumed during lunch
  ran under the sandwich, and if you stopped it before lunch ended, the task
  lunch had stopped came back anyway. Starting or resuming a task during
  lunch -- from the window, the mini timer or the bar -- now ends Lunch for
  the day, and nothing restarts at its end. The task lunch stops is kept in
  the database, so closing the app over lunch, or leaving Windows locked past
  its end, no longer loses it. And a task reassigned, closed or moved over the
  break is no longer restarted without asking: the window and the bar ask
  first.
- **The bar's task picker shows during lunch.** It was queued under Lunch, so
  START opened a picker nobody could see. It also closes when a task is
  started from the window, and no longer comes back after Away when it was
  opened and closed under it.
- **A task reassigned while you track it stays.** The sync retired it
  mid-session -- deleted outright when no time had been logged on it yet --
  so it vanished from the lists and finishing it as done did nothing. It now
  stays until the session ends, the panel and the mini timer say **No longer
  assigned to you**, the time is logged as usual, and marking it done asks
  first, on the bar too.
- **Discard discards.** `session:discard` logged the time and sent it to the
  provider like any stop. Nothing in the window called it, so it never
  showed; it now keeps nothing.
- **Ad-hoc time is no longer sent to Jira or OpenProject.** It was queued for
  the active provider under the task's internal id, so Jira was asked to log
  time on an issue called `adhoc_...`, answered 404, and the row ended in the
  failed queue -- while the task picker promised a fallback ticket nothing
  used. Ad-hoc time now stays in Work History. Rows already failed for this
  reason stay in the sync queue panel. The "fallback ticket" setting is now
  what it always was in practice, the **ad-hoc task key** new ad-hoc tasks show.
- **An ad-hoc task can be finished.** Finishing one as done was skipped, so
  it stayed in progress for good. And one started again from a list was
  treated as a provider's task, its status pushed to Jira under the same id.
- **Today's table shows today.** The Active Session panel's list headed
  "Today's Logged Work" held the latest fifty worklogs whatever their day, so
  each morning it opened on yesterday's hours, and its total disagreed with
  Work History for the same date. It now holds the current local day.
- **Today's table names each task by its key.** The Active Session panel's
  list of the day's worklogs headed its first column Task Key and filled it
  with the task's internal id -- `demo-pf_PF-33` for a local task `PF-33`.
  Work History already showed the key.

## 1.2.1 — 2026-10-07

A bar that stays up, and shows what is going on. On 2026-10-05, 1.2.0 hung
the bar twice in one day of Unity work, each time needing a restart by hand:
the end of a compile redrew the idle screen twice, and the two clears skipped
the pause the device needs before closing its screen. That is fixed, and the
whole class with it -- the app now sends the bar one display request at a
time and checks every rule the firmware is known to hang on just before
sending, whoever asked. A new stress test plays generated days of Unity,
notifications, tasks and breaks against a simulated bar; it found the hang
again, four more ways to break the device's rules, and a dozen ways the
screen could end up showing the wrong thing, two Unity projects open
included. Testing this release on a real bar then froze it a third way, from
the app's own careful teardown: firmware 1.2.4 hangs, now and then and with
no warning, when an animation is removed while it plays. The app no longer
removes one. Device Diagnostics now shows the slowdown that came before the
earlier freezes. Every fix here was checked on a real bar (firmware 1.2.4)
before release.

### Added

- **Display Health in Device Diagnostics.** Before every freeze measured on
  firmware 1.2.4, uploads to the bar slowed from about 50 ms to several
  hundred. The panel now shows the median upload time, the screen closes of
  the last hour, and the requests the app decided it did not need to send;
  it turns red with a warning when uploads slow like that, and the log says
  so once. The figures go into the diagnostics bundle, so a freeze reported
  after the fact comes with its run-up.

### Fixed

- **The bar no longer freezes when an animated icon or scene goes away.**
  Replaying a day of Unity compiles on a real bar froze it on BUILDING 40%,
  the HTTP API silent until it was restarted by hand. The cause, reproduced
  without the app: firmware 1.2.4 hangs now and then when a playing
  animation is removed -- the gear icon froze it on its 30th removal in one
  run and its 59th in another, with nothing slowing down first. The app now
  replaces an animation it is done with by an empty one under the same name,
  which survived 200 swaps in a row, and hands the display back to the clock
  by taking the picture down, waiting half a second and closing the screen
  on the animations alone, which survived 100 rounds. You may notice that
  half second of black before the clock.
- **A bar that comes back after an outage shows what is current.** After that
  freeze and a restart the bar came back on the old BUILDING screen: the
  return to the clock had failed while it was away, and the app resent the
  last picture it had. It now redraws whatever holds the display when the bar
  answers again -- after a restart, a cable or Wi-Fi blip too short for the
  connection status to notice, or turning no-bar mode off. A Lunch or Away
  break that started during such a blip no longer streams its animation
  picture by picture for the whole break, and an unplugged bar no longer
  fills the log with errors each time the clock should come back.
- **The bar now shows what is actually going on when something ends.** The
  stress test learned to check the screen at the end of every generated day
  against the state, with two Unity projects open, and found the display
  wrong in about one day in seven:
  - a build covered by a notification came back as the idle clock, the build
    still running; a compile that started under a notification never showed;
  - with two projects open, the first to finish compiling took the gear down
    while the other still compiled, and one project's build end removed the
    other's build screen; closing an editor in Play Mode left ON AIR up;
  - leaving Lunch while a project compiled left the sandwich playing;
  - finishing a task during Play Mode ended on the idle clock, and the end of
    a session wiped a notification that was on screen;
  - a Lunch that began during Away took the display back in Work mode, above
    every notification.

  Whatever ends now hands the display to what was underneath, or to what
  Unity is doing by then, before the idle clock.

- **Stopping a task with the idle clock on could close the screen on a
  picture and an animation together**, the close that hung the bar within a
  few rounds on firmware 1.2.4. The clear for the idle clock and the LOGGED
  scene went out in the same instant and crossed on the way to the device.
  Found by a new stress test that plays generated mixes of Unity, banners,
  tasks and breaks against a simulated bar; with it came four more ways the
  app could break the device's rules -- closing too soon after an animation,
  uploading over a playing scene and dropping to 60-frames-a-second
  streaming, requests overlapping, requests that could only fail. The driver
  now sends every display request one at a time and checks each rule itself
  just before sending, whoever asked.

- **The bar no longer hangs during Unity sessions.** On 2026-10-05 it froze
  twice in a day and needed restarting by hand. The end of each compile, of
  Play Mode and of an exception screen redrew the idle screen twice, and idle
  each redraw clears the display; two clears side by side skipped the pause
  the device needs between taking an animation down and closing its screen,
  the sequence measured hanging firmware 1.2.4. Clears now run one at a time,
  a clear with nothing left to clear sends nothing, and each Unity end redraws
  once.
- **A compile burst keeps the compiling screen up.** Unity often compiles,
  reloads and compiles again a second later; the bar used to return to idle
  and clear between each. A compile that starts again within three seconds of
  the last one ending now carries on with the same screen.
- **A Unity end no longer wipes a notification.** A banner that took the
  display while Unity was compiling or in Play Mode was replaced by the idle
  screen the moment Unity finished. It now stays for its full time.
- **A script compile inside a build no longer takes the build screen down.**
  The compile's end gave back the display lock the build was holding.
- **"remove icon_anim: device returned 400" is no longer a warning.** It is the
  device saying the icon was already gone, which is what was asked for; the
  log now says that.

## 1.2.0 — 2026-10-02

SprintTicker without a bar, and a bar that is ours. Without one, the app now
stands on its own: a setup that does not require the device, a mini timer that
stays on top, and Windows notifications for what happens on your OpenProject
and Jira tasks. With one, the front display is set in our own fonts and every
screen we draw -- icons, Lunch, Away, the stand-up, GO!, DONE!, SEE YOU! -- is
our own animation, made in a new studio. Under both, the bar no longer hangs
when screens change, an expired Jira token no longer empties the project list,
and the device address is a setting rather than an assumption. As in 1.1.0,
most of the fixes came out of daily use; the entries below say so where it
matters.

### Added

- **SprintTicker without a BUSY Bar.** The setup wizard now asks whether you
  have one. Without it, the app keeps time, syncs and runs your ceremonies as
  before, stops looking for a device, and hides the screens that only describe
  the bar -- Priority Rules, Unity Engine and Notifications. The Unity plugin's
  events are ignored and the Windows notification listener does not run, since
  both exist to put things on the bar. **Add a BUSY Bar** in Device & Logs brings it back, with the address
  and token you had set. The connection readout no longer opens on invented
  figures (connected, 98% battery) before the real status arrives.
- **A mini timer.** A small window that stays above the others and shows what
  the bar would: the task, the elapsed time with seconds, and whether it is
  running or paused. Pause, resume and stop from it; its list button brings the
  dashboard forward with the task picker open. Drag it anywhere; it comes back
  where you left it, and opens at the next launch if it was open when you quit.
  Open it from **Mini Timer** in the top bar or **Show Mini Timer** in the tray
  menu. Useful without a bar, and with one that is out of sight.
- **Windows notifications for what happens on your tasks.** When someone
  assigns you a work package, mentions you, comments, changes a status, or a
  date alert fires, OpenProject's notification becomes a Windows toast;
  clicking it opens the work package. Choose which of the five you want, and
  whether they also go to the bar, under **Notifications from OpenProject** in
  Task Providers. A burst of more than three arrives as one summary. Only what
  arrives after you turn it on is shown, not the unread history.
- **The same notifications from Jira.** An issue assigned to you, a status
  change, a comment, a mention in a comment -- on the issues you are assigned,
  reported or watch -- each switchable under **Notifications from Jira**, with
  its own animated icon on the bar. Jira Cloud has no notification feed, so
  the app reads the changes off a search every minute. Your own changes never
  notify you. A mention on an issue you do not follow is not seen, and Jira has
  no date alerts.
- **Tasks have descriptions.** The start of a Jira or OpenProject description
  appears under the task's title in Projects & Tasks and in the task picker,
  which searches it too. On the bar, the picker's second row shows the task
  key followed by as much of the description as fits. Existing tasks gain
  theirs at the next sync.
- **The renderer has tests.** A second Vitest project runs in jsdom with
  Testing Library: every tab mounts, a session update from main reaches the
  screen, and the session card's finish paths are pinned. Its
  `window.electronAPI` mock is typed as the whole bridge and type-checked by
  `pnpm typecheck`, so a bridge change that the renderer's tests do not follow
  fails the build.
- **`pnpm db:check-migration`.** Migrates a copy of your database and reports
  whether anything was lost: worklogs, tracked time, task references, or the
  one-open-session rule. The original is never opened. It is how migrations 5
  and 6 were checked against real history before this release.

- **Animated icons.** While Unity compiles, the gear on the bar turns,
  steadily, for as long as the compile lasts. The bar plays the icon itself, laid
  over the screen with `z_index`, so it costs one upload per connection and
  nothing per frame. The screen keeps the still icon underneath, so a bar that
  refuses the animation shows the icon as before. The on-screen emulator
  animates it too.
- **Every event icon of ours moves.** The Play Mode pad is played, the
  exception triangle shakes, the notification bell swings, the end-of-day
  alarm clock rings, and the lunch-prompt burger hops. Work in progress moves
  steadily; an event acts, then rests. App logos in notifications stay as they are.
- **The session screen shows where you are.** A stopwatch replaces the
  checkmark that the tracking, paused, idle and Day Complete screens all
  shared: green while a task runs, amber with blinking pause bars while
  paused, dim grey when nothing runs. The idle screen reads "Ready / No task
  running" instead of a cut-off "No Active Ta...".
- **The running time is large, and the stopwatch ticks.** While a task runs,
  row 2 shows its time in 7px bold digits, where it used to be the small row-2
  face, and the stopwatch's hand ticks round the face once a second, the
  elapsed part filling in behind it; the crown clicks at each lap. The bar
  animates the hand by itself, so the picture still changes once a minute and
  nothing more is sent each second. The hand keeps its own time: it shows that
  the clock is running, not the seconds of the session.
- **The task picker on the bar says where you are.** A folder while you choose
  a project and a checklist while you choose a task, where it was bare text;
  the item's place in the list (`3/12`) at the end of row 2; and a one-pixel
  scroll bar along the bottom, whose thumb shows whether there is more before
  or after. A project with no tasks shows no position, rather than a "1/1"
  that would suggest something to pick.
- **Tasks in the picker are sorted and show their status.** In progress
  first, then to do, then done; within each, by the priority Jira or
  OpenProject gives (Highest/Blocker/Immediate first; a priority the app does
  not know comes after the known ones), then in the provider's order. The
  checklist icon is grey, amber or green to match, and a done task's name is
  dimmed. The list used to come in whatever order the store returned.
- **STOP and FINISH follow the wheel.** Left picks STOP, right picks FINISH,
  and turning further stays put, where every notch used to flip the choice --
  one notch too many before the click landed on the other one.
- **The paused screen shows the whole task key.** STOP and FINISH now sit side
  by side on row 1, which leaves row 0 to the key and its time. Stacked in a
  column on the right, they left the title 26px, and it came out as "SPR-...".
- **The Unity screens read the same way.** State on row 0, project on row 1,
  and for a build or bake the percentage beside the state and a one-pixel
  progress line along the bottom. "COMPILING:" lost its dangling colon, and a
  build no longer cuts the project name to "BUILDING: M...".
- **The icons were reviewed, and five reworked.** The end-of-day prompt shows
  an alarm clock that rings, in place of a plain clock. The Play Mode pad is
  played: buttons go down, the pad dips, the stick is pushed. The lunch burger
  hops layer by layer instead of squashing, and the check's tick is
  retraced by a pen instead of scaled up. The exception triangle starts from
  its still.
- **OpenProject notifications shine.** A light sweeps once across the
  OpenProject logo, then it rests. The logo's shape and blue never change: it
  is OpenProject's mark, so light passing over it is as far as the animation
  goes. Other apps' logos stay still.
- **Finishing a task celebrates with a scene of our own.** A green badge drops
  in and squashes on landing, its tick draws itself, and confetti bursts and
  falls behind **DONE!**. The bar plays it once and rests on the finished
  badge, where the old confetti was drawn here and streamed: about 80 requests
  over four seconds, now one upload and one draw.
- **Stopping a task says so.** STOP, from the bar's paused screen or from the
  app, plays **LOGGED**: the amber stopwatch clicks, its hand sweeps back to
  twelve taking the elapsed time with it, and a glow settles -- then the idle
  screen. The bar used to go straight to idle, which looked the same as the
  stop not having worked. Finishing still plays DONE!, and starting another
  task from the app no longer flashes LOGGED before the new one: the start
  logs the running session itself. The debug panel's **Stop Task** button,
  which fired the confetti, now previews LOGGED.
- **Starting a task from the bar says GO!** Confirm a task in the picker and
  the green stopwatch's crown clicks, its hand runs a lap and a quarter, and
  it lands at three with a quarter filled -- the tracking screen's own icon,
  which follows two seconds later. The menu used to vanish into the tracking
  screen with nothing to say the click had landed.
- **The day ends on SEE YOU!** Once the end-of-day wrap-up is done, a
  crescent moon rises over a dusk sky and three stars come out, one twinkle
  each, for five seconds. It replaces the Day Complete screen, a checkmark and
  two rows that read as one more event rather than the end of the day. The
  wrap-up's display lock now ends with the scene, where it was a separate
  five seconds of its own.
- **A scene is no longer cut off when a lock is released under it.** Every
  release restores the work screen, and that stopped whatever was playing:
  GO! would have lasted a frame, and a banner ending during DONE! cut it
  short.
- **The build and bake screens have their own icons**: a hammer that strikes,
  and a light bulb that glows. Both replace the Unity logo, which is Unity's
  mark and not ours to animate.
- **`pnpm probe:busybar --compositing` checks the layering the app uses**: an
  icon stays above a redrawn frame, and removing it with `element_ids` leaves
  the frame. It also records that removing an element the device does not hold
  answers 400.
- **The device address and API token are configurable**, in Settings › Device.
  Changing either reconnects the driver in place — no restart. This was
  hardcoded to `10.0.4.20` on the reasoning that the bar always answers there
  over USB, which is true of the *device* and not of the address the *app* has
  to dial. Two things break it: a bar on Wi-Fi holds a DHCP lease, and a host
  whose USB CDC-NCM driver refuses to start the network interface (Windows
  25H2, Intel 700-series xHCI — the device enumerates cleanly and the adapter
  fails with Code 10) is recovered by proxying the bar onto a *different*
  address. Before this, a working bar and a working recovery still left the app
  unable to reach it. Addresses are validated before use, since the value is
  concatenated into a URL, and the token is redacted from the StateStream URL
  the driver logs — that log line is captured into the diagnostics bundle.
- **A fake Jira server and an integration test.** `scripts/fake-jira.js`
  (`pnpm mock:jira`) is a sibling of the OpenProject harness, and
  `tests/jira-integration.test.ts` drives the real adapter over a real socket.
  The live run in 1.1.0 removed the unknowns but left no regression cover;
  nothing automated exercised the Jira dialect, which is where the traps are —
  two different pagination schemes, ADF comments, and a timestamp format that
  rejects both `toISOString()` and the `+02:00` form.
- **Tests for the hardware task picker and the tray context menu.** Both were
  behaviour a user reaches with a physical control and neither was covered.
  `input-decoder.ts` went from 66% to 94%, `tray-manager.ts` from 69% to 92%,
  and the coverage floor is ratcheted to 83 / 74 / 84.5 / 85, and again to
  84 / 75 / 85 / 86.5 with the driver's failure-path tests, and to
  92 / 85 / 90 / 93.5 once the priority engine, services, hardware and IPC
  were covered.
- **Tests for the diagnostics export**, which had one test asserting three
  values the exporter had invented. `main/diagnostics` went from 66% to 98.5%;
  `logger-interceptor.ts` had no test file at all.
- **`pnpm preflight` now runs in CI**, catching a version drift across the three
  `package.json` files when it is introduced rather than when someone tries to
  cut a release.
- **`pnpm probe:busybar`** — checks the device contract against a real bar and
  reports which newer firmware fields it accepts. Run against **firmware 1.2.3**:
  everything this app relies on still holds, and both `z_index` and
  `element_ids` are accepted, which lifts the compositing blocker recorded in
  ROADMAP §4. It draws only under its own application name and sends no
  `rectangle` elements, since a wrong colour count there reboots the device.
- **The probe reads the panel back and measures it.** `pnpm probe:busybar` now
  captures frames with `GET /api/screen?display=0` and writes them out as PNGs,
  so a check can assert a *layout* rather than a status code. What that
  settled, all on firmware 1.2.3:
  - `CountdownElement` renders **17×5px**, not tall as its guidance warns, and
    sits beside a 16px app icon with 39px of the field to spare. It ticks with
    no uploads at all, against the two HTTP requests per frame the app pays
    today. ROADMAP §4's timer work is a layout exercise, not a rewrite.
  - **The countdown counts against the device's RTC, not the app's clock.** The
    measured bar runs 19 seconds behind its host, so a countdown built from
    `Date.now()` drew `00:47` for a 65-second interval — silently wrong, with
    nothing reporting it. Recorded before anything is built on it.
  - `z_index` genuinely reorders overlapping elements. The previous run showed
    only that the field is accepted on a draw, which is a weaker claim.
  - `GET /api/screen` serves base64 raw **BGR** pixels, top-down and with no
    BMP header, despite answering `Content-Type: image/bmp`.
- **The probe now checks hardware animation playback**, which is the gap the
  Away regression below fell through. It uploads the largest real `.anim` in
  `Animations/` — the app's own ~0.8–1.3 MB file, not a token — draws it, and
  captures the panel twice 700 ms apart. That separates three outcomes a status
  code cannot: the device refused the file, it accepted the file and drew
  nothing, and it is genuinely animating. Only the last one shows two frames
  differing. Set `BUSYBAR_IP` for a bar reached on another address.
- **Generated documentation site.** `pnpm docs:build` renders the three
  Markdown documents into `docs/index.html` for GitHub Pages, and `pnpm
  docs:check` fails CI when the page and its sources have drifted.
- **An animation studio**, `pnpm studio`, in its own package
  (`packages/anim-studio`, Vite and plain TypeScript, no React or Electron). It
  composes full-screen scenes in the visual language of the bar's own
  animations: a rounded gradient plate with an outline, an animated
  frame-by-frame icon on the left and large text on the right.
  - Each layer can move: the plate slides or pulses, the icon plays an intro
    once and loops the rest, and the text has typewriter, wave, shine, scroll
    or blink.
  - The editor has an LED-style preview, a pixel editor with onion skin, a
    palette and PNG import, and undo.
  - It exports the PNG sequence and `meta.json` the app already plays, and can
    also compile the `.anim` and play it on a real bar under its own
    application name, at priority 100 with a 5-minute timeout.
  - It refuses to export over a folder holding files it did not write, which
    protects the firmware frame sets beside it.
  - It draws large text in a display face, Bold 7, generated by
    `pnpm fonts:build` like the app's fonts.
  - Its 113 tests run in CI.
- **The studio now animates the way the official animations do.** They were
  measured frame by frame first, and the findings are recorded in
  `packages/anim-studio/STYLE-GUIDE.md`. The main finding is that their icons
  move smoothly, by fractions of a pixel at 60 fps, rather than in whole-pixel
  steps. The studio gained:
  - keyframed motion (position, scale about an anchor, opacity) with easing
    curves;
  - 4 × 4 anti-aliasing and motion blur;
  - a glow layer for halos and dark spots;
  - a graded outline, highlight and anti-aliased corners for the plate;
  - gradient and shadow for text;
  - a one-line title face, Bold 9;
  - a loop-seam check under the timeline.

  Scenes default to 60 fps. Scene files saved earlier still open.
- **`pnpm probe:busybar --compositing`** measures whether an animated icon
  can play beside the app's text on the device. It builds a 16×16 test
  animation and reads the panel back twice for each case: side by side, under
  a transparent hole, above and below an opaque image by `z_index`, and with
  the text replaced mid-play. On firmware 1.2.3 all of them work, so a
  notification icon can animate with no per-frame traffic. The check draws
  above the app at priority 100, so it runs with SprintTicker open.
- **`scripts/lib/busybar-device.js`**, the device client and PNG encoder, is
  split out of the probe so the probe and the studio share one copy.

### Fixed

- **An expired Jira token no longer empties your project list.** Jira Cloud
  does not refuse a token it no longer accepts: it answers as if to an
  anonymous visitor, and an anonymous visitor sees no projects and no issues.
  The app took that for the truth and cleared its local lists at every sync,
  with nothing in the log. It now checks the credentials first, so a rejected
  token fails the sync with a message and leaves your projects and tasks as
  they were. Logged time was never lost -- tasks with history are archived,
  not deleted -- and the first sync with a working token brings everything
  back.
- **Toasts from an installed copy are attributed to SprintTicker.** The app
  told Windows it was `com.busybar.desktop` while the installer's shortcut
  says `io.github.istalry.sprintticker`, and Windows only shows a toast for an
  ID it can tie to a shortcut. Both now use the latter.
- **An animated icon no longer outlives its screen at the idle clock.** When a
  screen with an animated icon -- a notification banner, the paused
  stopwatch -- gave way to the idle clock, the icon stayed: alone in the
  on-screen emulator, and drawn back onto the bar over the firmware's clock.
- **The tray's "Trigger Task Selector Modal" opens the task picker.** It
  brought the window forward and nothing else: it sent its request on a channel
  the window does not listen on.
- **START on the bar no longer wraps up the day by mistake.** With the
  end-of-day window open but the bar showing something else -- the window
  opened from the top bar, or a higher-ranked screen on the bar -- START both
  paused the session there and armed the wrap-up in the window, and a second
  START confirmed it, shutdown included. The window now follows the bar's
  buttons only while the bar shows the wrap-up prompt, and the top-bar button
  puts that prompt on the bar.
- **Times follow Windows' regional format.** History, the sync queue, the
  notification log and Device Diagnostics showed times in US style (`2:05:33
  PM`) whatever the region set in Windows. They now use it: `14:05:33` for most
  of Europe.
- **SprintTicker names itself.** Windows' shutdown notice after an end-of-day
  wrap-up read "BUSY Bar End-of-Day Wrap-Up", and the tray said "BUSY Bar:
  TRACKING" and offered "Open BUSY Bar Dashboard" -- the device's name where the
  app's belonged. They now say SprintTicker, as the idle tooltip already did.
- **A session left running behind another one is recovered.** If the app ever
  stopped with two sessions open, only the newer one showed; the older one was
  never stopped and its time never logged. Upgrading closes it where the next
  session began and puts its time in Work History, marked as recovered and not
  sent to your provider. From then on the database refuses a second open
  session.
- **Work History names your tasks.** Each entry showed the provider's internal
  id -- Jira's `10001` rather than `SCRUM-2` -- and the daily summary guessed a
  key from the id and used the worklog's comment, usually "Completed session
  via SprintTicker", as the title. Both now show the task's key and title.
- **Time logged against a task is never left nameless.** A sync that no longer
  listed a task you had worked on, or deleting it or its project, deleted the
  task and left its hours pointing at nothing. Such a task is now archived:
  gone from the lists, still in history, back if the provider lists it again.
  Upgrading names the hours already orphaned from the sessions that logged
  them; none are dropped.
- **The end-of-day wrap-up takes two presses on the bar again.** Every press
  reached the app twice, so when the wrap-up window was open without the bar
  showing its prompt, a single START both said "yes" and confirmed -- running
  the wrap-up, and the shutdown if it was ticked. Device Diagnostics also
  listed every press twice.
- **The test suite no longer saves open Unity scenes.** The wrap-up tests
  asked every Unity Editor on the machine to save, as the real wrap-up does.
- **The test suite no longer changes the machine's git configuration.** On a
  machine with no global `core.excludesfile` -- a CI runner, a fresh checkout
  -- running the tests pointed it at a temporary file the tests then deleted.
  The app's own "set up global gitignore" behaves as before.
- **A notification that waited its turn is no longer wiped the moment it
  shows.** When two arrived together, the second was queued behind the first
  -- and when the first ended, the second was drawn and then immediately
  replaced by the screen underneath. With no task running and the bar's own
  clock enabled for idle, it vanished outright.
- **The end-of-day dialog offers the wrap-up again when reopened.** Once a
  wrap-up had completed, every later opening -- the next evening's prompt, or
  the header button -- showed "Day Complete!" until the app restarted.
- **A sync no longer throws the task picker back to step 1.** The picker reset
  itself whenever the project list changed, so a sync landing while you were
  choosing a task started the choice over.
- **Work History copes with a failed read and with fast date changes.** A read
  that failed left "Loading session history..." up for good, and stepping
  through days quickly could show the worklogs of a day no longer selected.
- **Finishing a task from the app plays DONE! once.** Both finish dialogs
  asked the bar for the scene after the stop had already played it, so it
  started twice: two uploads of the same file, the second over the one the
  bar was playing. The desktop confetti is unchanged.
- **The bar no longer freezes after a few lunch, away or meeting screens.**
  Starting one of those scenes cleared the whole display first, and on
  firmware 1.2.4 clearing it while a picture and an animation are both on it
  hangs the bar within three or four times -- a screen with an animated icon,
  followed by a scene, is exactly that. Scenes now slide in under the current
  screen and out under the next one, so the display is never emptied to
  change screens. Handing the display back for the idle clock or at quit
  still clears it, but takes every animation down first and gives the bar a
  moment before the clear.
- **An animated icon no longer changes colour as it starts.** The icon
  generator quantised colours to keep the palette small, which moved most
  icons off the still icon they replace: the end-of-day clock's purple came
  back as `#9555FF`, the bell's orange shifted, and the gear, hammer and bulb
  did not match at all. Every first frame is now the still icon exactly, and a
  test compares the two.
- **`&` reads as an ampersand** in both row fonts. It was a 4px checkerboard;
  it is now a small loop over a crossing stroke with a tail, 5px wide like `M`
  and `W`.
- **`pnpm probe:busybar --font-sheet` shows every glyph whole.** It put two
  lines on every page, which is 19px of Sprint Bold 9 on a 16px panel, so the
  second line lost its bottom rows; it now fits as many lines as the font's
  height allows. And the animation check left its element on the panel for
  30 seconds, so the Sprint 5 sheet drawn next failed its readback by some 850
  pixels with nothing wrong in the font. Both checks now start from, and
  leave, a clear panel.
- **The emulator no longer plays the bar's animations at a quarter speed.**
  While the bar plays an animation itself, the on-screen preview ticks at 15
  fps; it stepped through every frame of a 60 fps scene, so Lunch, Away and
  Meeting crawled on screen while the bar ran at full speed. It now skips
  frames to keep time, and a scene played once ends on the same frame as the
  bar.
- **The `.anim` compiler's licence is recorded.** `scripts/busybar-anim-toolchain/`
  is the firmware's own `seq2anim.py` and helpers, GPL-2.0-or-later, and had
  been copied in with no notice. The folder now carries the licence text and
  its provenance. `seq2anim.py` is marked as modified, since it accepts a
  directory and runs on Python older than 3.11. `LICENSE` and the README name
  it as the one part of the repository that is not MIT. Nothing changes for the
  app: the toolchain runs at build time and is not in the installer.

- **Animations reached the bar and were then painted over.** Lunch, Away and
  the meeting screens showed nothing on the hardware while the on-screen
  emulator animated correctly. Two separate defects, both now fixed:
  - `AnimationPlayer` chained `.then().catch()` on driver calls that report
    failure by returning `false`, so a device that refused the file ran the
    success path and logged nothing. The calls are awaited and checked, the
    file and its byte count are logged on refusal, and a refusal now falls back
    to streaming PNG frames instead of leaving the bar blank.
  - Once that was fixed the bar was still black, because every animated mode
    clears its canvas, starts the animation and then transmits the blank
    canvas. That transmission draws `px_matrix_img`, a full-panel opaque PNG
    which the firmware composites **above** the animation element whichever
    order the two arrive in — a draw merges by element id rather than replacing
    the element set, so drawing the animation second does not displace it.
    `AnimationPlayer` now clears the display before handing over the `.anim`,
    and `DisplayRenderer` does not transmit a front frame while the device owns
    playback. Both measured against a real bar on firmware 1.2.3 by replaying
    the two draws and reading the panel back.
  - A failed clear now also falls back to streaming, since the animation would
    otherwise sit under the stale frame. So does a `409` on the animation draw,
    so the animation reaches the bar once the display is released.
- **A frame the device refused was never sent again.** The renderer skips a
  frame identical to the last one it sent, and it was meant to forget that frame
  when sending failed. The forgetting sat in a `.catch()` on a call that
  reported failure by returning `false`, so it never ran. The bar kept whatever
  it had until the picture changed, which is up to a minute for the timer and
  never for a static screen. The frame is now resent on the next render. After a
  `409` it is deliberately not resent, so a display held by another application
  does not receive a re-upload on every tick.

### Changed

- **OpenProject notifications on the bar follow the new settings.** They used
  to replay every unread notification on the bar at each launch, and could
  only be switched off as a whole. They now start from the moment you turn
  them on, honour the per-kind choices, and arrive as one banner per check
  rather than one per notification. An upgrade keeps the old on/off switch and
  interval.
- **`ws` 8.22**, the WebSocket client behind the bar's live status, and one
  of the two packages the installed app carries.
- **Development tools updated, and `pnpm audit` is clean again.** ESLint
  10.11, typescript-eslint 8.71, Vite 8.3, Vitest 5.0.3, wait-on 9.5 and
  marked 18.0.14; `@types/node` 24.19 and `@types/ws` 8.18.2. Twenty-five advisories had built up in
  tools several levels down -- axios and joi under `wait-on`, brace-expansion
  under ESLint and electron-builder, fast-uri under electron-builder -- none
  of them in the installed app. A lockfile refresh cleared most; the overrides
  in `pnpm-workspace.yaml` were raised for the rest. Dependabot no longer
  proposes `@types/node` majors: the types follow the Node 24 that Electron
  ships, and move with it.
- **Building from source no longer needs a C++ toolchain.** better-sqlite3 13
  ships one prebuilt binary that Node and Electron both load, so the rebuilds
  that ran before every `pnpm test` and `pnpm dev` did nothing, and are gone,
  along with the Visual Studio Build Tools requirement. Python is still needed
  to compile animations. Packaging skips electron-builder's native rebuild for
  the same reason, which also drops the Visual Studio project files it left
  behind from the installer. The pre-flight check, which looked for a compiled
  binary that no longer exists and warned on every run, now checks the
  prebuild that ships.
- **A much smaller installer.** The app inside it went from about 73 MB to
  about 5 MB. It had been carrying React, the icon set and the fonts twice --
  once bundled, once as the source they were bundled from -- plus SQLite's
  source code, database binaries for macOS and Linux, a library the app never
  used, and compiled files left over from July.
  It also carries only Chromium's English UI translation rather than all 55,
  which takes the installer from 103 MB to 95 MB. Nothing in the app was
  translated, so nothing on screen changes.
- **React 19.** The renderer moved from React 18, and `lucide-react` from
  0.359 to 1.48 with it, since the old icons capped React at 18. Nothing
  should look different.
- **Lunch, Away and the stand-up play our own animations.** Lunch is a
  sandwich stacking itself layer by layer; Away is a steaming coffee; the
  stand-up is three people round a table, speaking in turn under speech
  bubbles. Each has its own plate colour -- teal, purple, blue -- so the mode
  reads at a glance. They replace the firmware's salad, "back soon" and
  meeting frame sets, which are removed (below). All three were drawn in the animation studio in the official
  animations' style, 60 fps with smooth, anti-aliased motion, and play on the
  device from a `.anim` with PNG streaming as the fallback, as before. A new test fails if an animation the app names has no folder behind
  it, which would otherwise show as an empty panel and a log warning.
- **The front display's text is set in our own fonts.** Row 1 used a
  fixed-width 3×5 font with 40 characters, so `( ) , ' " # + @ & =` and the rest
  of the punctuation reached the bar as `?`. It cut a row at fourteen characters
  with no marker, so "PROJ-142: Write the notes" showed as "PROJ-142: Writ", and
  its `g` and `q` were the same bitmap. Row 0 used the firmware's own font, which
  read well but was OFL-1.1 and the one file in the app under another licence.
  Both are replaced, at the same size, by Sprint 5 (row 0) and the condensed
  Sprint Small (row 1):
  - both carry all of printable ASCII;
  - both are proportional and end a truncated row with `…`;
  - digits share one width, so a running timer does not shift.

  The fonts are drawn as ASCII art in `packages/desktop-app/fonts/` and
  compiled by `pnpm fonts:build`. The generator refuses a missing character, two
  identical glyphs or a blank edge column, and `fonts:check` runs in CI.
  `pnpm probe:busybar --font-sheet` shows every glyph on a real bar and checks
  the panel shows exactly the pixels sent.
- **The device driver reports failure by throwing.** `BusyBarDriver`'s commands
  answered `Promise<boolean>` and never threw, so a refusal looked like success
  to any caller that forgot to check. That shipped the blank-Away-animation bug
  twice: a `.catch()` on one of these calls could not run for the failure that
  actually happens. They now throw a `DeviceRequestError` that says why:
  `disconnected`, `unreachable` (with the transport cause), `too_large`, `busy`,
  `conflict` or `rejected`, plus the HTTP status. Two answers that are not
  failures come back as values instead: a draw refused with `409` resolves
  `'conflict'`, because another application owning the display is the device
  working as designed, and a pixel frame that was queued or superseded says so
  rather than returning the same `false` as a refusal. An ESLint rule now bans
  `.then(` in the hardware layer, the chained shape behind both incidents.
  `connect()` and `reconfigure()` still answer a boolean. They are probes, and
  "the bar is not there" is a normal answer for them.
- **ESLint 8 → 10, on flat config.** ESLint 8 is end of life. The target became
  10 rather than the planned 9 once the registry showed 9 as the `maintenance`
  tag. `.eslintrc.cjs` and `.eslintignore` are replaced by `eslint.config.mjs`,
  with every rule and comment carried across — the process-boundary rules and
  the curated type-aware ones are load-bearing, and a silently dropped rule is
  the real risk in a config migration. Verified by capturing the old findings as
  a sorted list and reproducing it exactly (150 files, 36 warnings, 0 errors),
  then deliberately breaking each rule to confirm it still fires. No behaviour
  change; developer tooling only.
- Three small findings from ESLint 10's stricter defaults: a disable comment
  naming `no-var-requires`, which was renamed and had stopped suppressing
  anything; an unused `catch` binding; a redundant initialiser.
- **`verify:packed` asserts what the packaged app does.** It used to prove only
  that the binary booted and something was listening on 39123 — true of a build
  with broken routing. It now accepts a Unity heartbeat and refuses both
  browser-shaped request forms, which is the boundary between a web page the
  user happens to be visiting and hardware this API can drive.
- **A provider can say it does not know how much time the remote holds.**
  `reconcileRemoteState` returns `remoteLoggedTimeToday: number | null`; Jira and
  ad-hoc return `null` where they returned a confident `0` they had not
  measured, and OpenProject returns `null` on a failed fetch rather than
  understating the day as zero.
- `preflight` compares all three `package.json` versions. It printed the root
  version and compared only the other two, so a drifted root passed silently.

### Removed

- **The `messaging:*` IPC channels** and `MessagingIntegrationService`, whose
  one live job -- polling OpenProject for the bar -- moved to the provider
  events above. The rest was a test banner for Discord, Slack and Gmail that
  no screen used any more.
- **The rear display modes.** Diagnostics, Performance and Stealth Clock, the
  setting that chose between them, and the emulator's rear screen. None of it
  ever reached the bar: the rear shows the firmware's own mirror of the front,
  twice the size, and its clock when the front is empty. Measured with the new
  `pnpm probe:busybar --rear`, and kept that way by choice.

- **The `provider:reconcile` IPC channel.** It was declared on the preload bridge
  with no handler in main, so calling it rejected — the same shape as the updater
  stub deleted in 1.0.0 (audit F-18). Nothing called it. The provider methods
  remain, so the day a UI wants a server-side day total the work is a handler
  plus a component.
- **The firmware font and its converter.** `shared/busy-font.ts` (OFL-1.1),
  `tools/lvgl-font-to-ts.js`, the old 3×5 table in `shared/pixel-fonts.ts` and
  the character-count helper `shared/text-capacity.ts`, all superseded by the
  fonts above. `LICENSE` no longer carries the OFL notice for a file the app
  does not ship.
- **The firmware's three animation frame sets**, `lunch_72x16`,
  `back_soon_72x16` and `meeting_72x16` (CC-BY-SA-4.0), replaced by our own
  (above). `Animations/` is now entirely MIT, so `LICENSE`, the installer's
  copyright line and the docs footer drop the CC-BY-SA notice. The installer
  also loses about 8.7 MB of frames it no longer plays.

### Fixed

- **A refused animation upload falls back to streaming frames instead of
  leaving the bar blank.** With a `.anim` file present the player hands the
  whole animation to the device and stops streaming PNGs, which is right when
  the device takes it. But `uploadAsset` and `sendDisplayPayload` report refusal
  by returning `false`, not by throwing, and the code chained
  `.then(...).catch(...)` — so a refusal ran the *success* path, asked the
  device to draw an asset it had never stored, and fired neither handler. The
  result was a blank bar, an on-screen emulator animating perfectly (it is fed
  by a separate callback that never touches the device), and a log whose only
  line said the animation had loaded. Both results are now checked, the failure
  names the file and its size, and playback degrades to the frame-streaming path
  that animations without a `.anim` already use.
- **An unreachable bar says so, instead of reporting itself connected.**
  `connect()` set `isConnected = true` even when both status probes got no
  answer, so an unplugged device showed as connected until the ping loop quietly
  flipped it back three seconds later. Every failure path was silent: the
  transport error was discarded, and the ping loop's `catch` set the flag with no
  log. The net effect was that a diagnostics export sent in to ask *why the bar
  would not connect* contained no evidence of the connection failing at all.
  - The failure reason is kept and reported — `timed out after 2000ms`,
    `ECONNREFUSED`, `EHOSTUNREACH` — taken from the `cause` of Node's fetch
    error, since the top-level message is only ever `fetch failed`.
  - Connection **loss** is now logged as well as recovery, so both edges of an
    outage appear, plus a throttled reminder every ten minutes while down. Not
    every failed ping: at one every three seconds that would put 1200 lines an
    hour into a 2000-line ring and flush out every other diagnostic.
  - A device that answers but returns a non-2xx for the status endpoints is
    still treated as present, because a firmware that does not serve
    `/api/status` is still a usable bar. That case now warns that telemetry is
    unavailable rather than displaying a confident 0% battery.
  - The test covering this asserted the old behaviour by name —
    `..._StillConnectsDegraded` — so it passed while pinning the defect in
    place. It now asserts the corrected behaviour.
- **The top bar fits the window.** It needed roughly 1850px to lay out, so it
  overflowed and clipped its right-hand controls at the app's own 1200px default
  size — the connection status and EOD button were simply cut off unless the
  window was maximised. The three header groups were all sized by their content,
  and the LED matrix was fixed at 505px, so nothing could yield.
  - The emulator now absorbs the slack instead of dictating the width, and the
    matrix scales itself from 6px LEDs down to 3px on whole-pixel steps, so the
    diodes stay aligned while the window is dragged.
  - Below four thresholds the least useful things step aside in order: the rear
    OLED preview (preview-only in this build), then the "Ping:" and "Setup
    Wizard" labels, then the remote pad and the remaining labels. Everything
    that loses a label keeps a tooltip, and connection state stays readable from
    the icon colour and the pulsing dot beside the logo.
  - The remote control pad is hidden *last* rather than first: `injectRemoteKey`
    exists nowhere else in the renderer, so it is the only way to drive hardware
    input without a bar attached.
- **The first-run wizard's provider step saves what you choose.** It never did:
  the provider dropdown and the fallback-ticket field were local state nothing
  read, so completing the wizard configured nothing and the app stayed on its
  default. It now persists the choice, reinitialises the providers and starts a
  sync, so the Projects list fills instead of coming up empty. Jira is offered
  alongside OpenProject and ad-hoc, and each collects the credentials it needs
  to work — a Jira user no longer has to pick something else and then find the
  provider in Settings.
- **The diagnostics export reports facts instead of asserting them.** The bundle
  users attach to a bug report claimed `appVersion: "1.0.0"` on every release
  after 1.0.0, fell back to Electron `"30.0.0"` on a build running Electron 44,
  and hardcoded `webhookServerStatus.listening: true` — asserting the Unity
  listener was up in precisely the bundle someone sends when it is not. The
  version now comes from Electron, the listener state from the socket itself,
  and anything genuinely unknowable is reported as unknown.
- **`LoggerInterceptor.intercept()` is idempotent and reversible.** Called
  twice it captured its own wrapper as the "original", double-recording every
  line; there was also no way to put `console` back, which is a problem for
  anything that intercepts outside the main process.
- A deprecated `.substr` in the priority engine (audit F-36).
- An intermittent `Closing rpc while onUserConsoleLog was pending` teardown
  error that failed the coverage run while every test passed. The suite's console
  output was outrunning vitest's rpc channel at worker teardown. First addressed
  by stubbing `console` in the noisy fixtures; it recurred, so
  `disableConsoleIntercept: true` now sends console output straight to stdout
  and removes the forwarding that was the actual mechanism.

## 1.1.0 — 2026-09-08

Jira Cloud support, a readable notification banner, and the bar set in its own
font. Most of the fixes below came out of using the app rather than reading it,
which is noted where it matters — a defect found in daily use tends to be one
the test suite structurally could not see.

### Added

- **Jira Cloud provider.** Projects, issues, worklogs, and status changes by
  workflow transition. Configured with a site URL, account email and API token,
  and verified against a live site on both a Story and a Task.
  - Status comes from Jira's `statusCategory`, which every workflow has, so it
    needs no setup at all — unlike OpenProject, where the same mapping is three
    numeric status ids pasted in by hand.
  - Transitions are configured by **name**, because a Jira transition id only
    means anything inside one workflow.
- **A visible sync queue** (Task Providers). Every worklog that has not reached
  the provider, with the server's own message, the attempt count against the
  ceiling, and when the next attempt is due. Plus *Sync Now* and *Retry
  Failed*, the latter for repairs no settings form can detect — a re-created
  issue, a corrected workflow.
- **Which tasks to fetch is now a setting**: assigned to me, everything open,
  or a custom query. Each adapter renders it in its own dialect, JQL for Jira
  and a filter array for OpenProject.
- **Per-app notification icon override**, reachable from the Notifications
  panel. The field existed and was honoured; nothing could set it.
- **A "sender only" mode for notification sources**, so a channel can show that
  a message arrived without showing what it said.
- `pnpm probe:jira-worklog <ISSUE-KEY>` — measures the shortest worklog a real
  Jira site accepts, since the app's 60-second floor is an inference from
  Jira's documented granularity rather than a measurement.

### Changed

- **The notification banner shows the message.** It used to draw one centred
  row of eleven characters and spend ten of them on a bracketed channel label
  the app icon already conveyed, so a Slack message reached the bar as
  `[Message]…`. It now uses the same icon-and-two-rows template as every other
  screen, at the same one frame upload.
- **Row 0 is set in the BUSY Bar's own font**, ported from the firmware. The
  previous hand-rolled font was 3px of ink in a 4px cell drawn at a 5px stride,
  which left two blank columns between every character and gave `#` nowhere to
  draw. The 55px field now holds about 14 characters of mixed case where it held
  11 of anything. This adds one **OFL-1.1** file; see `LICENSE`.
- **Provider credentials are encrypted at rest** via Electron's `safeStorage`.
  A key already on disk in plain text is upgraded the first time it is read, and
  every failure mode degrades rather than losing the key.
- **A finished worklog is sent immediately** rather than waiting out the
  five-minute sync interval. Safe now that the queue has atomic claims; it was
  not when the interval was introduced.
- **Every provider request has a timeout**, and only GET/HEAD/OPTIONS are
  retried — a worklog POST has no idempotency key, so repeating it after a lost
  response bills the session twice.
- **A provider reports failure by throwing**, never by returning an empty list.
  An empty list is indistinguishable from "this user has no tasks", and the sync
  worker prunes against it.
- The debug panel draws real screens through the real renderer instead of
  hand-built payloads in a vocabulary the main process had stopped emitting.
- Dropped three animation sets nothing played (`coding`, `dnd`, `on_call`),
  about 3.8 MB of Git LFS traffic on every clone and CI checkout.
- Removed the last of the scrolling-text support, which nothing produced.

### Fixed

- **Finishing a task with the bar's own buttons left it in progress.** Both
  hardware paths logged the time and skipped the completion — including the
  wheel's default selection, so it was the press made without scrolling.
- **Marking a task done un-did itself on Jira.** Completing fires the configured
  transition rather than closing the issue, which lands it in To Review; that
  read back as in-progress and the next sync overwrote the local row.
- **The bar showed `10001: Active Task`** — Jira's internal issue id next to a
  placeholder — where the task row held `SCRUM-2` and its real title all along.
- **Accented characters reached the bar as `?`.** The transliterating sanitiser
  existed but the rasterised front display never called it.
- **A request the server had already refused was retried.** A 404 for a deleted
  issue and a 400 for a rejected payload each spent the full retry budget
  sending byte-identical requests. Any 4xx is now permanent except 408 and 429.
- **A session too short for the provider to record is no longer queued.** Jira
  cannot store less than a minute, and such a row could never be delivered.
  The session is still kept in local history.
- **The task list ignored status changes** until the tab was left and re-entered.
- **A Discord notification was titled `squirrel.discord…`** instead of Discord.
- **The end-of-day prompt could be cancelled by the stand-up prompt** having
  already stamped the day as handled.
- OpenProject was still being dialled once a minute after switching to Jira,
  printing a full stack trace each time for a server neither running nor in use.
- Auto-save was dead in development, silently.
- The pixel editor (`pnpm editor`) had been opening to an empty palette after
  its bitmap module moved.
- Pagination is walked to the end of every collection, and throws on reaching
  its page cap rather than returning a partial list — a short list is exactly
  what makes the sync worker prune.

### Notes

- The rear 160×80 OLED remains preview-only.
- `reconcileRemoteState` is declared on the preload bridge with no handler in
  main; calling it from the renderer rejects. Unchanged in this release.

## 1.0.0

First published release. Unsigned NSIS installer and portable executable, built
by CI on a `v*` tag.
