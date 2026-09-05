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
pnpm test:coverage    # thresholds: 80% statements/lines/functions, 70% branches
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
- **Draw priority must be ≥ 95** for the app to hold the display.
- **Status codes carry meaning.** `409` is a priority conflict (something else
  owns the display — not a failure), `413` is a payload too large (permanent;
  retrying sends the same bytes), `503` means retry. See
  `classifyDeviceResponse`.
- **RTC timestamps need a UTC offset, not `Z`.** The device applies no
  conversion, so `toISOString()` leaves the bar showing UTC.

The bar answers on the fixed address `10.0.4.20` over USB and needs no token
there. That is not a hardcoded shortcut; it is how the device works.

**The front display is a rasterised 72×16 PNG.** Every frame is an asset upload
plus a draw — two HTTP requests. Before adding anything that redraws on a timer,
check what actually changes: `transmitFrame` deduplicates by hashing the frame,
and the timer deliberately shows `HH:MM` rather than seconds for this reason.

The rear 160×80 OLED is **preview only** in this build. `buildRearElements` feeds
the on-screen emulator; `transmitFrame` sends the front matrix and nothing else.

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

## 9. Reference material

`Documentation/private/` holds BUSY Bar's own OpenAPI specification, example app
and AI teaching pack. It is deliberately untracked: useful locally, not ours to
redistribute. Fetch it from [github.com/busy-app](https://github.com/busy-app).

`Documentation/design-history/` holds the pre-implementation design documents.
They describe intent, not the shipped system, and are not maintained.
