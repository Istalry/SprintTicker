# API reference

The four API surfaces in this project:

1. [IPC channels](#ipc-channels) — renderer ↔ main
2. [Local HTTP API](#local-http-api) — the Unity plugin → main
3. [`ITaskProvider`](#itaskprovider) — the contract a task provider implements
4. [The BUSY Bar device contract](#the-busy-bar-device-contract) — main → hardware

Source of truth for each is named at the top of its section. Where this file and
the code disagree, the code is right — tell us so it can be fixed here.

---

## IPC channels

**Source:** `src/shared/ipc-channels.ts`, `src/preload/electron-api.d.ts`

The renderer never touches Electron or Node directly. Every call goes through
`window.electronAPI`, whose shape is `IElectronAPI`. That annotation on the
bridge object is load-bearing: it turns preload/renderer drift into a compile
error rather than an undefined at runtime.

Channels named `ON_*` are main → renderer events, subscribed with a callback.
Everything else is a request/response `invoke`.

### Session and timer

| Channel | Purpose |
| :--- | :--- |
| `session:get-current` | The live session, or `null` |
| `session:start-task` | Start tracking a task |
| `session:pause` / `session:resume` | Pause and resume |
| `session:complete` | Stop, write a worklog, optionally mark the task done. When a session was stopped, the bar plays DONE! (marked done) or LOGGED (not) |
| `session:discard` | Stop without recording |
| `session:on-updated` | **Event** — the session changed |

### Providers, projects and tasks

| Channel | Purpose |
| :--- | :--- |
| `provider:get-all` | Current provider settings |
| `provider:set-active` | Persist settings, reinitialise providers, start a sync. Takes a **partial** `ProviderSettingsUpdateDTO`, so unrelated providers' credentials are left alone |
| `provider:get-projects` / `provider:get-tasks` | Read the local cache |
| `provider:create-adhoc` | A local task with no ticket |
| `provider:fetch-op-statuses` | OpenProject status list, for the settings form |
| `provider:sync-now` | Fetch projects and tasks immediately |
| `provider:get-sync-queue` | Everything undelivered, with attempt counts and the server's own message |
| `provider:retry-failed-worklogs` | Un-park `FAILED` rows |
| `projects:on-updated` | **Event** — the cached project list changed |

> `provider:reconcile` was removed. It was declared on the bridge with no
> handler in main, so calling it rejected. The providers keep their
> `reconcileRemoteState` methods; the channel comes back the day a UI needs a
> server-side day total, together with its handler.

### Projects, tasks and worklogs (local)

`projects:create`, `projects:rename`, `projects:delete`, `tasks:delete`,
`tasks:update`, `tasks:import`, `worklogs:get-by-date`,
`worklogs:get-daily-summary`, `worklog:get-todays`, `db:wipe-all-data`, and the
`worklog:on-updated` event.

`projects:delete` and `tasks:delete` delete a task only if no time was logged
against it; one with worklogs is archived -- off every list, still in history.
Worklogs come back with `taskKey` and `taskTitle` beside `taskId`, read from
the task row, archived or not.

### Hardware input

| Channel | Purpose |
| :--- | :--- |
| `input:get-bindings` / `input:save-bindings` | The rebindable control map |
| `input:inject-remote-key` | Simulate a physical key |
| `input:on-hardware-event` | **Event** — a physical control was used |

### Priority and display

| Channel | Purpose |
| :--- | :--- |
| `priority:get-rules` / `priority:save-rules` | The scoring table |
| `priority:set-user-mode` / `priority:get-user-mode` | `WORK` / `LUNCH` / `AWAY` |
| `priority:on-user-mode-updated` | **Event** |
| `display:get-state` | Current frame, for the emulator |
| `display:on-state-updated` | **Event** |
| `display:set-color-theme`, `display:trigger-confetti-burst` | Display options. `display:trigger-confetti-burst` plays DONE! alone, for the debug panel |
| `display:preview-screen` | Draws one **real** screen for the debug panel, through the actual renderer — the panel used to hand-build payloads and drifted into a vocabulary main had stopped emitting |

### Device, ceremonies, Unity, notifications, diagnostics, updates

| Group | Channels |
| :--- | :--- |
| Device | `device:get-status`, `device:get-config`, `device:set-config`, `device:on-status-changed` |
| Ceremonies | `schedule:get-settings`, `schedule:save-settings`, `schedule:trigger-eod-prompt`, `schedule:trigger-eod-wrapup`, `schedule:cancel-eod-wrapup`, `schedule:trigger-standup-prompt`, `schedule:cancel-standup-prompt`, `schedule:snooze-ceremony`, `schedule:on-ceremony-prompt`, `schedule:update-ceremony-prompt` |
| Unity | `unity:get-settings`, `unity:save-settings`, `unity:get-telemetry`, `unity:on-telemetry-updated`, `unity-injector:*`, `dialog:open-folder-picker` |
| Notifications | `notifications:get-settings`, `notifications:save-settings`, `notifications:simulate`, `notifications:get-listener-status`, `notifications:on-log`, `notifications:open-settings` |
| Provider events | `provider-events:get-settings`, `provider-events:save-settings` (answers the settings as stored: an interval is clamped to 30-3600 s), `provider-events:test` (a sample through the destinations switched on; answers `{ toast, bar }`) |
| Diagnostics | `diagnostics:export-logs` |
| Updates | `updates:check`, `updates:get-enabled`, `updates:set-enabled`, `updates:open-release-page`, `updates:on-status` |
| App | `app:get-system-locale` -- Windows' regional format (`en-BE`, `fr-FR`), read once by the renderer at startup to format times |
| Mini timer | `mini:toggle` (answers whether it is open afterwards), `mini:is-open`, `mini:on-visibility` (**Event**, to every window, however it was opened or closed), `mini:open-task-picker` (brings the dashboard forward with the picker open; `false` if there is no dashboard) |

---

## Local HTTP API

**Source:** `src/main/api/webhook-server.ts`

`http://127.0.0.1:39123`, bound to loopback and never reachable from the
network. It exists for the Unity Editor plugin.

### Routes

| Route | Method | Body |
| :--- | :--- | :--- |
| `/api/v1/unity/compile` | POST | `{ state: 'started' \| 'finished', projectName, type?: 'compile' \| 'build' \| 'bake', progress?, unityVersion?, success?, elapsedSeconds?, instanceId? }` |
| `/api/v1/unity/playmode` | POST | `{ state: 'entered' \| 'exited', projectName, instanceId? }` |
| `/api/v1/unity/console` | POST | `{ type: 'warning' \| 'error' \| 'exception', message, projectName, stackTrace?, instanceId? }` — throttled to one event per 3 s |
| `/api/v1/unity/heartbeat` | POST | `{ projectName, unityVersion?, compiling?, playMode?, savePort?, instanceId? }` |
| `/api/input` | POST | `{ key }` — or `?key=` — injects a physical key event (`up`, `down`, `start`, `ok`, `back`, …) |

Responses are JSON. `200 { status: 'ACCEPTED' }` on success,
`200 { status: 'THROTTLED' }` for a rate-limited console event,
`400 { error: 'INVALID_PAYLOAD' }` for a body that does not validate.

### Screening

> [!WARNING]
> **Loopback is not a security boundary**
>
> Any page in any browser on this machine can POST to `127.0.0.1`, and this API
> can drive hardware and inject input. Requests are therefore screened before
> routing.

| Rule | Response | Why |
| :--- | :--- | :--- |
| Method must be POST | `405` | |
| An `Origin` header is present | `403` | Browsers set it; native clients do not |
| `Content-Type` is not `application/json` | `415` | A browser may send a cross-origin POST without permission only while the request stays "simple" — form, plain-text or multipart. Requiring JSON forces a CORS preflight, and no `Access-Control-Allow-Origin` is ever sent, so that preflight fails and the real request is never made |
| Body over 64 KB | `413` | |

**This is not authentication.** Any local program can still call this API. What
the checks close is the path from a web page you happen to be visiting to your
hardware. `pnpm verify:packed` asserts all of it against a real packaged build.

---

## `ITaskProvider`

**Source:** `src/main/providers/task-provider-interface.ts`

What you implement to add a task provider. Three exist: `OpenProjectProvider`,
`JiraProvider`, `AdHocProvider`.

```ts
interface ITaskProvider {
  readonly providerId: string;
  readonly providerName: string;
  readonly minimumLoggableSeconds: number;

  initialize(credentials: Record<string, string>): Promise<boolean>;
  getProjects(): Promise<ProjectDTO[]>;
  getTasks(projectId: string): Promise<TaskDTO[]>;
  reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number | null }>;
  logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }>;
  updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean>;

  // Optional: activity on the user's tasks, for toasts and bar banners.
  getEventsSince?(sinceUtc: string): Promise<ProviderEventDTO[]>;
  getEventsInboxUrl?(): string | null;
}
```

`TaskDTO.description` is optional: plain text on one line, at most
`TASK_DESCRIPTION_MAX_CHARS` (500), cut with an ellipsis. Convert with
`task-description.ts` -- `adfToPlainText` for Jira's document tree,
`markdownToPlainText` for OpenProject's `description.raw` -- then
`clampDescription`. Omit the field when there is nothing left; do not send an
empty string. Jira asks for `description` in its `fields` list, the one heavy
field it requests.

### The contract, in rules

**Report failure by throwing a `ProviderRequestError`. Never return `[]`.**
An empty array is indistinguishable from "this user has no tasks", and
`OfflineSyncWorker` prunes the local cache against what it receives. Returning
an empty list on a network error is how the cache got deleted (F-01). A partial
page is the same hazard: if pagination cannot finish, throw rather than return
what you have.

**Check that the remote accepts the credentials; a 200 does not prove it.**
Jira Cloud answers a revoked or expired token as an anonymous caller:
`/project/search` and `/search/jql` return 200 and empty, and only an endpoint
that needs a user, such as `/myself`, returns 401 (measured 2026-10-02, with
no credentials and with wrong ones alike). `JiraProvider` therefore calls
`/myself` before every read the prune or the event cursor depends on, trusting
the answer for `JIRA_AUTH_CHECK_TTL_MS` (one minute) so that a sync pass does
not ask once per project. A new adapter has to find out how its API treats a
bad credential, and `scripts/fake-jira.js` reproduces Jira's answer so the
check has cover.

**`minimumLoggableSeconds` is a fact about your API, not a policy.** Jira's time
tracking is minute-granular, so it declares 60; OpenProject and AdHoc record
arbitrary durations and declare 1. The engine reads it before queueing, so a
session too short to record is never handed to a provider that will refuse it —
and one provider's limitation never costs a user time on another.

Declare a number you have **measured**, not one you read in the vendor's
documentation. Jira's 60 was verified against a live site with
`pnpm probe:jira-worklog`: 59s is refused and 60s accepted. Guessing high is not
the safe direction — it silently discards time the remote would have stored, and
nothing anywhere reports that it happened.

**A task's priority is a rank, `priorityRank`: 0 most urgent, 4 least.** Map
your provider's priority name with `priorityRankFromName`, which knows Jira's
two shipped schemes and OpenProject's. Leave the field off for a priority it
does not know rather than guessing: an unranked task sorts after the ranked
ones in the hardware picker, while a wrong rank puts it where nobody expects.

**`reconcileRemoteState` may answer `null`.** `remoteLoggedTimeToday: null`
means "this provider cannot find out". Jira has no single endpoint for "time I
logged today", and AdHoc has no remote at all; both return `null` rather than a
`0` a caller would render as a measured "you logged nothing today".
OpenProject returns a real total, and `null` when the fetch failed.

**`getEventsSince` throws too, and works on the provider's clock.** It answers
what happened after `sinceUtc`, exclusive: `assigned`, `mentioned`,
`commented`, `status_changed` or `date_alert` (`ProviderEventDTO` in
`src/shared/provider-events.ts`). An empty array means nothing happened, so a
failure must throw, or the poller would move its cursor past events it never
saw. `occurredAtUtc` is the server's own timestamp: the cursor advances on it,
never on this machine's clock. Drop what is not about the user's attention
rather than inventing a kind for it, and add the provider's id to
`PROVIDERS_WITH_EVENTS`, which a test holds to the adapters that implement the
method. OpenProject reads unread `/api/v3/notifications` -- the API has no
time filter -- and maps `assigned`/`responsible`, `mentioned`, `commented`,
`processed` and `dateAlert`.

Jira Cloud has no notifications API, so its adapter approximates one:
`GET /rest/api/3/myself` once per configuration for the account id, then
`/search/jql` over `(assignee = currentUser() OR reporter = currentUser() OR
watcher = currentUser()) AND updated >= -Nm` with `expand=changelog` and the
`comment` field. A changelog `assignee` set to the user is `assigned`, as is an
issue someone else created already assigned to them; a `status` item is
`status_changed`, with `From → To` as its summary; a comment is `mentioned`
when its ADF has a `mention` node carrying the user's account id, `commented`
otherwise. Anything whose author is the user is dropped. Two traps:

- **The window is relative, never a date.** JQL reads `"2026-10-01 10:05"` in
  the timezone of the user's Jira profile, so an absolute bound shifts by the
  difference. N is the minutes since the cursor plus
  `JIRA_EVENT_WINDOW_MARGIN_MINUTES`, and the timestamps cut it exactly.
- **Never read `item.toString` off a changelog item.** It is a field -- the new
  value's display text -- and where it is missing the expression is
  `Object.prototype.toString`. `historyItemField` reads own properties only.

A changelog or comment list the search truncated (`total` above what came back)
is completed from `/issue/{id}/changelog` (its last page: it lists oldest
first) or `/issue/{id}/comment?orderBy=-created`. `providerEventKindsFor`
limits the settings panel to the kinds a provider produces; Jira has no
`date_alert`.

**Use `providerFetch`.** `src/main/providers/provider-http.ts` is the one place
a provider talks to the network: per-attempt timeout, `Retry-After`-aware
backoff, bounded retries, and classification into `ProviderRequestError`. Do not
call `fetch` directly.

**Only GET/HEAD/OPTIONS are retried.** Neither API has an idempotency key, so
repeating a worklog POST after a lost response bills the time twice. An
over-reported day is harder to spot than a missing entry the queue will resend.

**`isPermanent` decides whether a queued row retries.** Any 4xx except `408` and
`429` is permanent — those two describe a moment; the rest describe the request.
A permanent failure parks the row at once with the server's own message instead
of spending eight attempts on byte-identical requests.

### Errors

`ProviderRequestError` (`provider-errors.ts`) carries a `kind`, an optional
HTTP `status`, and a derived `isPermanent`.

| `kind` | Means |
| :--- | :--- |
| `not_configured` | No credentials. **Always permanent** |
| `auth` | `401` or `403`. **Always permanent** — retrying a revoked key to the ceiling is what parked rows with no explanation |
| `protocol` | Any other HTTP status, or a malformed response |
| `transport` | The request never completed — network failure or timeout |

`isPermanent` is `true` for `auth` and `not_configured` regardless of status,
and otherwise for any 4xx **except `408` and `429`**. A 5xx stays retryable: the
request was fine and the server was not.

`ProviderRequestError.notConfigured(providerId)` and
`ProviderRequestError.fromStatus(providerId, status, context, detail)` are the
two standard constructors. Pass `detail` — it is what makes a failure say
`HTTP 401 - You did not provide the correct credentials` instead of leaving the
user to guess.

Note that `ArgumentException` is **not** a `ProviderRequestError`: a
non-positive duration throws one, and the queue cannot classify it, so callers
must not enqueue work that will throw that way.

### Task scope

`src/shared/task-scope.ts` holds the vocabulary — assigned to me, everything
open, or a custom query — and each adapter renders it in its own dialect: JQL
for Jira, a v3 filter array for OpenProject. A custom OpenProject filter is
validated and **throws** if malformed, because an invalid filter that quietly
matched nothing would let the prune delete every cached task for the project.

---

## The BUSY Bar device contract

**Source:** `src/main/hardware/busybar-driver.ts`, and
[the developer guide](BUSY%20Bar%20API%20%26%20Display%20Technical%20Developer%20Guide.md)

The bar answers on **`10.0.4.20`** over USB and needs no token there. That is
the device's own default — but it is the app's *default*, not a constant, and
both the address and the token are configurable in Settings › Device.

> [!IMPORTANT]
> **Never hardcode the device address.**
> Two situations put the bar somewhere else. Over Wi-Fi it holds a DHCP lease.
> And when a host's USB CDC-NCM driver refuses to start the network interface —
> a real failure on Windows 25H2 with Intel 700-series xHCI, where the device
> enumerates cleanly and the adapter fails with Code 10 — the working recovery
> is to reach the bar through a proxy on a different address. Read
> `DeviceConfigDTO.ipAddress`, never `DEFAULT_USB_IP`.

`DeviceConfigDTO.enabled` is no-bar mode when false: the driver does not dial,
and `DeviceStatusDTO.enabled` reports the same so the renderer can hide the
bar's screens. A missing field reads as `true`. `SET_DEVICE_CONFIG` turns the
bar off before retargeting and on after, so it never dials an address it is
leaving; `BusyBarDriver.setEnabled()` does the switch in place.

Changing either value calls `BusyBarDriver.reconfigure()`, which tears down the
ping loop and StateStream socket, re-points the driver and reconnects, without
restarting the app. A host is validated with `isValidDeviceHost` before it is
used: an IPv4 address or hostname only, since the value is concatenated into
`http://${host}/api/...` where a stray `/` or `@` retargets every request.

The API token, when set, is sent as `x-api-token` — as a header on HTTP calls
and as a **query parameter** on the StateStream WebSocket URL. Anything logging
that URL must pass it through `redactTokenInUrl` first; console output is
captured into the diagnostics bundle users attach to bug reports.

Violating the rules below does not produce a helpful error. Some of them reboot
the device.

| Rule | What happens if you break it |
| :--- | :--- |
| Colours are `#RRGGBBAA` — exactly 8 hex digits | The **entire** draw call 400s, so one bad element takes down the whole frame |
| Text is printable ASCII (`0x20`–`0x7E`) | Smart quotes and emoji corrupt the display. Use `sanitizeAsciiText`, which transliterates rather than substitutes |
| A solid fill takes exactly one colour; a gradient exactly two | **Reboots the device.** `formatHardwarePayload` normalises this — do not bypass it |
| The field is `application_name`, not `app_id` | `app_id` is a legacy name the firmware ignores |
| Asset filenames match `^[a-zA-Z0-9._-]+$` | No paths, no spaces. Firmware 1.2.3 does accept a subdirectory and creates it, but the strict rule holds on every firmware and nothing here needs one |
| Draw priority ≥ 95 | The app does not hold the display |
| RTC timestamps need a numeric UTC offset, not `Z` | The device applies no conversion, so `toISOString()` leaves the bar showing UTC |
| The device's clock is not the host's | A measured bar ran 19s behind. Anything that lets the *device* do the time arithmetic is wrong by the skew, and nothing reports it — see below |

### Status codes carry meaning

See `classifyDeviceResponse`.

| Code | Meaning |
| :--- | :--- |
| `409` | Priority conflict — something else owns the display. **Not a failure** |
| `413` | Payload too large. **Permanent** — retrying sends the same bytes |
| `503` | Retry |

### How the driver reports failure

`BusyBarDriver`'s commands **throw** when the device did not do what was asked.
The error is a `DeviceRequestError`, and its `kind` gives the reason:

| `kind` | Meaning |
| :--- | :--- |
| `disconnected` | The driver is not connected, so nothing was sent |
| `unreachable` | Sent, no answer: timeout, refused connection. The message carries the transport cause |
| `conflict` | `409` on a request that is not a draw |
| `too_large` | `413`. Permanent |
| `busy` | `503`, still busy after the driver's own retry |
| `rejected` | Any other non-2xx; `status` holds the code |

A bad asset filename throws `ArgumentException` before anything is sent.

Draws return a value instead of throwing for the answers that are not failures:

| Call | Resolves to |
| :--- | :--- |
| `sendDisplayPayload` | `'drawn'`, or `'conflict'` when another application owns the display |
| `drawOverlay` | The same, for elements laid **over** the screen. Unlike `sendDisplayPayload` it does not supersede a frame whose upload is in flight |
| `sendPixelFrame` | `'sent'`; `'queued'` (disconnected or another frame in flight, so it is sent next); `'superseded'` (a clear landed mid-upload, **the device is not showing it**); `'conflict'` |
| `clearDisplay` | `'cleared'`; or `'superseded'` when a draw landed while it waited its turn or took animations down, in which case the display is **not** released. Clears run one at a time; one that finds the panel already emptied, with nothing drawn since, sends nothing and answers `'cleared'` |

`removeDisplayElements(app, ids)` removes the named elements and nothing
else. An id the device does not hold answers **400**, so it throws `rejected`;
a caller removing something that may already be gone has to read that as
success -- `isElementAbsent(err)` says so, for a 400 and nothing else. The
driver logs that 400 on a single id as "already gone", not as a warning. **Several
ids in one call are all or nothing**: one missing id fails the request and
removes none of the others, so remove one id per call when any may be gone.

`shownElementIds(app, type?)` lists what the driver has drawn for an
application and not yet removed -- id and element type, from its own
successful draws and removals, since the device has no endpoint that lists
them. It can only be stale in one direction (an element the device dropped by
itself), and a removal of such an element answers 400, which reads as gone.

### Emptying the panel closes the device's screen

When an application's element set becomes empty -- a full `DELETE
/api/display/draw`, or removing its last element by id -- the firmware closes
its screen, and reopens it on the next draw.

> [!CAUTION]
> **On firmware 1.2.4, closing the screen after an image and an animation have
> shared it hangs the bar within a few cycles.** Measured 2026-09-30: a clear
> with both on the panel hung it on round 3 and round 4; removing the
> animation by id and clearing at once hung it on round 6. Uploads slowing
> from ~50 ms to several hundred came first. An animation alone, and every
> sequence that never emptied the panel, ran ten rounds clean.

So the app never empties the panel to change screens:

| Transition | How |
| :--- | :--- |
| Into a full-panel scene | Draw `hardware_anim` at `z_index` 0, under the frame; then remove `px_matrix_img` |
| Out of it | The next frame lands at `z_index` 1 over the scene; once it is `sent`, remove `hardware_anim` |
| Scene to scene | Same element id, so the draw replaces it in place |
| Release for the idle clock, and quit | `clearDisplay`, one at a time: every tracked animation removed by id, `ANIMATION_TEARDOWN_SETTLE_MS`, then the full DELETE |

That last row is the only close left, and the pause is what makes it safe:
the same release without it hung the bar on round 6, and with the 500 ms pause
`pnpm probe:busybar --teardown-soak` ran ten rounds clean on firmware 1.2.4
(2026-09-30), uploads flat at 24-53 ms. Re-run that soak before changing the
pause -- a pause too short hangs the bar.

Uploading over an `.anim` the device is playing answers **508**, so a scene
still on the panel is redrawn from the copy the device holds rather than
uploaded again.

`connect()` and `reconfigure()` answer a boolean and never throw. They are
probes, and "the bar is not there" is a normal answer for them.

> [!IMPORTANT]
> **The driver used to answer `Promise<boolean>` for every command and never
> throw.** A `.catch()` on one of those calls was therefore dead code for the
> failure that actually happens, and `.then()` ran regardless. That is how the
> Away animation stayed dark while the emulator played it. `.then(` is now an
> ESLint error under `src/main/hardware/**`. Await each step so a failure names
> the step that failed.

### Frames

The front display is a rasterised **72×16 PNG**. Every frame is an asset upload
plus a draw — two HTTP requests. `transmitFrame` hashes the frame and skips an
identical one, so before adding anything that redraws on a timer, check what
actually changes. This is why the session timer shows `HH:MM` and not seconds.

### Reading the panel back

`GET /api/screen?display=0` returns the front panel. It is the only way to check
a *layout*, and `pnpm probe:busybar` uses it to measure element sizes.

> [!WARNING]
> **The response is not what its content type claims.** It answers
> `Content-Type: image/bmp`, and the firmware's own `streaming.yaml` types the
> body as base64 — but on 1.2.3 what arrives is base64-encoded **raw** pixels
> with no BMP header: 4608 characters decoding to 3456 bytes, which is
> 72 × 16 × 3. The channel order is **BGR**, and rows are **top-down**. Both
> were established by drawing a known block and reading the bytes, because
> either mistake still produces a plausible image — one with the colours
> swapped, the other upside down.

### Letting the device keep time

`CountdownElement` draws a timer the device advances by itself, at no upload
cost — against the two HTTP requests per frame the app pays to animate one.
Measured on 1.2.3: **17×5px** for `01:06`, which fits beside a 16px icon with
39px of the field to spare, and it has no `font` field to configure.

> [!CAUTION]
> **It counts against the device's RTC, not yours.** A countdown built from
> `Date.now()` on a bar running 19 seconds behind displayed `00:47` for a
> 65-second interval. The element is correct; the clocks disagree, and the
> element believes the device. Read `GET /api/time`, compute the offset, apply
> it to the timestamp, and re-read it periodically — RTC drift is what produced
> the skew in the first place. Nothing surfaces this error on its own: the bar
> simply shows a confidently wrong time.

The app draws nothing on the rear 160×80 display: the firmware mirrors the
front there, and shows its own clock when the front is empty. What the rear
accepts, measured on 1.2.4 with `pnpm probe:busybar --rear`: `image` and `text`
elements with `display: 'back'`; a status column the firmware draws over
x 148-159; 16 levels of grey, with colour converted to luminance; and
`GET /api/screen?display=1` answering 6400 bytes of 4-bit grey, base64,
high nibble first.

### Checking the contract after a firmware release

`pnpm probe:busybar` runs the calls above against a real bar and reports the
firmware version alongside the result. The test suite mocks the driver, so it
proves what this app *sends* and nothing about what the device does with it —
every hardware defect in this project's history was found by running the app and
reading a console.

Verified on **firmware 1.2.3** (2026-09-09) and again on **1.2.4**
(2026-09-29): everything above still holds, and two additions are available
that were not before.

| Field | Where | What it enables |
| :--- | :--- | :--- |
| `z_index` | On any display element | Integer, higher drawn on top. Elements at the same priority can be layered instead of overwriting one another |
| `element_ids` | `DELETE /api/display/draw` | An array of element ids to remove, with `application_name` as a sanity check that you own them. Omit it to remove everything |

Both are used for animated icons and scenes (`FRONT_LAYER_Z`,
`FRONT_ELEMENT_IDS`). A full-panel scene, `hardware_anim`, is drawn at
`z_index` 0; the screen, `px_matrix_img`, at 1; the icon, `icon_anim`, at 2
over it. Each is removed on its own with `element_ids`. Without them an
animation was all-or-nothing across the whole panel, and changing screens
meant emptying it -- see above for why that is no longer done.
