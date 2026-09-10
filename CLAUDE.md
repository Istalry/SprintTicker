# CLAUDE.md — working in this repository

The product is **SprintTicker**. "BUSY Bar" is the Flipper FZCO device it
drives, not this project; keep the two apart in anything user-facing.

Guidance for Claude Code and any other AI agent working on BUSY Bar. Read this
before changing code; most of it is knowledge that is expensive to rediscover
and invisible in the source.

## 1. What this is

A pnpm workspace with two packages:

| Package | What it is |
| :--- | :--- |
| `packages/desktop-app` | Electron 44 + React 18 + Vite 8 + Vitest 5 + Tailwind + better-sqlite3 13. ~90% of the code. |
| `packages/unity-plugin` | A Unity Editor C# package (`io.github.istalry.sprintticker`) that posts editor events to the desktop app. |

The desktop app tracks time against tasks, drives a physical BUSY Bar LED
display over USB, and mirrors Windows notifications onto it.

## 2. Commands

```bash
pnpm dev              # Vite renderer + preload/main watchers + Electron
pnpm dev:mock         # the same, with no hardware attached
pnpm test             # vitest run
pnpm test:coverage    # floor: 83% stmts / 85% lines / 84.5% funcs / 74% branches
                      # a ratchet -- raise it, never lower it to make a run pass
pnpm typecheck        # main and renderer tsconfigs, separately
pnpm lint             # 0 errors expected; renderer floating-promise warnings are known
pnpm package:win      # electron-builder, unsigned
pnpm editor           # pixel editor for 16x16 bitmaps
```

**The better-sqlite3 ABI trap.** The native module must be built for whichever
runtime is about to load it, and the two are not interchangeable:

- `pretest` runs `pnpm rebuild better-sqlite3` — the **Node** ABI, for Vitest.
- `predev` runs `electron-builder install-app-deps` — the **Electron** ABI.

Running `pnpm test` then `pnpm dev` rebuilds twice; that is correct, not a bug.
If either fails with `NODE_MODULE_VERSION` mismatch, run the other one's rebuild
step.

**better-sqlite3 and Electron are a version pair, not two independent
dependencies.** Upgrading Electron 30 to 44 made better-sqlite3 11 fail to
*compile* -- not a mismatched ABI number but hard C++ errors, because V8 had
changed underneath it (`v8::External::Value()` gained an isolate parameter,
`PropertyCallbackInfo::This` was removed). The fix was better-sqlite3 13. So an
Electron major implies a better-sqlite3 review, which is why Dependabot ignores
better-sqlite3 majors: that bump is driven by this pairing rather than chosen on
its own. On a fresh install with no prebuild for your Node version, it compiles
from source and needs Python and MSVC Build Tools.

**Lint config is flat config, in `eslint.config.mjs` at the repo root.** ESLint 8
reached end of life; the repository is on ESLint 10 (9 is the `maintenance`
dist-tag). Four things about it are worth knowing before you touch it, because
each presents as "the migration broke everything":

- **`.eslintignore` is not read any more**, and the file is deleted rather than
  left lying around doing nothing. The ignore list lives in the first config
  object. If `scripts/` or `tools/` ever start reporting errors, this is why —
  they are deliberately unlinted, untyped, dependency-free CommonJS.
- **`--ext` no longer exists.** The old invocation was `eslint packages --ext
  .ts,.tsx`, so `.js` was never linted; the config reproduces that by ignoring
  `**/*.js`. Removing that ignore means `postcss.config.js` and
  `tailwind.config.js` enter scope and fail on `module is not defined`.
- **`settings.react.version` must stay a literal, never `'detect'`.**
  `eslint-plugin-react` has no ESLint 10 release, and its version *detection*
  path crashes the entire run with `contextOrFilename.getFilename is not a
  function`. Pinned, the plugin works normally. Revisit when the plugin ships
  ESLint 10 support.
- **`@typescript-eslint/no-var-requires` was renamed `no-require-imports`.** A
  disable comment naming the old rule silently stops suppressing anything.

`eslint-plugin-react-hooks` is on 7, but only `rules-of-hooks` and
`exhaustive-deps` are enabled. Its full recommended set is the React Compiler
one and reports 16 findings in the renderer; adopting it is a real task with
real refactoring behind it, not a config flip. See ROADMAP.

**Git LFS is mandatory.** `Animations/` and `packages/desktop-app/build/icon.png`
are LFS objects. Cloning without LFS leaves them as ~130-byte pointer files, and
`package:win` will happily build an installer with a broken icon and no
animations.

## 3. Process boundaries

`contextIsolation: true`, `nodeIntegration: false`. The renderer reaches the
main process only through the contextBridge preload.

- **The renderer must never import from `src/main/**` or from `electron`.** Both
  are ESLint errors. Doing so pulls `electron`, `fs` and better-sqlite3 into the
  browser bundle where they cannot work.
- **Main must never import from `src/renderer/**`.** Also an ESLint error.
- Anything genuinely shared goes in `src/shared/`, which must stay free of
  runtime dependencies on either side.
- `src/preload/electron-api.d.ts` declares the `window.electronAPI` global. The
  `: IElectronAPI` annotation on the bridge object is load-bearing — it is what
  turns preload/renderer drift into a compile error.

A duplicated constant is a bug waiting to happen here, not a style question:
main and the renderer have shipped contradictory copies of the notification
defaults and the priority rules, and which one won depended on process start
order. Both now live in `src/shared/`.

## 4. The BUSY Bar hardware contract

Violating these does not produce a helpful error. Some of them reboot the
device.

- **Colours are `#RRGGBBAA` — exactly 8 hex digits.** Anything else makes the
  *entire* draw call 400, so one bad element takes down the whole frame.
- **Text is printable ASCII only (`0x20`–`0x7E`).** Smart quotes and emoji
  corrupt the display. Use `sanitizeAsciiText`.
- **A solid fill takes exactly one colour; a gradient takes exactly two.**
  Supplying the wrong count **reboots the device**. `formatHardwarePayload`
  normalises this — do not bypass it.
- **The field is `application_name`, not `app_id`.** The latter is a legacy name
  the firmware ignores.
- **Asset filenames must match `^[a-zA-Z0-9._-]+$`** — no paths, no spaces.
  Firmware 1.2.3 does accept a subdirectory in the name and creates it, but the
  strict rule stays: it is valid on every firmware, and nothing here needs a
  subdirectory. Relaxing it would buy nothing and cost compatibility with a bar
  the user has not updated.
- **Draw priority must be ≥ 95** for the app to hold the display.
- **Status codes carry meaning.** `409` is a priority conflict (something else
  owns the display — not a failure), `413` is a payload too large (permanent;
  retrying sends the same bytes), `503` means retry. See
  `classifyDeviceResponse`.
- **RTC timestamps need a UTC offset, not `Z`.** The device applies no
  conversion, so `toISOString()` leaves the bar showing UTC.
- **The device's clock is not this machine's clock.** A real bar measured
  **19 seconds behind** its host. That is invisible today because the app
  renders every time value itself and uploads pixels — but anything that hands
  the device a timestamp and lets *it* do the arithmetic (`CountdownElement` is
  the one that matters) shows a time wrong by the skew, with nothing anywhere
  reporting it. Read `GET /api/time`, take the offset, and apply it; re-read it
  periodically, because drift is what produced the 19 seconds.
- **`GET /api/screen?display=0` does not return what it says it does.** It
  answers `Content-Type: image/bmp`, and `streaming.yaml` types the body as
  base64 — but on 1.2.3 what arrives is base64-encoded **raw** pixels with no
  BMP header: 4608 characters decoding to 3456 bytes, which is 72 × 16 × 3. The
  channel order is **BGR** (a pure red block reads back `0000ff`) and rows are
  **top-down**, the opposite of BMP's default. Both were measured by drawing a
  known block, because either mistake still yields a plausible-looking image —
  just with the colours swapped or the picture upside down. `decodeFrame` in
  `scripts/busybar-probe.js` handles it and keeps a real BMP path in front for
  the day the endpoint matches its own content type.

**The bar answers on `10.0.4.20` over USB and needs no token there — but that
is a default, not a constant, and the app must never hardcode it.** This file
used to say the opposite, and an audit finding asking for a configurable
address was withdrawn on the strength of it. Both were wrong, for two reasons
that only showed up in use:

- Over Wi-Fi the bar takes a DHCP lease and is somewhere else entirely.
- Windows' inbox CDC-NCM driver can refuse to start the interface — a real
  failure, reproduced on 25H2 with an Intel 700-series xHCI, where the device
  enumerates cleanly and the network child fails with Code 10 /
  `STATUS_DEVICE_HARDWARE_ERROR`. Ten targeted fixes changed nothing; the
  working recovery is to pass the device through to another network stack and
  proxy it back on a *different* address. A bar reachable only at `10.0.4.21`
  is still a bar.

So the address and token live in `DeviceConfigDTO`, seeded from
`DEFAULT_USB_IP` and `DEFAULT_DEVICE_CONFIG` in `shared/device-constants.ts`.
Read the configured value; never the constant.

Three things that go with it:

- **Validate any host before it reaches a URL.** `isValidDeviceHost` is an
  allow-list of `[A-Za-z0-9.-]`, not a list of forbidden characters — a
  blocklist has to enumerate `/`, `\`, `@`, `:`, `?` and `#` inside a character
  class where several need escaping, and one that goes missing lets a typed
  string silently retarget every device request at another origin. That is not
  hypothetical: the first version of this check lost its backslash to a shell
  heredoc and nothing failed.
- **The token is a secret, and the StateStream URL carries it as a query
  parameter.** Console output is captured verbatim into the diagnostics bundle
  users attach to bug reports, so anything logging that URL must go through
  `redactTokenInUrl`.
- **Changing the address re-dials in place, so socket teardown races.**
  `close()` does not fire `onclose` synchronously; without the `wsGeneration`
  guard a superseded socket's close handler nulls the *live* `wsClient` and
  orphans it, still open against the previous address with nothing able to
  close it. Every socket handler compares its captured generation before acting.

`connectionType` in `DeviceStatusDTO` is derived as "not the default USB
address", which is all the driver can know — HTTP over USB Ethernet and HTTP
over Wi-Fi are indistinguishable from there. A proxied bar therefore reports
`wifi` while physically on USB. The address shown beside it is the true part.

**Check the contract against a real bar after a firmware release**, with
`pnpm probe:busybar`. It reports the firmware version, verifies the calls this
app depends on, and says which newer fields the device accepts. It draws only
under its own `application_name`, sends no `rectangle` elements — a wrong colour
count there reboots the device, and no probe is worth that — and removes what it
drew. Close the app first, or its priority-95 claim turns into 409s that mean
only that the app owns the display. Last run: **firmware 1.2.3, all checks
passing** (2026-09-09).

It also reads the panel back and writes every frame out as a PNG (`--out <dir>`,
default a temp directory), because the questions worth asking of a *display* are
about layout and a status code cannot answer those. That is how the countdown
element was measured at 17×5px and how `z_index` was shown to genuinely reorder
overlapping elements rather than merely being accepted on a draw. When you add a
check here, prefer one that looks at pixels over one that reads a status code.

**The front display is a rasterised 72×16 PNG.** Every frame is an asset upload
plus a draw — two HTTP requests. Before adding anything that redraws on a timer,
check what actually changes: `transmitFrame` deduplicates by hashing the frame,
and the timer deliberately shows `HH:MM` rather than seconds for this reason.

The rear 160×80 OLED is **preview only** in this build. `buildRearElements` feeds
the on-screen emulator; `transmitFrame` sends the front matrix and nothing else.

**Row 0 text is proportional, so there is no character capacity.** It is set in
the firmware's own font, generated into `shared/busy-font.ts` by
`tools/lvgl-font-to-ts.js` — do not hand-edit either. `i` advances 2px and `#`
advances 6, so anything asking "does this fit" must call `measureText` /
`fitToWidth` in `shared/proportional-text.ts`. Both the text composer and
`PixelCanvas` use those, deliberately: a one-character disagreement between them
truncates every row twice, and the second cut lands mid-word with no marker.

Row 1 is still the fixed-width 3×5 font, which is fine because it genuinely is
fixed-width. The old row-0 "4×6" font was not — 82 of its 96 glyphs were 3px of
ink in a 4px cell — and it is deleted, not kept as a fallback.

`busy-font.ts` is **OFL-1.1**, not MIT. It is the one file in the package under a
different licence; the notice in `LICENSE` has to travel with it.

## 5. Priority and notifications

The priority engine decides what the display shows. Two rules matter for anyone
changing it:

- **Never hardcode a ranking.** Which events outrank which is the user's
  configuration in the priority panel. In the shipped ordering Lunch and Away sit
  above both notification classes, so notifications correctly do not interrupt a
  break — that is the panel working, not a bug to fix.
- **One event produces exactly one `evaluateRequest`.** Evaluating twice takes
  the display lock twice under different names, and the release then never
  matches the lock actually held. This has already shipped once.

## 6. Code standards

- **SOLID, and DIP in particular.** Constructors take their dependencies; a
  service that reaches for a singleton cannot be tested. `new
  ProjectRepository()` resolving the `DatabaseConnection` singleton is why the
  test suite once wrote a real database to disk.
- **Fail fast.** Validate arguments at the top and throw `ArgumentNullException`
  / `ArgumentException`.
- **Providers report failure by throwing**, never by returning `[]`. An empty
  array is indistinguishable from "this user has no tasks", and treating one as
  the other deleted local data.
- **No magic numbers.** Constants belong in a named module —
  `render-constants.ts`, `sync-constants.ts`, `priority-defaults.ts`.
- **Never write an empty `catch`.** If a failure is genuinely safe to swallow,
  the comment must say why.
- **No floating promises in main.** An unhandled rejection terminates the
  process on Node 15+; it is an ESLint error there and a warning in the renderer.
- **Async Electron lifecycle handlers do not work.** Electron does not await
  `will-quit`, so an `async` handler's teardown after the first `await` never
  runs. Use `preventDefault()` + `app.exit(0)`.

### Naming

TypeScript uses `PascalCase` types, `camelCase` members, `_camelCase` private
fields. The Unity plugin is C# and follows C# conventions (`IPascalCase`
interfaces, `PascalCase` methods).

### Tests

- `MethodName_StateUnderTest_ExpectedBehavior`, e.g.
  `UploadAsset_ValidFile_ReturnsSuccess`.
- **Test the behaviour, not the implementation you just wrote.** A suite that
  asserted a high-priority notification evaluated to priority 95 passed happily
  while the feature was broken end to end, because nothing produces 95.
- Prefer a real collaborator to a stub where it is cheap. Use
  `new DatabaseConnection(':memory:')`, not the singleton.
- Tests must not spawn PowerShell against the developer's own machine or leave a
  database behind.

### Comments

Document **why**, not what. The reader can see what the code does; what they
cannot see is which constraint, bug or hardware quirk forced it. Comments that
restate the code are noise — comments recording a trap are the most valuable
thing in this repository.

## 7. Where the data lives

`%APPDATA%\SprintTicker\sprintticker.db`, for both `pnpm dev` and an installed
build.

They used to differ. Electron derives `userData` from `productName`, falling
back to `name` when it is absent, and only `electron-builder.json` set one --
so development wrote to `%APPDATA%\@busy-app\desktop-app` while the installer
wrote to `%APPDATA%\Antigravity BUSY Bar Companion`. Nobody chose that; it
meant installing the packaged app looked like losing all your history.
`productName` is now set in `packages/desktop-app/package.json` as well, which
is what keeps the two agreeing.

The consequence to be aware of: **development shares the real database.** A
migration you are testing runs against your actual worklogs. Use
`new DatabaseConnection(':memory:')` in tests -- never the singleton -- and copy
the file before trying anything destructive.

**A shell inside a packaged app does not see that path directly.** The Claude
desktop app ships as an MSIX package, and processes launched from its integrated
terminal inherit the container's filesystem redirection: a file written to
`%APPDATA%\SprintTicker\` from there also appears under
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\SprintTicker\`.

The practical rule is narrow but worth stating, because a whole afternoon went
into rediscovering it: **do not trust a database inspection performed from an
agent's shell.** During one session that shell reported zero projects while the
running app's own log and UI showed twenty-five, and the contradiction was never
resolved -- entirely plausibly because the two were not looking at the same
physical file. Verify state from an ordinary terminal, or from the app's own
logging, and treat anything an agent reports about this file as a hypothesis.

The same caution applies to *writing*: a backup or restore performed from such a
shell may not land where the installed app will look for it.

## 8. Commit identity

This repository is configured with a **repo-local** author identity:

```
user.name  = Istalry
user.email = 7848814+Istalry@users.noreply.github.com
```

The global `~/.gitconfig` points at a corporate address that has no business on
a personal project, and history was rewritten once already to remove it. That
rewrite does not change `git config`, so the very next commit reintroduced the
old address and had to be amended. If you clone this repository somewhere new,
set the local config before committing.

## 9. Documentation is part of the change

**A change that alters observable behaviour updates its document in the same
commit.** Not afterwards, not in a follow-up: documentation that lags is worse
than none, because a reader trusts it.

Which document depends on what moved:

| You changed | Update |
| :--- | :--- |
| An IPC channel, an HTTP route, `ITaskProvider`, the device contract | `Documentation/API.md` |
| A component's responsibilities, the data model, how a flow works | `Documentation/ARCHITECTURE.md` |
| Anything a user sees, does, or has to troubleshoot | `Documentation/USER-GUIDE.md` |
| A command, a threshold, a requirement, a feature | `README.md` |
| Anything at all worth a release note | `CHANGELOG.md` § Unreleased |
| The plan, or an item finished or abandoned | `ROADMAP.md` |
| A trap, a constraint, or a rule the next agent must not break | this file |

**`docs/index.html` is generated — never edit it.** It is the three documents
above rendered into one page for GitHub Pages by `scripts/build-docs.js`:

```bash
pnpm docs:build    # rebuild it after editing any Documentation/*.md
pnpm docs:check    # fail if it is out of date -- this runs in CI
```

It was briefly a hand-maintained second copy, which is the duplicated-constant
hazard from §3 in different clothes: nothing fails when two copies disagree, and
the reader trusts whichever they opened. `docs:check` in CI is what makes the
Markdown the only source in practice rather than in principle.

Two things the generator relies on, so edit the Markdown with them in mind:

- **Callouts are GitHub alert syntax.** `> [!NOTE]` becomes an aside and
  `> [!WARNING]` / `> [!CAUTION]` / `> [!IMPORTANT]` a trap block; a bold first
  line becomes the callout's label. GitHub renders these natively, so the
  Markdown gains a real callout rather than paying a tax for the page. An
  earlier version guessed the severity from keywords in the label and quietly
  filed "Row 0 has no character capacity" as a gentle aside.
- **`<!-- docs-build:svg=architecture -->` swaps the ASCII diagram** that
  follows it for a drawn one. The ASCII block stays because that is what renders
  on GitHub, where there is no stylesheet to hang an SVG off.

The published Artifact is a third rendering and **cannot be the same file**: the
Artifact runtime injects `<!doctype html><html><head>…<body>` at publish time,
so an Artifact source must not carry those tags and a standalone page must.
Regenerating it means stripping the skeleton off `docs/index.html`.

**Numbers in prose go stale silently, and this repository has already shipped
that.** The README claimed "439 tests across 42 files" and a floor of
78/80/80/68 while `vitest.config.ts` actually enforced 79.5/82/81.5/70.5, and it
listed Jira as roadmap-only for a release that shipped Jira. Nothing failed;
the numbers simply became false. So: when you change a threshold, a test count
or a version, grep the **value you are replacing** across the Markdown before
you finish —

```bash
git grep -n "<the old number>" -- '*.md'
```

Raising the coverage floor, for instance, has to reach `vitest.config.ts`, this
file's command table, the README's quality-gates section and the ROADMAP's
coverage section — four places, and only the first one fails a build when it is
wrong. Treat a figure quoted in two places as the same hazard as a duplicated
constant, because it is one.

Two documents are **deliberately not maintained**, and neither should be
"corrected" to match the code:

- `Documentation/design-history/` — the pre-implementation design documents.
  They describe intent, and are kept for provenance. Where they and the code
  disagree, the code is right and the document stays as written.
- `AUDIT.md` — a dated snapshot of one audit. Findings get a **status**
  (fixed, deferred, withdrawn, closed-as-documented); the finding text itself
  stays as it was written, because rewriting the evidence destroys the record of
  what was actually wrong.

## 10. Reference material

`Documentation/private/` holds BUSY Bar's own OpenAPI specification, example app
and AI teaching pack. It is deliberately untracked: useful locally, not ours to
redistribute.

The specification is **no longer one file**. It lives in the firmware repository,
split per tag and merged by their own `scripts/openapi_merge.py`, so refreshing
it means pulling the directory at the release you care about:

```bash
# every path under applications/services/web_server/openapi/ at that tag
curl -sSf "https://raw.githubusercontent.com/busy-app/busybar-firmware/1.2.3/applications/services/web_server/openapi/assets.yaml"
```

`assets.yaml` is the one that matters here: it carries `/api/display/draw`,
`/api/assets/upload` and the element schemas. Worth knowing before you go
looking, because the older single `BUSY Bar HTTP API Docs.yaml` in this folder
is a merged snapshot and its `info.version` (`25.0.0`) is not a firmware
version — it will not tell you which release it describes.
