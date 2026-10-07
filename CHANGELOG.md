# Changelog

## Unreleased

## 1.2.1 — 2026-10-07

A bar that stays up, and shows what is going on. On 2026-10-05, 1.2.0 hung
the bar twice in one day of Unity work, each time needing a restart by hand:
the end of a compile redrew the idle screen twice, and the two clears skipped
the pause the device needs before closing its screen. That is fixed, and the
whole class with it -- the app now sends the bar one display request at a
time and checks every rule the firmware is known to hang on just before
sending, whoever asked. A new stress test plays generated days of Unity,
notifications, tasks and breaks against a simulated bar; it found the hang
again, four more ways to break the device's rules, and a dozen ways the
screen could end up showing the wrong thing, two Unity projects open
included. Testing this release on a real bar then froze it a third way, from
the app's own careful teardown: firmware 1.2.4 hangs, now and then and with
no warning, when an animation is removed while it plays. The app no longer
removes one. Device Diagnostics now shows the slowdown that came before the
earlier freezes. Every fix here was checked on a real bar (firmware 1.2.4)
before release.

### Added

- **Display Health in Device Diagnostics.** Before every freeze measured on
  firmware 1.2.4, uploads to the bar slowed from about 50 ms to several
  hundred. The panel now shows the median upload time, the screen closes of
  the last hour, and the requests the app decided it did not need to send;
  it turns red with a warning when uploads slow like that, and the log says
  so once. The figures go into the diagnostics bundle, so a freeze reported
  after the fact comes with its run-up.

### Fixed

- **The bar no longer freezes when an animated icon or scene goes away.**
  Replaying a day of Unity compiles on a real bar froze it on BUILDING 40%,
  the HTTP API silent until it was restarted by hand. The cause, reproduced
  without the app: firmware 1.2.4 hangs now and then when a playing
  animation is removed -- the gear icon froze it on its 30th removal in one
  run and its 59th in another, with nothing slowing down first. The app now
  replaces an animation it is done with by an empty one under the same name,
  which survived 200 swaps in a row, and hands the display back to the clock
  by taking the picture down, waiting half a second and closing the screen
  on the animations alone, which survived 100 rounds. You may notice that
  half second of black before the clock.
- **A bar that comes back after an outage shows what is current.** After that
  freeze and a restart the bar came back on the old BUILDING screen: the
  return to the clock had failed while it was away, and the app resent the
  last picture it had. It now redraws whatever holds the display when the bar
  answers again -- after a restart, a cable or Wi-Fi blip too short for the
  connection status to notice, or turning no-bar mode off. A Lunch or Away
  break that started during such a blip no longer streams its animation
  picture by picture for the whole break.
- **The bar now shows what is actually going on when something ends.** The
  stress test learned to check the screen at the end of every generated day
  against the state, with two Unity projects open, and found the display
  wrong in about one day in seven:
  - a build covered by a notification came back as the idle clock, the build
    still running; a compile that started under a notification never showed;
  - with two projects open, the first to finish compiling took the gear down
    while the other still compiled, and one project's build end removed the
    other's build screen; closing an editor in Play Mode left ON AIR up;
  - leaving Lunch while a project compiled left the sandwich playing;
  - finishing a task during Play Mode ended on the idle clock, and the end of
    a session wiped a notification that was on screen;
  - a Lunch that began during Away took the display back in Work mode, above
    every notification.

  Whatever ends now hands the display to what was underneath, or to what
  Unity is doing by then, before the idle clock.

- **Stopping a task with the idle clock on could close the screen on a
  picture and an animation together**, the close that hung the bar within a
  few rounds on firmware 1.2.4. The clear for the idle clock and the LOGGED
  scene went out in the same instant and crossed on the way to the device.
  Found by a new stress test that plays generated mixes of Unity, banners,
  tasks and breaks against a simulated bar; with it came four more ways the
  app could break the device's rules -- closing too soon after an animation,
  uploading over a playing scene and dropping to 60-frames-a-second
  streaming, requests overlapping, requests that could only fail. The driver
  now sends every display request one at a time and checks each rule itself
  just before sending, whoever asked.

- **The bar no longer hangs during Unity sessions.** On 2026-10-05 it froze
  twice in a day and needed restarting by hand. The end of each compile, of
  Play Mode and of an exception screen redrew the idle screen twice, and idle
  each redraw clears the display; two clears side by side skipped the pause
  the device needs between taking an animation down and closing its screen,
  the sequence measured hanging firmware 1.2.4. Clears now run one at a time,
  a clear with nothing left to clear sends nothing, and each Unity end redraws
  once.
- **A compile burst keeps the compiling screen up.** Unity often compiles,
  reloads and compiles again a second later; the bar used to return to idle
  and clear between each. A compile that starts again within three seconds of
  the last one ending now carries on with the same screen.
- **A Unity end no longer wipes a notification.** A banner that took the
  display while Unity was compiling or in Play Mode was replaced by the idle
  screen the moment Unity finished. It now stays for its full time.
- **A script compile inside a build no longer takes the build screen down.**
  The compile's end gave back the display lock the build was holding.
- **"remove icon_anim: device returned 400" is no longer a warning.** It is the
  device saying the icon was already gone, which is what was asked for; the
  log now says that.

## 1.2.0 — 2026-10-02

SprintTicker without a bar, and a bar that is ours. Without one, the app now
stands on its own: a setup that does not require the device, a mini timer that
stays on top, and Windows notifications for what happens on your OpenProject
and Jira tasks. With one, the front display is set in our own fonts and every
screen we draw -- icons, Lunch, Away, the stand-up, GO!, DONE!, SEE YOU! -- is
our own animation, made in a new studio. Under both, the bar no longer hangs
when screens change, an expired Jira token no longer empties the project list,
and the device address is a setting rather than an assumption. As in 1.1.0,
most of the fixes came out of daily use; the entries below say so where it
matters.

### Added

- **SprintTicker without a BUSY Bar.** The setup wizard now asks whether you
  have one. Without it, the app keeps time, syncs and runs your ceremonies as
  before, stops looking for a device, and hides the screens that only describe
  the bar -- Priority Rules, Unity Engine and Notifications. The Unity plugin's
  events are ignored and the Windows notification listener does not run, since
  both exist to put things on the bar. **Add a BUSY Bar** in Device & Logs brings it back, with the address
  and token you had set. The connection readout no longer opens on invented
  figures (connected, 98% battery) before the real status arrives.
- **A mini timer.** A small window that stays above the others and shows what
  the bar would: the task, the elapsed time with seconds, and whether it is
  running or paused. Pause, resume and stop from it; its list button brings the
  dashboard forward with the task picker open. Drag it anywhere; it comes back
  where you left it, and opens at the next launch if it was open when you quit.
  Open it from **Mini Timer** in the top bar or **Show Mini Timer** in the tray
  menu. Useful without a bar, and with one that is out of sight.
- **Windows notifications for what happens on your tasks.** When someone
  assigns you a work package, mentions you, comments, changes a status, or a
  date alert fires, OpenProject's notification becomes a Windows toast;
  clicking it opens the work package. Choose which of the five you want, and
  whether they also go to the bar, under **Notifications from OpenProject** in
  Task Providers. A burst of more than three arrives as one summary. Only what
  arrives after you turn it on is shown, not the unread history.
- **The same notifications from Jira.** An issue assigned to you, a status
  change, a comment, a mention in a comment -- on the issues you are assigned,
  reported or watch -- each switchable under **Notifications from Jira**, with
  its own animated icon on the bar. Jira Cloud has no notification feed, so
  the app reads the changes off a search every minute. Your own changes never
  notify you. A mention on an issue you do not follow is not seen, and Jira has
  no date alerts.
- **Tasks have descriptions.** The start of a Jira or OpenProject description
  appears under the task's title in Projects & Tasks and in the task picker,
  which searches it too. On the bar, the picker's second row shows the task
  key followed by as much of the description as fits. Existing tasks gain
  theirs at the next sync.
- **The renderer has tests.** A second Vitest project runs in jsdom with
  Testing Library: every tab mounts, a session update from main reaches the
  screen, and the session card's finish paths are pinned. Its
  `window.electronAPI` mock is typed as the whole bridge and type-checked by
  `pnpm typecheck`, so a bridge change that the renderer's tests do not follow
  fails the build.
- **`pnpm db:check-migration`.** Migrates a copy of your database and reports
  whether anything was lost: worklogs, tracked time, task references, or the
  one-open-session rule. The original is never opened. It is how migrations 5
  and 6 were checked against real history before this release.

- **Animated icons.** While Unity compiles, the gear on the bar turns,
  steadily, for as long as the compile lasts. The bar plays the icon itself, laid
  over the screen with `z_index`, so it costs one upload per connection and
  nothing per frame. The screen keeps the still icon underneath, so a bar that
  refuses the animation shows the icon as before. The on-screen emulator
  animates it too.
- **Every event icon of ours moves.** The Play Mode pad is played, the
  exception triangle shakes, the notification bell swings, the end-of-day
  alarm clock rings, and the lunch-prompt burger hops. Work in progress moves
  steadily; an event acts, then rests. App logos in notifications stay as they are.
- **The session screen shows where you are.** A stopwatch replaces the
  checkmark that the tracking, paused, idle and Day Complete screens all
  shared: green while a task runs, amber with blinking pause bars while
  paused, dim grey when nothing runs. The idle screen reads "Ready / No task
  running" instead of a cut-off "No Active Ta...".
- **The running time is large, and the stopwatch ticks.** While a task runs,
  row 2 shows its time in 7px bold digits, where it used to be the small row-2
  face, and the stopwatch's hand ticks round the face once a second, the
  elapsed part filling in behind it; the crown clicks at each lap. The bar
  animates the hand by itself, so the picture still changes once a minute and
  nothing more is sent each second. The hand keeps its own time: it shows that
  the clock is running, not the seconds of the session.
- **The task picker on the bar says where you are.** A folder while you choose
  a project and a checklist while you choose a task, where it was bare text;
  the item's place in the list (`3/12`) at the end of row 2; and a one-pixel
  scroll bar along the bottom, whose thumb shows whether there is more before
  or after. A project with no tasks shows no position, rather than a "1/1"
  that would suggest something to pick.
- **Tasks in the picker are sorted and show their status.** In progress
  first, then to do, then done; within each, by the priority Jira or
  OpenProject gives (Highest/Blocker/Immediate first; a priority the app does
  not know comes after the known ones), then in the provider's order. The
  checklist icon is grey, amber or green to match, and a done task's name is
  dimmed. The list used to come in whatever order the store returned.
- **STOP and FINISH follow the wheel.** Left picks STOP, right picks FINISH,
  and turning further stays put, where every notch used to flip the choice --
  one notch too many before the click landed on the other one.
- **The paused screen shows the whole task key.** STOP and FINISH now sit side
  by side on row 1, which leaves row 0 to the key and its time. Stacked in a
  column on the right, they left the title 26px, and it came out as "SPR-...".
- **The Unity screens read the same way.** State on row 0, project on row 1,
  and for a build or bake the percentage beside the state and a one-pixel
  progress line along the bottom. "COMPILING:" lost its dangling colon, and a
  build no longer cuts the project name to "BUILDING: M...".
- **The icons were reviewed, and five reworked.** The end-of-day prompt shows
  an alarm clock that rings, in place of a plain clock. The Play Mode pad is
  played: buttons go down, the pad dips, the stick is pushed. The lunch burger
  hops layer by layer instead of squashing, and the check's tick is
  retraced by a pen instead of scaled up. The exception triangle starts from
  its still.
- **OpenProject notifications shine.** A light sweeps once across the
  OpenProject logo, then it rests. The logo's shape and blue never change: it
  is OpenProject's mark, so light passing over it is as far as the animation
  goes. Other apps' logos stay still.
- **Finishing a task celebrates with a scene of our own.** A green badge drops
  in and squashes on landing, its tick draws itself, and confetti bursts and
  falls behind **DONE!**. The bar plays it once and rests on the finished
  badge, where the old confetti was drawn here and streamed: about 80 requests
  over four seconds, now one upload and one draw.
- **Stopping a task says so.** STOP, from the bar's paused screen or from the
  app, plays **LOGGED**: the amber stopwatch clicks, its hand sweeps back to
  twelve taking the elapsed time with it, and a glow settles -- then the idle
  screen. The bar used to go straight to idle, which looked the same as the
  stop not having worked. Finishing still plays DONE!, and starting another
  task from the app no longer flashes LOGGED before the new one: the start
  logs the running session itself. The debug panel's **Stop Task** button,
  which fired the confetti, now previews LOGGED.
- **Starting a task from the bar says GO!** Confirm a task in the picker and
  the green stopwatch's crown clicks, its hand runs a lap and a quarter, and
  it lands at three with a quarter filled -- the tracking screen's own icon,
  which follows two seconds later. The menu used to vanish into the tracking
  screen with nothing to say the click had landed.
- **The day ends on SEE YOU!** Once the end-of-day wrap-up is done, a
  crescent moon rises over a dusk sky and three stars come out, one twinkle
  each, for five seconds. It replaces the Day Complete screen, a checkmark and
  two rows that read as one more event rather than the end of the day. The
  wrap-up's display lock now ends with the scene, where it was a separate
  five seconds of its own.
- **A scene is no longer cut off when a lock is released under it.** Every
  release restores the work screen, and that stopped whatever was playing:
  GO! would have lasted a frame, and a banner ending during DONE! cut it
  short.
- **The build and bake screens have their own icons**: a hammer that strikes,
  and a light bulb that glows. Both replace the Unity logo, which is Unity's
  mark and not ours to animate.
- **`pnpm probe:busybar --compositing` checks the layering the app uses**: an
  icon stays above a redrawn frame, and removing it with `element_ids` leaves
  the frame. It also records that removing an element the device does not hold
  answers 400.
- **The device address and API token are configurable**, in Settings › Device.
  Changing either reconnects the driver in place — no restart. This was
  hardcoded to `10.0.4.20` on the reasoning that the bar always answers there
  over USB, which is true of the *device* and not of the address the *app* has
  to dial. Two things break it: a bar on Wi-Fi holds a DHCP lease, and a host
  whose USB CDC-NCM driver refuses to start the network interface (Windows
  25H2, Intel 700-series xHCI — the device enumerates cleanly and the adapter
  fails with Code 10) is recovered by proxying the bar onto a *different*
  address. Before this, a working bar and a working recovery still left the app
  unable to reach it. Addresses are validated before use, since the value is
  concatenated into a URL, and the token is redacted from the StateStream URL
  the driver logs — that log line is captured into the diagnostics bundle.
- **A fake Jira server and an integration test.** `scripts/fake-jira.js`
  (`pnpm mock:jira`) is a sibling of the OpenProject harness, and
  `tests/jira-integration.test.ts` drives the real adapter over a real socket.
  The live run in 1.1.0 removed the unknowns but left no regression cover;
  nothing automated exercised the Jira dialect, which is where the traps are —
  two different pagination schemes, ADF comments, and a timestamp format that
  rejects both `toISOString()` and the `+02:00` form.
- **Tests for the hardware task picker and the tray context menu.** Both were
  behaviour a user reaches with a physical control and neither was covered.
  `input-decoder.ts` went from 66% to 94%, `tray-manager.ts` from 69% to 92%,
  and the coverage floor is ratcheted to 83 / 74 / 84.5 / 85, and again to
  84 / 75 / 85 / 86.5 with the driver's failure-path tests, and to
  92 / 85 / 90 / 93.5 once the priority engine, services, hardware and IPC
  were covered.
- **Tests for the diagnostics export**, which had one test asserting three
  values the exporter had invented. `main/diagnostics` went from 66% to 98.5%;
  `logger-interceptor.ts` had no test file at all.
- **`pnpm preflight` now runs in CI**, catching a version drift across the three
  `package.json` files when it is introduced rather than when someone tries to
  cut a release.
- **`pnpm probe:busybar`** — checks the device contract against a real bar and
  reports which newer firmware fields it accepts. Run against **firmware 1.2.3**:
  everything this app relies on still holds, and both `z_index` and
  `element_ids` are accepted, which lifts the compositing blocker recorded in
  ROADMAP §4. It draws only under its own application name and sends no
  `rectangle` elements, since a wrong colour count there reboots the device.
- **The probe reads the panel back and measures it.** `pnpm probe:busybar` now
  captures frames with `GET /api/screen?display=0` and writes them out as PNGs,
  so a check can assert a *layout* rather than a status code. What that
  settled, all on firmware 1.2.3:
  - `CountdownElement` renders **17×5px**, not tall as its guidance warns, and
    sits beside a 16px app icon with 39px of the field to spare. It ticks with
    no uploads at all, against the two HTTP requests per frame the app pays
    today. ROADMAP §4's timer work is a layout exercise, not a rewrite.
  - **The countdown counts against the device's RTC, not the app's clock.** The
    measured bar runs 19 seconds behind its host, so a countdown built from
    `Date.now()` drew `00:47` for a 65-second interval — silently wrong, with
    nothing reporting it. Recorded before anything is built on it.
  - `z_index` genuinely reorders overlapping elements. The previous run showed
    only that the field is accepted on a draw, which is a weaker claim.
  - `GET /api/screen` serves base64 raw **BGR** pixels, top-down and with no
    BMP header, despite answering `Content-Type: image/bmp`.
- **The probe now checks hardware animation playback**, which is the gap the
  Away regression below fell through. It uploads the largest real `.anim` in
  `Animations/` — the app's own ~0.8–1.3 MB file, not a token — draws it, and
  captures the panel twice 700 ms apart. That separates three outcomes a status
  code cannot: the device refused the file, it accepted the file and drew
  nothing, and it is genuinely animating. Only the last one shows two frames
  differing. Set `BUSYBAR_IP` for a bar reached on another address.
- **Generated documentation site.** `pnpm docs:build` renders the three
  Markdown documents into `docs/index.html` for GitHub Pages, and `pnpm
  docs:check` fails CI when the page and its sources have drifted.
- **An animation studio**, `pnpm studio`, in its own package
  (`packages/anim-studio`, Vite and plain TypeScript, no React or Electron). It
  composes full-screen scenes in the visual language of the bar's own
  animations: a rounded gradient plate with an outline, an animated
  frame-by-frame icon on the left and large text on the right.
  - Each layer can move: the plate slides or pulses, the icon plays an intro
    once and loops the rest, and the text has typewriter, wave, shine, scroll
    or blink.
  - The editor has an LED-style preview, a pixel editor with onion skin, a
    palette and PNG import, and undo.
  - It exports the PNG sequence and `meta.json` the app already plays, and can
    also compile the `.anim` and play it on a real bar under its own
    application name, at priority 100 with a 5-minute timeout.
  - It refuses to export over a folder holding files it did not write, which
    protects the firmware frame sets beside it.
  - It draws large text in a display face, Bold 7, generated by
    `pnpm fonts:build` like the app's fonts.
  - Its 113 tests run in CI.
- **The studio now animates the way the official animations do.** They were
  measured frame by frame first, and the findings are recorded in
  `packages/anim-studio/STYLE-GUIDE.md`. The main finding is that their icons
  move smoothly, by fractions of a pixel at 60 fps, rather than in whole-pixel
  steps. The studio gained:
  - keyframed motion (position, scale about an anchor, opacity) with easing
    curves;
  - 4 × 4 anti-aliasing and motion blur;
  - a glow layer for halos and dark spots;
  - a graded outline, highlight and anti-aliased corners for the plate;
  - gradient and shadow for text;
  - a one-line title face, Bold 9;
  - a loop-seam check under the timeline.

  Scenes default to 60 fps. Scene files saved earlier still open.
- **`pnpm probe:busybar --compositing`** measures whether an animated icon
  can play beside the app's text on the device. It builds a 16×16 test
  animation and reads the panel back twice for each case: side by side, under
  a transparent hole, above and below an opaque image by `z_index`, and with
  the text replaced mid-play. On firmware 1.2.3 all of them work, so a
  notification icon can animate with no per-frame traffic. The check draws
  above the app at priority 100, so it runs with SprintTicker open.
- **`scripts/lib/busybar-device.js`**, the device client and PNG encoder, is
  split out of the probe so the probe and the studio share one copy.

### Fixed

- **An expired Jira token no longer empties your project list.** Jira Cloud
  does not refuse a token it no longer accepts: it answers as if to an
  anonymous visitor, and an anonymous visitor sees no projects and no issues.
  The app took that for the truth and cleared its local lists at every sync,
  with nothing in the log. It now checks the credentials first, so a rejected
  token fails the sync with a message and leaves your projects and tasks as
  they were. Logged time was never lost -- tasks with history are archived,
  not deleted -- and the first sync with a working token brings everything
  back.
- **Toasts from an installed copy are attributed to SprintTicker.** The app
  told Windows it was `com.busybar.desktop` while the installer's shortcut
  says `io.github.istalry.sprintticker`, and Windows only shows a toast for an
  ID it can tie to a shortcut. Both now use the latter.
- **An animated icon no longer outlives its screen at the idle clock.** When a
  screen with an animated icon -- a notification banner, the paused
  stopwatch -- gave way to the idle clock, the icon stayed: alone in the
  on-screen emulator, and drawn back onto the bar over the firmware's clock.
- **The tray's "Trigger Task Selector Modal" opens the task picker.** It
  brought the window forward and nothing else: it sent its request on a channel
  the window does not listen on.
- **START on the bar no longer wraps up the day by mistake.** With the
  end-of-day window open but the bar showing something else -- the window
  opened from the top bar, or a higher-ranked screen on the bar -- START both
  paused the session there and armed the wrap-up in the window, and a second
  START confirmed it, shutdown included. The window now follows the bar's
  buttons only while the bar shows the wrap-up prompt, and the top-bar button
  puts that prompt on the bar.
- **Times follow Windows' regional format.** History, the sync queue, the
  notification log and Device Diagnostics showed times in US style (`2:05:33
  PM`) whatever the region set in Windows. They now use it: `14:05:33` for most
  of Europe.
- **SprintTicker names itself.** Windows' shutdown notice after an end-of-day
  wrap-up read "BUSY Bar End-of-Day Wrap-Up", and the tray said "BUSY Bar:
  TRACKING" and offered "Open BUSY Bar Dashboard" -- the device's name where the
  app's belonged. They now say SprintTicker, as the idle tooltip already did.
- **A session left running behind another one is recovered.** If the app ever
  stopped with two sessions open, only the newer one showed; the older one was
  never stopped and its time never logged. Upgrading closes it where the next
  session began and puts its time in Work History, marked as recovered and not
  sent to your provider. From then on the database refuses a second open
  session.
- **Work History names your tasks.** Each entry showed the provider's internal
  id -- Jira's `10001` rather than `SCRUM-2` -- and the daily summary guessed a
  key from the id and used the worklog's comment, usually "Completed session
  via SprintTicker", as the title. Both now show the task's key and title.
- **Time logged against a task is never left nameless.** A sync that no longer
  listed a task you had worked on, or deleting it or its project, deleted the
  task and left its hours pointing at nothing. Such a task is now archived:
  gone from the lists, still in history, back if the provider lists it again.
  Upgrading names the hours already orphaned from the sessions that logged
  them; none are dropped.
- **The end-of-day wrap-up takes two presses on the bar again.** Every press
  reached the app twice, so when the wrap-up window was open without the bar
  showing its prompt, a single START both said "yes" and confirmed -- running
  the wrap-up, and the shutdown if it was ticked. Device Diagnostics also
  listed every press twice.
- **The test suite no longer saves open Unity scenes.** The wrap-up tests
  asked every Unity Editor on the machine to save, as the real wrap-up does.
- **The test suite no longer changes the machine's git configuration.** On a
  machine with no global `core.excludesfile` -- a CI runner, a fresh checkout
  -- running the tests pointed it at a temporary file the tests then deleted.
  The app's own "set up global gitignore" behaves as before.
- **A notification that waited its turn is no longer wiped the moment it
  shows.** When two arrived together, the second was queued behind the first
  -- and when the first ended, the second was drawn and then immediately
  replaced by the screen underneath. With no task running and the bar's own
  clock enabled for idle, it vanished outright.
- **The end-of-day dialog offers the wrap-up again when reopened.** Once a
  wrap-up had completed, every later opening -- the next evening's prompt, or
  the header button -- showed "Day Complete!" until the app restarted.
- **A sync no longer throws the task picker back to step 1.** The picker reset
  itself whenever the project list changed, so a sync landing while you were
  choosing a task started the choice over.
- **Work History copes with a failed read and with fast date changes.** A read
  that failed left "Loading session history..." up for good, and stepping
  through days quickly could show the worklogs of a day no longer selected.
- **Finishing a task from the app plays DONE! once.** Both finish dialogs
  asked the bar for the scene after the stop had already played it, so it
  started twice: two uploads of the same file, the second over the one the
  bar was playing. The desktop confetti is unchanged.
- **The bar no longer freezes after a few lunch, away or meeting screens.**
  Starting one of those scenes cleared the whole display first, and on
  firmware 1.2.4 clearing it while a picture and an animation are both on it
  hangs the bar within three or four times -- a screen with an animated icon,
  followed by a scene, is exactly that. Scenes now slide in under the current
  screen and out under the next one, so the display is never emptied to
  change screens. Handing the display back for the idle clock or at quit
  still clears it, but takes every animation down first and gives the bar a
  moment before the clear.
- **An animated icon no longer changes colour as it starts.** The icon
  generator quantised colours to keep the palette small, which moved most
  icons off the still icon they replace: the end-of-day clock's purple came
  back as `#9555FF`, the bell's orange shifted, and the gear, hammer and bulb
  did not match at all. Every first frame is now the still icon exactly, and a
  test compares the two.
- **`&` reads as an ampersand** in both row fonts. It was a 4px checkerboard;
  it is now a small loop over a crossing stroke with a tail, 5px wide like `M`
  and `W`.
- **`pnpm probe:busybar --font-sheet` shows every glyph whole.** It put two
  lines on every page, which is 19px of Sprint Bold 9 on a 16px panel, so the
  second line lost its bottom rows; it now fits as many lines as the font's
  height allows. And the animation check left its element on the panel for
  30 seconds, so the Sprint 5 sheet drawn next failed its readback by some 850
  pixels with nothing wrong in the font. Both checks now start from, and
  leave, a clear panel.
- **The emulator no longer plays the bar's animations at a quarter speed.**
  While the bar plays an animation itself, the on-screen preview ticks at 15
  fps; it stepped through every frame of a 60 fps scene, so Lunch, Away and
  Meeting crawled on screen while the bar ran at full speed. It now skips
  frames to keep time, and a scene played once ends on the same frame as the
  bar.
- **The `.anim` compiler's licence is recorded.** `scripts/busybar-anim-toolchain/`
  is the firmware's own `seq2anim.py` and helpers, GPL-2.0-or-later, and had
  been copied in with no notice. The folder now carries the licence text and
  its provenance. `seq2anim.py` is marked as modified, since it accepts a
  directory and runs on Python older than 3.11. `LICENSE` and the README name
  it as the one part of the repository that is not MIT. Nothing changes for the
  app: the toolchain runs at build time and is not in the installer.

- **Animations reached the bar and were then painted over.** Lunch, Away and
  the meeting screens showed nothing on the hardware while the on-screen
  emulator animated correctly. Two separate defects, both now fixed:
  - `AnimationPlayer` chained `.then().catch()` on driver calls that report
    failure by returning `false`, so a device that refused the file ran the
    success path and logged nothing. The calls are awaited and checked, the
    file and its byte count are logged on refusal, and a refusal now falls back
    to streaming PNG frames instead of leaving the bar blank.
  - Once that was fixed the bar was still black, because every animated mode
    clears its canvas, starts the animation and then transmits the blank
    canvas. That transmission draws `px_matrix_img`, a full-panel opaque PNG
    which the firmware composites **above** the animation element whichever
    order the two arrive in — a draw merges by element id rather than replacing
    the element set, so drawing the animation second does not displace it.
    `AnimationPlayer` now clears the display before handing over the `.anim`,
    and `DisplayRenderer` does not transmit a front frame while the device owns
    playback. Both measured against a real bar on firmware 1.2.3 by replaying
    the two draws and reading the panel back.
  - A failed clear now also falls back to streaming, since the animation would
    otherwise sit under the stale frame. So does a `409` on the animation draw,
    so the animation reaches the bar once the display is released.
- **A frame the device refused was never sent again.** The renderer skips a
  frame identical to the last one it sent, and it was meant to forget that frame
  when sending failed. The forgetting sat in a `.catch()` on a call that
  reported failure by returning `false`, so it never ran. The bar kept whatever
  it had until the picture changed, which is up to a minute for the timer and
  never for a static screen. The frame is now resent on the next render. After a
  `409` it is deliberately not resent, so a display held by another application
  does not receive a re-upload on every tick.

### Changed

- **OpenProject notifications on the bar follow the new settings.** They used
  to replay every unread notification on the bar at each launch, and could
  only be switched off as a whole. They now start from the moment you turn
  them on, honour the per-kind choices, and arrive as one banner per check
  rather than one per notification. An upgrade keeps the old on/off switch and
  interval.
- **`ws` 8.22**, the WebSocket client behind the bar's live status, and one
  of the two packages the installed app carries.
- **Development tools updated, and `pnpm audit` is clean again.** ESLint
  10.11, typescript-eslint 8.71, Vite 8.3, Vitest 5.0.3, wait-on 9.5 and
  marked 18.0.14; `@types/node` 24.19 and `@types/ws` 8.18.2. Twenty-five advisories had built up in
  tools several levels down -- axios and joi under `wait-on`, brace-expansion
  under ESLint and electron-builder, fast-uri under electron-builder -- none
  of them in the installed app. A lockfile refresh cleared most; the overrides
  in `pnpm-workspace.yaml` were raised for the rest. Dependabot no longer
  proposes `@types/node` majors: the types follow the Node 24 that Electron
  ships, and move with it.
- **Building from source no longer needs a C++ toolchain.** better-sqlite3 13
  ships one prebuilt binary that Node and Electron both load, so the rebuilds
  that ran before every `pnpm test` and `pnpm dev` did nothing, and are gone,
  along with the Visual Studio Build Tools requirement. Python is still needed
  to compile animations. Packaging skips electron-builder's native rebuild for
  the same reason, which also drops the Visual Studio project files it left
  behind from the installer. The pre-flight check, which looked for a compiled
  binary that no longer exists and warned on every run, now checks the
  prebuild that ships.
- **A much smaller installer.** The app inside it went from about 73 MB to
  about 5 MB. It had been carrying React, the icon set and the fonts twice --
  once bundled, once as the source they were bundled from -- plus SQLite's
  source code, database binaries for macOS and Linux, a library the app never
  used, and compiled files left over from July.
  It also carries only Chromium's English UI translation rather than all 55,
  which takes the installer from 103 MB to 95 MB. Nothing in the app was
  translated, so nothing on screen changes.
- **React 19.** The renderer moved from React 18, and `lucide-react` from
  0.359 to 1.48 with it, since the old icons capped React at 18. Nothing
  should look different.
- **Lunch, Away and the stand-up play our own animations.** Lunch is a
  sandwich stacking itself layer by layer; Away is a steaming coffee; the
  stand-up is three people round a table, speaking in turn under speech
  bubbles. Each has its own plate colour -- teal, purple, blue -- so the mode
  reads at a glance. They replace the firmware's salad, "back soon" and
  meeting frame sets, which are removed (below). All three were drawn in the animation studio in the official
  animations' style, 60 fps with smooth, anti-aliased motion, and play on the
  device from a `.anim` with PNG streaming as the fallback, as before. A new test fails if an animation the app names has no folder behind
  it, which would otherwise show as an empty panel and a log warning.
- **The front display's text is set in our own fonts.** Row 1 used a
  fixed-width 3×5 font with 40 characters, so `( ) , ' " # + @ & =` and the rest
  of the punctuation reached the bar as `?`. It cut a row at fourteen characters
  with no marker, so "PROJ-142: Write the notes" showed as "PROJ-142: Writ", and
  its `g` and `q` were the same bitmap. Row 0 used the firmware's own font, which
  read well but was OFL-1.1 and the one file in the app under another licence.
  Both are replaced, at the same size, by Sprint 5 (row 0) and the condensed
  Sprint Small (row 1):
  - both carry all of printable ASCII;
  - both are proportional and end a truncated row with `…`;
  - digits share one width, so a running timer does not shift.

  The fonts are drawn as ASCII art in `packages/desktop-app/fonts/` and
  compiled by `pnpm fonts:build`. The generator refuses a missing character, two
  identical glyphs or a blank edge column, and `fonts:check` runs in CI.
  `pnpm probe:busybar --font-sheet` shows every glyph on a real bar and checks
  the panel shows exactly the pixels sent.
- **The device driver reports failure by throwing.** `BusyBarDriver`'s commands
  answered `Promise<boolean>` and never threw, so a refusal looked like success
  to any caller that forgot to check. That shipped the blank-Away-animation bug
  twice: a `.catch()` on one of these calls could not run for the failure that
  actually happens. They now throw a `DeviceRequestError` that says why:
  `disconnected`, `unreachable` (with the transport cause), `too_large`, `busy`,
  `conflict` or `rejected`, plus the HTTP status. Two answers that are not
  failures come back as values instead: a draw refused with `409` resolves
  `'conflict'`, because another application owning the display is the device
  working as designed, and a pixel frame that was queued or superseded says so
  rather than returning the same `false` as a refusal. An ESLint rule now bans
  `.then(` in the hardware layer, the chained shape behind both incidents.
  `connect()` and `reconfigure()` still answer a boolean. They are probes, and
  "the bar is not there" is a normal answer for them.
- **ESLint 8 → 10, on flat config.** ESLint 8 is end of life. The target became
  10 rather than the planned 9 once the registry showed 9 as the `maintenance`
  tag. `.eslintrc.cjs` and `.eslintignore` are replaced by `eslint.config.mjs`,
  with every rule and comment carried across — the process-boundary rules and
  the curated type-aware ones are load-bearing, and a silently dropped rule is
  the real risk in a config migration. Verified by capturing the old findings as
  a sorted list and reproducing it exactly (150 files, 36 warnings, 0 errors),
  then deliberately breaking each rule to confirm it still fires. No behaviour
  change; developer tooling only.
- Three small findings from ESLint 10's stricter defaults: a disable comment
  naming `no-var-requires`, which was renamed and had stopped suppressing
  anything; an unused `catch` binding; a redundant initialiser.
- **`verify:packed` asserts what the packaged app does.** It used to prove only
  that the binary booted and something was listening on 39123 — true of a build
  with broken routing. It now accepts a Unity heartbeat and refuses both
  browser-shaped request forms, which is the boundary between a web page the
  user happens to be visiting and hardware this API can drive.
- **A provider can say it does not know how much time the remote holds.**
  `reconcileRemoteState` returns `remoteLoggedTimeToday: number | null`; Jira and
  ad-hoc return `null` where they returned a confident `0` they had not
  measured, and OpenProject returns `null` on a failed fetch rather than
  understating the day as zero.
- `preflight` compares all three `package.json` versions. It printed the root
  version and compared only the other two, so a drifted root passed silently.

### Removed

- **The `messaging:*` IPC channels** and `MessagingIntegrationService`, whose
  one live job -- polling OpenProject for the bar -- moved to the provider
  events above. The rest was a test banner for Discord, Slack and Gmail that
  no screen used any more.
- **The rear display modes.** Diagnostics, Performance and Stealth Clock, the
  setting that chose between them, and the emulator's rear screen. None of it
  ever reached the bar: the rear shows the firmware's own mirror of the front,
  twice the size, and its clock when the front is empty. Measured with the new
  `pnpm probe:busybar --rear`, and kept that way by choice.

- **The `provider:reconcile` IPC channel.** It was declared on the preload bridge
  with no handler in main, so calling it rejected — the same shape as the updater
  stub deleted in 1.0.0 (audit F-18). Nothing called it. The provider methods
  remain, so the day a UI wants a server-side day total the work is a handler
  plus a component.
- **The firmware font and its converter.** `shared/busy-font.ts` (OFL-1.1),
  `tools/lvgl-font-to-ts.js`, the old 3×5 table in `shared/pixel-fonts.ts` and
  the character-count helper `shared/text-capacity.ts`, all superseded by the
  fonts above. `LICENSE` no longer carries the OFL notice for a file the app
  does not ship.
- **The firmware's three animation frame sets**, `lunch_72x16`,
  `back_soon_72x16` and `meeting_72x16` (CC-BY-SA-4.0), replaced by our own
  (above). `Animations/` is now entirely MIT, so `LICENSE`, the installer's
  copyright line and the docs footer drop the CC-BY-SA notice. The installer
  also loses about 8.7 MB of frames it no longer plays.

### Fixed

- **A refused animation upload falls back to streaming frames instead of
  leaving the bar blank.** With a `.anim` file present the player hands the
  whole animation to the device and stops streaming PNGs, which is right when
  the device takes it. But `uploadAsset` and `sendDisplayPayload` report refusal
  by returning `false`, not by throwing, and the code chained
  `.then(...).catch(...)` — so a refusal ran the *success* path, asked the
  device to draw an asset it had never stored, and fired neither handler. The
  result was a blank bar, an on-screen emulator animating perfectly (it is fed
  by a separate callback that never touches the device), and a log whose only
  line said the animation had loaded. Both results are now checked, the failure
  names the file and its size, and playback degrades to the frame-streaming path
  that animations without a `.anim` already use.
- **An unreachable bar says so, instead of reporting itself connected.**
  `connect()` set `isConnected = true` even when both status probes got no
  answer, so an unplugged device showed as connected until the ping loop quietly
  flipped it back three seconds later. Every failure path was silent: the
  transport error was discarded, and the ping loop's `catch` set the flag with no
  log. The net effect was that a diagnostics export sent in to ask *why the bar
  would not connect* contained no evidence of the connection failing at all.
  - The failure reason is kept and reported — `timed out after 2000ms`,
    `ECONNREFUSED`, `EHOSTUNREACH` — taken from the `cause` of Node's fetch
    error, since the top-level message is only ever `fetch failed`.
  - Connection **loss** is now logged as well as recovery, so both edges of an
    outage appear, plus a throttled reminder every ten minutes while down. Not
    every failed ping: at one every three seconds that would put 1200 lines an
    hour into a 2000-line ring and flush out every other diagnostic.
  - A device that answers but returns a non-2xx for the status endpoints is
    still treated as present, because a firmware that does not serve
    `/api/status` is still a usable bar. That case now warns that telemetry is
    unavailable rather than displaying a confident 0% battery.
  - The test covering this asserted the old behaviour by name —
    `..._StillConnectsDegraded` — so it passed while pinning the defect in
    place. It now asserts the corrected behaviour.
- **The top bar fits the window.** It needed roughly 1850px to lay out, so it
  overflowed and clipped its right-hand controls at the app's own 1200px default
  size — the connection status and EOD button were simply cut off unless the
  window was maximised. The three header groups were all sized by their content,
  and the LED matrix was fixed at 505px, so nothing could yield.
  - The emulator now absorbs the slack instead of dictating the width, and the
    matrix scales itself from 6px LEDs down to 3px on whole-pixel steps, so the
    diodes stay aligned while the window is dragged.
  - Below four thresholds the least useful things step aside in order: the rear
    OLED preview (preview-only in this build), then the "Ping:" and "Setup
    Wizard" labels, then the remote pad and the remaining labels. Everything
    that loses a label keeps a tooltip, and connection state stays readable from
    the icon colour and the pulsing dot beside the logo.
  - The remote control pad is hidden *last* rather than first: `injectRemoteKey`
    exists nowhere else in the renderer, so it is the only way to drive hardware
    input without a bar attached.
- **The first-run wizard's provider step saves what you choose.** It never did:
  the provider dropdown and the fallback-ticket field were local state nothing
  read, so completing the wizard configured nothing and the app stayed on its
  default. It now persists the choice, reinitialises the providers and starts a
  sync, so the Projects list fills instead of coming up empty. Jira is offered
  alongside OpenProject and ad-hoc, and each collects the credentials it needs
  to work — a Jira user no longer has to pick something else and then find the
  provider in Settings.
- **The diagnostics export reports facts instead of asserting them.** The bundle
  users attach to a bug report claimed `appVersion: "1.0.0"` on every release
  after 1.0.0, fell back to Electron `"30.0.0"` on a build running Electron 44,
  and hardcoded `webhookServerStatus.listening: true` — asserting the Unity
  listener was up in precisely the bundle someone sends when it is not. The
  version now comes from Electron, the listener state from the socket itself,
  and anything genuinely unknowable is reported as unknown.
- **`LoggerInterceptor.intercept()` is idempotent and reversible.** Called
  twice it captured its own wrapper as the "original", double-recording every
  line; there was also no way to put `console` back, which is a problem for
  anything that intercepts outside the main process.
- A deprecated `.substr` in the priority engine (audit F-36).
- An intermittent `Closing rpc while onUserConsoleLog was pending` teardown
  error that failed the coverage run while every test passed. The suite's console
  output was outrunning vitest's rpc channel at worker teardown. First addressed
  by stubbing `console` in the noisy fixtures; it recurred, so
  `disableConsoleIntercept: true` now sends console output straight to stdout
  and removes the forwarding that was the actual mechanism.

## 1.1.0 — 2026-09-08

Jira Cloud support, a readable notification banner, and the bar set in its own
font. Most of the fixes below came out of using the app rather than reading it,
which is noted where it matters — a defect found in daily use tends to be one
the test suite structurally could not see.

### Added

- **Jira Cloud provider.** Projects, issues, worklogs, and status changes by
  workflow transition. Configured with a site URL, account email and API token,
  and verified against a live site on both a Story and a Task.
  - Status comes from Jira's `statusCategory`, which every workflow has, so it
    needs no setup at all — unlike OpenProject, where the same mapping is three
    numeric status ids pasted in by hand.
  - Transitions are configured by **name**, because a Jira transition id only
    means anything inside one workflow.
- **A visible sync queue** (Task Providers). Every worklog that has not reached
  the provider, with the server's own message, the attempt count against the
  ceiling, and when the next attempt is due. Plus *Sync Now* and *Retry
  Failed*, the latter for repairs no settings form can detect — a re-created
  issue, a corrected workflow.
- **Which tasks to fetch is now a setting**: assigned to me, everything open,
  or a custom query. Each adapter renders it in its own dialect, JQL for Jira
  and a filter array for OpenProject.
- **Per-app notification icon override**, reachable from the Notifications
  panel. The field existed and was honoured; nothing could set it.
- **A "sender only" mode for notification sources**, so a channel can show that
  a message arrived without showing what it said.
- `pnpm probe:jira-worklog <ISSUE-KEY>` — measures the shortest worklog a real
  Jira site accepts, since the app's 60-second floor is an inference from
  Jira's documented granularity rather than a measurement.

### Changed

- **The notification banner shows the message.** It used to draw one centred
  row of eleven characters and spend ten of them on a bracketed channel label
  the app icon already conveyed, so a Slack message reached the bar as
  `[Message]…`. It now uses the same icon-and-two-rows template as every other
  screen, at the same one frame upload.
- **Row 0 is set in the BUSY Bar's own font**, ported from the firmware. The
  previous hand-rolled font was 3px of ink in a 4px cell drawn at a 5px stride,
  which left two blank columns between every character and gave `#` nowhere to
  draw. The 55px field now holds about 14 characters of mixed case where it held
  11 of anything. This adds one **OFL-1.1** file; see `LICENSE`.
- **Provider credentials are encrypted at rest** via Electron's `safeStorage`.
  A key already on disk in plain text is upgraded the first time it is read, and
  every failure mode degrades rather than losing the key.
- **A finished worklog is sent immediately** rather than waiting out the
  five-minute sync interval. Safe now that the queue has atomic claims; it was
  not when the interval was introduced.
- **Every provider request has a timeout**, and only GET/HEAD/OPTIONS are
  retried — a worklog POST has no idempotency key, so repeating it after a lost
  response bills the session twice.
- **A provider reports failure by throwing**, never by returning an empty list.
  An empty list is indistinguishable from "this user has no tasks", and the sync
  worker prunes against it.
- The debug panel draws real screens through the real renderer instead of
  hand-built payloads in a vocabulary the main process had stopped emitting.
- Dropped three animation sets nothing played (`coding`, `dnd`, `on_call`),
  about 3.8 MB of Git LFS traffic on every clone and CI checkout.
- Removed the last of the scrolling-text support, which nothing produced.

### Fixed

- **Finishing a task with the bar's own buttons left it in progress.** Both
  hardware paths logged the time and skipped the completion — including the
  wheel's default selection, so it was the press made without scrolling.
- **Marking a task done un-did itself on Jira.** Completing fires the configured
  transition rather than closing the issue, which lands it in To Review; that
  read back as in-progress and the next sync overwrote the local row.
- **The bar showed `10001: Active Task`** — Jira's internal issue id next to a
  placeholder — where the task row held `SCRUM-2` and its real title all along.
- **Accented characters reached the bar as `?`.** The transliterating sanitiser
  existed but the rasterised front display never called it.
- **A request the server had already refused was retried.** A 404 for a deleted
  issue and a 400 for a rejected payload each spent the full retry budget
  sending byte-identical requests. Any 4xx is now permanent except 408 and 429.
- **A session too short for the provider to record is no longer queued.** Jira
  cannot store less than a minute, and such a row could never be delivered.
  The session is still kept in local history.
- **The task list ignored status changes** until the tab was left and re-entered.
- **A Discord notification was titled `squirrel.discord…`** instead of Discord.
- **The end-of-day prompt could be cancelled by the stand-up prompt** having
  already stamped the day as handled.
- OpenProject was still being dialled once a minute after switching to Jira,
  printing a full stack trace each time for a server neither running nor in use.
- Auto-save was dead in development, silently.
- The pixel editor (`pnpm editor`) had been opening to an empty palette after
  its bitmap module moved.
- Pagination is walked to the end of every collection, and throws on reaching
  its page cap rather than returning a partial list — a short list is exactly
  what makes the sync worker prune.

### Notes

- The rear 160×80 OLED remains preview-only.
- `reconcileRemoteState` is declared on the preload bridge with no handler in
  main; calling it from the renderer rejects. Unchanged in this release.

## 1.0.0

First published release. Unsigned NSIS installer and portable executable, built
by CI on a `v*` tag.
