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

**Blocked on:** §1. Publishing releases from a repository whose history still
carries personal data publishes that history.

Today there is no release: you clone and build. That is a real adoption barrier
and it is also why nobody but the author has ever run a packaged build.

- [x] **`build-windows.yml`** producing the NSIS installer and portable
  executable, attached to a **draft** GitHub Release on a `v*` tag (2026-09-07).
  - Draft rather than published: the assets are unsigned, so SmartScreen warns
    on first run and that deserves a release note before anyone downloads it.
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

**Blocked on:** nothing external — but see the note below before starting.

The provider interface already exists (`task-provider-interface.ts`), and
OpenProject and ad-hoc both implement it, so a Jira provider is mostly HTTP.

Three pieces of Phase 1 work exist specifically so that adding a provider does
not multiply existing bugs, and a fourth is still outstanding:

- Providers now report failure by **throwing** a typed `ProviderRequestError`
  rather than returning `[]`. Returning an empty array was indistinguishable
  from "this user has no tasks", and the sync worker treated it as
  authoritative and pruned the local cache (F-01). A new provider must throw.
- The sync queue has a single owner and atomic claim semantics (F-02, F-03).
- `logTimeForProvider(providerId, …)` exists so a queued OpenProject worklog
  cannot be dispatched to whichever provider happens to be active when the
  worker wakes up.
- **Pagination is still missing (F-12).** Every OpenProject call fetches a bare
  collection URL with no `pageSize`/`offset` and never follows
  `_links.nextByOffset`, so anyone with more than ~20 projects silently sees
  only the first page. Fix this in the shared layer *before* writing a second
  provider, or it gets reimplemented wrongly twice.

Also worth doing while this area is open:

- `safeStorage` for provider credentials (F-11); the API key is currently
  stored in plaintext, and the default OpenProject URL scheme is `http`.
- A shared HTTP client with timeout, exponential backoff and 429 handling,
  used by both the providers and the device driver.
- Surface the sync queue in the UI — pending / failed / synced counts, with a
  manual retry.

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
- Richer transitions, more `.anim` sets, and a per-app icon override so a
  hand-tuned 16×16 from `pnpm editor` can pin any application.

---

## Test coverage back to 80/70 on the honest metric

**Blocked on:** nothing. This is just work.

The floor is 76% statements / 78% lines / 79% functions / 66% branches. It read
80/70 until `@vitest/coverage-v8` 1 became 5 and AST-aware remapping became the
default; the same 346 tests then measured 76.19% instead of 88.15%. The suite
did not get worse -- the ruler got accurate, and the old one counted a whole
line as covered when any part of it ran.

Where the honest numbers are thinnest, worst first:

| Area | Statements | Note |
| :--- | ---: | :--- |
| `main/providers` | 57% | The OpenProject client. Also where F-01, F-02 and F-12 live, so tests here pay twice. |
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
| F-11 — credentials stored in plaintext, `http` default | Open | Belongs with §3 while the provider layer is already open. Single-user local app, so the exposure is a local-disk read. |
| F-12 — no pagination on OpenProject collections | Open | Must land **before** a second provider, not after. See §3. |
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
