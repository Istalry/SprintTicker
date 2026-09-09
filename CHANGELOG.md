# Changelog

## Unreleased

Housekeeping after 1.1.0: regression cover for the Jira adapter, the last four
open audit findings triaged, and several surfaces made honest about what they
do. No user-facing behaviour changes.

### Added

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
  and the coverage floor is ratcheted to 82 / 73.5 / 83.5 / 84.5.
- **`pnpm preflight` now runs in CI**, catching a version drift across the three
  `package.json` files when it is introduced rather than when someone tries to
  cut a release.

### Changed

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

- **The first-run wizard's provider step saves what you choose.** It never did:
  the provider dropdown and the fallback-ticket field were local state nothing
  read, so completing the wizard configured nothing and the app stayed on its
  default. It now persists the choice, reinitialises the providers and starts a
  sync, so the Projects list fills instead of coming up empty. Jira is offered
  alongside OpenProject and ad-hoc, and each collects the credentials it needs
  to work — a Jira user no longer has to pick something else and then find the
  provider in Settings.
- A deprecated `.substr` in the priority engine (audit F-36).
- An intermittent `Closing rpc while onUserConsoleLog was pending` teardown
  error that failed the coverage run while every test passed. The suite's console
  output was outrunning vitest's rpc channel at worker teardown.

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
