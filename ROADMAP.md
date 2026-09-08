# Roadmap

Phase 1 was cleaning: data integrity, a working quality gate, deleting dead
code, hardware and notification correctness, and documentation. That work is in
the repository's history.

`F-nn` references throughout point at `AUDIT.md`, the audit that started this
work.

This file is Phase 2 — what comes next, in order, and what has to be true first.
Each item states its blocking condition. An item whose blocker is unmet is not
"next up"; it is waiting.

---

## 1. Go public

**Blocked on:** the pre-flight checklist below, all of it.

The repository is intended to be public. Everything on this list is
irreversible once it is — a force-push does not retract a fork, and unreachable
objects survive on GitHub's servers.

- [x] **Personal data purged from history** (2026-09-05). A 3.9 MB `-wal` file
      captured from `wpndatabase.db` had been sitting in the history with ~1,175
      real toast records — Slack channel names, work item titles, shell fragments. Also in
      history: `coverage/**` (recommitted a dozen times), `__pycache__`,
      `__MACOSX`, deleted `Unity_AutoLinker*.ps1` scripts carrying an employer
      path, and the third-party BUSY Bar documentation that was removed from
      the working tree in Phase 1. One `git-filter-repo` pass covers all of it.
- [x] **Commit authorship rewritten** (2026-09-05). Every commit had been
      authored under a corporate address on what is a personal project; all 75
      are now `Istalry <7848814+Istalry@users.noreply.github.com>`, author and
      committer. Same `git-filter-repo` pass, one force-push.
- [x] **`Animations/` provenance confirmed.** They are the BUSY Bar firmware's
      own frame sets, (c) Flipper FZCO under CC-BY-SA-4.0, which permits
      redistribution with attribution. `LICENSE` carries the notice. The
      ShareAlike condition is worth remembering before anyone edits a frame:
      the edit, not the app, becomes CC-BY-SA-4.0.
- [x] **No credentials in history.** A scan of all commits found only test
      placeholders (`my_secret_token`, `<cloud-token>`), before and after the
      rewrite. The `secrets` job in `quality.yml` runs gitleaks over the full
      history on every push, so this stays checked rather than being a one-off.
- [x] **CI green on a fresh clone.** Run #25 on `7d026bc` (2026-09-07): all
      three jobs green in 1m58s — lint and typecheck, 377/377 tests across 35
      files, and gitleaks reporting no leaks. The ten annotations are the known
      renderer floating-promise warnings, not errors.

      Note for anyone reproducing it: clone somewhere outside `%TEMP%`. MSBuild
      refuses to build `better-sqlite3` with its output under the temp directory
      (MSB8029, then a C1083 on the generated `sqlite3.c`), which looks exactly
      like a repository defect and is not one.
- [x] `SECURITY.md`, issue and PR templates, `CODEOWNERS`, `dependabot.yml`.
- [x] **Private vulnerability reporting enabled** (2026-09-07), at the same time
      as the repository went public. It cannot be switched on before then -- the
      feature does not exist for private repositories -- and `SECURITY.md`
      sends reporters to `/security/advisories/new`, which 404s until it is on.
      Flipping both together meant there was never a window with a public
      repository and no private channel.
- [x] Enable **Dependabot alerts** (2026-09-07). 0 open, 95 closed. Separate
      from `dependabot.yml`, which schedules version bumps; alerts fire on
      published CVEs. Code scanning needs an Organization and is out of reach.
- [x] **No outbound requests** (F-30). Inter and JetBrains Mono are bundled
      from `@fontsource`, latin subset only. The pixel editor uses system font
      stacks. `git grep fonts.googleapis` returns nothing.
- [x] **Content-Security-Policy and navigation guards** (F-31).
      `default-src 'none'` with explicit allowances, injected into the built
      HTML by a Vite plugin so the dev server keeps working; `sandbox: true`;
      `setWindowOpenHandler` and `will-navigate` both deny. Verified against a
      packaged launch with `ELECTRON_ENABLE_LOGGING=1`: no violations.
- [x] **Neutral schedule defaults** (F-38), and the alias duplication behind
      them (F-37).

---

## 2. Release automation and in-app updates

**Shipped.**
[v1.0.0](https://github.com/Istalry/SprintTicker/releases/tag/v1.0.0) was
published on 2026-09-07: an NSIS installer and a portable executable, built by
CI from `27e7601`.

Until then you had to clone and build, which was a real adoption barrier and the
reason nobody but the author had ever run a packaged build. The release was
verified by downloading and installing the published artifact rather than a
local one — the packaged app had never been exercised that way, and packaging,
ABI and LFS failures in this repository have historically only appeared there.

- [x] **`build-windows.yml`** producing the NSIS installer and portable
  executable, attached to a GitHub Release on a `v*` tag (2026-09-07).
  - **CI drafts; publishing stays manual.** The assets are unsigned, so
    SmartScreen warns on first run, and that deserves a release note and a
    look at the build before anyone downloads it. v1.0.0 was reviewed and
    published by hand the same day.
  - The tag is checked against `package.json` *before* the build, because
    electron-builder names every artifact from that file — a mismatched tag
    would otherwise produce a v1.1.0 release full of 1.0.0 files, after paying
    for the whole build first.
  - Re-running a tag build replaces the assets rather than failing on the
    existing draft.
  - Workflow artifacts are kept for manual runs only. Each build is ~236 MB
    across the two executables and a free account has 500 MB of Actions storage,
    so retaining a second copy of what the release already holds would fill the
    quota in two tags.
  - `latest.yml` is attached now, at 349 bytes, so it is already in place when
    there is a certificate and an updater to read it.
  - `lfs: true` is **mandatory** on this job — see the LFS note in the README.
    Cache `.git/lfs` with `actions/cache`; the free tier's **1 GB/month
    download** cap is the binding constraint, not storage, and an uncached
    `lfs: true` checkout burns through it in roughly 77 runs.
  - Signing stays out of the build configuration. `electron-builder` reads
    `CSC_LINK` / `CSC_KEY_PASSWORD` from the environment, so adding two repository
    secrets is the entire change on the day a certificate exists.
- **`electron-updater`.** `electron-builder.json` already stages `publish`
  (`github`, `draft`) — it emits `latest.yml`, which is harmless without an
  updater and required with one, and CI always passes `--publish never`.
  - [x] **Notification-only checking shipped** (2026-09-07). The app asks the
    releases API whether a newer version exists and says so; it downloads and
    installs nothing. `/releases/latest` returns only published, non-draft
    releases, so the drafts CI produces stay invisible until reviewed.
    - A failed check is reported as a failure. The previous `AutoUpdateManager`
      logged "checking for updates" and never checked (audit F-18), so the
      checker throws when it could not find out and the caller shows the reason
      — it can never resolve to "up to date" by accident.
    - It is the app's only outbound request, so it is a documented setting that
      stops the request rather than hiding the result, and README and
      SECURITY.md now say what it sends. The Google Fonts removal (F-30) was
      about an *undisclosed* connection; this one is disclosed and refusable.
    - The URL passed to `shell.openExternal` is checked against this
      repository's prefix. An `openExternal` that opens whatever it is handed
      launches arbitrary protocol handlers.
  - **Still to do: the actual download.** Unsigned auto-updates re-trigger
    SmartScreen every time and some are blocked outright, so installing in-app
    would be worse than the manual route. This becomes `electron-updater` on
    the day a certificate exists, and `latest.yml` is already attached to
    every release so that day needs no release-side change.
  - `nsis.differentialPackage` is **off** deliberately. Differential updates
    need a signed, published baseline to diff against; against unsigned draft
    releases the blockmap is dead weight in every artifact. Turn it on with the
    certificate, not before.
  - The rationale above cannot live in `electron-builder.json`: electron-builder
    validates that file against its JSON schema and rejects unknown keys, so a
    `_comment` field fails the build rather than documenting it.
- **`verify:packed` needs a real assertion before it becomes a required check.**
  Its false-pass probe is fixed — it tried port 8080 first, from a build that no
  longer opens one, so any unrelated process there reported success. It now
  probes 39123 only. What it still proves is narrow: that the packaged app boots
  without an uncaught exception and opens its port. That is worth running; it is
  not worth blocking a merge on until it checks something the app actually does.

---

## 3. More task providers, Jira first

**The Jira Cloud adapter has been run against a real Jira Cloud site**
(2026-09-08): projects and issues listed, statuses read back, and a task marked
done moved the issue on the board. The three format traps below all held on the
first try -- the numeric `started` offset, Atlassian Document Format comments,
and the `nextPageToken` pagination -- so they are recorded here as facts about
the API rather than as suspicions.

The three things that were most likely to be wrong, each of which would have
failed as a bare `400` with nothing in the body naming the field:

- `started` on a worklog must be `yyyy-MM-dd'T'HH:mm:ss.SSSZ` with a **numeric**
  offset. `toISOString()` is rejected, and so is the `+02:00` form the device's
  own `toIsoWithLocalOffset` produces -- Jira wants `+0200`.
- v3 comments are **Atlassian Document Format**, not strings. A plain string is
  what the v2 API took.
- `/rest/api/3/search/jql` pages on an opaque `nextPageToken`, not `startAt`.
  The `startAt` endpoint is the deprecated one, and `/project/search` still uses
  it -- so the adapter contains two different pagination loops on purpose.

What the live run *did* find was in the status round trip, and no unit test
could have caught it because the defect only appears across two operations.
Marking a task done does not close the issue -- it fires the configured
completion transition, since you send your own work for review rather than
closing it -- which in a default workflow lands the issue in "To Review",
category `indeterminate`. Reading that back on category alone gave
`in_progress`, and `saveTask` upserts with `status = excluded.status`, so the
next sync overwrote the DONE the user had just set. The badge changed its own
mind a minute later, which reads as the app forgetting. The readback now treats
a status named by one of the configured completion transitions as done, which
is the same answer `OpenProjectProvider` already gave for its configured To
Test / To Review status ids; the category stays the fallback, so an install
with nothing mapped still needs no setup.

**Worklog submission is verified too**, on both a Story and a Task, so the
adapter is exercised end to end: projects, issues, status readback, transitions
and worklogs. The apparent "time tracking works for Task and not Story" was the
delay below, not the issue type -- the same Task-type issue had one worklog
arrive and another not, which is what ruled the type out before the retest
confirmed it.

The delay was real, though, and worth recording because the fix reverses an
earlier deliberate decision. A finished session's worklog was queued and left
for the worker's own timer, `SYNC_INTERVAL_MS`, which is five minutes -- so
finishing a task and then looking at Jira showed nothing, which reads as a
broken sync rather than a pending one. `stopSession` now asks the worker to
drain immediately. The comment saying not to do that was correct when it was
written: a flush racing the timer over the same rows meant both POSTed them and
the session was billed twice. F-02 and F-03 removed that -- `processPendingQueue`
will not start a second concurrent pass and `claimSyncItem` is atomic -- so the
hazard is gone and only the delay was left.

Waking the worker was not enough on its own. A stop landing *during* a pass hit
the single-dispatcher guard and got no dispatch, so it waited out the full
interval anyway -- and for this app's core loop, finish one task then start and
finish the next, that is the common case rather than a corner, because a pass
holds a network round trip open. The guard now coalesces: a request arriving
mid-pass sets a flag and the row is drained before the pass ends.

Reading the app's own terminal during a live run settled the rest of it, and
the answer was not what the durations suggested:

- **`404 - Le ticket n'existe pas`.** One of the missing worklogs was for an
  issue that had since been deleted. Not a duration problem at all.
- **`400 - Le journal de travail ne doit pas avoir pour valeur Null`.** Jira's
  time tracking is minute-granular, so `timeSpentSeconds` below 60 rounds to
  zero minutes and is refused.
- **Neither stopped retrying.** `isPermanent` covered only 401/403, so both
  spent the full retry budget sending byte-identical requests to byte-identical
  URLs. Any 4xx is now permanent except `408` and `429`, the two that describe
  a moment rather than a request. The device driver already had this rule --
  its `413` is documented as permanent for the same reason -- and it had simply
  never crossed to the provider side.

The minute floor is declared by each adapter, `ITaskProvider.minimumLoggableSeconds`,
rather than fixed in the engine: it is a fact about each remote API, and
OpenProject records arbitrary durations, so it must not lose a user's time to
Jira's limitation. The engine reads it before queueing, and `JiraProvider.logTime`
enforces it as a *permanent* failure so a row queued by an older build parks
with an explanation instead of retrying.

That run also showed why the terminal was hard to read at all: an OpenProject
notification poll ran every sixty seconds regardless of which provider was
active, and printed a full stack trace each time for a server that was neither
running nor in use. It is gated on the active provider now, and a path that
degrades to an empty list by design logs one line rather than thirty.

One cause of the missing worklogs turned up while writing the tests for that,
and it is the likeliest explanation for the shortest of them. A session started
and stopped inside the same second logs **zero**: `elapsedSeconds` is floored to
whole seconds and clamped at 0. Every provider's `logTime` rejects a
non-positive duration by throwing `ArgumentException` -- deliberately -- but
`ArgumentException` is not a `ProviderRequestError`, so the queue cannot tell
the row is hopeless. It took the ordinary backoff and spent all
`MAX_SYNC_ATTEMPTS` retries across several hours before parking something that
could never have been sent. `stopSession` no longer queues a zero-second
session; the local worklog is still written, because the session did happen.

Worth noting how it hid: the two tests written for the immediate-dispatch fix
above both started and stopped in the same tick, so they were passing *because*
a zero-duration row was being queued. They now backdate the session's start
time, the same way the end-to-end simulation does.

Two existing tests had to change with it, which is worth being explicit about.
Both asserted a row was sitting in the queue as PENDING, and that state is now
too short-lived to observe -- with no provider configured the row is parked at
once where it used to be parked five minutes later. They assert the recorded
worklog instead, which is the fact that has to survive either way. The
end-to-end offline simulation also turned out to have been muting only the
worker it constructed while the engine's own stayed online, so "the machine is
offline" was never really simulated; it just never showed while nothing
dispatched at stop time.

Four defects came out of that first day, all fixed and all invisible to the
suite before they were reported:

- The bar showed `?` for accented characters. `sanitizeAsciiText` was written
  for exactly this and transliterates rather than substitutes, but only the
  notification composer and the device's element path called it -- the front
  matrix is rasterised through `PixelCanvas`, which called nobody. It now
  sanitises inside `drawTextClipped` and `drawSmallText`, before the
  measurement, since transliteration changes length.
- Finishing a task with the bar's own buttons logged the time and left the task
  in progress. `stopSession(comment, markDone)` takes the flag second and both
  hardware paths passed only the comment -- one of them an action named
  `COMPLETE_AND_LOG_ACTIVE_TASK`, the other the FINISH branch that plays the
  completion confetti on its way past. FINISH is also the wheel's default
  selection, so this was the press a user makes without scrolling.
- The bar displayed `10001: Active Task` -- Jira's internal issue id, which
  appears nowhere in Jira's UI, next to a placeholder title. `taskKey` and
  `customTitle` were optional arguments defaulting to the id and the literal
  string, and the app's IPC handler passed neither. The engine now reads both
  from the task row it already fetches, which fixes every call site at once
  rather than threading two more arguments through the bridge.
- The task list did not react to a status change. `onProjectsUpdated` refreshed
  the projects and not the tasks under them, and `fetchTasks` ran only when the
  selected project changed -- so leaving the tab and coming back was the only
  way to see a badge move, which reads as the action not having worked.

**Blocked on:** nothing else. The prerequisites below are all in place.

The provider interface already exists (`task-provider-interface.ts`), and
OpenProject and ad-hoc both implement it, so a Jira provider is mostly HTTP.

Five pieces of groundwork exist specifically so that adding a provider does
not multiply existing bugs:

- Providers now report failure by **throwing** a typed `ProviderRequestError`
  rather than returning `[]`. Returning an empty array was indistinguishable
  from "this user has no tasks", and the sync worker treated it as
  authoritative and pruned the local cache (F-01). A new provider must throw.
- The sync queue has a single owner and atomic claim semantics (F-02, F-03).
- `logTimeForProvider(providerId, …)` exists so a queued OpenProject worklog
  cannot be dispatched to whichever provider happens to be active when the
  worker wakes up.
- **Pagination is done (F-12).** One helper,
  `providers/openproject-collection.ts`, walks `_links.nextByOffset` to the end
  of any v3 collection and is used by all five collection call sites. It throws
  on reaching its page cap rather than returning a partial list, because a
  short list is exactly what makes the sync worker prune. A Jira provider
  cannot reuse the walker itself -- Jira paginates on `startAt`/`maxResults`
  rather than HAL links -- but the request half has now been extracted from it,
  below.
- **Provider credentials are encrypted at rest (F-11).** `db/secret-store.ts`
  wraps Electron's `safeStorage`; a value already on disk in plain text is
  upgraded the first time it is read. Every failure mode degrades rather than
  loses the key: no keystore means plaintext and one warning, and ciphertext
  written by another OS account reads back as "not configured" so the user is
  prompted to re-enter rather than shown a crash. The remaining exposure is
  that `GET_PROVIDERS` still hands the decrypted key to the renderer, because
  the settings form shows it -- making that field write-only is a product
  decision, not a bug fix.
- **Jira Cloud is a sibling adapter, not a subclass.** What the two providers
  share is already shared -- `providerFetch`, `ProviderRequestError`,
  `TaskScope`, `SecretStore` -- and what is left is all dialect. Two things the
  Jira side does *better*, worth stealing if the OpenProject one is ever
  revisited: status comes from `statusCategory`, which every workflow has, so it
  needs no configuration at all, where OpenProject needs three numeric status
  ids pasted in by hand. And transitions are configured by **name**, because a
  Jira transition id only means anything inside one workflow.
- **Which tasks to fetch is a setting, not a constant (F-12).** `shared/task-scope.ts`
  holds the vocabulary -- assigned to me / everything open / a custom query --
  and each adapter renders it in its own dialect, since OpenProject takes a
  JSON filter array and Jira takes JQL. The default is the old hardcoded
  behaviour, so an existing install sees the list it always saw. A custom query
  is validated before it is sent and **throws** if it is not a filter array:
  an invalid filter that quietly matched nothing would let the sync worker's
  prune delete every cached task for the project, which is F-01 reachable from
  a text field.
- **The error contract is settled: every provider method reports failure by
  throwing.** `logTime` and `updateTaskStatus` used to log and return a falsy
  result, which reached the sync queue as the string "Provider reported
  failure" -- the same row whether the API key had been revoked or the wifi had
  dropped. The queue now reads `ProviderRequestError.isPermanent` and parks a
  hopeless row at once instead of retrying a revoked key to its attempt
  ceiling, recording what the server actually said. That is only safe because
  saving credentials calls `requeueFailedItems()`, which had no production
  caller at all, making FAILED terminal in practice despite its docstring --
  so a corrected API key now un-parks the time the wrong one stranded.
  `fetchUnreadNotifications` still degrades to an empty list on purpose:
  nothing is pruned on the strength of it.
- **The shared HTTP client is done.** `providers/provider-http.ts` is the one
  place a provider talks to the network: per-attempt timeout, status
  classification into `ProviderRequestError`, `Retry-After`-aware backoff, and
  bounded retries. Every provider request now has a timeout, which none of them
  had. Its load-bearing rule is that **only GET/HEAD/OPTIONS are retried**:
  `POST /api/v3/time_entries` has no idempotency key, so repeating it after a
  response that was sent but never received bills the session twice, and an
  over-reported day is harder to spot than a missing entry the sync queue will
  resend anyway. `OpenProjectProvider` takes its `ProviderFetchOptions` through
  the constructor, so a test no longer has to stub a global to exercise it.

A fake OpenProject (`pnpm mock:openproject`, `scripts/fake-openproject.js`)
now serves a paginated, filter-aware v3 API. It backs
`tests/provider-integration.test.ts` and can be pointed at by the running app,
so a provider change can be exercised without an instance. A Jira provider
should grow its own routes in the same harness rather than a second one.

Also worth doing while this area is open:

- Point the device driver's `deviceFetch` at the same client, or at least stop
  the two drifting. It is not urgent: `deviceFetch` already has the one thing
  the providers were missing, and the device's 409/413/503 semantics are not
  the providers'.
- Grow Jira routes in `scripts/fake-openproject.js` so there is an integration
  test, as the OpenProject side has. The live run replaced the *unknowns*, not
  the regression cover: nothing automated exercises the Jira dialect end to end.
- Offer Jira in the first-run wizard. `OnboardingWizardModal` still lists only
  OpenProject and ad-hoc, so a new user has to pick something else and then find
  the provider in Settings.
- `reconcileRemoteState` is dead: the `provider:reconcile` channel is declared on
  the preload bridge and has **no handler in main**, so calling it from the
  renderer rejects. Either wire it up or delete the exposure -- an API surface
  that throws when used is the F-18 updater stub again. The Jira implementation
  returns zero deliberately rather than build an N+1 worklog walk behind an
  unreachable path.
- Surface the sync queue in the UI — pending / failed / synced counts, with a
  manual retry. Half the plumbing exists now: `SYNC_PROVIDER_NOW` runs a sync
  on demand and `ON_PROJECTS_UPDATED` reports the outcome, but nothing in the
  UI calls the first or displays the `failed` / `not_configured` reason from
  the second. A visible “Sync now” control and a last-sync line belong here.
  **This is now the next thing to build**, not a nicety: the missing Jira
  worklogs above cannot be diagnosed without it. Each row already carries its
  own `last_error` and `retry_count`, and nothing shows them -- so a worklog
  that never arrived is indistinguishable from one that was never queued. Note
  that the database cannot be inspected from an agent's shell to settle it
  either, for the reasons in CLAUDE.md §7.

---

## 4. Animation and visual work

**Blocked on:** nothing now. F-07 (a full PNG upload every second) and F-08 (a
60 fps loop holding a power-save blocker through lunch) were the reason this
was gated, and both are fixed — frames are hashed and deduplicated, the
animation cache is bounded to two entries, and the blocker is released for
looping idle animations.

- **Probe `CountdownElement` before designing around it.** The device has a
  native countdown element, which would let the bar tick a timer without the
  app uploading a frame per second. Two things are unknown and cheap to
  establish: the element has no `font` field, and BUSY Bar's own guidance warns
  countdowns render tall, which may not coexist with a 16 px app icon beside
  them. Draw one and read it back with `GET /api/screen?display=0` — 30 minutes
  settles whether this is a layout or a rewrite. `direction: "time_since"`
  counts up, which is what a session tracker wants.
  Until then the timer deliberately shows `HH:MM`, not seconds: at 72×16 the
  paused layout clips to six characters, and seconds would mean a frame upload
  every second for a digit nobody reads.
- **Countdown display for lunch and breaks** — deferred by choice, not by
  blocker. Revisit after the probe.
- **Wire up the rear 160×80 OLED.** `buildRearElements` already produces valid
  8-digit `#RRGGBBAA` elements and feeds the on-screen emulator;
  `transmitFrame` sends the front matrix and nothing else. The re-entry path is
  therefore small — but it is a *feature*, not a wire-up, because the panel is
  greyscale and the current element set is written for colour. The reason this
  was not merged into the front payload in Phase 1: the elements previously
  carried 10-digit colours, and per the hardware contract one malformed colour
  fails the **entire** draw call, which would have taken the working front
  display down with it.
- **Real CPU load on the performance monitor.** It currently reports memory and
  uptime and omits CPU rather than inventing it; deriving load needs two
  `os.cpus()` samples over an interval, which is a service, not a display
  concern.
- Richer transitions and more `.anim` sets.
- [x] **The notification banner shows the message** (2026-09-07). It drew one
  centred row of eleven characters, and spent ten of them on a bracketed channel
  label the app icon already conveyed — so a Slack message reached the bar as
  "[Message]" and an ellipsis. It now uses the same icon-and-two-rows template
  as every other screen, still at one frame upload. Composition lives in
  `shared/notification-text.ts`, which is pure and tested, because the previous
  split across the listener and the renderer is what hid the problem.
- [x] **Per-app icon override reachable from the UI** (2026-09-07).
  `NotificationSourceRule.iconImagePath` was honoured by the listener but nothing
  could set it. It matters because Win32 icon resolution matches a Start-Menu
  shortcut by name and can pick the wrong executable.
- [x] **`pnpm editor` repaired** (2026-09-07). It had been resolving its bitmap
  module to the pre-move path and opening to an empty palette, which reads as
  "no icons yet" rather than as a broken tool. Now fails loudly at startup if
  the file moves again.
- [x] **The debug panel draws real screens** (2026-09-07). It used to inject
  hand-built payloads straight into the emulator, in a vocabulary main had
  stopped emitting — text at x=16 in a 56px field with a scroll rate, against
  x=17 in 55px and no scrolling. The panel a developer opens to check a layout
  was showing one the device cannot produce. Previews now run the real renderer
  over `PREVIEW_DISPLAY_SCREEN`, and the emulator's duplicate text
  rasteriser, marquee and second confetti simulation are gone with it.
- [x] **Dropped three animation sets that nothing played** (2026-09-07):
  `coding_72x16`, `dnd_72x16` and `on_call_72x16`, about 3.8 MB of the 12.5 MB
  in `Animations/`. No source file referenced them, and there is no state for
  `dnd` to attach to — `UserMode` is `WORK | LUNCH | AWAY`.
  - There is no compositing path to wire them into: `AnimationPlayer` sends one
    animation element at priority 95 and `transmitFrame` sends one full-panel
    image at priority 95, so they overwrite each other. An animation is
    therefore all-or-nothing across the whole panel, which suits only a state
    with nothing to say — Lunch, Away and the stand-up prompt, all already
    wired. `coding` would have to replace the task key and timer, and `on_call`
    needs a presence signal the app does not have.
  - This stops future clones and CI checkouts fetching them, which is what the
    LFS bandwidth cap actually charges for. The objects stay in history; they
    are Flipper FZCO's own frame sets under CC-BY-SA-4.0 and can be restored
    from there or from [github.com/busy-app](https://github.com/busy-app).
- [x] **Row 0 is set in the BUSY Bar's own font** (2026-09-08). Reported from a
  photograph of the bar: every character stood two blank columns from the next,
  and `#` was an unreadable blob. Both came from one cause -- the hand-rolled
  "4x6" font was really 3px of ink in a 4px cell, drawn at a 5px stride, and 82
  of its 96 glyphs never used the fourth column. A `#` has nowhere to put two
  strokes and the gaps between them in three columns.
  - The firmware's own `lv_font_busy_regular_5` is now converted to
    `shared/busy-font.ts` by `tools/lvgl-font-to-ts.js`, which reads the
    generated LVGL C directly rather than a font binary. It asserts the 1-bpp
    packing assumption per glyph and fails loudly instead of emitting plausible
    rubbish, because a wrong bit order still yields glyphs of the right size.
  - The font is proportional, so there is no character capacity for row 0 any
    more: `i` advances 2px and `#` advances 6. `shared/proportional-text.ts`
    measures and truncates by width, and `PixelCanvas` uses the same helper --
    a one-character disagreement between composer and canvas is what truncates
    a row twice, the second time mid-word with no marker. The 55px field now
    holds about 14 characters of mixed case where it held 11 of anything.
  - `FONT_4X6` is deleted rather than kept as a fallback. Row 1's 3x5 font is
    untouched: it is genuinely fixed-width and legible at that size.
  - This adds a licence entry. The glyph table is **OFL-1.1** (Ark Pixel Font,
    (c) TakWolf; (c) Flipper FZCO), which permits bundling with an MIT
    application but keeps that one file under its own terms. See `LICENSE`.

---

## Test coverage: 80/70 reached on the honest metric

**Done**, as of the Jira provider. The suite measures 80.52 statements / 71.43
branches / 82.32 functions / 82.75 lines across 599 tests, and the floor is
ratcheted to 79.5 / 70.5 / 81.5 / 82.

It read 80/70 once before, until `@vitest/coverage-v8` 1 became 5 and AST-aware
remapping became the default; the same 346 tests then measured 76.19% instead of
88.15%. The suite did not get worse -- the ruler got accurate, and the old one
counted a whole line as covered when any part of it ran. Getting back here on
the accurate ruler took the provider work in §3, which is well-covered by
construction because none of it touches hardware or Electron.

The floor is still ratcheted up whenever the measurement rises. What is left is
not a number but the thin areas below.

Where the numbers are thinnest, worst first. None of these is a percentage
problem now; each is a specific untested path:

| Area | Statements | Note |
| :--- | ---: | :--- |
| `main/diagnostics` | 66% | |
| `main/tray` | 69% | `tray-manager.ts` lines 86-117 are the context menu. |
| `main/hardware` | 74% | `input-decoder.ts` at 66% is the weakest file; it is also the one where an uncaught throw used to kill the main process. |
| `main/services` | 75% | |

The renderer is not measured at all -- `coverage.include` is `src/main/**` and
`src/shared/**`. Roughly 4,700 lines of TSX have no tests. Extending the gate
to cover it is a separate decision from raising the floor on what it already
measures.

---

## Dependency debt still outstanding

- **React 18 -> 19** and **ESLint 8 -> 9.** Neither carries a security advisory;
  both are real migrations. ESLint 8 is end-of-life and its 9 upgrade means
  moving `.eslintrc.cjs` to flat config, including the `parserOptions.project`
  wiring that the type-aware rules depend on. Do them for their own sake, not
  because a bot opened a PR.
- **Renderer bundle audit.** Electron 44 ships a much newer Chromium, so several
  `@vitejs/plugin-react` and browserslist assumptions are now conservative.

## Deferred findings

Carried forward deliberately, with the reason. This is not a backlog of things
nobody got to.

| Finding | Status | Why it is deferred |
| :--- | :--- | :--- |
| F-11 — credentials in plaintext, `http` scheme default | Closed | `sanitizeDomain` assumes TLS for a bare host, so a Basic-header API key no longer goes out in clear text; `SecretStore` encrypts it at rest through `safeStorage`, upgrading existing plaintext on first read. What is left is not this finding: the settings form still receives the decrypted key over IPC because it displays it. |
| F-12 residue — no `fetch` timeouts in the provider layer | Closed | `provider-http.ts` gives every provider request a timeout, so a hung OpenProject can no longer stall a sync pass indefinitely. Saving credentials still does not await its sync, which is now a choice about UI responsiveness rather than a hedge against an unbounded request. |
| F-12 residue — `getTasks` hardcodes `assignee = "me"` | Closed | Now the `op_task_scope` setting: assigned to me (the default, unchanged behaviour), everything open, or a custom v3 filter array. The scope vocabulary is shared so Jira reuses it rather than inventing a second one. |
| F-18 — updater | Deleted, not implemented | The stub claimed to check for updates and did not. Deleting a lie is an improvement; §2 is the real fix. |
| Partial unique index on `active_sessions` | Deferred | Would convert a rare data anomaly into a hard crash on startup. Needs a repair path first. |
| Foreign keys on `worklogs` → `tasks` | Deferred | **Would fail on existing data**: F-01 already deleted tasks that surviving worklogs reference. Needs an orphan-cleanup decision. |
| Sync idempotency | Documented limitation | `reclaimStaleSyncItems` can re-POST if the app died after OpenProject accepted but before the row was marked `SYNCED`. The v3 API has no idempotency key; the sync id is embedded in the comment so duplicates are greppable. |
| Task description field | Feature, not a fix | `input-decoder` renders the task **key** where a non-existent `TaskDTO.description` was read. A real description field is a schema change plus provider mapping. |
| Code signing | Blocked on cost | No certificate. Builds are unsigned and SmartScreen warns; the build configuration is already arranged so that adding one is two secrets. |
| macOS / Linux | Out of scope | The notification listener is PowerShell against the Windows Action Center. Porting means a second listener, not a build target. |

---

## Not planned

- Multi-user, teams, or any hosted component.
- Multiple devices from one app instance.
- Becoming a general-purpose BUSY Bar SDK. The device's own API is documented
  by its authors at [github.com/busy-app](https://github.com/busy-app).
