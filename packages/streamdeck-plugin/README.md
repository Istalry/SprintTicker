# SprintTicker for Stream Deck

A plugin for Elgato's Stream Deck app: keys that drive SprintTicker's running
session. It talks to the app on this machine, over the WebSocket described in
[API.md](../../Documentation/API.md#the-stream-deck-socket), and needs
SprintTicker running; with the app closed every key says **OFFLINE** and a
press only flashes the key.

Windows only, as the app is. Stream Deck 7.1 or later, which runs the plugin
on its own Node 24.

## Actions

Each is an action in Stream Deck's list, under **SprintTicker**: drag it onto
any key, as many times as you like.

| Action | Shows | A press |
| :--- | :--- | :--- |
| **Session** | the task's key and its time, the bar's icon; PAUSED when paused | pauses or resumes; with nothing running, opens the task picker |
| **Not done** | NOT DONE | ends the session, logs its time; the task stays open |
| **Done** | DONE | ends it and marks the task done |
| **Discard** | DISCARD | throws the session away -- asks first |
| **Switch task** | SWITCH TASK | brings the window forward with its task picker |
| **Favourite task** | the task you chose | starts that task |
| **Yes** / **No** | the answer to what SprintTicker asks | joins or skips the stand-up, wraps up the day or not, resumes a task or leaves it |
| **Away** | AWAY, or BACK TO WORK | sets you away, and back |

- **A key that asks first asks on itself.** Discard always, and Done when the
  task is no longer yours, turn into DISCARD? or NOT YOURS? -- press the same
  key again within four seconds to go ahead. Waiting, or another task
  starting, takes the question back.
- **A key never means two things by how long it is held.** Yes and No are two
  keys for that reason, where the bar answers with OK and BACK.
- **Yes and No are dimmed** while nothing is asked. The wrap-up asks twice, as
  on the bar: Yes, then CONFIRM WRAP-UP.
- **A Favourite is set in its panel**: click the key in Stream Deck and pick a
  task from the list SprintTicker sends. The key keeps the task's name, so it
  still reads while the app is closed. A task that has left every list is
  kept, marked, and refused when pressed.
- **UPDATE APP** on every key means SprintTicker speaks another version of
  the protocol than this plugin: update whichever is older.

## Build and install

From the repository root:

```bash
pnpm deck:build      # bundle to io.github.istalry.sprintticker.sdPlugin/bin, write imgs/
pnpm deck:validate   # build, then Elgato's own validator on the folder
pnpm deck:pack       # build, then dist/io.github.istalry.sprintticker.streamDeckPlugin
pnpm test:deck       # the tests
```

Double-click the `.streamDeckPlugin` file to install it. While working on the
plugin, `npx streamdeck link io.github.istalry.sprintticker.sdPlugin` (in this
folder, with developer mode on: `npx streamdeck dev`) installs the folder
itself instead, and `npx streamdeck restart
io.github.istalry.sprintticker` reloads it after a build.

## How it is put together

- `src/faces.ts` -- what every key shows and what a press does, as two pure
  functions of the app's state. Everything a user sees is decided here.
- `src/svg.ts` -- a face as an SVG key image, drawn on 144 units.
- `src/controller.ts` -- the keys on the deck: draws each from the state,
  only when its image changes; ticks the session's time once a second, only
  while one runs; arms and disarms the keys that ask first.
- `src/app-link.ts` -- the line to the app: reconnects with backoff while it
  is closed, and turns a request into its answer or `null`.
- `src/actions.ts`, `src/plugin.ts` -- the SDK's side, and nothing else.
- `src/assets/` -- the build's last step writes the manifest's images:
  the plugin icon (PNG, from the bar's stopwatch bitmap), the list icons, and
  each key's face before the plugin first draws it.

It imports from the desktop app's `src/shared/` and nowhere else -- the
protocol is `shared/deck-protocol.ts`, one file for both sides.

What the tests cannot see is a real deck: nothing here has run on a device
yet. The plugin has been run under a stand-in for the Stream Deck app,
speaking its registration and key events to the built bundle, against the
packaged app (2026-10-22).
