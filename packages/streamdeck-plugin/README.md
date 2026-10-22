# SprintTicker for Stream Deck

A plugin for Elgato's Stream Deck app: keys that drive SprintTicker's running
session. It talks to the app on this machine, over the WebSocket described in
[API.md](../../Documentation/API.md#the-stream-deck-socket), and needs
SprintTicker running; with the app closed every key turns grey and says
**offline**, and a press only flashes it.

Windows only, as the app is. Stream Deck 7.1 or later, which runs the plugin
on its own Node 24.

## Actions

Six actions, a Stream Deck Mini's six keys, under **SprintTicker** in Stream
Deck's list: drag each onto any key, as many times as you like.

| Action | Shows | A press |
| :--- | :--- | :--- |
| **Session** | the task's key and its time, the bar's icon moving as on the bar, under a band: green while tracking, amber while paused | pauses or resumes; with nothing running, opens the task picker. Held half a second, opens the task picker whatever runs |
| **Not done** | NOT DONE | ends the session, logs its time; the task stays open |
| **Done** | DONE | ends it and marks the task done |
| **Discard** | DISCARD | throws the session away -- asks first |
| **Yes** / **No** | the answer to what SprintTicker asks | joins or skips the stand-up, wraps up the day or not, resumes a task or leaves it |

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
- **One-shots.** Done, Not done and Discard play a half-second movement of
  their glyph when pressed, Yes and No when a question arrives, then rest.
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
the package test holds them equal -- before packing a change to try. While working on the
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
