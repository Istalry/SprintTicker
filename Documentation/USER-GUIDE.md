# User guide

Using SprintTicker day to day.

Installation is in the [README](../README.md#installation). This picks up from
first launch.

---

## First run

The onboarding wizard opens automatically. Three steps:

**1. Hardware.** Plug the BUSY Bar in over USB. It presents a virtual Ethernet
adapter and always answers on `10.0.4.20`, so there is nothing to configure —
press **Test Ping** to confirm the link. A failure here is reported as a failure;
it never congratulates you on a connection it did not make.

No bar? Run `pnpm dev:mock` (or launch with `--mock-hardware`) and the on-screen
emulator shows what the device would display.

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

---

## The panels

Nine tabs down the left.

### Active Session

The main screen. Start a task, and the bar shows it. Pause, resume, and finish
from here.

Finishing asks for a comment and whether to mark the task done. Marking it done
fires your configured completion transition — which in Jira usually means "To
Review", not "Closed", because you send work for review rather than closing it
yourself.

### Projects & Tasks

Your cached projects and their tasks, refreshed from the provider. Create local
ad-hoc tasks here for work that has no ticket.

The cache is what the app and the bar read. If it looks stale, **Sync Now** in
Task Providers refetches it.

### Work History

Worklogs by date, with a daily summary and an end-of-day export.

**A worklog is written locally whether or not the remote accepted it.** If Jira
refused a 40-second session, the time is still in your history — it just is not
in Jira.

### Task Providers

Credentials, the completion transitions, and which tasks to fetch — assigned to
me, everything open, or your own query (JQL for Jira, a v3 filter array for
OpenProject).

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

### Ceremonies

Working hours, and the three scheduled events:

| | Default | Does |
| :--- | :--- | :--- |
| **Stand-up prompt** | 09:30 | Prompts you, and collects answers in a modal |
| **Lunch** | 12:30–13:30 | Switches to Lunch mode |
| **End-of-day wrap-up** | 17:30 | Prompts to wrap up; can save open editors and schedule a shutdown |

Both prompts can be confirmed or dismissed **from the bar itself** — see the
hardware controls below.

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

A 72×16 RGB matrix: a 16px icon on the left, then two rows of text. Row 0 is the
firmware's own proportional font (roughly 14 characters of mixed case in the
55px field); row 1 is a fixed 3×5 font.

> [!NOTE]
> **Why the timer shows HH:MM**
>
> Every frame is an asset upload plus a draw — two HTTP requests. A per-second
> redraw would mean an upload a second for a digit nobody reads, so the tracker
> deliberately shows minutes.

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
The second row shows the task key.

**During a ceremony prompt**, START confirms and BACK dismisses. The end-of-day
wrap-up asks twice — the first START is "yes", the second confirms — because it
can shut your machine down.

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
> Two things do work. An **in-place repair upgrade** of Windows rebuilds the
> driver stack. Or, without touching Windows, pass the USB device through to
> another network stack — WSL2 with `usbipd-win`, whose `cdc_ncm` driver brings
> the adapter up without complaint — and proxy the bar back to a local address.
>
> If you take the proxy route, **put that address in Settings › Device →
> Connection**. That is what the setting is for: the bar is then reachable at,
> say, `10.0.4.21`, and the app needs to be told.

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

**The bar shows something stale.** Something is holding the display lock at a
higher priority. Check Priority Rules and your current mode.

**Windows warns on first launch.** The build is unsigned. *More info → Run
anyway*. There is no way around it short of a code-signing certificate.

**Accented characters.** These are transliterated to ASCII (`é` → `e`), because
the device accepts printable ASCII only. Emoji do not render.

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
