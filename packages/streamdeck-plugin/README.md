# SprintTicker for Stream Deck

A plugin for Elgato's Stream Deck app: keys that drive SprintTicker's running
session. It talks to the app on this machine, over the WebSocket described in
[API.md](../../Documentation/API.md#the-stream-deck-socket), and needs
SprintTicker running; with the app closed every key turns grey and says
**offline**, and a press only flashes it.

Windows only, as the app is. Stream Deck 7.1 or later, which runs the plugin
on its own Node 24.

## Actions

Five actions, on a Stream Deck Mini's six keys, under **SprintTicker** in
Stream Deck's list: drag each onto any key, as many times as you like. The
layout is the user's (2026-11-09): Session, Interrupt, and three answer keys
that show whichever answers apply.

| Action | Shows | A press |
| :--- | :--- | :--- |
| **Session** | the task's key and its time, the bar's icon moving as on the bar, under a band: green while tracking, amber while paused | pauses or resumes; with nothing running, opens the task picker. Held half a second, opens the task picker whatever runs |
| **Interrupt** | INTERRUPT | starts an interruption, whatever runs: a timer at once, the task it stops asked about when it ends |
| **Answer A** | DONE; the yes while SprintTicker asks something | ends the session and marks the task done; or says yes |
| **Answer B** | NOT DONE; the no while it asks | ends the session, logs its time, the task left open; or says no |
| **Answer C** | DISCARD, whatever is asked | throws the session away -- asks first |

- **An answer key is the key it stands in for** (`resolveKind` in
  `faces.ts`): its face and its press are exactly Done's, Yes's and so on,
  so it follows no rule of its own. Positive answers are always A, negative
  always B; C never changes, so the one end that keeps nothing cannot move
  under a finger.
- **A press just after an answer key changed meaning only flashes it**
  (`ANSWER_SETTLE_MS`, 700 ms), and a question armed on it is withdrawn: a
  press that soon was aimed at what the key showed before.
- **The five actions the answer keys replace** -- Not done, Done, Discard, Yes, No --
  are still declared and still work, hidden from the list
  (`VisibleInActionsList: false`), so a deck laid out with them keeps its
  keys. `package.test.ts` holds the hidden set to `HIDDEN_KINDS`.

- **The colour is the state.** A coloured glyph can be pressed, a grey key
  has nothing to do, a filled key waits on you. The look was chosen on Stream
  Deck Mobile over two others (2026-10-22).
- **A key that asks first asks on itself.** Discard always, and Done when the
  task is no longer yours, fill red or amber -- DISCARD? or NOT YOURS -- and
  the same key pressed again within four seconds goes ahead. Waiting, or another task
  starting, takes the question back.
- **Session is the one key with a long press.** Held, it opens the picker
  as soon as the half second is up, so the window appearing is the sign;
  let go sooner, it pauses or resumes. An answer never depends on how long a
  key is held: Yes and No are two keys, where the bar answers with OK and
  BACK.
- **Yes and No are grey** while nothing is asked. The wrap-up asks twice, as
  on the bar: Yes, then CONFIRM.
- **One-shots.** Done, Not done, Discard and Interrupt play a half-second
  movement of their glyph when pressed, the yes and the no -- A and B too --
  when a question arrives, then rest.
- **update app** under every key means SprintTicker speaks another version of
  the protocol than this plugin: update whichever is older.

## Build and install

From the repository root:

```bash
pnpm deck:build      # bundle to io.github.istalry.sprintticker.sdPlugin/bin, write imgs/
pnpm deck:validate   # build, then Elgato's own validator on the folder
pnpm deck:pack       # build, then dist/io.github.istalry.sprintticker.streamDeckPlugin
pnpm test:deck       # the tests
```

Double-click the `.streamDeckPlugin` file to install it. **Stream Deck
installs a pack only over an older version**: one with the version already
installed is refused as "already installed", and the old code keeps running.
Raise `version` in `package.json` and `Version` in the manifest together --
the package test holds them equal -- before packing a change to try. The
version is the plugin's own, apart from the app's. A release attaches the
pack as `SprintTicker-StreamDeck-<version>.streamDeckPlugin`, and
`build-windows.yml` first compares it with the previous release's
(`scripts/check-deck-release.js`): changed at the same version, the tag is
refused. While working on the
plugin, `npx streamdeck link io.github.istalry.sprintticker.sdPlugin` (in this
folder, with developer mode on: `npx streamdeck dev`) installs the folder
itself instead, and `npx streamdeck restart
io.github.istalry.sprintticker` reloads it after a build.

## How it is put together

- `src/faces.ts` -- what every key shows and what a press does, as two pure
  functions of the app's state. Everything a user sees is decided here.
- `src/svg.ts` -- a face as an SVG key image, drawn on 144 units, and the
  glyphs part-way through their one-shots.
- `src/controller.ts` -- the keys on the deck: draws each from the state,
  only when its image changes; ticks the session's time once a second, only
  while one runs, and faster while the bar's icon moves (its `motion`, a
  pose a step, read off the clock); arms and disarms the keys that ask first; tells Session's
  long press from a tap; plays a one-shot as six images, holding the
  state's redraws of that key until it ends.
- `src/app-link.ts` -- the line to the app: reconnects with backoff while it
  is closed, and turns a request into its answer or `null`.
- `src/actions.ts`, `src/plugin.ts` -- the SDK's side, and nothing else.
- `src/assets/` -- the build's last step writes the manifest's images:
  the plugin icon (PNG, from the bar's stopwatch bitmap), the list icons, and
  each key's face before the plugin first draws it.

It imports from the desktop app's `src/shared/` and nowhere else -- the
protocol is `shared/deck-protocol.ts`, one file for both sides.

What the tests cannot see is a real deck. The plugin has run on Stream Deck
Mobile against the packaged app (2026-10-22), not yet on a physical deck.
`setImage` never plays an animated image there -- GIF, WebP and animated SVG
all show their first frame -- so anything that moves is frames this plugin
sends.
