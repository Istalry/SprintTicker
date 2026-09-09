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
| `session:complete` | Stop, write a worklog, optionally mark the task done |
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
| `display:set-rear-oled-mode`, `display:set-color-theme`, `display:trigger-confetti-burst` | Display options |
| `display:preview-screen` | Draws one **real** screen for the debug panel, through the actual renderer — the panel used to hand-build payloads and drifted into a vocabulary main had stopped emitting |

### Device, ceremonies, Unity, notifications, diagnostics, updates

| Group | Channels |
| :--- | :--- |
| Device | `device:get-status`, `device:get-config`, `device:set-config`, `device:on-status-changed` |
| Ceremonies | `schedule:get-settings`, `schedule:save-settings`, `schedule:trigger-eod-prompt`, `schedule:trigger-eod-wrapup`, `schedule:cancel-eod-wrapup`, `schedule:trigger-standup-prompt`, `schedule:cancel-standup-prompt`, `schedule:snooze-ceremony`, `schedule:on-ceremony-prompt`, `schedule:update-ceremony-prompt` |
| Unity | `unity:get-settings`, `unity:save-settings`, `unity:get-telemetry`, `unity:on-telemetry-updated`, `unity-injector:*`, `dialog:open-folder-picker` |
| Notifications | `notifications:get-settings`, `notifications:save-settings`, `notifications:simulate`, `notifications:get-listener-status`, `notifications:on-log`, `notifications:open-settings`, `messaging:*` |
| Diagnostics | `diagnostics:export-logs` |
| Updates | `updates:check`, `updates:get-enabled`, `updates:set-enabled`, `updates:open-release-page`, `updates:on-status` |

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
}
```

### The contract, in rules

**Report failure by throwing a `ProviderRequestError`. Never return `[]`.**
An empty array is indistinguishable from "this user has no tasks", and
`OfflineSyncWorker` prunes the local cache against what it receives. Returning
an empty list on a network error is how the cache got deleted (F-01). A partial
page is the same hazard: if pagination cannot finish, throw rather than return
what you have.

**`minimumLoggableSeconds` is a fact about your API, not a policy.** Jira's time
tracking is minute-granular, so it declares 60; OpenProject and AdHoc record
arbitrary durations and declare 1. The engine reads it before queueing, so a
session too short to record is never handed to a provider that will refuse it —
and one provider's limitation never costs a user time on another.

**`reconcileRemoteState` may answer `null`.** `remoteLoggedTimeToday: null`
means "this provider cannot find out". Jira has no single endpoint for "time I
logged today", and AdHoc has no remote at all; both return `null` rather than a
`0` a caller would render as a measured "you logged nothing today".
OpenProject returns a real total, and `null` when the fetch failed.

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

The bar answers on the fixed address **`10.0.4.20`** over USB and needs no
token there. That is how the device works, not a hardcoded shortcut.

Violating the rules below does not produce a helpful error. Some of them reboot
the device.

| Rule | What happens if you break it |
| :--- | :--- |
| Colours are `#RRGGBBAA` — exactly 8 hex digits | The **entire** draw call 400s, so one bad element takes down the whole frame |
| Text is printable ASCII (`0x20`–`0x7E`) | Smart quotes and emoji corrupt the display. Use `sanitizeAsciiText`, which transliterates rather than substitutes |
| A solid fill takes exactly one colour; a gradient exactly two | **Reboots the device.** `formatHardwarePayload` normalises this — do not bypass it |
| The field is `application_name`, not `app_id` | `app_id` is a legacy name the firmware ignores |
| Asset filenames match `^[a-zA-Z0-9._-]+$` | No paths, no spaces |
| Draw priority ≥ 95 | The app does not hold the display |
| RTC timestamps need a numeric UTC offset, not `Z` | The device applies no conversion, so `toISOString()` leaves the bar showing UTC |

### Status codes carry meaning

See `classifyDeviceResponse`.

| Code | Meaning |
| :--- | :--- |
| `409` | Priority conflict — something else owns the display. **Not a failure** |
| `413` | Payload too large. **Permanent** — retrying sends the same bytes |
| `503` | Retry |

### Frames

The front display is a rasterised **72×16 PNG**. Every frame is an asset upload
plus a draw — two HTTP requests. `transmitFrame` hashes the frame and skips an
identical one, so before adding anything that redraws on a timer, check what
actually changes. This is why the session timer shows `HH:MM` and not seconds.

The rear 160×80 OLED is **preview only** in this build.
