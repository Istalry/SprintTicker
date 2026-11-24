# sprintticker, for AI agents

The command and the MCP server through which an AI agent -- Claude Code,
Claude desktop -- asks the running SprintTicker app what the user worked on.
The design is [AGENT-INTERFACE.md](../../Documentation/AGENT-INTERFACE.md);
the routes it calls are in [API.md](../../Documentation/API.md#the-ai-agents-routes).

It reads nothing itself: every command is a POST to the app on
`127.0.0.1:39123`, and the app writes the answer, figures and words
included. With the app closed it says so and exits 3; it never opens the
database file.

## Turning it on

In SprintTicker, **Settings › Data › AI agents**: switch it on and copy the
token. The agent gives it as `SPRINTTICKER_TOKEN`.

## The command

```bash
sprintticker now
sprintticker day yesterday
sprintticker day last-working-day --json
sprintticker week last-week
sprintticker check
sprintticker to-place
sprintticker tasks lantern glow
sprintticker --help
```

Each command takes its parameters in order, or as `--name value`; `--json`
prints the whole answer. Exit codes: 0 answered, 1 refused (access off, a
wrong token, a day that is not one), 2 not understood, 3 SprintTicker not
running.

## The MCP server

`sprintticker mcp` speaks MCP over stdio: the same commands as tools
(`get_running`, `get_day`, `get_week`, `check_week`, `get_to_place`,
`find_tasks`), each returning the app's text, and its JSON as structured
content. No SDK: newline-delimited JSON-RPC, in `src/mcp.ts`.

## Building and testing

```bash
pnpm agent:build   # dist/sprintticker.mjs, one file, Node 24
pnpm test:agent    # against the app's real local server and agent routes
```

It imports `desktop-app/src/shared/agent-protocol.ts` and nothing else of
the app -- an ESLint error otherwise -- so no rule an answer needs can drift
into it.
