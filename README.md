# SprintTicker

[![Quality](https://github.com/Istalry/SprintTicker/actions/workflows/quality.yml/badge.svg)](https://github.com/Istalry/SprintTicker/actions/workflows/quality.yml)

*A time tracker for the BUSY Bar.*

> Not affiliated with, endorsed by, or supported by Flipper FZCO. "BUSY Bar" is
> their product; this is a third-party companion app for it.

A Windows desktop companion for the **BUSY Bar** — a small USB device with a
72×16 RGB LED matrix on the front. The app tracks what you are working on and
puts it on the bar: the current task, a timer, Unity compile progress, and
Windows notifications from the apps you choose, arbitrated so the most important
thing holds the display rather than the most recent thing.

It ships with a Unity Editor package that pushes compile, Play Mode and console
events to the bar, and a canvas emulator so the whole thing can be developed
with nothing plugged in.

## What this is

- A **personal, single-user desktop app.** Everything lives in a local SQLite
  database and talks to one device over USB.
- **Windows-only in practice.** The notification listener drives PowerShell
  against the Windows Action Center database, and packaging targets `win-x64`.
- **Unsigned.** There is no code-signing certificate, so Windows SmartScreen
  warns on first launch. See [Packaging](#packaging).

## What this is not

- Not a team or multi-user product. No server, no account, no telemetry. The one
  request it makes is an update check against GitHub, which sends nothing about
  you and can be turned off — see [Updates](#updates).
- Not a general BUSY Bar SDK. It speaks enough of the device's HTTP API to do
  its own job; the device's own documentation is the reference.
- Not signed. Releases are built by CI and attached to a GitHub Release as a
  draft, but without a certificate SmartScreen warns on first run, so in-app
  updating stops at telling you a new version exists.

---

## Features

### Time tracking

Timestamp-based sessions with start / pause / resume / finish, a live tracker on
the bar, and a local worklog history with an end-of-day export. Persisted
through `better-sqlite3` with versioned schema migrations, so upgrading never
discards existing worklogs.

### OpenProject integration

Fetches projects and work packages over the REST API v3, updates a work
package's status when tracking starts or completes, and posts tracked durations
to `/api/v3/time_entries` as ISO 8601 durations.

Time entries go through an **offline sync queue**: if the server is unreachable
when you stop a session, the row stays `PENDING` with exponential backoff and is
dispatched when connectivity returns. Nothing billable is dropped because a POST
failed.

Local **ad-hoc tasks** cover work that has no ticket.

### Front display rendering

Everything on the front matrix is rasterised in the main process to a 72×16 PNG
and uploaded to the device: 16×16 app icons, scrolling task titles, notification
banners, compile progress bars, LED status colours and `.anim` animations.

Frames are hashed and identical frames skipped, so a tracking session sends
traffic on state change rather than on every tick.

A **canvas emulator** in the dashboard mirrors the same render, and
`pnpm dev:mock` runs the whole app with the hardware layer stubbed.

### Physical input

The rotary encoder and buttons decode into application actions — turn to scroll,
click to open the task selector, double-click to toggle play/pause, long press
for the daily ceremonies menu.

### Windows notifications with priority preemption

The app watches the Windows Action Center and mirrors notifications from apps
you allow onto the bar, with each app's **real icon** resolved from its MSIX
manifest or its Start Menu shortcut and downscaled to 15×15.

Every claim on the display carries a score, and the highest score holds it:

| Claim | Score |
| :--- | ---: |
| Away mode | 100 |
| Lunch mode | 95 |
| End-of-day wrap-up | 80 |
| Standup prompt | 75 |
| Notification — High Priority | 70 |
| Notification — Default | 65 |
| Unity build failure | 60 |
| Unity compiling | 55 |
| Unity Play Mode | 50 |
| Active task tracker | 45 |

Per application you choose `Don't Show`, `Default` or `High Priority`; the table
decides what that means in context. With the ordering above, notifications do
not interrupt Lunch or Away — that is the scores working as configured, and
every row is editable in the **Priority Rules** panel.

Notification text is **redacted from logs and from the diagnostics export** by
default. Launch with `--debug-notifications` to see it while troubleshooting.

### Unity Editor integration

A UPM package (`io.github.istalry.sprintticker`) posts compile state, Play Mode
transitions and console exceptions to the app's local HTTP server, and the app
discovers installed Unity projects and manages plugin injection.

### Ceremonies and schedules

Configurable working hours, lunch and away detection, a standup prompt with an
answer-collection modal, and an end-of-day wrap-up that can be confirmed from
the hardware **START** button or dismissed with **BACK**.

---

## Requirements

| | |
| :--- | :--- |
| **OS** | Windows 10/11 x64 |
| **Node.js** | `>=22.12.0` (`.nvmrc` pins `24.18.0`). Vitest 5 sets this floor. |
| **pnpm** | `>=11.0.0` (pinned to `pnpm@11.25.0` via `packageManager`) |
| **Git LFS** | **Mandatory** — see below |
| **Build tools** | Visual Studio Build Tools + Python, to compile `better-sqlite3` |
| **Hardware** | A BUSY Bar over USB — optional; `pnpm dev:mock` covers the rest |

### Git LFS is mandatory

`Animations/` is ~1,800 PNGs stored in Git LFS. Cloning without LFS installed
leaves every one of them as a **130-byte pointer file**, and because
`electron-builder` copies the folder verbatim into `extraResources`,
`pnpm package:win` then succeeds and ships an installer whose animations are
broken. Nothing errors; you find out on the hardware.

```bash
git lfs install
```

Run that **before** cloning. If you have already cloned without it, `git lfs pull`
repairs the working copy.

**If you only want to read the code, skip the download.** A full clone pulls
roughly 15 MB of LFS objects, and LFS bandwidth is billed to this repository's
owner against a 1 GB monthly allowance — about 65 clones. When it runs out, LFS
fetches fail for *everyone* and the repository looks broken to people who have
done nothing wrong.

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/Istalry/SprintTicker.git
```

That leaves `Animations/` as pointer files, which is fine for reading, editing
and running the test suite — nothing under `tests/` touches them. Run
`git lfs pull` before `pnpm dev` or `pnpm package:win`, or you get the silent
broken-animation build described above.

---

## Installation

```bash
git lfs install
git clone <repository-url>
cd SprintTicker
pnpm install
```

`pnpm install` compiles the native modules. `better-sqlite3` and `electron` are
listed under `allowBuilds` in `pnpm-workspace.yaml`, so no separate build
approval step is needed on pnpm 11.

### The native module ABI trap

`better-sqlite3` is a native addon, and Electron and Node.js use **different ABI
versions**. The scripts handle it — `pretest` rebuilds for Node, `predev`
rebuilds for Electron — but alternating `pnpm test` and `pnpm dev` rebuilds each
time. That is expected. A `NODE_MODULE_VERSION` mismatch means you skipped one;
re-running the script you actually want fixes it.

---

## First run

1. Launch the app; the onboarding wizard appears on first start.
2. The device answers at the fixed USB address `10.0.4.20`. There is no address
   or token to configure.
3. For OpenProject, open the **Task Providers** panel and enter your instance URL
   and an API key. Until you do, the app runs entirely on local ad-hoc tasks.
4. In the **Notifications** panel, choose which applications may reach the
   bar. Nothing is mirrored until you allow it.

Application data lives in Electron's `userData` directory. On Windows an
installed build uses `%APPDATA%\SprintTicker\sprintticker.db`.

---

## Updates

The app checks GitHub for a newer release and tells you when one exists. It does
not download or install anything: builds are unsigned, so every automatic update
would re-trigger SmartScreen and some would be blocked outright, which is a worse
route than the manual one it would replace. Installing over the previous version
is safe — the database lives in `userData` and an installer does not touch it.

**This is the app's only outbound connection.** One request to
`api.github.com` thirty seconds after launch and once a day after that, sending
nothing but the request itself — no identifier, no usage data, no telemetry.
Turn it off under **Device Diagnostics → Updates**, which stops the request being
made rather than hiding its result.

A check that fails says so. It never reports "up to date" when it could not find
out; the previous updater claimed to check and never did, and was deleted for it
(audit F-18). A real in-app updater is gated on a code-signing certificate — see
[ROADMAP.md](ROADMAP.md) §2.

---

## Development

```bash
pnpm dev
```

Starts the Vite dev server for the React UI on `http://localhost:3000`, watches
and rebuilds the Electron main and preload bundles, and launches the app. The
local HTTP server listens on `http://127.0.0.1:39123`.

With no hardware attached:

```bash
pnpm dev:mock
```

Equivalent to `MOCK_HARDWARE=true`, or `--mock-hardware` on a packaged build.
The driver logs what it would have transmitted and the canvas emulator shows the
frame.

### Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
```

`pnpm test` runs 439 tests across 42 files, covering the main and shared
process code; the renderer is not covered. `pnpm test:coverage` enforces a
threshold floor of 78% statements / 80% lines / 80% functions / 68% branches.

Those numbers used to read 80/70, and nothing regressed to change them:
`@vitest/coverage-v8` made AST-aware remapping the default after v1, and the
older provider counted a whole line as covered when any part of it ran. The
floor is a ratchet -- raise it, never lower it to make a run pass.

`pnpm preflight` runs the release pre-flight check.

### Conventions

Code standards, the process boundaries between main / preload / renderer, and
the BUSY Bar hardware contract the render path must not violate are all in
[CLAUDE.md](CLAUDE.md). Read the hardware contract before touching display code:
an 8-digit `#RRGGBBAA` colour is not a style preference, and a gradient with the
wrong number of stops reboots the device.

---

## Packaging

Windows x64, via `electron-builder`:

```bash
pnpm package:win
```

Builds both the NSIS installer and the portable executable into
`packages/desktop-app/dist-electron/`. Individual targets:

```bash
pnpm --filter @sprintticker/desktop-app package:installer
```

```bash
pnpm --filter @sprintticker/desktop-app package:portable
```

> [!WARNING]
> **Builds are unsigned.** There is no code-signing certificate for this
> project, so Windows SmartScreen shows "Windows protected your PC" on first
> launch — click **More info > Run anyway**. `electron-builder` reads `CSC_LINK`
> and `CSC_KEY_PASSWORD` from the environment, so the day a certificate exists,
> signing turns on with no change to the build configuration.

---

## Local HTTP API

The Electron main process hosts an HTTP server on `http://127.0.0.1:39123` for
the Unity Editor plugin.

| Route | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/unity/compile` | `POST` | Compilation state (`started`, `finished`) & progress bar display |
| `/api/v1/unity/playmode` | `POST` | Toggles "ON AIR" red display mode during Unity Play Mode (`entered`, `exited`) |
| `/api/v1/unity/console` | `POST` | Flashes red LED and displays exception details. Throttled to one event every 3s |
| `/api/v1/unity/heartbeat` | `POST` | Unity Editor C# plugin active connection heartbeat pings |
| `/api/input` | `POST` | Inject physical hardware key events (`up`, `down`, `start`, `ok`, etc.) |

### Security

Loopback is not a security boundary: any page in any browser on this machine can
POST to `127.0.0.1`, and this API can drive the hardware and inject input
events. Requests are screened before routing:

- **`Content-Type: application/json` is required.** A browser may send a
  cross-origin POST without permission only while the request stays "simple",
  which restricts it to form, plain-text and multipart bodies. Requiring JSON
  forces a CORS preflight, and no `Access-Control-Allow-Origin` is ever sent, so
  that preflight fails and the real request is never made.
- **Requests carrying an `Origin` header are refused.** Browsers set it, native
  clients do not.
- **Bodies are capped at 64 KB.**

This is not authentication. Any local program can still call this API; what the
checks close is the path from a web page you happen to be visiting to your
hardware. The server binds to `127.0.0.1` only and is never reachable from the
network.

---

## Unity Editor plugin

The monorepo includes a Unity Editor C# package connecting assembly compilation,
Play Mode transitions and console exceptions to the bar.

Validate the package structure — this checks the UPM manifest and Editor
scripts, and does not emit an archive:

```bash
pnpm verify:unity
```

To import it:

1. Open your Unity project (2021.3+).
2. **Window > Package Manager**.
3. `+` > **Add package from disk...**
4. Select `packages/unity-plugin/package.json`.

`BusyBarWebhookPublisher` and `BusyBarSceneSaveListener` initialise themselves
without modifying your scenes or project code.

---

## Tools

- **16×16 pixel art editor** — `pnpm editor` serves it at
  `http://localhost:39124`, for drawing and tweaking the icons the bar renders.
- **Icon downsampler** — `node scripts/convert-icons-pixelit.js`.
- **Fake OpenProject server** — `pnpm mock:openproject` serves an
  OpenProject-shaped API on `http://127.0.0.1:8099` that accepts any API key and
  paginates everything, so the provider layer can be exercised without an
  instance. Point **Settings → OpenProject** at it and you should see 25
  projects, the last named `Fake Project 25 (LAST)`. The same module backs
  `tests/provider-integration.test.ts`, so the automated check and the manual
  one cannot drift.
- **Animation debugger** — in-app under **Device Diagnostics**:
  marquee speeds, particle effects, LED colours and icon rasterisation, live.

Windows batch shortcuts for the common commands sit in the repository root:
`install.bat`, `run_editor.bat`, `package-win.bat`, `verify-unity.bat`,
`test-coverage.bat`.

---

## Repository layout

```
SprintTicker/
├── packages/
│   ├── desktop-app/       # Electron 44 + React 18 + Vite 8 + Vitest 5 + Tailwind + SQLite
│   └── unity-plugin/      # Unity UPM package (io.github.istalry.sprintticker)
├── Animations/            # .anim frame sets, CC-BY-SA-4.0 upstream (Git LFS)
├── Documentation/         # Hardware guide, captured samples, design history
├── scripts/               # Preflight, packaging and icon tooling
├── tools/pixel-editor/    # Standalone 16×16 editor (pnpm editor)
├── CLAUDE.md              # Code standards, process boundaries, hardware contract
└── ROADMAP.md             # What is planned, and what blocks it
```

---

## Documentation

- [BUSY Bar API & Display Technical Developer Guide](Documentation/BUSY%20Bar%20API%20%26%20Display%20Technical%20Developer%20Guide.md)
  — the display contract, written for this project.
- [Hardware samples](Documentation/hardware-samples/) — captured device payloads.
- [Design history](Documentation/design-history/) — the pre-implementation design
  documents. Kept for provenance and **not maintained**: where they and the code
  disagree, the code is right.

`Documentation/private/` holds third-party reference material this project did
not write — BUSY Bar's own OpenAPI specification and example app. It is
deliberately untracked; fetch it from [busy-app](https://github.com/busy-app) if
you want a copy.

---

## Known limitations

- **Windows only.** Nothing here has been run on macOS or Linux.
- **One device, one user.** The USB address is fixed at `10.0.4.20`.
- **The rear 160×80 OLED is preview-only.** The emulator draws it; nothing is
  transmitted to the physical panel.
- **OpenProject is the only remote task provider.** Jira is in the roadmap.
- **No automated releases and no in-app updates.**

---

## Contributing

This is a personal project, but issues and pull requests are welcome.

Before opening a PR, `pnpm lint`, `pnpm typecheck` and `pnpm test` must all
pass, and new behaviour needs a test. Follow the conventions in
[CLAUDE.md](CLAUDE.md).

---

## License

MIT — see [LICENSE](LICENSE).

The BUSY Bar hardware, its firmware and its official documentation are not part
of this repository and are not covered by that license.

`Animations/` is an exception worth knowing about: those frame sets come from
the BUSY Bar firmware and are (c) Flipper FZCO under **CC-BY-SA-4.0**, not MIT.
Adapting them means licensing the adaptation the same way. See
[LICENSE](LICENSE).
