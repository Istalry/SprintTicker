# SprintTicker Provider API — contract v1

> [!NOTE]
> **Status: draft, 2026-10-23. Not implemented in SprintTicker yet.** This is
> the contract a task-tracking server implements so that SprintTicker can use
> it as a provider, beside Jira and OpenProject. Section 15 is the plan for
> SprintTicker's side.

**Who this is for.** Whoever builds the server, including an AI coding agent
working from this file alone. It assumes no knowledge of SprintTicker: section
1 explains what the client is and the words it uses. Every rule says *why* it
exists. Most of them are a bug SprintTicker already met with Jira or
OpenProject, and the reason is what lets you decide a case this document did
not foresee.

**How to read it.** "Must", "must not" and "should" are requirements; anything
else is explanation. Where an example and a rule disagree, the rule wins.

Contents:

1. [SprintTicker in one page](#1-sprintticker-in-one-page)
2. [The rule of entry](#2-the-rule-of-entry)
3. [Conventions](#3-conventions)
4. [Objects](#4-objects)
5. [Capabilities](#5-capabilities)
6. [Required endpoints](#6-required-endpoints)
7. [Optional endpoints](#7-optional-endpoints)
8. [A working day, call by call](#8-a-working-day-call-by-call)
9. [Load, timeouts and retries](#9-load-timeouts-and-retries)
10. [Errors](#10-errors)
11. [Security](#11-security)
12. [The server's checklist](#12-the-servers-checklist)
13. [The conformance check](#13-the-conformance-check)
14. [Endpoint summary](#14-endpoint-summary)
15. [Implementing it in SprintTicker](#15-implementing-it-in-sprintticker)
16. [Changing the contract](#16-changing-the-contract)

---

## 1. SprintTicker in one page

SprintTicker is a **desktop time tracker for Windows**. A user picks one of
their tasks and starts a timer on it; when they stop, the time is sent to the
system the task came from, which this document calls the **provider**. The
user can drive it from its window, from a small always-on-top timer, from a
**BUSY Bar** (a USB LED display on the desk, 72x16 pixels, with buttons and a
wheel), or from a **Stream Deck** (a pad of programmable keys). Jira Cloud and
OpenProject are providers today; a server implementing this contract becomes
another one.

SprintTicker keeps its own local database. It works offline: everything it
has to send waits in a queue until the provider answers.

### Glossary

| Term | Meaning in this document |
| :--- | :--- |
| **User** | The person running SprintTicker. One API token belongs to one user, and every request is made as that user |
| **Server** | The system implementing this contract |
| **Client** | SprintTicker |
| **Project** | A container of tasks on the server. SprintTicker shows tasks grouped by project |
| **Task** | A unit of work time is logged against: an issue, a ticket, a work package |
| **Key** | A task's short human reference, such as `PLAT-142`, shown on screen. Not used to address the task in the API; the **id** is |
| **Session** | One run of the timer on one task, from start to stop. It can be paused and resumed |
| **Worklog** | A record of time spent on a task: a start, a duration, a comment. Called a *time entry* elsewhere |
| **Piece** | A session is sent as one or more worklogs, its *pieces*: one per local day it spans, and another after each long pause |
| **Sync** | The client re-reading projects and tasks from the server, every 5 minutes |
| **Queue** | The client's list of sends waiting for the server: worklogs, corrections, deletions. It survives restarts |
| **Ad-hoc task** | A task the user names on the spot, which exists only in SprintTicker ("Phone call", "Help a colleague") |
| **Default scope** | Which tasks the user's lists show: section 6.3 |
| **Local day** | A calendar day in the user's own timezone, as `YYYY-MM-DD` |

### How a session ends

The user ends a session in one of three ways, and the server sees each
differently:

| The user picks | The server receives |
| :--- | :--- |
| **Not done** -- stop, keep the task open | The session's worklogs |
| **Done** -- stop, the task is finished | The worklogs, then a `finish` transition (6.8) |
| **Discard** -- throw the session away | Nothing |

---

## 2. The rule of entry

SprintTicker is a time-tracking **client**: it reads tasks, records time and
moves a task to *started* and *finished*. It is not a project-management tool,
and the contract is not a remote control for one.

> [!IMPORTANT]
> **An endpoint or a field belongs in this contract only if SprintTicker would
> want the same thing from any provider.** Planning, approvals, estimates, team
> views, reports and administration stay in the server's own interface.
> SprintTicker never grows a screen for one server.

What the server does with what it is told is its own business. "The week is
closed" is in the contract (7.7); what the server then submits, and to whom,
is not.

---

## 3. Conventions

### 3.1 Base URL and versioning

- The user types **one base URL** into SprintTicker. It must end with the
  contract version: `https://tracker.example.com/sprintticker/v1`. Every path
  in this document is relative to it.
- **Within v1, changes are additive only**: new endpoints, new optional
  fields, new capabilities, new values in the lists that 3.5 marks *open*.
  Both sides must ignore fields they do not know; 3.5 says what each side does
  with a value it does not know.
- Removing or renaming a field, or changing a meaning, makes v2, served under
  a new base URL. A server may serve v1 and v2 side by side.

### 3.2 Transport

- **HTTPS is required**, except for `localhost` and `127.0.0.1`, which exist
  for development. The token is a permanent credential and must never travel
  in clear text.
- Request and response bodies are JSON, UTF-8: `Content-Type:
  application/json; charset=utf-8`. A request without a body has no
  `Content-Type`.
- The client sends these headers on every request:

  | Header | Value |
  | :--- | :--- |
  | `Authorization` | `Bearer <token>` |
  | `Accept` | `application/json` |
  | `User-Agent` | `SprintTicker/<version>`, for instance `SprintTicker/1.4.0` |

- The client is a desktop application, not a browser: the server needs no
  CORS headers.

### 3.3 Authentication

- One **personal API token per user**, created in the server's own interface
  and pasted into SprintTicker by the user. No password and no OAuth flow in
  v1.
- **The token is the user.** Every endpoint answers as the user the token
  belongs to, and every list is that user's view.
- **A missing, invalid, expired or revoked token answers `401` on every
  endpoint.** Never `200`. Section 6.1 explains why.

### 3.4 Formats

| Kind | Format | Example | Why |
| :--- | :--- | :--- | :--- |
| **Instant** | ISO 8601 in UTC, with `Z`. Both sides send whole seconds, and both accept a fraction of a second and may drop it | `2026-10-23T07:42:10Z` | Unambiguous. The client converts for display |
| **Local day** | `YYYY-MM-DD`, the user's own calendar day **as the client sends it** | `2026-10-23` | A worklog belongs to the day the user worked. Recomputing it from an instant in the server's timezone files evening work under the next day; SprintTicker shipped exactly that bug once |
| **Duration** | Integer seconds | `5400` | No rounding on either side |
| **Id** | Opaque string, 1 to 128 characters | `"t-1042"` | The client stores it and sends it back unchanged. It must stay valid for the object's whole life and never name another object, even after deletion |
| **Key** | Printable ASCII (`0x20`-`0x7E`), 2 to 12 characters, no spaces. Should be unique among the user's tasks; the client does not rely on it | `"PLAT-142"` | Shown on a 72x16 LED panel whose fonts have only ASCII, beside the timer. A server whose tasks have no short reference sends their number, such as `"#1042"` |
| **Text** | Any Unicode | `"Café: cache the list"` | Titles, names and messages. The client simplifies them for the LED panel itself |
| **Code** | Lowercase ASCII, `snake_case`, from a fixed list in this document | `"in_progress"` | See 3.5 |

### 3.5 Codes are identifiers, never labels

Statuses, intents, event kinds, error codes and capability names are
**codes**: fixed identifiers listed in this document.

- They are **case-sensitive** and **never translated**. `in_progress` is
  `in_progress` on a server in French, in German or in English.
- They are **never shown to the user** as they are. Where a human name helps,
  the object carries it beside the code (`serverStatus.name`, `message`).
- A server **must not** invent codes in a list this document closes. Where it
  needs more nuance, it maps its own values onto the codes and keeps its own
  identifiers in a separate field (`serverStatus.id`).

| List | Section | Closed or open | A value the receiver does not know |
| :--- | :--- | :--- | :--- |
| Task statuses | 4.3 | Closed: a new one is v2 | Cannot happen |
| Task states | 4.3 | Closed | Cannot happen |
| Intents | 6.8 | Closed | The server answers `422` |
| Assignment outcomes | 7.1 | Closed | Cannot happen |
| Event kinds | 4.5 | Open: a later v1 may add kinds | The client drops the event, so a server sends only the kinds listed here |
| Capabilities | 5 | Open | The client ignores it |
| Error codes | 10.2 | Open | The client acts on the HTTP status alone |

The reason is the one OpenProject taught: SprintTicker once stored status
*names* where the API wanted status *ids*, and every status change failed
with a `404` that said nothing about why.

### 3.6 Identifiers in paths

An id in a path is percent-encoded by the client (`/tasks/t%2F9` for the id
`t/9`). Ids made of `[A-Za-z0-9._-]` need no encoding and are recommended.

### 3.7 Collections and pagination

Every list answers the same envelope:

```json
{ "items": [ ], "nextCursor": null }
```

- The client may send `?limit=<n>`; the server answers at most `n` items, and
  may answer fewer. Without `limit`, the server picks a page size. **A page
  must not exceed 500 items.**
- While `nextCursor` is a string, the client asks for the next page with
  `?cursor=<nextCursor>` and the same other parameters. `null` means the list
  is complete.
- A cursor is opaque to the client. It should stay valid for at least 5
  minutes.
- The order of items is stable across the pages of one read. The client
  sorts tasks itself -- the user's first, then by status, then by
  `priorityRank` -- and tasks equal on all three **keep the server's order**,
  so send the order that means something, such as a board's ranking.
- **A page that fails fails the whole read.** The client never uses part of a
  list (6.3 explains why).

### 3.8 Unknown and missing fields

- The client ignores any field it does not know, so a server may return
  more than this document lists.
- An optional field the server has no value for is **omitted**, or `null`
  where this document says "nullable". An empty string is not "no value".
- The client reads `null` in an optional field as if it were omitted, so a
  server that serialises absent values as `null` still works.

---

## 4. Objects

The shapes every endpoint returns. "Required" means the server must always
send the field.

### 4.1 User

```json
{ "id": "u-17", "displayName": "Ada Lovelace" }
```

| Field | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `id` | Id | yes | Compared with a task's `assignee.id` to decide whose the task is |
| `displayName` | Text | yes | Shown to the user ("Assigned to Ada Lovelace") |

### 4.2 Project

```json
{ "id": "p-3", "key": "PLAT", "name": "Platform" }
```

| Field | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `id` | Id | yes | |
| `key` | Key | yes | A short reference shown beside the name |
| `name` | Text | yes | |

### 4.3 Task

```json
{
  "id": "t-1042",
  "projectId": "p-3",
  "key": "PLAT-142",
  "title": "Cache the session list",
  "status": "in_progress",
  "serverStatus": { "id": "st-4", "name": "In development" },
  "assignee": { "id": "u-17", "displayName": "Ada Lovelace" },
  "priorityRank": 1,
  "description": "The list is read on every redraw; keep it for a second.",
  "url": "https://tracker.example.com/tasks/1042",
  "labels": ["Sprint 12"],
  "state": "open"
}
```

| Field | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `id` | Id | yes | Addresses the task in every endpoint |
| `projectId` | Id | yes | The project it belongs to |
| `key` | Key | yes | Shown on screen and on the LED panel |
| `title` | Text | yes | |
| `status` | Code | yes | One of the three task statuses below |
| `serverStatus` | object | no | The server's own status: `id` (Id) and `name` (Text). Shown to the user as information only; the client never acts on it |
| `assignee` | User, **nullable** | yes | Who the task is assigned to, or `null` for nobody. Always present, so that "nobody" and "not sent" cannot be confused |
| `priorityRank` | integer 0-4 | no | `0` most urgent, `4` least. Sorts the task lists and the LED panel's task picker. A task without it sorts after every ranked one |
| `description` | Text | no | Plain text, no markup. The client keeps the first 500 characters, on one line |
| `url` | string | no | The task's page in the server's web interface, under `siteUrl` (5). Without it, the client offers no "open in browser" for the task |
| `labels` | array of Text | no | Only with the `labels` capability (7.8) |
| `state` | Code: `open` or `closed` | see below | `closed` when the task is finished for good, cancelled or rejected; otherwise `open` |

**`state`** is required in the answers that name one task -- 6.8, 7.1, 7.2 --
because those can be about a task closed since the client last read it. In a
list it may be omitted: a listed task is always `open`. A closed task carries
`"status": "done"` with `"state": "closed"`; `done` with `open` is the
"finished, not yet closed" below.

**Task statuses**, a closed list:

| Code | Meaning |
| :--- | :--- |
| `todo` | Not started |
| `in_progress` | Being worked on |
| `done` | Finished by whoever worked on it, **but not closed**: waiting for review, test or approval |

A task that is **closed** -- finished for good, cancelled, rejected -- has no
status of its own: it is not listed at all (6.3), and an answer about it
alone says `"state": "closed"`. A server with more statuses maps each of its
own onto the three codes or onto *closed*, and sends its own in
`serverStatus`. For instance:

| The server's status | `status` | Listed |
| :--- | :--- | :---: |
| Backlog, Ready | `todo` | yes |
| In development, Blocked | `in_progress` | yes |
| In review, To test, Resolved | `done` | yes |
| Closed, Rejected, Cancelled | `done`, `"state": "closed"` | no |

A task belongs to exactly one project. One that moves to another project keeps
its `id`, and its worklogs stay valid.

A **group or a placeholder** as assignee is someone else: send it as a User
with its own `id`. SprintTicker treats any assignee whose `id` is not the
user's as another person.

### 4.4 Worklog

```json
{
  "id": "w-5521",
  "clientRef": "q_01J9ZK7T3V4B5N6M7P8Q9R0S1T",
  "taskId": "t-1042",
  "startedAt": "2026-10-23T07:42:10Z",
  "day": "2026-10-23",
  "durationSeconds": 5400,
  "comment": "Cache the session list [#7P8Q9R0S]"
}
```

| Field | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `id` | Id | yes | The server's id for the worklog |
| `clientRef` | string, 1-64 characters of `[A-Za-z0-9_-]` | yes | The client's reference for the send that created it (6.4). Opaque: the server stores and compares it, never parses it |
| `taskId` | Id | yes | |
| `startedAt` | Instant | yes | When the work began |
| `day` | Local day | yes | The day the work belongs to, as the client sent it |
| `durationSeconds` | integer | yes | Time worked. Pauses are already taken out, so it can be shorter than the span from `startedAt` |
| `comment` | Text, up to 4000 characters | yes | As the client sent it, byte for byte. May be empty for a worklog made elsewhere |

A worklog belongs to the user who created it. Another user's worklogs are
invisible to this API: reading, correcting or deleting one answers `404`.

### 4.5 Event

```json
{
  "id": "e-9001",
  "kind": "assigned",
  "task": { "id": "t-1042", "key": "PLAT-142", "title": "Cache the session list" },
  "actor": { "id": "u-4", "displayName": "Grace Hopper" },
  "summary": "Can you take this one?",
  "url": "https://tracker.example.com/tasks/1042",
  "occurredAt": "2026-10-23T07:41:02Z"
}
```

| Field | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `id` | Id | yes | Unique among the server's events. The client drops an id it has already shown |
| `kind` | Code | yes | One of the event kinds below |
| `task` | object | yes | `id`, `key` and `title` of the task it is about. An event about anything else -- a project, a wiki page -- is not sent in v1 |
| `actor` | User | no | Who caused it. Omitted when nobody did, as for a date alert |
| `summary` | Text, up to 300 characters | no | A comment excerpt or similar |
| `url` | string | no | Where to read it, under `siteUrl` |
| `occurredAt` | Instant | yes | **The server's clock** |

**Event kinds**, an open list (3.5): a later revision of v1 may add kinds,
and the client drops an event whose kind it does not know.

| Code | Sent when |
| :--- | :--- |
| `assigned` | A task was assigned to the user |
| `mentioned` | Someone mentioned the user |
| `commented` | Someone commented on a task the user is assigned to or follows |
| `status_changed` | Someone changed the status of such a task |
| `date_alert` | A date on such a task is near or past (a due date) |

### 4.6 Error

```json
{ "error": { "code": "workflow_refused", "message": "A task in Review cannot go back to In development." } }
```

Section 10.

---

## 5. Capabilities

```
GET /capabilities
```

**Purpose.** Tells the client which version of the contract the server speaks
and which optional parts it implements. The client calls it when the user
saves the settings, at start-up, and once an hour.

**Response `200`:**

```json
{
  "contract": 1,
  "server": { "name": "Team Tracker", "version": "0.4.2" },
  "siteUrl": "https://tracker.example.com",
  "minimumWorklogSeconds": 60,
  "capabilities": ["assign", "task_state", "calendar", "events", "today_total", "inbox", "week_close", "labels"],
  "eventsInboxUrl": "https://tracker.example.com/notifications",
  "inboxTaskId": "t-1"
}
```

| Field | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `contract` | integer | yes | `1`. The client refuses a version it does not know and tells the user |
| `server.name` | Text | yes | Shown to the user as the provider's name |
| `server.version` | string | yes | Shown in diagnostics, for bug reports |
| `siteUrl` | string | yes | The server's web interface: `https://` and a host, or `http://` on `localhost` (3.2). The client opens a task's or an event's `url` **only if it is `http(s)` and on this origin**: a URL is data from the server, and opening whatever it names would let it launch any program registered for a URL scheme |
| `minimumWorklogSeconds` | integer ≥ 1 | yes | The shortest worklog the server records. The client never sends less: a shorter piece is merged into its neighbour, so no time is lost, and a whole session shorter than this stays in SprintTicker's local history. `1` if any duration works |
| `capabilities` | array of Code | yes | The optional parts implemented, from section 7. Empty if none |
| `eventsInboxUrl` | string | no | With `events`: the page listing all the user's notifications, for a "6 more" message |
| `inboxTaskId` | Id | with `inbox` | The task that receives unplanned time (7.6) |

**Capability codes:**

| Code | Section | In short |
| :--- | :--- | :--- |
| `assign` | 7.1 | Take a task nobody owns |
| `task_state` | 7.2 | Read one task, closed or not |
| `calendar` | 7.3 | Days off |
| `events` | 7.4 | Notifications |
| `today_total` | 7.5 | Time already recorded for a day |
| `inbox` | 7.6 | A task for unplanned time |
| `week_close` | 7.7 | Told when the user's week is over |
| `labels` | 7.8 | Short labels shown beside a task |

The client calls no optional endpoint whose capability is not listed. A
server must not list a capability it does not implement.

**Status codes:** `200`; `401` (3.3).

---

## 6. Required endpoints

A server without all of these is not a provider.

### 6.1 `GET /me` — who the token belongs to

**Response `200`:** a User (4.1).

**Why.** The client compares this `id` with each task's `assignee.id` to know
whose the task is, and reads it before every sync, which makes it the
client's check that the token still works.

> [!WARNING]
> **An invalid, expired or revoked token answers `401`, on this endpoint and
> every other. Never `200`.** Jira Cloud answers an expired token as an
> anonymous visitor: its searches return `200` and empty lists. SprintTicker
> read that as "this user has no projects" and emptied the user's lists at
> every sync until the cause was found.

**Status codes:** `200`; `401`.

### 6.2 `GET /projects` — the user's projects

**Response `200`:** a collection (3.7) of Projects (4.2).

**Which projects.** Every project in which the user can log time. Not
templates, not archived projects. The client hides projects that have no task
for the user, so listing a few too many costs nothing; listing too few hides
work. A project missing from a successful answer is removed from the user's
lists with its tasks, as 6.3 describes for a task.

**Status codes:** `200`; `401`.

### 6.3 `GET /projects/{projectId}/tasks` — the tasks of a project

**Response `200`:** a collection (3.7) of Tasks (4.3), each with `projectId`
equal to `{projectId}`.

**Which tasks: the default scope.** Not closed, and one of:

1. assigned to the user, in any status, `done` included;
2. assigned to nobody -- so the user can pick it up;
3. assigned to someone else **and** `in_progress` -- so the user sees who is
   working on what.

A task assigned to someone else that is `todo` or `done` is left out. The
server may return more than this scope; the client applies the same rule
after reading. It must not return less.

> [!WARNING]
> **A failure is an error status, never an empty list.** The client treats a
> successful answer as the complete truth about the project: a task that was
> listed before and is missing now is removed from the user's lists (or
> archived, when time was logged on it). An empty `items` must mean "this
> project has no task in scope". SprintTicker once deleted users' local data by
> reading a failed request as an empty one.

The client never removes the task of a running session this way: it keeps it
until the session ends, and asks the server why it left (7.2).

**Status codes:** `200`; `401`; `404` if the project does not exist or the
user cannot see it.

### 6.4 `POST /worklogs` — record time

**Request:**

```json
{
  "clientRef": "q_01J9ZK7T3V4B5N6M7P8Q9R0S1T",
  "taskId": "t-1042",
  "startedAt": "2026-10-23T07:42:10Z",
  "day": "2026-10-23",
  "durationSeconds": 5400,
  "comment": "Cache the session list [#7P8Q9R0S]"
}
```

Every field is required. `day` is the local day of `startedAt` on the user's
machine, computed by the client.

**Responses:**

| Status | Body | When |
| :--- | :--- | :--- |
| `201` | `{ "id": "w-5521" }` | Recorded |
| `200` | `{ "id": "w-5521" }` | **A worklog with this `clientRef` already exists for this user.** No second worklog is made: the existing one now holds what this request says, and its id is returned. See below |
| `404` | Error, `not_found` | The task does not exist or the user cannot see it |
| `409` | Error, `period_locked` | The day is in a period the server no longer accepts time for, such as a week already approved |
| `422` | Error, `validation_failed` | A field is invalid: see the rules below |
| `401`, `403` | Error | Section 10 |

> [!IMPORTANT]
> **Idempotent on `clientRef`.** Sending can fail *after* the server recorded
> the worklog: the answer times out, the connection drops, the application
> closes. The client cannot tell that from a failure before recording, so it
> sends again. Without this rule the user is billed twice. Neither Jira nor
> OpenProject offers it, which forces SprintTicker to search for its own
> entries before every resend.
>
> `clientRef` is unique **per user, forever**, including after the worklog is
> deleted: a deleted worklog's `clientRef` answers `200` with the old id, and
> creates nothing.

**A resend may differ from the first send.** While a send waits in the queue,
the user may correct it, and the queue then sends the corrected values. That
includes a send already tried once whose answer was lost: the server may
already hold the first values. So `POST /worklogs` with a `clientRef` the
server knows answers `200` and makes the stored worklog match the request:
`startedAt`, `day`, `durationSeconds` and `comment` take the values sent. Two
exceptions:

- a `taskId` other than the stored one answers `422`: the client never moves a
  worklog to another task;
- a worklog deleted since answers `200` with its old id and stays deleted.

**Enforce the uniqueness with a constraint**, on the pair (user,
`clientRef`), not with a read before the write. The client may send again
while the first request is still being processed -- it gave up waiting, the
server did not -- and two requests that both read "not there" would both
create.

**Validation rules** (`422` otherwise):

- `taskId` names a task the user can see. The task may be **closed, `done`,
  or assigned to someone else**: a session can run while its task is closed
  by someone, and a user may help on a teammate's task. **Refusing that
  worklog loses the time.**
- `durationSeconds` is at least `minimumWorklogSeconds` and at most `90000`
  (25 hours: the longest local day, when clocks go back).
- `day` is a real date. The server must not compare it with `startedAt` in its
  own timezone: the user's timezone decides.
- `startedAt` may be days or weeks in the past: a worklog made offline is sent
  when the network comes back. It may also end a few minutes in the future by
  the server's clock, because the user's clock may be ahead; the server must
  not refuse it for that.
- `comment` is at most 4000 characters and is stored **exactly** as sent. It
  ends with a marker in square brackets, such as `[#7P8Q9R0S]`. The server
  treats it as ordinary text: the marker is how SprintTicker finds its own
  entries on providers that have no `clientRef`, and how a person reading the
  worklog in the server's interface sees where it came from.

**What the client guarantees:**

- **A worklog never crosses the user's local midnight.** A session from 23:00
  to 01:00 arrives as two worklogs, one per day, each with its own
  `clientRef`. Several worklogs on the same task and day are normal.
- **A long pause splits a session**, 15 minutes by default (the user can
  change it or turn it off), so the pieces show when the work happened.
- Time on an ad-hoc task, or on a project made inside SprintTicker, is never
  sent, except to the inbox task (7.6).

### 6.5 `GET /worklogs?clientRef={clientRef}` — find a worklog

**Response `200`:** a collection (3.7) holding the user's worklog (4.4) with
that `clientRef`, or no item when there is none (including when it was
deleted).

**Why.** When the client corrects a worklog whose creation answer it never
received, it needs the worklog's `id` first.

**Status codes:** `200`; `401`. An unknown `clientRef` is `200` with no item,
never `404`.

### 6.6 `PATCH /worklogs/{worklogId}` — correct a worklog

**Request:** any of `startedAt`, `day`, `durationSeconds`, `comment`, with the
validation rules of 6.4. Fields left out keep their value.

```json
{ "durationSeconds": 3600, "comment": "Cache the session list, part one [#7P8Q9R0S]" }
```

**Response `200`:** the whole Worklog (4.4), as now stored.

- A worklog is **corrected, never moved** to another task: `taskId` and
  `clientRef` cannot change, and sending them answers `422`.
- The same `PATCH` sent twice gives the same result, so the client may resend
  it.
- The client sends a correction only after the worklog's creation has
  succeeded.

**Status codes:** `200`; `404` if the worklog does not exist, was deleted, or
belongs to another user (the client then tells the user the correction could
not be made); `409` `period_locked`, for the worklog's day or the new one;
`422`; `401`, `403`.

### 6.7 `DELETE /worklogs/{worklogId}` — delete a worklog

**Response `204`,** no body.

- **A worklog that no longer exists answers `404`, and the client counts that
  as deleted**: it is the outcome it asked for.
- Deletion is permanent. The worklog's `clientRef` stays reserved (6.4).

**Status codes:** `204`; `404`; `409` `period_locked`; `401`, `403`.

### 6.8 `POST /tasks/{taskId}/transitions` — start or finish a task

**Request:**

```json
{ "intent": "start" }
```

**Intents**, a closed list:

| Code | Sent when | The server |
| :--- | :--- | :--- |
| `start` | The user starts a session on a task **assigned to them** | Moves it to the status that means "being worked on" in its workflow, if it is not there already -- from `done` too: the user went back to it |
| `finish` | The user ends a session as **Done** | Moves it to the status that means "finished, not yet closed" in its workflow: *To review*, *To test*, *Resolved*. **The server chooses** |

The client sends an intent, never a status: it does not know the server's
workflow, and nobody configures statuses in SprintTicker. That setting --
three status ids to look up and paste -- was the one OpenProject users got
wrong most often.

**Response `200`:** the Task (4.3) as it is now.

**Rules:**

- An intent the task already satisfies changes nothing and answers `200`:
  `start` on a task in progress, `finish` on a task already finished.
- **`finish` on a closed task changes nothing and answers `200`.** It must not
  reopen it. SprintTicker once moved an OpenProject work package out of
  *Closed* back to *To test* this way.
- A move the workflow forbids answers `409` with the code `workflow_refused`
  and a `message` the client shows to the user.
- **`start` on a closed task changes nothing and answers `200`**, with
  `"state": "closed"`. The client's list can be five minutes old; starting a
  timer must not reopen a task either.
- `start` is never sent for a task assigned to someone else: the client does
  not move a teammate's work. A task nobody owns is first assigned (7.1); on a
  server without `assign`, it is tracked as it is, with no `start`.
- `finish` is sent whoever the task is assigned to. When it is no longer the
  user's, the client asks the user first.

**Status codes:** `200`; `404`; `409` `workflow_refused`; `422` for an
unknown intent; `401`, `403`.

---

## 7. Optional endpoints

Each is called only when `/capabilities` lists its capability.

### 7.1 `assign` — take a task nobody owns

```
POST /tasks/{taskId}/assignment
```

**Request:**

```json
{ "ifUnassigned": true }
```

**Responses:**

| Status | Body | Meaning |
| :--- | :--- | :--- |
| `200` | `{ "outcome": "assigned", "task": <Task> }` | It was nobody's; it is now the user's |
| `200` | `{ "outcome": "already_mine", "task": <Task> }` | It was already the user's |
| `409` | `{ "outcome": "taken", "task": <Task>, "error": { "code": "taken", "message": "..." } }` | Someone else has it. Nothing changed |

`ifUnassigned` is always `true` in v1. A request without it answers `422`.
A closed task answers `409` `workflow_refused` and changes nothing.

**Why.** Starting a task nobody owns makes it the user's, as anyone used to
Jira or OpenProject expects. The client's view of the task is up to five
minutes old, and a colleague may have taken it since. **The check and the
write must be one atomic step on the server**, so the task stays with whoever
took it first. With OpenProject this took a read, a write under a version
lock, and a second read when the lock refused; here it is the server's job.

The client sends this before `start` (6.8), and sends `start` only on
`assigned` or `already_mine`. A failure is shown to the user and never
retried later: by then the user may have moved on.

**Status codes:** `200`; `409`; `404`; `422`; `401`, `403`.

### 7.2 `task_state` — where one task stands

```
GET /tasks/{taskId}
```

**Response `200`:** the Task (4.3), closed or not, with `state`.

**Response `404`:** the task was deleted, or the user can no longer see it.
Both read the same to the client.

**Why.** When the task of a running session leaves the task list, the client
asks why, and tells the user which it was:

| Answer | The client |
| :--- | :--- |
| `closed` | Lets the user end the session as Done without asking, and sends no `finish`, so nothing reopens |
| `open` | Says the task left the user's list -- reassigned, most often -- and asks before marking it Done |
| `404` | Says the task is gone; the time is kept locally |

The client asks at every sync while the session runs, since a task reassigned
can be closed afterwards.

**Status codes:** `200`; `404`; `401`.

### 7.3 `calendar` — days off

```
GET /calendar/non-working-days?from=2026-12-20&to=2027-01-05
```

**Response `200`:**

```json
{ "days": ["2026-12-25", "2027-01-01"] }
```

- The user's days off between `from` and `to`, **both included**: public
  holidays, company closures, and the user's own leave if the server knows it.
- **Not weekends.** The user picks their working days of the week in
  SprintTicker.
- `from` and `to` are at most 400 days apart; more answers `422`.

**Why.** SprintTicker prompts the user for the daily stand-up, starts the
lunch break and proposes the end-of-day wrap-up. On a day off it stays quiet.
It reads five weeks once a day -- from the Monday of the week before to the
Sunday three weeks ahead -- and when a read fails, it keeps the previous
answer.

**Status codes:** `200`; `422`; `401`.

### 7.4 `events` — notifications

```
GET /events?since=2026-10-23T07:00:00Z
```

**Response `200`:** a collection (3.7) of Events (4.5).

**Rules:**

- Events whose `occurredAt` is **at or after** `since`, about tasks the user
  is assigned to, follows, or was mentioned on. *At or after*, because two
  events can share a second: one read in the last poll, one recorded just
  after it. The client drops the ids it has already shown, so the first one
  is not shown twice.
- **Never an event the user caused.** SprintTicker moves statuses for the
  user, and each move would come back a minute later as a notification -- seen
  with Jira.
- `occurredAt` is the server's clock. The client sets its next `since` to the
  latest `occurredAt` it received, so a difference between the two clocks loses
  nothing.
- `occurredAt` is the moment the event became readable, never earlier than an
  event already returned. An event stamped when its transaction began and
  committed later would land behind the client's `since`, and never be seen.
- The client's first poll asks nothing: it records the time and starts from
  there. It never shows events older than the moment notifications were
  turned on.
- An event is never returned again with another `id`.
- The server keeps at least 7 days of events. A `since` older than that
  answers what it has.

**What the user sees.** A Windows notification per event, and optionally a
banner on the LED panel. The user chooses which kinds reach them. Beyond 3
events at once, one summary replaces them, pointing at `eventsInboxUrl`.

The client asks every 60 seconds by default; the user can choose from 30
seconds to 1 hour.

**Status codes:** `200`; `422` if `since` is not an Instant; `401`.

### 7.5 `today_total` — time already recorded for a day

```
GET /worklogs/summary?day=2026-10-23
```

**Response `200`:**

```json
{ "day": "2026-10-23", "totalSeconds": 19800 }
```

The sum of `durationSeconds` of **all** the user's worklogs whose `day` is the
one asked, whatever created them -- SprintTicker, the server's interface, an
import.

**Why.** Shown beside the client's own total, so the user sees what reached
the server.

**Status codes:** `200`; `422`; `401`.

### 7.6 `inbox` — unplanned time

`/capabilities` names one task, `inboxTaskId`, that receives time spent on
unplanned work.

**How the client uses it.** With the user's consent (a setting, off until
they turn it on), the time of an ad-hoc task -- a phone call, helping a
colleague -- is sent as an ordinary worklog (6.4) on the inbox task. Its
comment starts with the name the user gave the ad-hoc task.

**Rules for the server:**

- The inbox task accepts worklogs from every user who can see it. It need not
  appear in any task list.
- The client sends no transition (6.8) and no assignment (7.1) for it.
- What happens to inbox time -- reassigned to a real task later, reported
  apart -- is the server's.

*Not built in SprintTicker yet.* Without `inbox`, ad-hoc time stays in
SprintTicker's local history and is never sent.

### 7.7 `week_close` — the user's week is over

```
POST /weeks/{weekStart}/close
```

`{weekStart}` is the Monday of the week, as a Local day: `2026-10-19`. Weeks
run Monday to Sunday.

**Request:**

```json
{ "workingDays": ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"] }
```

`workingDays` lists the days the user was expected to work that week: their
working days of the week, without the days off from 7.3.

**Response `200`:**

```json
{ "message": "Timesheet for 19-23 October submitted for approval." }
```

The client shows `message` to the user.

**When.** Once per week: at the end-of-day wrap-up of the week's last working
day, or -- when that was missed, for instance on a Friday off or with the
application closed -- at the first check of the next working day.

**Rules:**

- **Idempotent.** Closing a week already closed answers `200` with a message,
  and changes nothing.
- A server that refuses -- days without time, say -- answers `409` with the
  code `week_incomplete` and a `message` that says what is missing. The
  client shows it and does not retry: the user acts in the server's own
  interface.
- What "closed" triggers -- a submission, a lock, a reminder, nothing -- is
  the server's.

*Not built in SprintTicker yet.* The moment exists (`onWeekEnded`); nothing
sends it.

**Status codes:** `200`; `409`; `422`; `401`.

### 7.8 `labels` — short labels beside a task

A Task (4.3) may carry `"labels": ["Sprint 12", "Blocked"]`:

- at most **3** labels, each at most **16** characters of Text;
- shown as they are, beside the task in SprintTicker's window, never on the
  LED panel, which has no room;
- **never acted on**: the client does not sort, filter or decide anything by
  them.

**Why.** It lets a server show something of its own -- a sprint, a blocker, an
estimate -- without a change to SprintTicker and without bending the rule of
entry.

*Not built in SprintTicker yet.*

---

## 8. A working day, call by call

What the server sees from one user on a Friday, in order. Two things in it
are not obvious. A session **ends** whenever the user's work changes -- another
task, the stand-up, lunch -- and each end sends its worklogs. And when
SprintTicker restarts the task afterwards, that is a new session, with a new
`start`.

| Time | What happens | Requests |
| :--- | :--- | :--- |
| 08:55 | The user opens SprintTicker | `GET /capabilities`, `GET /me`, `GET /projects`, `GET /projects/{id}/tasks` for each project, and with `calendar`, `GET /calendar/non-working-days` |
| 09:00 | Starts *PLAT-142*, already theirs | `POST /tasks/t-1042/transitions` `start` |
| all day | Nothing in particular | Every 5 min: `GET /me`, `GET /projects`, the task lists. With `events`, every minute: `GET /events` |
| 09:30 | Joins the stand-up from the prompt. SprintTicker ends the session and times the stand-up as an ad-hoc task, whose time stays in SprintTicker (unless `inbox`, 7.6) | `POST /worklogs` for 09:00-09:30 on *PLAT-142* |
| 09:45 | The stand-up ends; SprintTicker restarts *PLAT-142* | `POST /tasks/t-1042/transitions` `start`, already satisfied: `200` |
| 10:40 | Pauses for a 20-minute call, then resumes | Nothing |
| 11:20 | Starts *PLAT-150*, which nobody has. The session on *PLAT-142* ends as *Not done* | `POST /worklogs` ×2 for *PLAT-142*: 09:45-10:40 and 11:00-11:20, two pieces because the pause lasted more than 15 minutes. Then `POST /tasks/t-1050/assignment` → `assigned`, then `POST /tasks/t-1050/transitions` `start` |
| 12:30 | Lunch starts. SprintTicker ends the session and remembers the task | `POST /worklogs` for 11:20-12:30 on *PLAT-150* |
| 13:30 | Lunch ends; SprintTicker restarts *PLAT-150* | `POST /tasks/t-1050/transitions` `start`, already satisfied: `200` |
| 16:00 | Ends *PLAT-150* as **Done** | `POST /worklogs` for 13:30-16:00, then `POST /tasks/t-1050/transitions` `finish` |
| 16:00 | The Wi-Fi drops while that worklog is sent, and the answer is lost | A minute later the client sends the same `POST /worklogs`, same `clientRef` → `200` and the existing id |
| 16:30 | Fixes a duration in the history | `PATCH /worklogs/{worklogId}` |
| 17:30 | Wraps up the day, the last working day of the week | With `week_close`, `POST /weeks/2026-10-19/close` |

---

## 9. Load, timeouts and retries

**Volume.** Per user, with 20 projects: about 25 requests every 5 minutes for
the sync, one a minute for events, and a handful per session. Nothing is sent
every second: the timer runs on the user's machine.

**Timeout.** The client gives each request **15 seconds**. A server that
answers later is treated as unreachable, so a list should be fast to read: a
page of 500 tasks well within that time.

**Retries inside one request.** A `GET` is retried up to twice, after about
half a second and then about a second, when the network fails or the server
answers `429`, `502`, `503` or `504`. Writes are not retried there: they go
through the queue below.

**Retries of queued sends.** Worklogs, corrections and deletions wait in the
client's queue. One that fails for a reason that may pass -- network, timeout,
`408`, `429`, `5xx` -- is tried again after 30 seconds, then after a delay
that doubles each time, up to an hour. After 8 failed attempts it stops and
waits for the user, who sees it in the app and can send it again.

**What is never retried.** Any other `4xx`: the same request would get the
same answer. A `401` stops every send until the user enters a new token, and
the user is told once.

**`429`.** The server may limit the rate. It answers `429` with a
`Retry-After` header in seconds, and the client waits at least that long.

---

## 10. Errors

### 10.1 The error body

Every response with a status of `400` or more carries:

```json
{ "error": { "code": "validation_failed", "message": "durationSeconds must be at least 60.", "field": "durationSeconds" } }
```

| Field | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `code` | Code | yes | From the list below. For the client and the logs |
| `message` | Text | yes | For the user, in their language. Says what went wrong and, where possible, what to do |
| `field` | string | no | The request field at fault, for `validation_failed` |

A body that is not this shape -- an HTML error page from a proxy -- is read by
its status alone.

### 10.2 Codes and statuses

| Status | `code` | Meaning | The client |
| :--- | :--- | :--- | :--- |
| `400` | `invalid_request` | Not JSON, or not this contract's shape | Gives up the request |
| `401` | `unauthorized` | No valid token | Stops sending; tells the user once to enter a new token; the queue waits |
| `403` | `forbidden` | A valid token, not allowed to do this | Gives up the request, shows `message` |
| `404` | `not_found` | No such object, or the user cannot see it | Per endpoint: deleted, gone, given up |
| `409` | `workflow_refused` | The workflow forbids this transition | Shows `message` |
| `409` | `taken` | The task has another assignee (7.1) | Tells the user who has it |
| `409` | `week_incomplete` | The week cannot be closed (7.7) | Shows `message` |
| `409` | `period_locked` | The day no longer accepts time (6.4, 6.6, 6.7) | Keeps the time locally, shows `message`, does not retry |
| `422` | `validation_failed` | A field is invalid | Gives up the request, shows `message` |
| `429` | `rate_limited` | Too many requests | Waits `Retry-After`, retries |
| `5xx` | `internal` | The server failed | Retries later |

A server may add codes for its own logs, but the **status** decides what the
client does: an unknown code under `409` is treated like `workflow_refused`.

---

## 11. Security

- **Tokens.** Long and random (at least 128 bits), shown once when created,
  stored hashed, revocable by the user. A token can do what its user can, and
  no more.
- **Never accept a token in a URL.** Only the `Authorization` header: URLs end
  up in logs.
- **Never log the token**, in the server's logs or error messages.
- **One user's data only.** Every list and every object answers as the
  token's user: another user's worklogs answer `404` (4.4).
- **URLs handed to the client** are under `siteUrl` (5): the client refuses
  to open anything else.
- **No HTML in Text.** The client shows text as text; markup arrives as
  literal characters.

---

## 12. The server's checklist

1. A bad token answers `401` on every endpoint, never `200` and empty (6.1).
2. A failed read is an error status, never an empty list (6.3).
3. Lists follow 3.7: pages of at most 500, stable order, a failed page fails.
4. Task lists cover the default scope: the user's, nobody's, others' in
   progress; never closed tasks (6.3).
5. `assignee` is always present, `null` for nobody (4.3).
6. Ids never change and never name another object; keys are printable ASCII,
   2 to 12 characters (3.4).
7. Codes are identifiers from this document: never translated, never invented
   in a closed list (3.5).
8. `POST /worklogs` is idempotent on `clientRef`, per user, forever, enforced
   by a unique constraint; a resend with other values updates the worklog
   (6.4).
9. Worklogs are accepted on closed, finished and teammates' tasks (6.4).
10. Worklog `day` and `comment` are stored exactly as sent (6.4).
11. No intent reopens a closed task; an intent already satisfied answers
    `200` (6.8).
12. `assignment` checks and writes in one atomic step (7.1).
13. Events never include the user's own actions; `since` is inclusive;
    `occurredAt` is the server's clock, when the event became readable (7.4).
14. Every URL handed out is under `siteUrl` (5).
15. `capabilities` lists exactly what is implemented (5).
16. Every error has the body of 10.1.

---

## 13. The conformance check

SprintTicker ships a command that runs this document against a server:

```bash
pnpm provider:check --url https://tracker.example.com/sprintticker/v1 \
                    --token <token> --task <id of a task the token's user may log time on>
```

It writes only on the task given -- worklogs it deletes again, and one `start`
transition, which moves the task to in progress -- and reads everything else.
Give it a task made for the purpose. Each failure names the rule and its
section, in words meant for whoever, or whatever, is building the server.

What it checks:

| # | Check | Rule |
| :---: | :--- | :--- |
| 1 | `/capabilities` has every required field, `contract` is `1`, `siteUrl` is https (or http on localhost) | 5 |
| 2 | A wrong token answers `401` on `/me`, `/projects` and a task list | 3.3, 6.1 |
| 3 | `/me` answers a User | 6.1 |
| 4 | `/projects` answers a well-formed collection; `?limit=1` pages through to the same set | 3.7, 6.2 |
| 5 | Every task has the required fields, a known `status`, a valid key, `assignee` present | 4.3 |
| 6 | No task outside the default scope, no closed task | 6.3 |
| 7 | Every `url` is under `siteUrl` | 5 |
| 8 | `POST /worklogs` answers `201`; the same body again answers `200` with the same id; another duration under the same `clientRef` answers `200` and is stored; two at once make one worklog | 6.4 |
| 9 | `GET /worklogs?clientRef=` finds it; an unknown reference answers `200` and no item | 6.5 |
| 10 | `PATCH` changes the duration and keeps the comment byte for byte; `taskId` in a `PATCH` answers `422` | 6.6 |
| 11 | `DELETE` answers `204`, then `404`; the `clientRef` sent again answers `200` and creates nothing | 6.7, 6.4 |
| 12 | A duration under `minimumWorklogSeconds` answers `422` with `field` | 6.4, 10.1 |
| 13 | `start` answers `200` twice in a row | 6.8 |
| 14 | An unknown intent answers `422` | 6.8 |
| 15 | Each declared capability answers in its documented shape | 7 |
| 16 | Every error body has `code` and `message` | 10.1 |

The check cannot see everything -- that a closed task never reopens, that
events leave out the user's own actions -- so section 12 still applies in full.

*Built with the provider; see 15.*

---

## 14. Endpoint summary

| Method and path | Capability | Section |
| :--- | :--- | :--- |
| `GET /capabilities` | required | 5 |
| `GET /me` | required | 6.1 |
| `GET /projects` | required | 6.2 |
| `GET /projects/{projectId}/tasks` | required | 6.3 |
| `POST /worklogs` | required | 6.4 |
| `GET /worklogs?clientRef=` | required | 6.5 |
| `PATCH /worklogs/{worklogId}` | required | 6.6 |
| `DELETE /worklogs/{worklogId}` | required | 6.7 |
| `POST /tasks/{taskId}/transitions` | required | 6.8 |
| `POST /tasks/{taskId}/assignment` | `assign` | 7.1 |
| `GET /tasks/{taskId}` | `task_state` | 7.2 |
| `GET /calendar/non-working-days` | `calendar` | 7.3 |
| `GET /events` | `events` | 7.4 |
| `GET /worklogs/summary` | `today_total` | 7.5 |
| *(the task named by `inboxTaskId`)* | `inbox` | 7.6 |
| `POST /weeks/{weekStart}/close` | `week_close` | 7.7 |
| *(the `labels` field of a task)* | `labels` | 7.8 |

---

## 15. Implementing it in SprintTicker

The client's side, in the order it lands. Each step follows `CLAUDE.md` and
ships with its tests and documents. Paths are relative to
`packages/desktop-app/` unless they start with `scripts/`.

1. **A fake server**, `scripts/fake-provider-api.js`, beside `fake-jira.js`
   and `fake-openproject.js`: the whole contract in memory, with switches for
   the failures the client must survive -- an answer lost after the write, an
   expired token, a page that fails, a task taken during an assignment, a
   closed task, a workflow refusal.
2. **The conformance check**, `scripts/provider-api-check.js` behind `pnpm
   provider:check`. CI runs it against the fake server, so the check and the
   fake hold each other honest.
3. **`CustomServerProvider`** in `src/main/providers/custom-server-provider.ts`,
   implementing `ITaskProvider`, with the provider id `custom-server` --
   `sprintticker` already names projects made in the app. It maps:

   | `ITaskProvider` | This contract |
   | :--- | :--- |
   | `initialize` | stores the base URL and token; reads `/capabilities` |
   | `minimumLoggableSeconds` | `minimumWorklogSeconds` |
   | `getProjects` | `GET /projects`, with `providerId` set |
   | `getTasks` | `GET /projects/{id}/tasks`; ownership from `assignee.id` against `/me` |
   | `logTime` | `POST /worklogs`, with `clientRef` and `day` (the local day of `startedAtUtc`) |
   | `findWorklog` | `GET /worklogs?clientRef=` |
   | `updateWorklog`, `deleteWorklog` | `PATCH`, `DELETE /worklogs/{id}` |
   | `updateTaskStatus('in_progress')` | `transitions {start}` |
   | `updateTaskStatus('done' / 'to_test' / 'to_review')` | `transitions {finish}` |
   | `assignToMe` | `assignment` (`assign`) |
   | `getTaskStanding` | `GET /tasks/{id}` (`task_state`) |
   | `getNonWorkingDays` | `calendar` |
   | `getEventsSince`, `getEventsInboxUrl` | `events`, `eventsInboxUrl` |
   | `getTaskPageUrl` | the task's `url`, checked against `siteUrl` |
   | `reconcileRemoteState` | `today_total`, or `null` without it |

   Errors go through `ProviderRequestError.fromStatus`, so the queue's rules
   for permanent and retryable failures apply unchanged.
4. **Three changes to the shared code, for every provider**, each passing the
   rule of entry:
   - `WorklogPayload` gains `clientRef`, the queue row's id. Jira and
     OpenProject ignore it; this provider sends it.
   - Which providers report events comes from what each provider can do, not
     from the fixed `PROVIDERS_WITH_EVENTS` list.
   - Days off are read from the active provider, not from the first one that
     has a calendar.
   - `ProviderEventService` keeps an event at the cursor's own instant when
     its id is new (it drops every event at or before the cursor today), so an
     inclusive `since` (7.4) is read as intended.
5. **Settings.** A third card in *Task Providers*: base URL and token -- the
   token through `SecretStore` -- and *Test connection*, which reads
   `/capabilities` and `/me` and shows the server's name and the user's.
   Nothing else: there are no statuses to map. The onboarding wizard offers it
   too. The provider sends `User-Agent: SprintTicker/<version>`.
6. **Integration tests** against the fake, as `provider-integration.test.ts`
   does for the others: a sync, a lost answer resent without a duplicate, an
   expired token, a task taken during an assignment, a task closed
   mid-session, a refused `finish`.
7. **Documents**: `API.md`, `USER-GUIDE.md` (setting it up), `ARCHITECTURE.md`,
   `README.md`, `CHANGELOG.md`, `ROADMAP.md`.

`inbox`, `week_close` and `labels` come afterwards, each as its own change,
once a server offers them.

---

## 16. Changing the contract

- **The contract is this file.** A change lands here first, then in the fake
  server and the conformance check, then in the client. A feature that is not
  in this file is not part of the integration, however it is used.
- **A request goes through the rule of entry** (2). One that passes becomes an
  additive change to v1 (3.1). One that does not belongs in the server's own
  interface -- or, if it must happen when something happens in SprintTicker,
  on the server, triggered by something the contract already sends: a
  worklog, a transition, the week's close.
- **The threshold for a private copy.** If a need fails the rule of entry,
  *and* cannot be done on the server, *and* the user wants it in SprintTicker
  anyway, it goes into a private copy of the repository, never into this one.
  That copy is a mirror -- `git clone --bare`, then `git push --mirror` to a new
  private repository, since a GitHub fork of a public repository cannot be
  private -- and it *adds* to the provider above rather than editing the shared
  code, so it can keep taking this repository's changes.
