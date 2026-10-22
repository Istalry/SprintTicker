# CLAUDE.md — working in this repository

The product is **SprintTicker**. "BUSY Bar" is the Flipper FZCO device it
drives, not this project; keep the two apart in anything user-facing.

Guidance for Claude Code and any other AI agent working on BUSY Bar. Read this
before changing code; most of it is knowledge that is expensive to rediscover
and invisible in the source.

## 1. What this is

A pnpm workspace with four packages:

| Package | What it is |
| :--- | :--- |
| `packages/desktop-app` | Electron 44 + React 19 + Vite 8 + Vitest 5 + Tailwind + better-sqlite3 13. Most of the code. |
| `packages/unity-plugin` | A Unity Editor C# package (`io.github.istalry.sprintticker`) that posts editor events to the desktop app. Its scripts compile only because `.asmdef` files own them (see below). |
| `packages/anim-studio` | The animation scene editor (`pnpm studio`): Vite + plain TypeScript, no React, no Electron. A development tool; nothing in it ships. |
| `packages/streamdeck-plugin` | A plugin for Elgato's Stream Deck app (`io.github.istalry.sprintticker.sdPlugin`): Node 24 + `@elgato/streamdeck` 3, bundled by Vite. Keys that drive the session over the app's WebSocket. Ships on its own, as a `.streamDeckPlugin`. |

The desktop app tracks time against tasks, drives a physical BUSY Bar LED
display over USB, and mirrors Windows notifications onto it.

## 2. Commands

```bash
pnpm dev              # Vite renderer + preload/main watchers + Electron
pnpm dev:mock         # the same, with no hardware attached
pnpm test             # vitest run, the app, the studio, then the Stream Deck plugin
pnpm test:studio      # the studio's tests only; no native module involved
pnpm test:deck        # the Stream Deck plugin's tests only; no native module either
pnpm test:coverage    # floor: 92% stmts / 93.5% lines / 90% funcs / 85% branches
                      # a ratchet -- raise it, never lower it to make a run pass
pnpm typecheck        # main, renderer and renderer-test tsconfigs, the studio, the plugin
pnpm lint             # 0 errors expected; renderer floating-promise warnings are known
pnpm package:win      # electron-builder, unsigned
pnpm editor           # pixel editor for 16x16 bitmaps
pnpm studio           # animation studio on http://127.0.0.1:5180
pnpm deck:validate    # build the Stream Deck plugin, run Elgato's validator on it -- in CI
pnpm deck:pack        # build it into dist/*.streamDeckPlugin
pnpm fonts:build      # compile packages/desktop-app/fonts/*.glyphs into shared/fonts/
pnpm fonts:check      # fail if a generated font is stale -- this runs in CI
pnpm fonts:preview "text"   # print text in every font, in the terminal
pnpm db:check-migration [db]  # migrate a COPY of the real database, report losses
```

**better-sqlite3 needs no rebuild, for either runtime.** Version 13 is an
N-API addon (`NAPI_VERSION=10`) and ships one binary per platform in
`prebuilds/`; `lib/win32-x64.js` loads `prebuilds/win32-x64.node`
unconditionally. Node 24 (ABI 137, for Vitest) and Electron 44 (ABI 149) load
that same file -- measured on 2026-10-01, by loading it in both on `:memory:`.
N-API is what makes the ABI number irrelevant.

This used to be the worst trap in the repository: `pretest` rebuilt for Node,
`predev` rebuilt for Electron, and a skipped one failed with
`NODE_MODULE_VERSION`. With 13 both rebuilds had become no-ops -- nothing in
the package had changed since the install a month before -- so they are gone.
`runtime-dependencies.test.ts` fails if a future version stops being N-API or
stops shipping the Windows prebuild, which is the day this paragraph needs its
old content back.

`pnpm-workspace.yaml` sets `better-sqlite3: false` under `allowBuilds`. The
package carries a `binding.gyp`, so pnpm runs `node-gyp rebuild` on it when
allowed -- a run that compiles nothing, because the gyp file detects the
prebuild, but that still needed Python and MSVC on a fresh machine. Removing
the entry instead does not work: pnpm then fails the install with
`ERR_PNPM_IGNORED_BUILDS` and writes `set this to true or false` into the file.
For the same reason `electron-builder.json` sets `npmRebuild: false`: its
rebuild ran `node-gyp rebuild --runtime=electron` at every package, built
nothing, and the project files it left in `build/` shipped in
`app.asar.unpacked`. A packaged Electron 44 loads the prebuild as it is
(measured on 2026-10-01 with the packaged exe under `ELECTRON_RUN_AS_NODE`).

The history behind it, still worth knowing: upgrading Electron 30 to 44 made
better-sqlite3 11 fail to *compile* -- hard C++ errors, because V8 had changed
underneath it (`v8::External::Value()` gained an isolate parameter,
`PropertyCallbackInfo::This` was removed). 11 was built against V8 directly;
13 is not, which is why an Electron major no longer implies a better-sqlite3
review, and why Dependabot no longer holds back its majors.

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

`eslint-plugin-react-hooks` is on 7 with its full `recommended-latest` set --
the React Compiler rules, not just `rules-of-hooks` and `exhaustive-deps`. The
one that shapes renderer code is **`set-state-in-effect`**, and it is stricter
than it reads: it flags any call in an effect's body to a local function that
sets state, **even when the state is only set after an `await`** -- the
compiler does not model `await`, so an `async` loader called from `useEffect`
is always a finding. State set in a `.then` callback or a subscription
callback is fine. The idioms that came out of fixing its 16 findings:
- A read an effect starts is a promise chain, or a stateless reader whose
  answer is applied in `.then` (`useWorklogs`).
- "Loading" is derived where it can be -- the day read versus the day
  selected -- rather than a flag raised before the request. The derived form
  also drops a late answer for a previous selection.
- A flag that is true only because the bridge is missing is a lazy
  `useState` initialiser, not an `else` branch in the effect.
- A modal that must start clean on every opening mounts its content only when
  open, so `useState` initial values are the reset.

**pnpm refuses versions younger than its minimum release age -- and `pnpm
add` quietly writes an exception for them.** Adding `lucide-react@^1.49.0`
the day 1.49.0 shipped did not fail: pnpm appended `minimumReleaseAgeExclude:
[lucide-react@1.49.0]` to `pnpm-workspace.yaml` and installed it, which is
the supply-chain policy switched off for that package by a side effect. A
later install then rejected the lockfile outright. Check
`git diff pnpm-workspace.yaml` after every `pnpm add`; if the exclusion
appeared, revert it and ask for the newest version old enough instead (1.48.0
there). An exclusion is a decision for the user, not something to keep
because a tool wrote it.

**`dependencies` is what ships, not what the code uses.** electron-builder
packs every `dependencies` entry into app.asar, while Vite has already bundled
everything main and the renderer import except the externals in
`vite.config.electron.ts`. So a package the renderer uses belongs in
**devDependencies**, and `dependencies` is exactly the non-builtin externals --
today `better-sqlite3` and `ws`. `runtime-dependencies.test.ts` holds the two
lists equal: React and lucide in `dependencies` were 39 MB of a 42 MB asar,
and an external missing from `dependencies` would crash only the packaged app
on its first `require`, never `pnpm dev`.

**The build targets are a pair with the Electron version**, like
better-sqlite3. `build-targets.ts` holds Electron's Node and Chromium versions,
read off Electron itself; its test fails when the installed Electron major
moves. Read the new ones with `ELECTRON_RUN_AS_NODE=1 npx electron -p
"JSON.stringify(process.versions)"`. `@types/node` belongs to the same pair:
its major is Electron's Node major, Dependabot is told to ignore its majors,
and raising it is part of the Electron upgrade, never a PR of its own.

**Never name a script `clean`.** pnpm 11 has a built-in `pnpm clean`, which
deletes `node_modules`, and a built-in shadows a script of the same name. The
build's step is `clean:dist`, invoked as `pnpm run clean:dist`. **Nor `pack`**:
`pnpm --filter <plugin> pack` ran pnpm's own and left an npm tarball at the
repository root (2026-10-22), so the plugin's is `pack:plugin`, reached
through the root's `deck:pack`.

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
- **The renderer names things; main decides what to open.** A task page is
  opened by task id (`tasks:open-page`): main builds the URL from the
  provider's configured site and opens it only if it is http(s) there
  (`isOpenableTaskPage`). `shell.openExternal` launches any protocol
  handler it is handed, and a key or id is synced data.
- `src/preload/electron-api.d.ts` declares the `window.electronAPI` global. The
  `: IElectronAPI` annotation on the bridge object is load-bearing — it is what
  turns preload/renderer drift into a compile error.

**The animation studio imports from `desktop-app/src/shared/` and nowhere else
in the app.** It reads the app's fonts and `isValidDeviceHost` in place rather
than copying them; main or the renderer would drag Electron, better-sqlite3 or
React into a tool that was split out to stay clear of them. An ESLint error, as
above. Two more things about it that cost time to find:

- **Its server code is loaded by the dev server, never imported by
  `vite.config.ts`.** The config uses `ssrLoadModule('/server/api.ts')`. Import
  it directly and every start prints a wall of warnings: Vite's coming native
  config loader cannot load extensionless TypeScript imports from across the
  workspace. For the same reason the studio imports the app's fonts by relative
  path rather than through an alias.
- **Before making or judging an animation, read
  `packages/anim-studio/STYLE-GUIDE.md`.** It is what the official animations
  measurably do. Only the icon moves, and it moves smoothly. Every action rests
  afterwards, and a loop ends on its first frame. Our art is drawn from
  scratch: the originals are CC-BY-SA, so a traced copy would carry that
  licence.
- **Its device calls go through `scripts/lib/busybar-device.js`**, shared with
  the probe. It is typed on the studio side by `DeviceModule` in
  `server/export.ts`, since `scripts/` is untyped JavaScript; change the two
  together.
- **`seq2anim.py` is GPL-2.0-or-later, and must stay a separate process.**
  `scripts/busybar-anim-toolchain/` is the firmware's compiler, and the one
  part of the repository that is not MIT. The studio, the probe and
  `build-anims.js` call it with `execFile`, which keeps the GPL at arm's length.
  Porting it to TypeScript, importing it, or copying the firmware's own TS port
  would bring our code under the GPL. If you change the script, add the change
  and its date to its header: GPL-2.0 requires a modified file to say so.

**The Unity plugin compiles in Unity, never here, so nothing here sees it
break.** Unity compiles no script in a package that no `.asmdef` owns, and
the plugin had none until 2026-10-16: both editors open that day skipped it
with a console warning, neither had ever compiled it, and the bar heard
nothing from them while the tests, the stress run and `docs:images` --
all replayed events -- passed. `unity-plugin-package.test.ts` now fails on a script outside an
assembly or an asset without its `.meta`. Two more things follow:
- **Its API floor is Unity 2021.3** (`package.json` `unity`), and an error
  there blocks the user's whole project from entering Play Mode. Check a
  Unity API's version before using it: its first real compile failed on
  `SceneManager.loadedSceneCount`, which 2021.3 does not have.
- **Projects link it, they do not copy it.** The injector makes a junction
  to the plugin folder it resolves first -- for a packaged build,
  `dist-electron/win-unpacked/packages/unity-plugin` -- so a change reaches
  the editors at their next compile once that folder has it.

**The Stream Deck plugin reaches the app over a WebSocket, and a key does
what a click or a press already does.** `DeckActionService` holds no rule of
its own, and must not grow one: ending a session is `completeSession`, shared
with the window's IPC; a prompt is answered by OK or BACK through
`InputDecoder`, so the wrap-up's two presses and the stand-up's switch stay
in one place; the picker is the tray's. A key with its own copy of a rule
is the duplicated-constant hazard below, with a session at stake. Four more
things about it:
- **`Origin` is the whole defence of the socket.** A browser opens a
  cross-origin WebSocket with no CORS check, so the content-type rule that
  stops a web page's POST does not exist for an upgrade. `WebhookServer`
  refuses any handshake carrying an `Origin` before a handler sees it.
- **The protocol is `shared/deck-protocol.ts`, and nothing else.** The plugin
  is built apart from the app and imports that file alone; a message shape
  kept in two places would drift with nothing failing.
- **Close the decks before the HTTP server.** An upgraded socket still counts
  as one of the server's connections, so `stop()` would wait on a deck that
  never hangs up.
- **A window opened for the deck must be raised past Windows' foreground
  lock.** The press reaches Stream Deck, not this app, and Windows refuses
  the foreground to a process the user is not using: `focus()` only flashes
  the taskbar while `isFocused()` answers true, so the picker opened behind
  the app in front (Stream Deck Mobile, 2026-10-22). `setAlwaysOnTop` and
  `minimize()` + `restore()` fail the same way; `ForegroundRaiser`
  (`AttachThreadInput` from PowerShell, ~0.8 s) works. Measuring it needs
  another app in front that the *user* chose: a process this shell starts
  while the agent's own window has the foreground inherits the right to it,
  and every method then passes.

**The plugin itself, `packages/streamdeck-plugin`, runs inside Elgato's
app, so nothing here sees it on a deck** -- the Unity plugin's situation.
What a key shows and does is two pure functions (`faces.ts`), tested for
every kind and state; `package.test.ts` holds the manifest to the code and
to what the build writes; `pnpm deck:validate` runs Elgato's validator in
CI. Five things about it cost time to find:
- **`imgs/` and `bin/` are build output**, never edited and never tracked.
  The keys' default images are the faces the plugin draws, rendered at
  build time by `src/assets/write-assets.ts`, so the two cannot drift; the
  manifest's plugin icon must be PNG, which `png.ts` writes with
  `node:zlib` rather than adding an image library. The build empties
  `imgs/` first: an image of a removed action would otherwise ship.
- **A pack installs only over an older version.** Stream Deck answers one
  with the installed `Version` "already installed" and keeps running the old
  code, with nothing else saying so (2026-10-22). Raise the version -- the
  manifest's and `package.json`'s, held equal by `package.test.ts` --
  before handing over a pack to try, or use `streamdeck link` while working.
  The version is the plugin's own, never the app's (the user's choice,
  2026-10-22), so no tag raises it: `build-windows.yml` unzips the previous
  release's pack and the new one and refuses the tag when they differ at
  the same version (`scripts/check-deck-release.js`). Pack against pack:
  `streamdeck pack` leaves out `plugin.js.map`, so the built folder never
  matches. A dependency that changes the bundle counts as a change.
- **`bin/package.json` says `"type": "module"`, and is generated too.**
  The bundle is ESM, and without it Stream Deck's Node reads `plugin.js` as
  CommonJS and fails on the first `import`.
- **A key image goes to the SDK as base64 with its type**
  (`svgDataUrl`). It also takes a bare SVG string, but every face carries
  `#` in its colours, which a URL reading of the image takes for a fragment.
  **And `setImage` never animates**: an animated GIF or WebP, or SVG with
  SMIL or CSS animation, shows its first frame (Stream Deck Mobile,
  2026-10-22). Only a manifest state image plays as a GIF, and only on the
  device. A face that moves is the plugin sending frames, which worked at
  about 13 fps: `DeckController.play`, whose frames hold off the state's
  redraws of that key until they end -- so anything that must show at once
  on a playing key, as a question arming it does, stops the one-shot
  first. The Session key's moving icon is frames too, read by the app from
  `Animations/` and sent once as poses: **those frames are opaque black
  around the icon**, an unlit LED on the bar and a dark square on a key, so
  `framePixels` reads pure black as nothing.
- **An answer never depends on how long a key is held** -- the user's
  rule, 2026-10-22. A question (DISCARD?, NOT YOURS?) is asked on the same
  key and answered by pressing it again within `CONFIRM_WINDOW_MS`; yes and
  no are separate keys. The one long press is Session's, which opens the
  picker (`hasLongPress`), also the user's choice; that key acts when it
  comes up, every other as it goes down. And the app refuses Done and Discard without
  `confirmed` when they must ask, so the plugin cannot skip the second press
  -- when the app asks where the state had not said it would, the key arms
  from that refusal (`needs-confirmation`).

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
  periodically, because drift is what produced the 19 seconds -- the same bar
  read **29.7 seconds** behind three weeks later (2026-09-29).
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
  `STATUS_DEVICE_HARDWARE_ERROR`. Ten targeted fixes changed nothing, and
  neither did an in-place repair upgrade of Windows — it completed, rebuilt the
  driver store, re-selected the same `usbncm.inf`, and the interface still came
  up Code 10, so do not suggest it again as though it were untried. The working
  recovery is to pass the device through to another network stack and proxy it
  back on a *different* address. A bar reachable only at `10.0.4.21` is still a
  bar.

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
only that the app owns the display. Last run: **firmware 1.2.4, all checks
passing** (2026-09-30). **`--compositing` still removes animations by id**,
the operation that hangs the bar now and then (below): run it knowing that,
and expect to restart the bar. The teardown soak takes the flags that
measured it -- `--rounds <n>`, `--icon <name>`, `--reupload`,
`--close-with-anim`, `--park` and `--swap-in-place` -- and each is a
deliberate risk of a hang too: ask before running one, one at a time.

It also reads the panel back and writes every frame out as a PNG (`--out <dir>`,
default a temp directory), because the questions worth asking of a *display* are
about layout and a status code cannot answer those. That is how the countdown
element was measured at 17×5px and how `z_index` was shown to genuinely reorder
overlapping elements rather than merely being accepted on a draw. When you add a
check here, prefer one that looks at pixels over one that reads a status code.

The animation check is the clearest case of why. It uploads the **largest real
`.anim` in `Animations/`** — the app's own file, at ~0.3–0.6 MB, not a token —
draws it, and captures the panel twice 700 ms apart. Three outcomes that a
status code cannot tell apart are then distinguishable: the device refused the
file, the device accepted it and drew nothing, and the device is genuinely
animating it. That third one is only provable by two frames differing. The
probe talks to `BUSYBAR_IP` if it is set, so a proxied bar is
`BUSYBAR_IP=10.0.4.21 pnpm probe:busybar`.

- **A draw merges by element id; it does not replace the element set. And
  `px_matrix_img` composites above `hardware_anim` in either order.** These two
  together cost a fortnight. `sendPixelFrame` draws the front matrix as an
  element called `px_matrix_img`, opaque across the whole 72×16 panel. Every
  animated mode in `DisplayRenderer` clears the canvas, hands the front display
  to `AnimationPlayer`, and then transmits that blank canvas — so a full-panel
  **black** image lands on top of the animation and stays there. The upload
  returns 200, the draw returns 200, the log says the device is playing the
  file, and the bar is black. Drawing the animation afterwards does not help;
  only removing the image does, which is why `startHardwareAnimation` removes
  `px_matrix_img` once the scene is down and `transmitFrame` skips the
  hardware send while `isHardwareAnimationActive()`. Measured on firmware 1.2.3
  by replaying both draws against a real bar and reading the panel back. It
  used to call `clearDisplay` for this, which is the next trap.
- **`z_index` decides that stacking, and PNG alpha is respected.** "Either
  order" above is *draw* order. Given `z_index`, an animation element does
  draw above a full-panel opaque image, and below it when the numbers are
  swapped. A transparent pixel in an image shows the animation beneath it. So
  an animated 16×16 icon can play at x=0 beside a text image at x=17, or under
  a full-panel image with a transparent hole, at no HTTP cost per frame.
  Replacing only the text image, which is a merge by id, leaves the icon
  playing. All measured on firmware 1.2.3 with `pnpm probe:busybar
  --compositing` (2026-09-29), which reads the panel back twice for every case.
  That check draws at priority 100 with element timeouts, so it runs with the
  app open.
- **Animated icons use exactly that layering, and three things about it are
  traps.** `px_matrix_img` is drawn at `z_index` 1 with the icon's *static*
  pixels in it; `IconAnimator` draws `icon_anim`, the 16×16 `.anim`, at
  `z_index` 2 over them (`FRONT_LAYER_Z`). Measured on firmware 1.2.4: the icon
  stays on top through any number of frame redraws, and drawing another icon
  under the same id swaps it in place -- 200 swaps in a row (`pnpm
  probe:busybar --teardown-soak --swap-in-place`, 2026-10-07). It is never
  removed by id; see the next rule.
  - **Draw the icon with `drawOverlay`, never `sendDisplayPayload`.** The
    latter bumps `displayVersion`, so a frame whose upload is still in flight
    abandons its draw as `superseded` -- and the icon lands over the
    *previous* screen's text.
  - **Removing an element that is not there answers 400**, not 404, which the
    driver reports as `rejected`. A clear for the idle clock, or another
    application taking the panel, leaves the icon's removal finding nothing.
    Read a 400 on a removal as "already gone" (`isElementAbsent`), or every
    render retries it -- but only a 400: a 500 says nothing about the element.
  - **A removal naming several ids is all or nothing.** The firmware checks
    every id before removing any (`canvas_element_destroy_multi`), so one
    missing id answers 400 and removes *none* of the others. Remove one id per
    request wherever one may already be gone.
  - **The idle clock leaves the icon to its clear** (`leaveToClear`), which
    closes the screen and takes the icon with it at no cost -- and only a
    clear that went through (`'cleared'`) says the icon is gone. One
    overtaken by a newer screen leaves it playing: lunch stopping a task
    drew the sandwich during the clear, and the stopwatch played over it
    for the whole break (real bar, 2026-10-16). Likewise a reset makes the
    icon *unknown*, never "none": a removal that failed while the bar was
    away left it playing when it came back (stress seed 1026). Unknown, the
    next `show(null)` parks it, and the ledger sends nothing when the panel
    is known to hold no icon.
  - **Keep the static icon in the frame.** It is the fallback: when the device
    refuses the `.anim`, or a 409 holds the draw off, the bar shows the icon
    still rather than a hole. The emulator follows the same rule and stops
    animating an icon the device refused.
  - **The animation's first frame must be that static icon, exactly**, or the
    bar jumps when the device takes over. Quantising colours to fit the
    palette broke this for most icons while every document said "pixel for
    pixel"; `animation-assets.test.ts` now compares them. Change the bitmap
    and the scene together.
- **Never remove a playing animation by id: put it to rest.** On firmware
  1.2.4 a `DELETE /api/display/draw` naming an animation that is playing
  hangs the bar now and then -- the HTTP API stops answering and the panel
  freezes on the animation, until someone restarts it. Measured on
  2026-10-07, without the app: the probe froze it on the 30th removal of the
  gear icon and, with the icon uploaded again each round, on the 59th; the
  app froze it after about 13 and 36. The 1.2 KB pause icon survived 100. No
  warning comes first -- uploads stayed flat at ~23 ms right up to it,
  unlike the 09-30 hangs below -- and ten rounds, the soak that once called
  this safe, pass by luck. So `removeDisplayElements` never sends an
  animation's id: it draws the empty animation (`blank-animation.ts`, one
  transparent 16×16 frame, 80 bytes, compiled by `seq2anim.py` from
  `Animations/blank_16x16/`) under the same id and layer, which is the swap
  in place measured safe. The element stays listed, showing nothing, until
  the screen closes. The simulator reports any removal of an animation by id
  as `animation-removed-by-id`.
  - **"At rest" must be certain.** After a park whose draw got no answer the
    element may still be playing what it played before, so the next removal
    parks it again rather than skipping it.
- **Never empty the panel to change screens: emptying it closes the device's
  screen, and that can hang the bar.** When the application's element set
  becomes empty -- a full `DELETE /api/display/draw`, or removing the last
  element by id -- firmware 1.2.4 closes its screen (`canvas_screen_close`)
  and reopens it on the next draw. Measured on 2026-09-30 with ten-round
  loops: closing it while an image and an animation share it hung the bar on
  round 3 and round 4 of two runs; removing the animation by id and closing
  *immediately* hung it on round 6 -- which the rule above now reads as the
  removal, not the close. Uploads slowing from ~50 ms to 300-600 ms came
  first every time; then nothing answered, and the bar sometimes rebooted
  itself about 45 s later. An animation alone closed safely ten times then,
  and 100 times in a row on 2026-10-07 (`--teardown-soak --close-with-anim`),
  and so did every loop that never emptied the panel. The app follows the
  second rule everywhere it changes screens:
  - **Scenes go in under the frame and come out under the next one** (make
    before break). `AnimationPlayer` draws `hardware_anim` at
    `FRONT_LAYER_Z.SCENE` (0), below the frame, then removes `px_matrix_img`
    to reveal it. When it ends, the renderer's next frame lands at z 1 over
    the still-playing scene, and only after that frame is `sent` does
    `retireScene` put the scene to rest -- and not even then if the driver
    believes nothing else is on the panel. The next scene is drawn over the
    resting one, under the same id. Scene draws and retirements share that
    id, so they run under a lock: a late retirement would blank the scene
    just drawn, with the frame already gone.
  - **The one deliberate close is `clearDisplay`** -- the idle clock and quit,
    which have to hand the display back. It removes the *images* beside any
    animation, one id per request, waits `ANIMATION_TEARDOWN_SETTLE_MS`
    (500 ms) after the last removal, and closes the screen on the animations
    alone, which it never removes. That is the release `pnpm probe:busybar
    --teardown-soak --park` ran 100 times in a row on firmware 1.2.4
    (2026-10-07); it costs about half a second of black between the frame
    leaving and the firmware's clock. A close with no wait after a removal
    has not been measured, so do not shorten the wait without re-running
    that soak -- deliberately, alone. On a panel the driver cannot vouch for
    (the first clear after start, or after an outage) it removes the frame
    whatever it lists, in case a previous run left one beside an icon. A
    draw that lands during the clear makes it `superseded`, and stops its
    removals too, instead of wiping the screen that replaced the one being
    released.
  - **Clears run one at a time.** Three clears one Unity compile end sent in
    the same millisecond hung the bar twice on 2026-10-05: the second found
    the animation the first had removed and closed at once. `clearDisplay`
    queues behind the clear in progress, and one that finds the panel known
    to be empty sends nothing. "Known" means a clear emptied it: a previous
    run may have left a screen this driver never drew, so the first clear
    after start always sends.
  - **After an outage, redraw what is current; never replay.** The driver
    used to resend the frame left pending when the bar came back. On
    2026-10-07 the bar froze on BUILDING 40%, was restarted, and came back
    showing it: the clear for the build's end had failed while it was away,
    and clears are not pending frames. Now any outage -- a failed ping, or
    just a request that got no answer between two good pings -- makes the
    driver forget what the panel holds, drop the pending frame and emit
    `reconnected`, and the renderer draws the screen of whoever holds the
    display, or the user's mode. The same goes for turning no-bar mode off.
    An outage shorter than the ping interval matters: a Lunch scene whose
    upload failed in one streamed PNG frames for the whole break.
    **Forget at the loss, not at the return** (`loseTrackOfDevice`): requests
    answered after the bar came back describe the panel after the outage.
    Forgotten at the ping that saw it back, a clear answered just before was
    lost, and the redraw cleared the empty panel again -- a removal answered
    400 and a second close of a closed screen (stress seed 1670).
  - **The driver is the one guardian of these rules; callers are not.** Every
    display and asset request goes through one queue (`displayQueue`, a
    `SerialQueue`), and each carries a guard that runs at the head of it,
    after every earlier request has answered. A `DisplayLedger` records what
    the panel holds, and from it the guards: skip a removal of an element
    known to be absent, a clear of a panel known to be empty, an upload over
    the `.anim` an element is playing -- or may be playing, after a draw over
    it got no answer; put animations to rest instead of removing them; and
    make anything that could empty the panel -- a clear *or* a removal --
    wait out the settle after the last removal, whoever made it. Four
    components draw (frames, the
    animation player, the icon animator, the idle clock's clear) and none
    sees the others, so a rule kept by callers was kept by luck: the stress
    test found a clear and a scene crossing in flight and closing the screen
    on both, on the stop-a-task path. **A new request that touches the panel
    goes through `queued()`**, and records what it changed before it returns.
  - **The run-up to a hang is recorded, not acted on.** `DisplayHealthMonitor`
    keeps the last ten upload times, the screen closes of the last hour and
    the requests the ledger skipped, in `DeviceStatusDTO.displayHealth` and so
    in every diagnostics bundle; a median above `DEVICE_LATENCY_WARNING_MS`
    (250 ms) logs one warning per episode. Doing something on that signal --
    fewer redraws, no closes -- has not been measured on a bar, and is a
    decision of its own.
  - **An upload over an `.anim` the device is playing answers 508** ("Failed to
    open file for writing"). Restarting the scene that is still on the panel
    therefore draws it from the copy the device holds instead of uploading it
    again, and uploads once more only if that draw is refused.
  - **The probe follows the same rule.** `--compositing` keeps a transparent
    floor element under every case so removing the case never empties the
    panel, and closes once at the end, animations first. It used to clear
    between cases -- a dozen image-plus-animation closes in a row.

**The front display is a rasterised 72×16 PNG.** Every frame is an asset upload
plus a draw — two HTTP requests. Before adding anything that redraws on a timer,
check what actually changes: `transmitFrame` deduplicates by hashing the frame,
and the timer deliberately shows `HH:MM` rather than seconds for this reason.
The seconds are the tracking stopwatch's hand: an animated icon the device
plays, which costs nothing per frame and keeps its own time. Do not "sync" it
to the session by redrawing; that is the per-second traffic this avoids.

**The rear 160×80 display is the firmware's, by choice.** Left alone, firmware
1.2.4 shows there a copy of the front at twice the size under a header, and its
own clock and date when the front is empty. The user chose that over anything
the app would draw (2026-09-30), and the app sends nothing with `display:
'back'` -- a test pins it. An element drawn there *replaces* the mirror, so
anything that draws on the rear is a product decision first. Measured with
`pnpm probe:busybar --rear`, for whoever revisits it:
- **An image draws on the rear**, so the app could rasterise it in its own
  fonts as it does the front. The firmware's text fonts are small there --
  capitals 4 to 10px tall -- which is what the user noticed first.
- **A status column is always drawn over it at x 148-159** (volume, Wi-Fi,
  USB, battery). An application owns 148×80, not 160×80.
- **Colour becomes luminance, 16 greys.** The readback is 4-bit grey, 6400
  bytes, high nibble first: pure red reads 68, green 153, blue 17. The greys
  are distinct on the physical panel.

**Both text rows are proportional, so neither has a character capacity.** Row 0
is set in Sprint 5, row 1 in the condensed Sprint Small. Both are our own fonts,
drawn as ASCII art in `packages/desktop-app/fonts/*.glyphs`. The generator
`tools/glyphs-to-ts.js` compiles them into `shared/fonts/sprint-*.ts`.
- **Edit the sheet, never the generated file**, then run `pnpm fonts:build`.
  `fonts:check` fails CI when the two disagree.
- **The generator refuses a sheet** that is missing a printable ASCII character,
  that draws two characters identically, or that leaves a blank edge column.
  Those rules are the fixes for what the previous row-1 font got wrong: 55
  missing characters that drew as `?`, and `g` identical to `q`.

The running timer is set in a third font, **Sprint Bold 7** (`TIMER_FONT`):
7px, 2px strokes, capitals, digits and some punctuation, **no lowercase**, so
draw nothing in it but a time. It is also the studio's two-line title face.
Its sheet lives in the app's `fonts/` because the app cannot import from the
studio; the studio reads the generated file from `shared/fonts/`, as it does
the row fonts. Bold 9 is the studio's alone and stays there.

`i` advances 2px and `M` advances 6, so anything asking "does this fit" must call
`measureText` / `fitToWidth` in `shared/proportional-text.ts`, **with the font
the text will be drawn in**. The font is a required argument for that reason.
The composer and `PixelCanvas` both take it from `ROW0_FONT` / `ROW1_FONT` in
`shared/fonts/pixel-font.ts`. A one-character disagreement between them
truncates every row twice, and the second cut lands mid-word with no marker.

Constraints a new glyph must keep:
- Digits share one width, in all three fonts, so a running timer does not
  shift.
- Row 1's capitals stay within the ascent: the paused screen draws STOP and
  FINISH inside 7px highlight bars.
- Row 0's descenders end above y=8, where row 1 starts.

The tests pin all three. `pnpm probe:busybar --font-sheet` shows every glyph on
a real bar, because legibility on the LEDs is not something a unit test can
judge.

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
- **And its end produces exactly one render, the engine's.**
  `releaseActiveLock` hands the display back to the user's mode itself
  (`setContextMode`) when it frees the lock it names, and does nothing when
  that lock is not the one held. So a service ending its screen releases and
  stops there: rendering the idle or session screen after the release draws
  twice, and idle, twice is two clears of the device's screen at once (§4).
  `UnityTelemetryService` did exactly that on every compile, Play Mode exit
  and exception end, which also wiped any banner that had taken the display
  in the meantime. It is what hung the bar on 2026-10-05.
- **Who gets the display back is the engine's decision, in one order.**
  Freeing a lock replays a queued alert first; then resumes the most
  important screen a preemption set aside (`_suspended`, redrawn through
  `DisplayRenderer.resumeScreen`); then offers the display to the background
  states (`addBackgroundScreen`); and only then hands it to the mode. Each
  step exists because its absence shipped: a build under a banner came back
  as the idle clock with the build still running; a compile refused under a
  banner never drew at all. Releasing a lock that is not held removes it
  from the set-aside list -- that screen ended while covered.
  **One exception, by the user's own scores:** a background state ranked
  above everything queued or set aside is offered first, and background
  states are offered highest first, never in the order they registered.
  Unity ranks below the alerts, so for it nothing changes; the bar's picker
  (97) does not, and lost the display to a banner queued under Away.
- **Unity's screens are states, not alerts.** `UnityTelemetryService`
  registers as a background screen and redraws whatever the editors are
  doing *now* when the display frees; its locks are never set aside or
  queued. Its operations are per editor instance: one global operation let
  the first of two projects to finish take the other's gear down. A compile
  inside a build belongs to the build and ends with it.
- **The bar's open picker is a state too.** It is never queued (each press
  redraws it), so under Away it was refused and then forgotten: open,
  invisible, still taking presses, while Away's end handed the display to
  the clock, Unity or Lunch. `InputDecoder` registers it as a background
  screen that redraws itself while open; Desk registers the same.
- **Modes and the tracker are not claims to restore.** The idle clock is the
  user's mode: the idle branch of `renderActiveSession` leaves alone any
  holder but the tracker, and drops the tracker's lock with the session
  (`handBack: false`, since it is itself what handing back draws). Lunch and
  Away are never queued (`queueOnPreempt: false`): a Lunch refused during
  Away replayed when Away ended, holding a Lunch lock back in WORK. A screen
  granted over a mode's looping scene stops it (`endModeSceneFor`), or the
  frame waits behind the sandwich for good.
- **A one-shot scene ends on the holder's screen**, through
  `grantedScreens`, not on the session: DONE! during Play Mode used to end
  on the idle clock with Play Mode still holding the lock.
- **A screen that redraws on every press is never queued.** The bar's
  picker (`menuPriority`) had no rule, sat at the default 50 under Lunch, and
  START during lunch opened it invisibly. It has a rule now, above Lunch, and
  passes `queueOnPreempt: false`: a copy queued under Away replayed after the
  user had closed it, holding the display for nothing.
- **Lunch never overrides the user.** `ContextScheduleService` listens to the
  engine: a session *going* TRACKING during lunch ends Lunch for the day
  (`lunch_skipped_date`) and drops the stored restart (`lunch_resume`). Its
  own restart runs after the switch to WORK, which is how it is told apart.
  **The engine's listeners hear every tick**, once a second while a session
  runs, so "going TRACKING" means a new session id or a resume, never a
  notification that merely says TRACKING: read that way, the first tick of
  lunch -- the check runs every 30 s -- skipped lunch whenever a task was
  running (found on the real bar, 2026-10-15).
  Anything that restarts a task on the user's behalf checks
  `TaskRepository.isListed` first and asks when it is not. A yes tracks the
  task and takes nothing back: `startTask` neither saves its row -- `saveTask`
  un-archives -- nor sends In Progress for a task archived or seen unlisted,
  and the session reads as unlisted at once, before the next sync.
- **The stand-up's restart waits for the listeners.** `joinStandup` keeps
  the task it stopped (`standup_resume`) and restarts it when the stand-up's
  session ends -- which the service learns from inside the engine's
  `notifyListeners`. Starting a task there runs a second notification inside
  the first: every listener after this one is then handed the *ended*
  session, and the IPC registry's render draws the idle clock over the task
  just started. So the restart is a `queueMicrotask`. Anything else that
  starts or stops a session from an engine listener has the same trap.
- **Lunch stops the session under Away too.** Lunch never *leaves* Away --
  Away outranks it -- and that used to mean it never began at all: locked at
  12:30, the session ran on and the break was logged as work. The check now
  stops it and keeps the restart while staying Away, and `exitAwayMode`
  goes straight to LUNCH during the lunch hours (stopping a session the
  machine slept through the start of), never WORK first: WORK and then LUNCH
  at the next check is two renders, and a session started in between reads
  as working through lunch. **AWAY to LUNCH lets go of Away's lock**
  (`setUserMode`), which outranks Lunch: kept, the mode said LUNCH while the
  bar showed the coffee cup. It is dropped, not released -- the mode draws
  next -- and only a background state ranked above the new mode, the bar's
  picker, is offered the display first.
- **Days off silence the entries, never the exits.** The stand-up, entering
  Lunch and the wrap-up ask `WorkingCalendar` first; leaving Lunch and Away
  does not, or a LUNCH mode would outlive its hour into a holiday. The
  holidays are a cache read asynchronously, so a check answers from what the
  last read found: a failed read must keep the previous days, never empty
  them. **A week closes once** (`last_week_closed`), at the wrap-up of its
  last working day or at the next working day's first check -- anything that
  acts on the close (a timesheet submission) hangs off `onWeekEnded` and
  inherits that guarantee rather than keeping its own.

The app posts toasts of its own (`ProviderEventService`), and two things about
them are traps:

- **The AppUserModelID must equal electron-builder's `appId`.** Windows shows a
  toast for an ID it can tie to a Start-menu shortcut, and the installer writes
  `appId` onto that shortcut. They differed (`com.busybar.desktop`), and a test
  now holds `APP_USER_MODEL_ID` in `app-identity.ts` to the JSON. A packaged
  build with no shortcut at all was measured showing toasts under the right
  name and icon (2026-10-01), so the portable build is fine.
- **"Sending time stopped" is told once per stop, and told late.** The
  worker parks a row on refused credentials (`auth`) silently -- only the
  queue panel showed it -- so `onSendingStopped` fires on the first such row
  per provider, and again only after new credentials or a send that went
  through. It replays a stop to a listener that subscribes afterwards: the
  first queue pass runs from `engine.initialize()`, before main wires
  `ProviderEventService`, and an overnight-expired token is found exactly
  there. The toast ignores `showToasts`, which is about the user's tasks.
- **Our own toasts reach the bar once, from the app -- never through the
  listener.** The listener skips every ID in `OWN_APP_USER_MODEL_IDS`, on the
  database path *and* the WinRT path; the latter used to skip nothing. Let it
  mirror them and each event lands on the bar twice, under two locks.
- **Jira's events are a search, not a feed**, and two things keep it honest.
  The window is relative JQL (`updated >= -Nm`), never a date: JQL reads a
  date in the Jira profile's timezone. And every change authored by the
  user's own account id is dropped -- the app moves statuses for them, and
  each move would otherwise come back as a notification a minute later.

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
  **And a 200 is not proof the credentials work.** Jira Cloud answers an
  expired or revoked token as an anonymous caller -- searches come back 200
  and empty, only `/myself` says 401 -- so an expired token emptied the
  project list at every sync. `JiraProvider` checks `/myself` before the reads
  the prune depends on. The fake used to 401 everything, which is why no test
  saw it; it now answers like Jira. Found 2026-10-02 on the user's own site.
- **`BusyBarDriver` commands throw too.** Every command (`uploadAsset`,
  `clearDisplay`, `sendDisplayPayload`, `sendPixelFrame`, `injectRemoteKey`,
  and the rest) throws a `DeviceRequestError` whose `kind` says why:
  `disconnected`, `unreachable`, `conflict`, `too_large`, `busy` or `rejected`.
  A bad asset filename is an `ArgumentException`. Two answers that are not
  failures come back as values, and you must read them:
  - `sendDisplayPayload` resolves `'drawn' | 'conflict'`. A `409` means another
    application owns the display, which is the device working as designed.
  - `sendPixelFrame` resolves `'sent' | 'queued' | 'superseded' | 'conflict'`.
    `superseded` means a clear landed mid-upload and **the device is not showing
    this frame**.

  `connect()` and `reconfigure()` still answer a boolean on purpose: they are
  probes, and "the bar is not there" is a normal answer for them. The getters
  answer `null` for "unknown".

  It used to be the other way round, and that shipped the same bug twice. Every
  command answered `Promise<boolean>` and never threw, so `.catch()` was dead
  code for the failure that actually happens and `.then()` ran regardless. The
  animation player chained
  `uploadAsset(...).then(() => sendDisplayPayload(...).catch(...)).catch(...)`,
  which asked the device to draw an asset it had refused to store. The bar went
  blank while the on-screen emulator animated correctly, because the emulator is
  fed by `onFrameCallback` and never touches hardware. Neither handler fired, and
  the log said only that the animation had loaded. The renderer's "forget the
  frame so it is resent" logic sat in the same kind of dead `.catch()`.

  An ignored rejection is a lint error in main (`no-floating-promises`), and
  `.then(` is banned under `src/main/hardware/**`, so this cannot silently come
  back. When a preview and the hardware disagree, still suspect the failure
  path before anything else.
- **No magic numbers.** Constants belong in a named module —
  `render-constants.ts`, `sync-constants.ts`, `priority-defaults.ts`.
- **Never write an empty `catch`.** If a failure is genuinely safe to swallow,
  the comment must say why.
- **Do not delete the working path in the commit that adds the faster one.**
  `9b9f3bd` introduced hardware `.anim` playback and removed frame streaming for
  any animation that had one, in a single change, so the new path had no floor
  under it: when the device refused the file there was nothing left to fall back
  to, and the only visible symptom was a dark bar. Land the new path with the
  old one still reachable on failure; remove the old one later, as its own
  change, once the new one has run against real hardware.
- **No floating promises in main.** An unhandled rejection terminates the
  process on Node 15+; it is an ESLint error there and a warning in the renderer.
- **Async Electron lifecycle handlers do not work.** Electron does not await
  `will-quit`, so an `async` handler's teardown after the first `await` never
  runs. Use `preventDefault()` + `app.exit(0)`.
- **A login item is read back, never remembered, and `openAtLogin` is not
  the answer.** Measured on Electron 44 (2026-10-22): `openAtLogin` stayed
  false with the Run value present; `executableWillLaunchAtLogin` is true
  while it exists and false once Windows' Startup apps switch it off.
  `launchItems[].args` reads `[]` while the value carries `--hidden`. And
  any write approves the entry again, undoing that switch-off -- so
  `LaunchAtLoginService.refresh()` rewrites only an entry still enabled.
  Register `PORTABLE_EXECUTABLE_FILE` when it is set (the portable build's
  `execPath` is a temp folder gone by the next login), and nothing from
  `pnpm dev`, whose `execPath` is a bare electron.exe.

### Naming

TypeScript uses `PascalCase` types, `camelCase` members, `_camelCase` private
fields. The Unity plugin is C# and follows C# conventions (`IPascalCase`
interfaces, `PascalCase` methods).

### Tests

- `MethodName_StateUnderTest_ExpectedBehavior`, e.g.
  `UploadAsset_ValidFile_ReturnsSuccess`.
- **The renderer has its own Vitest project**, in jsdom, under
  `tests/renderer/*.test.tsx`; everything else runs in Node. Its
  `window.electronAPI` is `tests/renderer/electron-api-mock.ts`, typed as the
  whole `IElectronAPI` -- so **a method added to the bridge must be added to
  the mock**, or `pnpm typecheck` fails (`tsconfig.renderer-tests.json`; the
  tests are type-checked nowhere else). That failure is the point: a partial
  mock would let a view call something the bridge no longer has and pass on
  `undefined`. `installElectronApi({ ... })` swaps in other answers for one
  test; `emit` pushes an update the way main would. The views guard their
  bridge calls, so a smoke test does not catch a missing method at runtime --
  the typed mock catches it at compile time. The renderer is still outside
  `coverage.include`.
- **Test the behaviour, not the implementation you just wrote.** A suite that
  asserted a high-priority notification evaluated to priority 95 passed happily
  while the feature was broken end to end, because nothing produces 95.
- Prefer a real collaborator to a stub where it is cheap. Use
  `new DatabaseConnection(':memory:')`, not the singleton -- and not a file
  named by `Date.now()` either. Two suites started in the same millisecond
  opened the same one, and the second failed migrating a schema the first
  had built (`duplicate column name`): the test that failed once in eight
  runs, in two files, until 2026-10-14.
- Tests must not spawn PowerShell against the developer's own machine or leave a
  database behind. **Every service that shells out takes its executor by
  constructor** -- `SystemAutomationService`'s `CommandExecFn`,
  `UnityInjectorService`'s `GitRunner`, `AppIconResolver`'s runners -- and a
  test passes a fake. A path override is not enough: the injector had one and
  still ran `git config --global` for real, *writing* the test's temp file into
  the global config of any machine where `core.excludesfile` was unset.
  The same goes for localhost: the wrap-up's Unity scene save is an injected
  `UnitySceneSaver`, because the default POSTs to every Editor open on the
  machine, and the wrap-up tests used to save the developer's scenes.
- **If the code checks a result, there is a test where that result is the bad
  one.** Every mock in this suite defaults to success, so a failure branch that
  is never mocked false is never executed by anything, and a dead handler looks
  exactly like a working one. The `.anim` regression survived a full green run
  for that reason alone. When you add an `if (!ok)`, add the test that reaches
  it in the same change.
- **A test that drives the display through the real driver runs on
  `FirmwareSimulator`** (`tests/support/firmware-simulator.ts`) and ends with
  `expectClean()`. The simulator answers like firmware 1.2.4 -- merge by id,
  all-or-nothing removals, an empty element set closes the screen, 508 on an
  upload over a playing `.anim` -- and checks every request against §4: an
  animation removed by id, the close rules that hung the bar, colours, ASCII
  text, fill colour counts, names, priority, the rear display. `offline` and
  `reboot()` take the bar away; `visible()` and `isShowing()` leave out the
  animations put to rest, which stay on the panel showing nothing. A test that breaks a rule on purpose
  names it in `allow`; anything else fails with the requests that broke it.
  **A rule measured on the bar goes into the simulator**, so every display test
  starts checking it. `formatTrace()` prints the requests with their status
  and the panel after each, which is how a failure is read.
- **`display-stress.test.ts` plays generated days against the simulator**:
  seeded mixes of Unity, banners, the session, Lunch/Away and the bar
  dropping out or rebooting, some in one tick, over a device with latency,
  through the whole real stack. It is what catches the bugs no single source
  causes -- the 10-05 hang was one, and a Lunch scene streaming frames after
  an outage shorter than a ping was another. A failure prints its seed and
  script; `STRESS_SEED=<seed>` replays it with the device trace, and
  `STRESS_RUNS=2000` runs a longer campaign (about 35 s).
  Animations are read from disk once before the runs, because under fake
  timers a real file read lands at an arbitrary point of simulated time and a
  seed would not replay. Two editors are open, and every run ends by
  checking the panel against the state (`expectSettledScreen`): an editor
  still compiling has the gear, idle has an empty panel, and so on.
- **A bug a seed finds becomes a scripted case** in
  `display-handback.test.ts`, on the same `Desk` (`tests/support/desk.ts`).
  A seed shows the bug; only a script keeps it shown once the generator's
  weights change. Check the case fails on the code before the fix.

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

**A build that adds a migration is checked on real data before it ships.**
`pnpm db:check-migration` copies the database (with its `-wal`), migrates the
copy, and compares the two sides: no worklog lost except to a recovered
session, no second of tracked time lost, every orphaned task id named, at most
one open session, no foreign key broken, no row of the provider queue
lost. The rules are
`src/main/db/migration-check.ts`, tested, and hold any future migration to the
same standard; the script only copies and prints. Migrations 5, 6, 8, 9, 10, 11
and 12 were checked this way. Ask the user to run it from an ordinary terminal and paste
the output -- for the reason below, its answer from an agent's shell describes
a file that may not be theirs.

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

**Never `DELETE FROM tasks`.** `worklogs.task_id` is a foreign key (migration
5), so deleting a task with logged time fails -- by design, because the paths
that used to do it left history naming ids nothing could resolve. Tasks leave
through `retireTasks`, which deletes the untouched ones and archives the rest,
and anything listing tasks filters `archived_at_utc IS NULL`. A worklog is
written only after `ensureTaskExists`, because a session's task can vanish
while it runs.

**Time is wall clock; an absence across a change of day is asked about.** A
session's time is now minus its start minus its pauses, so an absence the
same day counts as work -- a meeting away from the desk is work. One across
midnight is not assumed either way: `ForgottenSessionService` pauses the
session at the user's last activity (`pauseSessionAt`) and asks, and nothing
is logged or sent until they answer. Overtime is never interrupted -- input
moves the presence on every minute -- and no time the user has not
confirmed is ever sent. Presence is read *before* it is recorded, at every
check: recorded first, the evidence of the absence is gone.

**A worklog never spans local midnight.** The providers file a worklog under
the day it began (`started_at_utc`), so a session across midnight is split
when it ends (`splitWork` in `shared/work-split.ts`): a worklog per local day,
and another after any pause of the user's `splitPauseMinutes` (15; 0 never).
Each piece is its own worklog and its own queue row, so its own marker. Four
things to keep:
- **Split at the end, never on a timer.** A midnight timer would move the
  session's start, which the forgotten-session check reads, would send hours
  nobody confirmed, and misses midnight on a machine asleep. Every end goes
  through `finishSession`; split there.
- **The pieces add up to the session's total**, the same number STOP has
  always logged and the LOGGED screen shows. Rounding, and a clock set back
  during a pause (below), are settled on the longest piece. Recompute the
  pieces from the pause rows alone and the jump is lost again.
- **A piece too short for the provider joins its longer neighbour**
  (`mergeShortPieces`), locally too, so the history and the provider hold
  the same entries. Thirty seconds after midnight is otherwise a worklog
  Jira refuses, and that time gone.
- **A pause set retroactively has no row** (`pauseSessionAt`). `stopSession`
  counts it (`pausesUntilNow`); `stopSessionAt` does not, because the end the
  user chose may lie after it.

**A negative pause is the clock set back, and it is right.** Paused at 10:00
and resumed at 09:30 on a corrected clock, the pause measures -30 min -- and
`now - start` is short by those same 30, so the session's total is exact.
Never clamp it to zero: that is what the audit first proposed, and it would
have dropped the jump from every such session. Anything that recomputes time
from the pause rows must count a row resumed before it was paused as negative
(`workedSecondsUntil`); the forgotten-session path did not, and logged 90
minutes of a two-hour session that STOP logged as 120. `splitWork` keeps the
rule by settling its pieces on that total rather than summing pause rows.

**A session's time goes to the provider its task came from**, recorded on
the session when it starts (`active_sessions.provider_id`, migration 9),
never to whichever provider is active when it ends: a Jira issue's numeric
id sent to OpenProject can name a real, different work package. Two values
are not providers. `sprintticker` is a project made in the app, whose time
stays here and which the sync never deletes. `local` is the column's old default, which every OpenProject
project held because that adapter did not name itself -- it means *not
known*, never "made here", and keeps the old rule of the active provider.
An adapter's `getProjects` must set `providerId`.

**A row sent before is looked for before it is sent again.** Neither Jira nor
OpenProject takes an idempotency key, so a POST whose answer was lost -- a
timeout, a dropped connection, the app closing mid-request -- may already be
recorded, and posting it again bills the time twice. The worker searches by
the row's marker whenever `send_attempts` (migration 11) says an earlier
attempt was made, and a failed search fails the attempt rather than sending
blind. Never reset `send_attempts`: `retry_count` is the retry *budget* and is
reset on purpose, which is why it could not answer this.

**A correction to a sent worklog goes through the queue, behind its send.**
`WorklogCorrectionService` rewrites the local row and queues an `UPDATE` or
`DELETE` that names the `CREATE` row it corrects (`origin_sync_id`);
`getPendingQueueItems` holds it until that send has arrived. Never call a
provider's `updateWorklog` or `deleteWorklog` from anywhere else: a direct
call runs ahead of a send still in flight and names no entry, and a lost
network loses the correction. Two things keep the entry findable: the
comment of every correction ends with the *original* row's marker, never its
own, and an id the provider did not give is never stored -- the adapters
used to invent one (`jira_wl_<time>`), indistinguishable from a real id.

**Listed is not mine.** The sync keeps the user's open work, every open task
nobody is assigned and a teammate's task in progress (`keptByDefaultScope`),
and each row says whose it is (`tasks.ownership`, migration 12) -- read from
the assignee on the task, never from which query found it: OpenProject needs
three queries for that set, and a custom one says nothing about owners.
Three things follow:
- **"Still the user's" checks the owner.** `isListed` is false for a
  teammate's task, so nothing restarts it unasked, and a session on one reads
  `taskUnlisted` / `reassigned` while the task stays listed. The engine
  re-sends the session when the owner changes, since the sync's unlisted set
  never moves for a task that is still found.
- **Only the user's own task is moved to In Progress.** A teammate's is
  tracked as it is; one nobody has is not moved before it is taken.
- **The adapters need the user's identity** to tell owners apart -- Jira's
  `/myself`, OpenProject's `/api/v3/users/me` -- and throw without it, like
  any read the prune depends on.
- **Taking a task reads before it writes, and never takes it from anyone.**
  Starting an unassigned task assigns it (`assignToMe`, after the session is
  down) only if the provider still says nobody has it; OpenProject's PATCH
  carries the `lockVersion` read, so a 409 means someone edited it -- read
  again and decide again, once. Measured on a real OpenProject 17.9
  instance on 2026-10-16, race included; Jira has no conditional write and reads just before the PUT. Taken meanwhile, the row is recorded as
  theirs and the session reads `reassigned` with `taskOwnerName`. A failure
  is told and never queued: a retry later acts on a choice the user may have
  dropped.
- **The store lists every owner; the lists filter.** `getTasksByProjectId`
  answers all of them, and each list applies the task visibility
  (`shared/task-visibility.ts`) and the order (`shared/task-order.ts`) --
  the window in the renderer, the bar's picker in main, one rule in shared
  for both. A list that reads tasks without them shows a teammate's work the
  user hid, in an order the bar does not use.

**The sync never retires the task of the open session.** A task reassigned,
closed or moved on the provider leaves the user's scope, and the prune used
to retire it mid-session -- deleted, when nothing was logged on it yet -- so
finishing it as done found no row and silently did nothing.
`OfflineSyncWorker.protectTasks` keeps it, and its project, until the session
ends, and `ActiveSessionDTO.taskUnlisted` says it has left the list. Marking
such a task done asks the user first, in the window and on the bar: their
completion transition would move a task that is no longer theirs. The sync
then asks the provider why (`getTaskStanding`, `taskLeftBecause`) -- at every
sync, since a task reassigned can be closed afterwards -- and a task
*closed* there is finished without asking and **without a transition** --
sending one moved an OpenProject work package out of Closed again. Every
place that decides goes through `finishNeedsConfirmation` in
`shared/task-left.ts`, so the window, the mini timer and the bar cannot
disagree.

**Ad-hoc time is never queued.** It has no ticket on any provider: queued
for the active one, Jira was asked to log time on an issue called
`adhoc_...`, answered 404, and the row ended in the failed queue. It stays
in local history.

**OpenProject 17.9 has no `work_package` filter on time entries.** Time can
be logged on a meeting, so an entry belongs to an entity: filter by
`entity_type` + `entity_id`. A real 17.9 instance answered `work_package` 400, which failed
every resend's search there; the fake passed it because it
accepted whatever it was sent. It now refuses it as 17.9 does, and
`timeEntryFilters.mode = 'legacy'` plays an older instance, which the
search falls back to on a 400. Check a new filter or field against a real
instance, not the fake.

**The open session copies its task's key and title, so it follows them.**
`active_sessions` stores both at start, and the bar and the window read them
from there, not from `tasks`. After every committed sync (`onSynced`) the
engine copies them again from the task row and notifies once -- only when
they differ, since every redraw is two requests to the bar. Ad-hoc sessions
are left alone: their name is the user's, and it is the worklog's comment.

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

**The pictures live once, in `docs/images/`, and are generated.** The README
reaches them as `docs/images/…`; `Documentation/*.md` as `../docs/images/…`,
which GitHub resolves and `build-docs.js` rewrites to `images/…` for the page
Pages serves from `docs/`. Never copy one beside the Markdown -- the
duplicated-constant hazard again, in binary. Four things about them:

- **`pnpm docs:images` makes them**, and a change to a screen remakes its
  picture in the same commit, like any other document. `capture-app.js` runs
  the built app on a throwaway profile under `--mock-hardware`, fills it with
  invented projects, and records the frames the app sends its emulator;
  `make-images.py` renders those, and every scene and icon in `Animations/`,
  as the LED panel. Never capture the real profile: development shares the
  real database (§7), so its pictures would publish the user's own task names.
- **Close SprintTicker and Unity before running it.** The Unity events it
  replays go to port 39123, and if the installed app owns that port they reach
  the real bar; the script refuses to start while anything answers there.
  Every Unity editor open on the machine posts to that port too, so a real
  project's console errors land in the pictures -- the first run published
  one, `Plugins: Failed...`, on the emulator. The script stops if any editor
  but its own connects.
- **Not LFS, and on a budget.** `.gitattributes` keeps LFS to `Animations/`
  on purpose. Animated clips are WebP rather than GIF -- the LED bloom made the
  Away scene a megabyte as a GIF, 110 KB as WebP -- and screenshots are
  paletted PNG. `make-images.py` fails on anything over 300 KB.
- **An emoji in a heading moves its GitHub anchor**: `## 🚀 Installation` is
  `#-installation` there. Grep for `](#` and `.md#` when you add or change
  one. The page's own anchors ignore emoji, so `docs/index.html` links do not
  move.

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
