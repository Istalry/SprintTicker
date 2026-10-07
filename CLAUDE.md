# CLAUDE.md — working in this repository

The product is **SprintTicker**. "BUSY Bar" is the Flipper FZCO device it
drives, not this project; keep the two apart in anything user-facing.

Guidance for Claude Code and any other AI agent working on BUSY Bar. Read this
before changing code; most of it is knowledge that is expensive to rediscover
and invisible in the source.

## 1. What this is

A pnpm workspace with three packages:

| Package | What it is |
| :--- | :--- |
| `packages/desktop-app` | Electron 44 + React 19 + Vite 8 + Vitest 5 + Tailwind + better-sqlite3 13. Most of the code. |
| `packages/unity-plugin` | A Unity Editor C# package (`io.github.istalry.sprintticker`) that posts editor events to the desktop app. |
| `packages/anim-studio` | The animation scene editor (`pnpm studio`): Vite + plain TypeScript, no React, no Electron. A development tool; nothing in it ships. |

The desktop app tracks time against tasks, drives a physical BUSY Bar LED
display over USB, and mirrors Windows notifications onto it.

## 2. Commands

```bash
pnpm dev              # Vite renderer + preload/main watchers + Electron
pnpm dev:mock         # the same, with no hardware attached
pnpm test             # vitest run, the app then the studio
pnpm test:studio      # the studio's tests only; no native module involved
pnpm test:coverage    # floor: 92% stmts / 93.5% lines / 90% funcs / 85% branches
                      # a ratchet -- raise it, never lower it to make a run pass
pnpm typecheck        # main, renderer and renderer-test tsconfigs, then the studio
pnpm lint             # 0 errors expected; renderer floating-promise warnings are known
pnpm package:win      # electron-builder, unsigned
pnpm editor           # pixel editor for 16x16 bitmaps
pnpm studio           # animation studio on http://127.0.0.1:5180
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
build's step is `clean:dist`, invoked as `pnpm run clean:dist`.

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
passing** (2026-09-30).

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
  stays on top through any number of frame redraws, and `element_ids` removes
  it alone, leaving the frame.
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
  - **Keep the static icon in the frame.** It is the fallback: when the device
    refuses the `.anim`, or a 409 holds the draw off, the bar shows the icon
    still rather than a hole. The emulator follows the same rule and stops
    animating an icon the device refused.
  - **The animation's first frame must be that static icon, exactly**, or the
    bar jumps when the device takes over. Quantising colours to fit the
    palette broke this for most icons while every document said "pixel for
    pixel"; `animation-assets.test.ts` now compares them. Change the bitmap
    and the scene together.
- **Never empty the panel to change screens: emptying it closes the device's
  screen, and that can hang the bar.** When the application's element set
  becomes empty -- a full `DELETE /api/display/draw`, or removing the last
  element by id -- firmware 1.2.4 closes its screen (`canvas_screen_close`)
  and reopens it on the next draw. Measured on 2026-09-30 with ten-round
  loops: closing it while an image and an animation share it hung the bar on
  round 3 and round 4 of two runs; removing the animation by id and closing
  *immediately* hung it on round 6. Uploads slowing from ~50 ms to 300-600 ms
  came first every time; then nothing answered, and the bar sometimes
  rebooted itself about 45 s later. An animation alone closed safely ten
  times, and so did every loop that never emptied the panel. The app now
  follows the second rule everywhere it changes screens:
  - **Scenes go in under the frame and come out under the next one** (make
    before break). `AnimationPlayer` draws `hardware_anim` at
    `FRONT_LAYER_Z.SCENE` (0), below the frame, then removes `px_matrix_img`
    to reveal it. When it ends, the renderer's next frame lands at z 1 over
    the still-playing scene, and only after that frame is `sent` does
    `retireScene` remove the scene -- and not even then if the driver believes
    nothing else is on the panel. Scene draws and removals share one id, so
    they run under a lock: a late removal would take down the scene just
    drawn, with the frame already gone.
  - **The one deliberate close is `clearDisplay`** -- the idle clock and quit,
    which have to hand the display back. The driver tracks every element it
    has drawn (`shownElementIds`), removes each animation by id first, waits
    `ANIMATION_TEARDOWN_SETTLE_MS` (500 ms), and only then clears. **The wait
    is what makes the difference**: without it this is the K case above,
    which hung on round 6; with it, `pnpm probe:busybar --teardown-soak` ran
    ten releases clean on firmware 1.2.4 (2026-09-30), uploads flat at
    24-53 ms throughout. Do not shorten it without re-running that soak --
    deliberately, alone, since a wait that is too short hangs the bar.
    A draw that lands during the wait makes the clear `superseded` instead of
    wiping the screen that replaced the one being released.
  - **Clears run one at a time, and the wait is per clear.** Two concurrent
    clears defeat it: the second finds the animation the first already
    removed, so it has nothing to remove, skips the wait and closes at once
    -- the K case again. That hung the bar twice on 2026-10-05, from three
    clears one Unity compile end sent in the same millisecond. `clearDisplay`
    now queues behind the clear in progress, and one that finds the panel
    known to be empty sends nothing. "Known" means a clear emptied it: a
    previous run may have left a screen this driver never drew, so the first
    clear after start always sends.
  - **The driver is the one guardian of these rules; callers are not.** Every
    display and asset request goes through one queue (`displayQueue`, a
    `SerialQueue`), and each carries a guard that runs at the head of it,
    after every earlier request has answered. A `DisplayLedger` records what
    the panel holds, and from it the guards: skip a removal of an element
    known to be absent, a clear of a panel known to be empty, an upload over
    the `.anim` an element is playing; and make anything that could empty the
    panel -- a clear *or* a removal -- wait out the settle after the last
    animation left, whoever removed it. Four components draw (frames, the
    animation player, the icon animator, the idle clock's clear) and none
    sees the others, so a rule kept by callers was kept by luck: the stress
    test found a clear and a scene crossing in flight and closing the screen
    on both, on the stop-a-task path. **A new request that touches the panel
    goes through `queued()`**, and records what it changed before it returns.
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

The app posts toasts of its own (`ProviderEventService`), and two things about
them are traps:

- **The AppUserModelID must equal electron-builder's `appId`.** Windows shows a
  toast for an ID it can tie to a Start-menu shortcut, and the installer writes
  `appId` onto that shortcut. They differed (`com.busybar.desktop`), and a test
  now holds `APP_USER_MODEL_ID` in `app-identity.ts` to the JSON. A packaged
  build with no shortcut at all was measured showing toasts under the right
  name and icon (2026-10-01), so the portable build is fine.
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
  `new DatabaseConnection(':memory:')`, not the singleton.
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
  upload over a playing `.anim` -- and checks every request against §4: the
  close rules that hung the bar, colours, ASCII text, fill colour counts,
  names, priority, the rear display. A test that breaks a rule on purpose
  names it in `allow`; anything else fails with the requests that broke it.
  **A rule measured on the bar goes into the simulator**, so every display test
  starts checking it. `formatTrace()` prints the requests with their status
  and the panel after each, which is how a failure is read.
- **`display-stress.test.ts` plays generated days against the simulator**:
  seeded mixes of Unity, banners, the session and Lunch/Away, some in one
  tick, over a device with latency, through the whole real stack. It is what
  catches the bugs no single source causes -- the 10-05 hang was one. A
  failure prints its seed and script; `STRESS_SEED=<seed>` replays it with
  the device trace, and `STRESS_RUNS=2000` runs a longer campaign (about 15 s).
  Animations are read from disk once before the runs, because under fake
  timers a real file read lands at an arbitrary point of simulated time and a
  seed would not replay.

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
one open session, no foreign key broken. The rules are
`src/main/db/migration-check.ts`, tested, and hold any future migration to the
same standard; the script only copies and prints. Migrations 5 and 6 were
checked this way. Ask the user to run it from an ordinary terminal and paste
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
