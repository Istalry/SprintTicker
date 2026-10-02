# User guide

Using SprintTicker day to day.

Installation is in the [README](../README.md#installation). This picks up from
first launch.

---

## First run

The onboarding wizard opens automatically. Three steps:

**1. Hardware.** First, whether you have a BUSY Bar. If you do, plug it in over
USB. It presents a virtual Ethernet adapter and answers on `10.0.4.20`, so there
is usually nothing to configure — press **Test Ping** to confirm the link. A
failure here is reported as a failure; it never congratulates you on a
connection it did not make.

If you do not, choose **Not now**: SprintTicker runs without one (see
[Without a BUSY Bar](#without-a-busy-bar)), and you can add a bar later.

Developing without a bar but wanting to see what it would show? Run
`pnpm dev:mock` (or launch with `--mock-hardware`) and the on-screen emulator
shows what the device would display.

**2. Task provider.** Choose OpenProject, Jira Cloud or ad-hoc, and enter the
credentials for the one you picked:

| Provider | What it needs |
| :--- | :--- |
| OpenProject | Domain URL, and an API key from *My Account → Access tokens* |
| Jira Cloud | Site URL, your account email, and a token from `id.atlassian.com` |
| Ad-hoc | Nothing — local tasks only |

You can leave credentials blank and add them later in **Task Providers**. Until
a remote provider is configured the app runs on local ad-hoc tasks. Completing
the wizard saves the choice and immediately fetches your projects.

The **fallback overhead ticket** (default `MISC-1`) is what ad-hoc time is
logged against — meetings, admin, anything without a ticket.

**3. Unity plugin.** Optional. Skip it if you do not use Unity.

### Without a BUSY Bar

Everything that keeps time works without the hardware: the task picker, the
running timer, pausing, finishing, worklog sync, history, the ceremonies and
the end-of-day wrap-up. What steps aside is what only describes the bar — the
on-screen emulator and connection readout in the top bar, **Priority Rules**,
which orders the bar's screen and nothing else, **Unity Engine**, whose
compile, Play Mode and error states exist to be shown on the bar, and
**Notifications**, which mirrors Windows notifications onto it. Notifications
*from* OpenProject still arrive, as Windows notifications; their settings are
in Task Providers. Events from the
Unity plugin are ignored in this mode, the Windows notification listener does
not run, and the setup wizard skips its Unity step. The end-of-day wrap-up still saves open Unity scenes. **Device Diagnostics**
becomes **Device & Logs**, keeping log export, the update setting and the
factory reset.

The app does not look for a bar in this mode, so it logs nothing about one being
unreachable.

To switch, use **Use without a bar** in Device Diagnostics; the bar is cleared
and handed back to its own clock first. To add a bar later,
press **Add a BUSY Bar** in Device & Logs: the address and token you had set
before are kept, and the bar's screens come back at once.

### The mini timer

A small window that stays above every other one and shows what the bar would:
the task key and title, the elapsed time, and a coloured edge -- green while
tracking, amber while paused, grey with nothing running. Open it with **Mini
Timer** in the top bar or **Show Mini Timer** in the tray menu.

- **Pause**, **Resume** and **Stop** act on the session as the dashboard does.
  Stop logs the time without marking the task done.
- The **list** button brings the dashboard forward with the task picker open:
  that is how you start or switch a task from it.
- Drag it by any part that is not a button. It reopens where you left it; if
  that was on a monitor you have since unplugged, it comes back in the
  bottom-right corner of the main one.
- It reopens at the next launch if it was open when you quit, and stays closed
  if you closed it.

It counts seconds, which the bar does not: on screen a second costs nothing.

---

## The panels

Nine tabs down the left.

### Active Session

The main screen. Start a task, and the bar shows it. Pause, resume, and finish
from here.

Finishing asks for a comment and whether to mark the task done. Marking it done
celebrates on the bar -- a green badge drops in, ticks itself, and throws
confetti beside **DONE!** -- then returns to the session. It also fires your
configured completion transition — which in Jira usually means "To
Review", not "Closed", because you send work for review rather than closing it
yourself. Stopping without marking it done shows **LOGGED** on the bar
instead: the time is kept and the task stays open.

### Projects & Tasks

Your cached projects and their tasks, refreshed from the provider. Create local
ad-hoc tasks here for work that has no ticket.

A task from Jira or OpenProject shows the start of its description under its
title, on one line. The task picker searches it too, so you can find a task by
what it is about.

The cache is what the app and the bar read. If it looks stale, **Sync Now** in
Task Providers refetches it.

### Work History

Worklogs by date, with a daily summary and an end-of-day export.

**A worklog is written locally whether or not the remote accepted it.** If Jira
refused a 40-second session, the time is still in your history — it just is not
in Jira.

Each entry is named by its task's key and title. **Deleting a task or a project
does not delete the time logged against it**: the task leaves your lists and
stays in your history. The same happens when your provider stops listing a task
you worked on — reassigned, closed or moved — and if it lists it again, it
comes back.

An entry whose comment starts **"Recovered:"** is a session an earlier version
left running behind another one. Its end is where the next session began, the
latest it can have run, so check it before copying it to a timesheet; it is not
sent to your provider.

### Task Providers

Credentials, the completion transitions, and which tasks to fetch — assigned to
me, everything open, or your own query (JQL for Jira, a v3 filter array for
OpenProject).

**Notifications from OpenProject** turns what happens on your work packages
into Windows notifications: assigned to you, a mention, a comment, a status
change, a date alert. Tick the ones you want. Clicking a notification opens the
work package in your browser. With a bar, they can go there too, as a banner
that competes for the display like any *Notification — Default*. The app
checks every minute by default (30 seconds to an hour); more than three at
once arrive as one summary. Only unread notifications that arrive after you
turn this on are shown -- what was already waiting in OpenProject is not
replayed -- and one you have read in OpenProject before the next check is not
shown either. **Send a test notification** shows what one looks like, and
says where it went.

Below the credentials is the **sync queue**: every worklog that has not reached
the provider, with the server's own message, the attempt count against the
ceiling, and when the next attempt is due.

| Button | Does |
| :--- | :--- |
| **Sync Now** | Fetches projects and tasks immediately |
| **Retry Failed** | Un-parks rows that gave up — use after fixing what broke them |

> [!NOTE]
> **Why a row parks**
>
> A row goes `FAILED` when the failure is permanent: a deleted issue, a revoked
> key, a session too short for the provider to record. Retrying those on a timer
> would send byte-identical requests forever, so the app stops and tells you
> why. **Retry Failed** is for after you have fixed the cause.

### Unity Engine

Discovered Unity projects and plugin injection. Once installed, the bar shows
compile progress, an "ON AIR" screen during Play Mode, and console exceptions.
The icons move. While scripts compile the gear turns; during Play Mode the
pad is played, its buttons going down and its stick pushed; a build shows a hammer striking and a lightmap
bake a glowing bulb; an exception shakes its warning triangle. Outside Unity,
a notification without an app logo rings its bell, the end-of-day prompt's
alarm clock rings, and the lunch prompt's burger hops. An OpenProject notification passes a shine across the OpenProject logo;
other apps' logos stay still. The bar animates them itself. If one ever shows still, the log's
`[IconAnimator]` lines say why, and the screen is otherwise unaffected.

### Ceremonies

Working hours, and the three scheduled events:

| | Default | Does |
| :--- | :--- | :--- |
| **Stand-up prompt** | 09:30 | Prompts you, and collects answers in a modal |
| **Lunch** | 12:30–13:30 | Switches to Lunch mode |
| **End-of-day wrap-up** | 17:30 | Prompts to wrap up; can save open editors and schedule a shutdown |

Both prompts can be confirmed or dismissed **from the bar itself** — see the
hardware controls below.

During Lunch the bar shows a sandwich building itself beside **LUNCH**, on
teal. In Away mode it shows a steaming coffee beside **AWAY**, on purple. At the
stand-up prompt, and while you track a stand-up task, it shows three people
round a table taking turns to speak, beside **MEETING**, on blue. Each loops
for as long as the mode lasts, and the bar plays it itself, so it keeps moving
when the computer is busy.

### Notifications

Which applications may reach the bar. **Nothing is mirrored until you allow it.**

Per app, choose one of three:

| Setting | Effect |
| :--- | :--- |
| **Don't Show** | Ignored entirely |
| **Default** | Claims the display at whatever *Notification — Default* scores |
| **High Priority** | Claims it at whatever *Notification — High Priority* scores |

Note what that means: an app is assigned to a **class**, and the Priority Rules
panel decides what that class is worth and how it behaves during Lunch and Away.
Nothing here hardcodes which app wins. In the shipped defaults those two classes
score 65 and 70, and a few common apps arrive pre-classified — Slack and the
battery warning as High Priority, Discord, Gmail and Windows as Default — but
all of it is yours to change.

Each app's real icon is resolved from its MSIX manifest or Start Menu shortcut
and downscaled to 15×15. If it picks the wrong executable — name matching is not
perfect — set an icon override on that app.

**Sender only** mode shows that a message arrived without showing what it said.

Notification text is redacted from logs and the diagnostics export. Launch with
`--debug-notifications` to see it while troubleshooting.

### Priority Rules

What the display shows when several things want it. Every claim has a score;
the highest holds the bar.

| Claim | Default |
| :--- | ---: |
| Away mode | 100 |
| Lunch mode | 95 |
| End-of-day wrap-up | 80 |
| Stand-up prompt | 75 |
| Notification — High Priority | 70 |
| Notification — Default | 65 |
| Unity build failure | 60 |
| Unity compiling | 55 |
| Unity Play Mode | 50 |
| Active task tracker | 45 |

Every row is editable, including what each does in each mode — **Display**,
**Suppress** or **Queue** for Work, Lunch and Away.

With the shipped ordering, notifications do not interrupt Lunch or Away. That is
the table working as configured, not a bug. Move the rows if you disagree.

### Device Diagnostics

Connection status, battery, firmware, the update setting, and the animation
debugger — marquee speeds, particle effects, LED colours and icon rasterisation,
live, drawn through the real renderer.

It also holds **Connection**, where you set the address the app dials and, if
your device needs one, an API token:

- **Device address.** Defaults to `10.0.4.20`, which is where the bar answers
  over USB. Change it for a bar on Wi-Fi, or when you are reaching the device
  through a proxy on another address. An IPv4 address or a hostname — no
  `http://`, no port, no path.
- **API token.** Leave empty for USB, where the bar accepts unauthenticated
  requests. Fill it in once the device has access protection enabled, which is
  the normal state over Wi-Fi; without it every request comes back 401 or 403.

**Save & Reconnect** applies both immediately — the app re-dials without a
restart. Watch the connection status at the top of the window to see whether the
new address answered; saving means the setting was stored, not that the bar
replied. **Reset to USB default** puts the address back to `10.0.4.20`.

---

## The bar itself

### What it shows

A 72×16 RGB matrix: a 16px icon on the left, then two rows of text, both in
proportional fonts drawn for SprintTicker. Row 0 holds roughly twelve characters
of mixed case in its 55px field. Row 1 uses a narrower face and holds about
fourteen.
Text that does not fit ends in `…`. Accented letters are shown without their
accents, since the display draws plain ASCII only.

The small screen on the back belongs to the bar itself: it shows a copy of the
front at twice the size, and its own clock and date when the front is empty.
SprintTicker draws nothing there.

The session screen's icon is a stopwatch whose colour says where you are: green
while a task runs, its hand ticking round once a second; amber with blinking
pause bars while it is paused; dim grey when nothing runs (the screen then
reads **Ready / No task running**). While a task runs, row 0 shows the task and
row 1 its time, in large digits. While paused, row 0 shows the task key and its time, and row
1 offers **STOP** and **FINISH** side by side; turn the wheel left for STOP,
right for FINISH -- turning further stays put -- and click to confirm. Picking
a task from the bar's own picker shows **GO!** for two seconds, the stopwatch
setting off, before the tracking screen. STOP logs the time and leaves the task open, and the bar shows
**LOGGED** for three seconds, the stopwatch's hand sweeping back to twelve;
FINISH also marks it done, and shows **DONE!**.

Unity screens all read the same way: what is happening on row 0 (with the
percentage for a build or a lightmap bake), the project on row 1, and for a
build or bake a thin progress line along the bottom. An exception shows its
message on row 1 instead of the project.

> [!NOTE]
> **Why the timer shows HH:MM**
>
> Every frame is an asset upload plus a draw — two HTTP requests. A per-second
> redraw would mean an upload a second for a digit nobody reads, so the tracker
> deliberately shows minutes. The stopwatch's ticking hand is the bar's own
> animation: it shows that the clock is running, and is not the seconds of your
> session.

### Controls

| Control | Does |
| :--- | :--- |
| **START** press | Start or pause. With nothing running, opens the task picker |
| **Wheel** turn | Scroll |
| **Wheel** click | Open the task picker |
| **BACK** short press | Dismiss the current notification |
| **BACK** long press | Complete the active task and log the time |

All of these are rebindable.

**The task picker** is two stages: turn to choose a project, click to descend
into it, turn to choose a task, click to start. **BACK** leaves at any point.
A blue folder means you are choosing a project, a checklist a task. The
checklist also gives the task's status: grey for to do, amber for in progress,
green for done, and a done task's name is dimmed. Tasks come in that order of
use: in progress first, then to do, then done, and within each the most urgent
first, by the priority set in Jira or OpenProject. The second
row shows the task key, followed by as much of its description as fits, and on
its right where you are in the list -- `3/12` --
with a thin line along the bottom whose bright segment slides from left to
right as you scroll: at the far left there is nothing before, at the far right
nothing after.

**During a ceremony prompt**, START confirms and BACK dismisses. The end-of-day
wrap-up asks twice — the first START is "yes", the second confirms — because it
can shut your machine down. Once it is done, the bar says **SEE YOU!** for five
seconds, a moon rising and the stars coming out, and then goes idle.

The bar's buttons answer the wrap-up only while the bar shows its prompt. The
**EOD Wrap-Up** button in the top bar puts the prompt on the bar too. If
something ranked above the wrap-up holds the bar -- Lunch, in the shipped
ordering -- the buttons keep doing what that screen says, and the wrap-up is
confirmed in the window.

---

## Troubleshooting

**The task list is empty.** Check Task Providers for a saved domain and key.
Press **Sync Now**; if it stays empty, the credentials are probably wrong — the
app deliberately does not invent tasks. A provider error is shown rather than
swallowed.

**A worklog never reached Jira or OpenProject.** Open the sync queue panel. The
row carries the server's own message. Common causes:

- *`404` — the issue no longer exists.* Nothing to do; the local worklog stands.
- *`400` — under a minute.* Jira records time to the minute; anything shorter
  rounds to zero and is refused. The time is in your local history.
- *`401`/`403` — the key was revoked.* Enter a new one; saving credentials
  automatically un-parks rows the old key stranded.

**Notifications never appear on the bar.** Three things to check, in order: the
app is set to something other than *Don't Show*; the notification listener is
running (Device Diagnostics reports its status — **its failures are otherwise
silent**); and nothing higher-priority holds the display, Lunch and Away being
the usual culprits.

**The bar never connects.** The header shows *Disconnected* and Device
Diagnostics reports no firmware or battery. The bar reaches the app as a **USB
network device on `10.0.4.20`**, so the question is whether that device exists
at all:

1. Open <http://10.0.4.20> in a browser. If the bar's own web UI loads, the link
   is fine and the problem is in the app — export the logs from Device
   Diagnostics and read the `[BusyBarDriver]` lines.
2. If the browser times out, run `ipconfig` (Windows) and look for an adapter
   holding a `10.0.4.x` address. **No such adapter means the bar is not
   enumerating**, and nothing in software can reach it.
3. Reseat the cable, and make sure it is a **data** cable rather than
   charge-only — a charge-only cable powers the bar, so its lights come on and
   it looks healthy while presenting no network device at all. Try a port
   directly on the machine rather than through a hub, and confirm the bar is
   awake.
4. On Windows, open Device Manager and look under **Network adapters** for
   *Flipper FZCO Network Interface*. A yellow warning triangle with **Code 10 —
   "This device cannot start"** means the bar is enumerating correctly and
   Windows' own USB network driver is refusing to bring the interface up. See
   the note below; this is not something the app can fix.

> [!WARNING]
> **Code 10 on the Flipper network interface is a Windows driver fault, not a
> bar fault or an app fault.**
> It has been reproduced on Windows 11 25H2 with an Intel 700-series USB
> controller, where the composite device enumerates cleanly, every descriptor
> reads back, and the network child still fails to start. The same bar works on
> another computer. Reinstalling the driver, switching to the alternate inbox
> NCM driver, `DISM`/`sfc`, clearing the USB descriptor cache and disabling
> selective suspend all change nothing.
>
> An **in-place repair upgrade** of Windows is the obvious next move, and on
> this machine it did not help: the upgrade completed, the driver store was
> rebuilt, Windows selected the same `usbncm.inf`, and the interface still came
> up with Code 10. Try it if you like, but do not count on it.
>
> **What does work is not using the Windows driver at all** — pass the USB
> device through to another network stack. WSL2 with `usbipd-win` brings the
> adapter up without complaint under its own `cdc_ncm` driver; proxy the bar
> back to a local address from there.
>
> Then **put that address in Settings › Device → Connection**. That is what the
> setting is for: the bar is reachable at, say, `10.0.4.21`, and the app needs
> to be told.
>
> One thing to watch if you go this route: a `usbipd` binding, and any watcher
> script that re-attaches the device on plug-in, will claim the bar before
> Windows can try. If you ever want to re-test the native driver, disable the
> watcher and `usbipd unbind` the device first, or you are only testing the
> passthrough.

> [!NOTE]
> **Export the logs; they now say what went wrong.** The driver records the
> reason it could not reach the device — `timed out after 2000ms`,
> `ECONNREFUSED`, and so on — and logs the moment a connection is lost or comes
> back. Earlier builds failed silently, so a diagnostics export sent in to ask
> "why won't it connect" contained no evidence of the failure anywhere.

**An animation plays in the app but not on the bar.** Fixed as of this
release, and worth knowing why, because the symptom is confusing: the preview
and the bar are fed by two different paths. The on-screen emulator draws every
frame locally, while the bar is handed the whole animation file and plays it
itself, so the preview kept animating while the bar showed nothing. Two causes,
both addressed — a refused upload that went unreported, and the app drawing its
own blank frame on top of the animation it had just started. If you still see
it, export the logs from Device Diagnostics and look for `[AnimationPlayer]`
lines naming the file and its size.

**The bar freezes and stops answering.** The panel stops changing, the app
reports the bar disconnected, and sometimes the bar restarts on its own about
45 seconds later. On firmware 1.2.4 this is what happens when the display is
cleared a few times while a picture and an animation are both on it. Earlier
builds did exactly that each time Lunch, Away or a meeting began from a screen
with an animated icon. This release switches scenes without clearing, so it
should not happen in normal use. If it does, unplug and replug the bar, then
export the logs from Device Diagnostics: the lines just before the freeze say
what the app was drawing. Uploads taking several hundred milliseconds, rather
than about fifty, are the warning sign.

**The bar shows something stale.** Something is holding the display lock at a
higher priority. Check Priority Rules and your current mode.

**Windows warns on first launch.** The build is unsigned. *More info → Run
anyway*. There is no way around it short of a code-signing certificate.

**Accented characters.** These are transliterated to ASCII (`é` → `e`), because
the device accepts printable ASCII only. Emoji do not render.

### No notification from OpenProject

- **Is it switched on, for that kind?** Task Providers › Notifications from
  OpenProject. **Send a test notification**: if it says it was sent and nothing
  appeared, the cause is on the Windows side.
- **Windows may be holding it.** Do Not Disturb, Focus, or SprintTicker turned
  off in Windows Settings › System › Notifications all hide toasts without
  telling the app. They still land in the notification centre.
- **It may have been read already.** Only unread notifications are shown; one
  read in OpenProject between two checks is not news.
- **The log says why a check failed** -- `[ProviderEvents] OpenProject events
  unavailable: ...` -- and a refused toast as `[Toasts] Windows did not show a
  notification`.

---

## Your data

One SQLite file: `%APPDATA%\SprintTicker\sprintticker.db`. Installing over a
previous version does not touch it.

Provider credentials are encrypted at rest with Windows' own keystore. If it is
unavailable, the app says so rather than failing silently; if the file is read
by a different Windows account, the key reads back as "not configured" and you
are asked to re-enter rather than shown a crash.

> [!NOTE]
> **No telemetry, no account, no server**
>
> The one outbound request is a daily update check against GitHub, which sends
> nothing about you and can be turned off in Device Diagnostics — turning it off
> stops the request being made, rather than hiding its result.
