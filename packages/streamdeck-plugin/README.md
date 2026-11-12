# SprintTicker for Stream Deck

A plugin for Elgato's Stream Deck app: keys that drive SprintTicker's running
session. It talks to the app on this machine, over the WebSocket described in
[API.md](../../Documentation/API.md#the-stream-deck-socket), and needs
SprintTicker running; with the app closed every key turns grey and says
**offline**, and a press only flashes it.

Windows only, as the app is. Stream Deck 7.1 or later, which runs the plugin
on its own Node 24.

## Actions

Nine actions under **SprintTicker** in Stream Deck's list: drag each onto
any key, as many times as you like. The layout is the user's (2026-11-09):
Session, Interrupt and three answer keys fill five of a Mini's six keys;
Previous task and Recent 1-3 are there to add (0.6.0, S29).

| Action | Shows | A press |
| :--- | :--- | :--- |
| **Session** | the task's key and its time, the bar's icon moving as on the bar, under a band: green while tracking, amber while paused, during an interruption (the bolt and its time) and for a task no longer yours (NOT YOURS). With nothing running, START -- amber **NOT TIMING** in your working hours | pauses or resumes; with nothing running or an interruption running, opens the task picker. Held half a second, opens the task picker whatever runs |
| **Interrupt** | INTERRUPT, or ANOTHER during an interruption, with "3 to place" while interruptions wait | starts an interruption, whatever runs; during one, ends it and starts the next |
| **Previous task** | PREV and the task's key; blank during an interruption | goes back to the task timed before this one |
| **Answer A** | says yes: DONE (two presses), BACK during an interruption, JOIN, WRAP UP, RESUME, START LUNCH, END STAND-UP, DONE ANYWAY | that |
| **Answer B** | stops or waits, keeping the time: STOP, SKIP, NOT NOW | that |
| **Answer C** | throws away: DISCARD, or DISCARD ⚡ during an interruption (two presses); blank while a question waits or nothing runs | that |
| **Recent 1-3** | a recent task's key and START; never the one running | starts it |

- **One meaning per position, one colour** (S29). A is green and says yes,
  B blue-grey and stops or waits, C red and throws away; a key with nothing
  of its kind to do is blank. `answerKind` in `faces.ts` is the table, and
  the face and press are then those of the key the answer stands in for
  (Done's, Yes's...), so no rule is copied. After an interruption A, B and C
  are DONE, STOP and DISCARD again at once: what is left to place is
  counted on Interrupt, and placed in the app.
- **DONE always takes two presses** -- it changes the task at Jira or
  OpenProject, and a habit learned on BACK, the same key, must never mark a
  ticket done. The app refuses an unconfirmed finish from this plugin, so
  the second press cannot be skipped.
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
- **A key that asks first asks on itself.** Done and Discard fill green or
  red -- DONE? or DISCARD? -- and the same key pressed again within four
  seconds goes ahead. Waiting, or another task
  starting, takes the question back.
- **Session is the one key with a long press.** Held, it opens the picker
  as soon as the half second is up, so the window appearing is the sign;
  let go sooner, it pauses or resumes. An answer never depends on how long a
  key is held: Yes and No are two keys, where the bar answers with OK and
  BACK.
- **Yes and No are grey** while nothing is asked. The wrap-up asks twice, as
  on the bar: Yes, then CONFIRM.
- **One-shots.** Done, Stop, Discard and Interrupt play a half-second
  movement of their glyph when pressed, the yes and the no -- A and B too --
  when a question arrives, then rest.
- **update app** under every key means SprintTicker speaks another version of
  the protocol than this plugin: update whichever is older. The plugin names
  its protocol (2) in the socket's URL; an app from before 0.6.0 does not
  know it, while a newer app still serves plugin 0.5 in protocol 1.

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
