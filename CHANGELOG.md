# Changelog

## Unreleased

Housekeeping after 1.1.0: regression cover for the Jira adapter, the last four
open audit findings triaged, and several surfaces made honest about what they
do -- the diagnostics bundle, the device connection, and the top bar all
reported something other than the truth, in three different ways.

### Added

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
  and the coverage floor is ratcheted to 83 / 74 / 84.5 / 85.
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
- **Generated documentation site.** `pnpm docs:build` renders the three
  Markdown documents into `docs/index.html` for GitHub Pages, and `pnpm
  docs:check` fails CI when the page and its sources have drifted.

### Changed

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

- **The `provider:reconcile` IPC channel.** It was declared on the preload bridge
  with no handler in main, so calling it rejected — the same shape as the updater
  stub deleted in 1.0.0 (audit F-18). Nothing called it. The provider methods
  remain, so the day a UI wants a server-side day total the work is a handler
  plus a component.

### Fixed

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
