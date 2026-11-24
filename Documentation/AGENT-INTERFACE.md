# An interface for AI agents

**Status:** decided and built 2026-11-24 (A1-A5), for 2.0.1; to be tried
from Claude Code and Claude desktop on an installed build. First
written as a proposal on 2026-11-13; the user's answers are in section 9.

The goal: an LLM agent -- Claude Code, or Claude desktop's chat -- answers
"what did I do yesterday?", "how much went on MG-12 this week?" or "is
anything left unsent?" from SprintTicker's own records, and can stop the
task running and start another when the user asks it to.

## 1. The shape: one API in the app, two thin clients

| | Command-line tool | MCP server |
| :--- | :--- | :--- |
| Command | `sprintticker day yesterday` | `sprintticker mcp`, over stdio |
| Serves | Anything with a shell: Claude Code, scripts, the user | Any MCP host: Claude Code and Claude desktop's chat |
| Answers | Text, or `--json` | The same text, and the JSON as structured content |

Both are one script in `packages/agent-cli`, and both call **the running
app** over its local port. **The rules live in the app, not in the
client**: which day "yesterday" is, the totals, the words for a send's
state, the text of every answer. The client formats nothing it could get
wrong; it forwards. That is the duplicated-constant hazard of CLAUDE.md §3
in another process, and the Stream Deck plugin is the precedent: it imports
`shared/deck-protocol.ts` and nothing else. The agent's client imports
`shared/agent-protocol.ts` and nothing else.

**Not chosen: the app serving MCP itself** at `/mcp`. It would put the MCP
SDK in main -- a `dependencies` entry, shipped in app.asar (CLAUDE.md §2) --
and turn the loopback server's plain POST routes into JSON-RPC sessions. The
stdio server is a few dozen lines of newline-delimited JSON-RPC with no SDK.

## 2. Where the answers come from: the running app, never the file

The client asks `http://127.0.0.1:39123/api/v1/agent/<command>`
(`LOCAL_API_PORT`; `SPRINTTICKER_PORT` moves it, for the checks that run a
second app on another port). It never opens `sprintticker.db`, and **when
the app is closed it says so and exits non-zero** -- no fallback to the
file:

1. **An agent's shell may be reading another file.** CLAUDE.md §7: a process
   started from the Claude desktop app (MSIX) gets `%APPDATA%` redirected,
   and an agent once reported zero projects while the app showed
   twenty-five. Over loopback the app answering is the app the user sees.
2. **Opening the file is a write.** `DatabaseConnection` sets WAL and runs
   the migrations: a client of another revision would migrate the real
   database.
3. **The running session is not in the file as a number.** The engine
   computes it (`getCurrentSession`): pauses, negative pauses, an
   interruption answering as the session.

## 3. The commands

`AgentService` (`main/services/agent-service.ts`) answers each from what
the window reads, and the writes through what the window, the bar and the
deck call. Each is a POST route, a command of the tool and an MCP tool;
the list is `AGENT_COMMANDS` in `shared/agent-protocol.ts`.

| Command | MCP tool | Answers or does | Built from |
| :--- | :--- | :--- | :--- |
| `now` | `get_running` | What runs or is paused, its time, an interruption and the task it holds | `engine.getCurrentSession()` |
| `day [<day>]` | `get_day` | A day's entries in the order worked, the total, each task's share, where the sends stand | `getWorklogsByDate`, `summarizeDay`, `describeSends` |
| `week [<day>]` | `get_week` | Time per project, task and day; what the provider holds; time to place | `getWorklogsBetween`, `buildWeekSheet` |
| `check [<day>]` | `check_week` | Check my week's list: to place, not sent, refused, gaps, overlaps, changes after the close | `checkWeek`, `describeWeekCheck` |
| `to-place` | `get_to_place` | Interruptions waiting to be placed | `InterruptionService.getToPlace` |
| `tasks <words>` | `find_tasks` | Tasks matching a key or words, the user's own work included | `getAllListed`, `getOwnListed`, `matchesSearch` |
| `start <task>` | `start_task` | Starts a task by key or id; with one running, a switch | `engine.startTask`, refused during an interruption |
| `stop [<note>]` | `stop_task` | Stops and logs what runs | `SessionEnding.complete` (Undo) |
| `done --confirmed` | `mark_done` | Stops and marks the task done at the provider | `SessionEnding.complete(…, true)` (Undo) |
| `pause` / `resume` | `pause_task` / `resume_task` | Pauses or resumes | `engine.pauseSession` / `resumeSession` |

A day is `today`, `yesterday`, `last-working-day` or `YYYY-MM-DD`, resolved
**in main** on the app's clock and `WorkingCalendar`, so the client and the
app never disagree about which day "yesterday" is. A week is named by any
of its days, `this-week` or `last-week`.

## 4. Answers

Every answer is `{ protocol, readAt, text, data }`:

- `text` is the answer written for a reader -- the window's own words and
  figures -- and is what the tool prints and what the MCP tool returns as
  text. An LLM reads it first.
- `data` is the same answer as JSON (`--json`, and MCP's structured
  content).
- **Totals are given, never left to add up**, in seconds and as text
  (`formatHoursAndMinutes`). An agent summing twelve durations gets it
  wrong often enough to matter.
- **Times are local with an offset** (`2026-11-12T14:05:00+01:00`) beside
  the UTC value. "What did I do at 3?" is a local question.
- **States are words**: an entry's `syncState` comes with the word the
  window shows.
- `protocol` names the version, so a client of another version says so
  instead of misreading.

A refusal is `{ protocol, error, message }` with a code: `off`,
`unauthorized`, `invalid-request`, `not-found`, `refused`,
`needs-confirmation`.

## 5. Security

- **Loopback only**, as today, behind `WebhookServer`'s screening: POST,
  `application/json`, any `Origin` refused (a page cannot reach it, and
  DNS rebinding is closed). A `Host` check is added: `127.0.0.1:<port>` or
  `localhost:<port>`.
- **Off until the user turns it on** (Settings › Data › AI agents). Off, the
  routes answer `404`, as an unknown path does.
- **A bearer token**, made when access is turned on, kept in `SecretStore`
  (DPAPI), shown with Copy and Make a new one. Any local program can read the
  database, so the token is not against local malware: it keeps other
  Windows sessions on the machine out (loopback is shared, the file's ACL is
  not), lets the user revoke an agent, and keeps "may read my time" apart
  from `/api/input` and the deck. Sent as `Authorization: Bearer`, **never
  in a URL** (why `redactTokenInUrl` exists), never logged, compared in
  constant time.
- **The token reaches the client through its configuration**
  (`SPRINTTICKER_TOKEN`, or the MCP host's `env` block), never a file in
  `%APPDATA%`: under MSIX redirection the agent's shell may read a stale
  copy of it (§7), which fails as "wrong token" with no hint why.
- **Never answered:** provider credentials, the provider's site, account
  ids, the device's address or token, task page URLs.
- **What an agent reads leaves the machine**, with the conversation, to the
  model's vendor: task keys and titles, and worklog notes (the user's
  decision: notes are read, section 9). Settings says so beside the switch.
- **Bounded**: an answer covers at most a week; the body cap is unchanged.

## 6. Writes

The user's decisions (section 9): writes are in, and **the ten-second Undo
is enough** -- an agent's stop is held and undoable like a click's, and the
Undo bar shows in the app.

- **The same commands every surface uses, never a rule of the agent's.**
  Stop and Done are the window's `SessionEnding` (`undoableSessionEnding`);
  a start is `engine.startTask`, refused during an interruption with
  `END_THE_INTERRUPTION_FIRST` as the window's, the picker's and the deck's
  are; pause and resume are the engine's.
- **Done asks first**, as on the deck: it changes the ticket at the
  provider, so `mark_done` without `confirmed` answers `needs-confirmation`,
  and the tool's description tells the agent to confirm with the user.
- **A start by key** resolves among the listed tasks and the user's own
  work; a key that matches none, or several, is refused with the
  candidates.

## 7. Distribution

Shipped in the installer (the user's decision): the bundled script and a
`sprintticker.cmd` in `resources/agent/`, run by the app's own executable
under `ELECTRON_RUN_AS_NODE`, so nothing else needs installing. Settings
shows the exact lines to give Claude Code (`claude mcp add …`) and Claude
desktop (its `claude_desktop_config.json` entry), with this machine's paths
and the token filled in (`shared/agent-setup.ts`). `verify:packed` checks
the files are there, runs the script under the packed executable against
the app it started, and runs the `.cmd`. The portable build gets no lines:
it runs from a temporary folder gone at its exit.

## 8. Phases

| Phase | What | Done when |
| :--- | :--- | :--- |
| **A0** | This note, the user's answers recorded | 2026-11-24 |
| **A1** | `shared/agent-protocol.ts`, `AgentService`'s reads, the routes with the switch, token and `Host` check; Settings › AI agents | Each read and each refusal tested through `inject` |
| **A2** | `packages/agent-cli`: the commands as a command-line tool, text and `--json`, exit codes | Tested against a fake server |
| **A3** | `sprintticker mcp`: the same commands as MCP tools over stdio | `tools/list` and `tools/call` tested; listed from Claude Code |
| **A4** | Shipped in the installer, the setup lines in Settings | `verify:packed` checks it |
| **A5** | The writes of section 6 | Each command and refusal tested |

## 9. The user's answers (2026-11-24)

1. **Which agent?** Both Claude Code and Claude desktop: the tool and the
   MCP server together.
2. **Writes?** Yes; the ten-second Undo is enough, no confirmation in the app.
3. **Worklog notes?** Read. They are mostly the app's own words ("Stopped by
   switching task"), plus what the user types in Add time or Correct, and
   interruption names.
4. **Shipped in the installer**, not a developer tool.
5. **Defaults accepted:** a token, off until turned on; never the file when
   the app is closed; "yesterday" is the calendar's, `last-working-day` the
   working calendar's; the command is `sprintticker`.
