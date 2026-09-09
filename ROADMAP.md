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
    `CSC_LINK` / `CSC_KEY_PASSWORD` from the environment, so nothing here has to
    change to *allow* signing. That is no longer the same as it being easy: see
    the HSM note under `electron-updater` below.
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
  - [x] **The download is not planned** (2026-09-09) — decided, not pending.
    Notification plus a manual install is the finished state of this feature,
    not a stopgap waiting on a certificate.
    - Unsigned auto-updates re-trigger SmartScreen on every update and some are
      blocked outright, so an in-app install would be *worse* than the manual
      route it replaced. A certificate is the only thing that changes that, and
      the ones that satisfy SmartScreen are an annual cost plus an identity
      verification process — not proportionate for a single-author personal
      project with a working manual path.
    - What the user loses is one download and one double-click per release,
      perhaps twice a year. What they keep is the app's only outbound request
      staying a single unauthenticated GET that can be switched off.
    - Nothing is being left half-built. `latest.yml` is attached to every
      release and `electron-builder.json` already stages `publish`, so if the
      decision is ever revisited the release side needs no change — but it is a
      decision now, and this item is closed rather than blocked.
    - **The "just add `CSC_LINK`" note elsewhere in this file was already
      stale.** Since June 2023 the CA/Browser Forum requires the private key of
      every new code-signing certificate to live on a FIPS-140-2 token or in a
      cloud HSM, so there is no longer a `.pfx` to base64 into a repository
      secret. Signing in CI now means an HSM signing service and a custom
      `signtool` step, which is a further reason this is not a two-secret
      change.
  - `nsis.differentialPackage` is **off** deliberately. Differential updates
    need a signed, published baseline to diff against; against unsigned draft
    releases the blockmap is dead weight in every artifact. Turn it on with the
    certificate, not before.
  - The rationale above cannot live in `electron-builder.json`: electron-builder
    validates that file against its JSON schema and rejects unknown keys, so a
    `_comment` field fails the build rather than documenting it.
- [x] **`verify:packed` asserts what the app does** (2026-09-09). The false-pass
  probe had already been fixed — it tried port 8080 first, from a build that no
  longer opens one, so any unrelated process there reported success — but what
  remained was still only "the binary booted and something is listening", which
  its own comment admitted. It now makes three requests to the running packaged
  app:
  - a well-formed Unity heartbeat is **accepted**, which exercises routing, body
    parsing, payload validation and the JSON response in one call, and is the
    request the Unity plugin actually makes;
  - the same request without `Content-Type: application/json` is **refused**
    (415);
  - a request carrying an `Origin` header is **refused** (403).

  The last two are the loopback hardening, and they earn their place in a
  *packaged* check specifically: loopback is not a security boundary, and those
  two rules are the whole of what stands between a web page the user happens to
  be visiting and hardware this API can drive. A regression in either is
  invisible from the UI and cannot fail a unit test that stubs the server.
  Whether to make it a required check is now a question about CI cost — it needs
  a full packaging run — rather than about whether it proves anything.

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

- [x] **`deviceFetch` and `provider-http.ts` stay separate** — decided, not
  pending. What looked like duplication is one shared idea (timeout, bounded
  retries, backoff) wrapped around the part that genuinely differs: status
  classification. The device's codes carry meanings the providers have no
  equivalent for — `409` is a priority conflict and *not a failure*, `413` is
  permanent because retrying sends identical bytes — while the providers care
  about 401 vs 429 vs 5xx. A shared client would need a per-caller classifier
  injected, which is the whole of what is not already shared. `deviceFetch` also
  already had the timeout the providers were missing, so there is no defect to
  carry across. If the two ever converge, it should be on the backoff schedule
  alone: the one piece with no caller-specific meaning.
- [x] **A fake Jira and an integration test** (2026-09-09).
  `scripts/fake-jira.js` is a sibling of the OpenProject harness — same factory
  shape, same request-spy array, `pnpm mock:jira` to run it by hand — and
  `tests/jira-integration.test.ts` drives the real adapter over a real socket.
  It covers what a mocked `fetch` structurally cannot: that both pagination
  walks agree with a server (`startAt` for projects, the opaque
  `nextPageToken` for issues), that the worklog body carries a numeric offset
  and an ADF comment, that a transition configured by name resolves to the id
  the workflow uses, and that a 401 is classified as permanent.
  - The fake **clamps `maxResults`** the way the OpenProject one clamps
    `pageSize`. Without that, the adapter's request for 100 would be honoured,
    everything would arrive in one page, and both walks would silently never
    run — the harness would pass while proving nothing.
  - The test constructs `JiraProvider` directly and injects a `fetchFn` that
    rewrites the origin, because `sanitizeSite` forces `https://` and a
    plain-HTTP loopback fake is therefore unreachable through `ProviderManager`.
    Weakening the scheme rule to suit a harness would trade the F-11 fix for
    test convenience. The cost is that this exercises the adapter and not
    `ProviderManager`'s credential wiring, which the OpenProject integration
    test already covers.
- [x] **Jira is offered in the first-run wizard** (2026-09-09) — and step 2 now
  does something. The task was written as "add Jira to the dropdown", but the
  dropdown turned out to be decorative: `providerId` and `fallbackKey` were
  local `useState` that nothing read, `onClose` took no arguments, and the
  component contained no save call at all. A user who chose a provider here
  found the app still on its default. Adding a third option to that would have
  stranded a Jira user *worse* than leaving it out — the F-18 shape once more.
  - Completing the wizard now calls `setActiveProvider`, which already
    persists, reinitialises the providers and kicks a sync pass, so the
    Projects view fills instead of showing an empty list.
  - It collects only the minimum each provider needs to work: domain and API
    key for OpenProject, site, email and token for Jira. Not the transitions or
    the task scope — Jira reads status from `statusCategory` and needs no
    mapping to start, and duplicating the whole Settings form into the wizard
    is the constant-duplication trap in a different costume.
  - Only the chosen provider's fields are sent. `setActiveProvider` takes a
    partial update, so the other provider's stored credentials are left alone
    rather than blanked by empty strings from a form that never showed them.
  - A failed save is displayed. Closing quietly would leave the user believing
    setup had happened, which is the state the step was already in.
- [x] **`reconcileRemoteState` is no longer exposed** (2026-09-09). The
  `provider:reconcile` channel was declared on the preload bridge with **no
  handler in main**, so calling it rejected — the F-18 updater stub again, an
  API surface that throws when used. Nothing called it, on either side.
  - The channel, the bridge method and its type declaration are deleted
    together; `pnpm typecheck` is what proves all three went, because the
    `: IElectronAPI` annotation on the bridge turns any survivor into a compile
    error.
  - The provider methods stay. `OpenProjectProvider`'s is correct, tested code,
    and the day a UI wants a server-side day total the work is a handler plus a
    component rather than a rewrite.
  - The contract changed while it was open: `remoteLoggedTimeToday` is now
    `number | null`. Jira and AdHoc returned a confident `0` they had not
    measured, which a caller cannot tell apart from "you logged nothing today"
    — and that is the reading a UI would render. `null` means "this provider
    cannot answer". OpenProject returns `null` on a failed fetch too, for the
    same reason: understating the day as zero is the same lie in a different
    costume.
- [x] **The sync queue is visible** (2026-09-08). Every row that has not been
  delivered, with the provider's own message, the attempt count against the
  ceiling and when the next attempt is due, plus Sync Now and Retry Failed.
  It was built after diagnosing two failed worklogs took a terminal and three
  hundred lines of console for reasons already recorded on the rows.
  `getSyncQueueSnapshot` is a new read rather than a reuse of
  `getPendingQueueItems`: that one answers "what may I send now", so it hides
  both a parked row and one waiting out its backoff -- the two kinds anyone
  opening the panel is looking for. Rows are named from the local task cache,
  since the queue stores the provider's own id and `10004` appears nowhere in
  Jira's UI.
- [x] **`minimumLoggableSeconds = 60` is measured** (2026-09-09). It had been an
  inference — Jira's documented minute granularity plus one observed `400` — and
  if the real floor had been lower the engine would have been discarding time a
  user worked. `pnpm probe:jira-worklog` against a live Cloud site refused 1s,
  5s, 30s and 59s and accepted 60s, 61s and 120s. The boundary is exactly 60, so
  the constant was right and is now a fact rather than a guess.
  - The refusal is a `400` reading "the worklog must not be Null", with
    `errors.timeLogged` saying to indicate the time spent. It names neither the
    duration nor a minimum, which is why this took a live run to settle rather
    than being readable off a failed request. Recorded at the constant so the
    next person is not misled by it.
  - Worth keeping the probe: this is a fact about a remote API, not about this
    code, so Atlassian can change it without anything here failing.

---

## 4. Animation and visual work

**Blocked on:** nothing now. F-07 (a full PNG upload every second) and F-08 (a
60 fps loop holding a power-save blocker through lunch) were the reason this
was gated, and both are fixed — frames are hashed and deduplicated, the
animation cache is bounded to two entries, and the blocker is released for
looping idle animations.

- [x] **`CountdownElement` is probed, and it is a layout exercise, not a
  rewrite** (2026-09-09). `pnpm probe:busybar` now draws one, reads the panel
  back with `GET /api/screen?display=0` and measures the pixels. Every number
  below is measured on firmware 1.2.3, not read from the spec.
  - **It does not render tall.** The warning that prompted this probe does not
    apply here: it draws **17×5px** for `01:06` — the same 5px height as row 1's
    own font. It has no `font` field and there is nothing to configure, but at
    that size there is nothing to fix either.
  - **It coexists with a 16px app icon comfortably.** Drawn at `x=17` beside a
    16×16 icon it occupies 17px of the 56px field, leaving 39px. The layout
    this was feared to break is not close to breaking.
  - **It ticks on its own.** Two readbacks 2s apart differ with no redraw from
    the app, which is the entire point: a live seconds display for **zero**
    uploads, against the two HTTP requests per frame the app pays today.
  - **`direction: "time_since"` counts up**, as documented, and
    `show_hours: "when_non_zero"` gives `MM:SS` until there is an hour to show.
  - **The trap, and it is a real one: the countdown counts against the
    *device's* RTC, not the app's clock.** The probe asked for 65 seconds
    elapsed and the bar drew `00:47`, because this bar's clock is **19 seconds
    behind** the host. Nothing is wrong with the element; the two clocks simply
    disagree, and the element believes the device. Handing the bar a timestamp
    computed with `Date.now()` displays a timer that is silently wrong by
    whatever the skew happens to be, and *nothing reports it* — the bar looks
    confidently incorrect. Re-running with the skew added produced `01:06`, so
    the fix is arithmetic, but it has to be deliberate: read `GET /api/time`,
    compute the offset, apply it to every countdown timestamp, and re-read it
    periodically since RTC drift is what caused this. Setting the device's clock
    instead is the other option and is a bigger decision — it is the user's
    device and the bar shows that time when this app is not running.
  - Until this is built the timer still shows `HH:MM`, not seconds: at 72×16 the
    paused layout clips to six characters, and seconds *rendered by the app*
    would mean a frame upload every second for a digit nobody reads. The
    countdown element is what makes seconds affordable, and it is now measured
    rather than hypothetical.
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
  - There was no compositing path to wire them into: `AnimationPlayer` sends one
    animation element at priority 95 and `transmitFrame` sends one full-panel
    image at priority 95, so they overwrite each other. An animation was
    therefore all-or-nothing across the whole panel, which suits only a state
    with nothing to say — Lunch, Away and the stand-up prompt, all already
    wired. `coding` would have to replace the task key and timer, and `on_call`
    needs a presence signal the app does not have.
  - **Firmware 1.2.3 lifts that blocker, and it is measured rather than
    assumed** (2026-09-09). `pnpm probe:busybar` against a real bar on 1.2.3
    reports `z_index` accepted on a draw and `element_ids` accepted on a delete.
    So elements can now be layered and removed individually instead of a frame
    being all-or-nothing.
    - Two elements at the same priority no longer have to fight: `z_index` is
      an integer, higher drawn on top, on the shared element schema.
    - `DELETE /api/display/draw` takes an `element_ids` array, with
      `application_name` as a sanity check that you own them.
    - **`z_index` genuinely reorders; it is not merely accepted** (2026-09-09).
      The first run proved only that the field survives a draw, which is a
      weaker claim than it reads as. The probe now draws two overlapping images,
      swaps their `z_index` and reads the panel back both ways: the frames
      differ, and the higher value is the one drawn on top. That is the fact §4
      would be designed around, so it is measured rather than inferred from a
      `200`.
    - This does **not** make the animation work small. The blocker was one of
      three reasons; `coding` still has to coexist with the task key and timer
      inside 72×16, and `on_call` still needs a presence signal the app does not
      have. What changed is that the *device* is no longer the thing preventing
      it. Anyone picking §4 up should re-read this bullet rather than the one
      above it.
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

**Done**, as of the Jira provider, and raised again since. The suite measures
**83.13 statements / 74.18 branches / 84.67 functions / 85.34 lines across 707
tests in 50 files**, and the floor is ratcheted to 83 / 74 / 84.5 / 85.

It read 80/70 once before, until `@vitest/coverage-v8` 1 became 5 and AST-aware
remapping became the default; the same 346 tests then measured 76.19% instead of
88.15%. The suite did not get worse -- the ruler got accurate, and the old one
counted a whole line as covered when any part of it ran. Getting back here on
the accurate ruler took the provider work in §3, which is well-covered by
construction because none of it touches hardware or Electron.

The floor is still ratcheted up whenever the measurement rises. What is left is
not a number but the thin areas below.

Where the numbers are thinnest, worst first. None of these is a percentage
problem; each is a specific untested path:

| Area | Statements | Note |
| :--- | ---: | :--- |
| `main/diagnostics` | 98.5% | Was 66%. Closed below. |
| `main/services` | 78% | Depth, not absence — every service has a test file. `priority-preemption-engine.ts` is the best value per unit of effort: 341 lines of pure logic behind an interface, constructor-injected. |
| `main/hardware` | 79% | Was 74%. `input-decoder.ts` is now 94%. |
| `main/tray` | 92% | Was 69%. Closed below. |

- **`main/diagnostics` 66% → 98.5%**, and this one found defects rather than
  just covering lines. `logger-interceptor.ts` had **no test file at all**;
  writing one meant giving it a `restore()`, because `intercept()` was an
  irreversible change to a process-wide singleton and leaving it in place is the
  console-over-rpc hazard below. It also turned out `intercept()` was not
  idempotent: a second call captured the first call's wrapper as the "original",
  so every line would have been recorded twice and `restore()` would have
  unwrapped only one layer.
  - **Three fields in the diagnostics bundle were invented, not measured** —
    and this is the bundle a user attaches to a bug report. `appVersion` was the
    literal `'1.0.0'`, so every report since the 1.1.0 release named the wrong
    version. `electronVersion` fell back to `'30.0.0'` for a build running
    Electron 44. Worst of the three, `webhookServerStatus.listening` was
    hardcoded `true`: it asserted the Unity listener was up in exactly the
    bundle a user sends because it is not. `WebhookServer.getStatus()` now reads
    `server.listening` — the socket, not a flag that stays true after it dies —
    and anything genuinely unknowable is reported as unknown.
  - The single existing test **asserted all three invented values**, so it
    passed while the bundle lied. That is CLAUDE.md's "test the behaviour, not
    the implementation you just wrote", found in the wild.
  - The interceptor's most valuable test is the one tying it to
    `notification-redaction.ts`: what this class captures is what leaves the
    machine, which is how 1,175 real toast records once did.

Two more were closed on 2026-09-09, and both were behaviour a user
reaches with a physical control rather than percentage-chasing:

- **`input-decoder.ts` 66% → 94%.** The hardware task picker was entirely
  untested — the one screen driven wholly from the bar. The lock assertions are
  the point: `renderTaskSelection` acquires `menuPriority` on every redraw, and
  every exit has to release it. When nothing did, the lock outlived the menu
  and the bar stayed on the picker until an unrelated higher-priority event
  overwrote it (F-15); nothing proved that stayed fixed. The listener guard is
  now driven through `driver.simulateInputEvent` rather than by calling
  `handleHardwareInput` directly, so the try/catch is actually in the call
  stack — the earlier tests all bypassed the very guard that keeps a throw on a
  button press from terminating the main process.
- **`tray-manager.ts` 69% → 92%.** `updateContextMenu` is private and runs only
  from `initialize`, so its click handlers are reachable only through the
  template `Menu.buildFromTemplate` receives. The quit item used that technique;
  nothing else did, which left every item a user actually reaches untested —
  and the tray is how you pause without opening the window.

One thing that surfaced while doing it, worth recording because it failed the
gate while every test passed: the added tests multiplied this suite's console
output, and vitest forwards each line to the main thread over rpc. The worker
began tearing down with logs still in flight — `Closing rpc while
onUserConsoleLog was pending` — an unhandled error that exits non-zero on a run
where every test is green, intermittently and more often under coverage.
The first fix was to stub `console` at the top of each noisy fixture, before
anything logs. Volume was the whole problem; nobody was reading the output.

**That treated the symptom, and it came back** (2026-09-09). The diagnostics
tests reproduced it once in three runs while stubbing console correctly, because
per-fixture stubbing is whack-a-mole — the next suite that logs brings it back,
and the *forwarding* is the mechanism. `disableConsoleIntercept: true` in
`vitest.config.ts` writes console output straight to stdout instead of over rpc,
which removes the mechanism rather than the symptom: six consecutive clean
coverage runs since. The fixture stubs stay, because keeping the suite's output
readable is a separate and still-good reason for them.

The renderer is not measured at all -- `coverage.include` is `src/main/**` and
`src/shared/**`. Roughly 4,700 lines of TSX have no tests. Extending the gate
to cover it is a separate decision from raising the floor on what it already
measures.

---

## Dependency debt still outstanding

- [x] **ESLint 8 -> 10, flat config** (2026-09-09). Done on
  `chore/dependency-debt`. It was planned as 8 -> 9; the registry settled that
  during the work — **9 is now the `maintenance` dist-tag and 10 is `latest`**,
  so stopping at 9 would have migrated onto a line already scheduled to expire.
  - `.eslintrc.cjs` and `.eslintignore` are both gone, replaced by
    `eslint.config.mjs`. Every rule and every explanatory comment moved across
    verbatim; the comments are the valuable part of that file.
  - **The measurement that made this safe:** the old config's findings were
    captured as a sorted `file:line rule` list *before* starting, and the new
    config reproduces it **exactly** -- 150 files linted, 36 warnings, 0 errors,
    byte-identical. A matching count alone would not have proved it; a rule that
    silently stops running is the failure mode here, and it looks like success.
  - A clean run still proves nothing about rules that no longer fire, so each
    load-bearing rule was deliberately broken and confirmed to error:
    `no-misused-promises` (the `async will-quit` bug class), `await-thenable`,
    `no-floating-promises`, both directions of the `no-restricted-imports`
    process boundary, and `react-hooks/rules-of-hooks`.
  - **`eslint-plugin-react` has no ESLint 10 release** (7.37.5 caps its peer
    range at `^9.7`), and on 10 it really does crash:
    `contextOrFilename.getFilename is not a function`. It is *only* the version
    **detection** path -- `settings.react.version: 'detect'` -- so pinning the
    version explicitly avoids it entirely and the rules run normally. That is
    why `settings.react.version` is a literal and must stay one until the plugin
    ships 10 support; `'detect'` is the tempting-looking change that breaks the
    whole lint run.
  - Three traps, recorded in `CLAUDE.md` §2 because each one presents as "the
    migration broke everything": `.eslintignore` is no longer read, `--ext` no
    longer exists (so `.js` files enter scope for the first time), and
    `@typescript-eslint/no-var-requires` was **renamed** to `no-require-imports`
    -- a disable comment naming the old rule had quietly stopped applying.
  - **`eslint-plugin-react-hooks` 4 -> 7** (v4 has no flat config at all). v7's
    recommended set is the React Compiler one and reports **16 new findings**
    across the renderer -- `set-state-in-effect` x14, `purity`, `refs`. They are
    not adopted here: this commit is a config migration, and those are renderer
    refactors in code that has no tests. Only the two classic rules are enabled.
    **Adopting the expanded set is the natural follow-up once the smoke harness
    below exists**, and it is the most valuable thing in this section now.
- **React 18 -> 19.** No security advisory; doing it for its own sake. Blocked
  on a renderer smoke-test harness, because the renderer has no tests and
  nothing automated could see a regression. Note that `lucide-react` 0.359 caps
  its React peer at 18, so this drags a coupled bump with it -- the same shape
  as the better-sqlite3 / Electron pairing in `CLAUDE.md` §2.
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
| Code signing | Not planned | Deliberate, as of 2026-09-09, not a gap. A SmartScreen-satisfying certificate costs money annually and requires identity verification, which is out of proportion to a personal project whose manual install works. Builds stay unsigned and the first-run warning is documented where a user meets it. Note that the old "adding one is two repository secrets" claim no longer holds: new code-signing keys must sit on a hardware token or in a cloud HSM, so CI signing needs a signing service, not a `.pfx` in a secret. |
| macOS / Linux | Out of scope | The notification listener is PowerShell against the Windows Action Center. Porting means a second listener, not a build target. |

---

## Not planned

- Multi-user, teams, or any hosted component.
- Multiple devices from one app instance.
- Becoming a general-purpose BUSY Bar SDK. The device's own API is documented
  by its authors at [github.com/busy-app](https://github.com/busy-app).
