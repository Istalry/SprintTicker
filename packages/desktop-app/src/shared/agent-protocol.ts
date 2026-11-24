/**
 * What an AI agent may ask SprintTicker, and how it is answered
 * (`Documentation/AGENT-INTERFACE.md`).
 *
 * The one file the agent's client (`packages/agent-cli`: the command-line
 * tool and the MCP server) imports, as the Stream Deck plugin imports
 * `deck-protocol.ts` alone: a message shape kept in two places would drift
 * with nothing failing. So nothing here imports anything, and every rule --
 * which day "yesterday" is, the totals, the words of an answer -- stays in
 * the app; the client forwards and prints.
 */

/** Raised when an answer's shape changes: the client names the version it reads. */
export const AGENT_PROTOCOL_VERSION = 1;

/** Each command is a POST to this prefix and its name: `/api/v1/agent/day`. */
export const AGENT_API_PREFIX = '/api/v1/agent/';

/** The local API's port, as `LOCAL_API_PORT` in `deck-protocol.ts`; repeated so the client imports this file alone. */
export const AGENT_DEFAULT_PORT = 39123;

/** Where the client reads the token: its environment, set by the agent's configuration. */
export const AGENT_TOKEN_ENV = 'SPRINTTICKER_TOKEN';

/** Moves the client to another port: the checks that run a second app beside the user's. */
export const AGENT_PORT_ENV = 'SPRINTTICKER_PORT';

/** The words a day can be named by, besides `YYYY-MM-DD`; resolved in the app, on its clock. */
export const AGENT_DAY_WORDS = ['today', 'yesterday', 'last-working-day'] as const;

/** The words a week can be named by, besides any of its days. */
export const AGENT_WEEK_WORDS = ['this-week', 'last-week'] as const;

export type AgentParamType = 'string' | 'boolean';

export interface AgentParamSpec {
  type: AgentParamType;
  description: string;
  required?: boolean;
}

export interface AgentCommandSpec {
  /** The route and the command-line verb: `day`. */
  name: string;
  /** The MCP tool: `get_day`. */
  tool: string;
  /** What it answers or does, for the tool's description and `--help`. */
  description: string;
  /** Changes something: an MCP host shows it as such, and asks the user before calling it. */
  writes: boolean;
  /** Named parameters, in the order the command line takes them positionally. */
  params: Record<string, AgentParamSpec>;
}

const DAY_PARAM: AgentParamSpec = {
  type: 'string',
  description: `The day: ${AGENT_DAY_WORDS.join(', ')}, or YYYY-MM-DD. Today when left out.`
};
const WEEK_PARAM: AgentParamSpec = {
  type: 'string',
  description: `The week: ${AGENT_WEEK_WORDS.join(', ')}, or any of its days (${AGENT_DAY_WORDS.join(', ')}, YYYY-MM-DD). This week when left out.`
};

/** Every command, in the order `--help` and `tools/list` show them. */
export const AGENT_COMMANDS: readonly AgentCommandSpec[] = [
  {
    name: 'now',
    tool: 'get_running',
    description: 'What is being timed now: the task, running or paused, its time so far, and an interruption with the task it holds.',
    writes: false,
    params: {}
  },
  {
    name: 'day',
    tool: 'get_day',
    description: "One day's time entries in the order worked, the day's total, each task's share, and whether they reached the provider (Jira, OpenProject...). Use it for \"what did I do yesterday?\".",
    writes: false,
    params: { day: DAY_PARAM }
  },
  {
    name: 'week',
    tool: 'get_week',
    description: 'A week as a timesheet: time per day, per project and per task, what the provider holds, and interruptions still to place.',
    writes: false,
    params: { week: WEEK_PARAM }
  },
  {
    name: 'check',
    tool: 'check_week',
    description: "Check my week: everything in a week to look at -- interruptions to place, entries not sent or refused, untracked gaps in working hours, overlaps, and changes made after the week closed.",
    writes: false,
    params: { week: WEEK_PARAM }
  },
  {
    name: 'to-place',
    tool: 'get_to_place',
    description: 'Interruptions that ended and wait to be placed on a task, or kept off the provider.',
    writes: false,
    params: {}
  },
  {
    name: 'tasks',
    tool: 'find_tasks',
    description: "Finds tasks by key or by words of their title, the user's own work included. Use it to get a task's key before starting it.",
    writes: false,
    params: { search: { type: 'string', description: 'A key (MG-12) or words of the title.', required: true } }
  },
  {
    name: 'start',
    tool: 'start_task',
    description: 'Starts timing a task, by its key (MG-12) or its id from find_tasks. With a task running, switches to it: the one running stops and its time is logged. Refused during an interruption. The user can undo a stop in SprintTicker for ten seconds.',
    writes: true,
    params: { task: { type: 'string', description: 'The task\'s key, or its id when several tasks share the key (the user\'s own work).', required: true } }
  },
  {
    name: 'stop',
    tool: 'stop_task',
    description: 'Stops the task being timed and logs its time, which is sent to the provider after ten seconds the user can undo in SprintTicker. During an interruption, ends the interruption and takes the held task up again.',
    writes: true,
    params: { note: { type: 'string', description: 'The entry\'s note, shown at the provider. Left out, SprintTicker writes its own.' } }
  },
  {
    name: 'done',
    tool: 'mark_done',
    description: 'Stops the task being timed, logs its time, and marks the task done at the provider (Jira, OpenProject). Ask the user first, then call it with confirmed: without it, nothing happens.',
    writes: true,
    params: { confirmed: { type: 'boolean', description: 'True once the user said yes to marking the task done.' } }
  },
  {
    name: 'pause',
    tool: 'pause_task',
    description: 'Pauses the task being timed; nothing is logged.',
    writes: true,
    params: {}
  },
  {
    name: 'resume',
    tool: 'resume_task',
    description: 'Resumes the paused task.',
    writes: true,
    params: {}
  }
];

/** The command named `name`, by its verb or its MCP tool; undefined for neither. */
export function agentCommand(name: string): AgentCommandSpec | undefined {
  return AGENT_COMMANDS.find(c => c.name === name || c.tool === name);
}

/** A request's body: the command's parameters by name. */
export type AgentRequest = Record<string, string | boolean | undefined>;

/** An answer: the text written for a reader, and the same answer as data. */
export interface AgentAnswer<T = unknown> {
  protocol: number;
  /** When the app read it, local with its offset. */
  readAt: string;
  /** What to show or say: the window's own words and figures. */
  text: string;
  data: T;
}

export type AgentErrorCode =
  | 'off'
  | 'unauthorized'
  | 'invalid-request'
  | 'not-found'
  | 'refused'
  | 'needs-confirmation';

export interface AgentError {
  protocol: number;
  error: AgentErrorCode;
  message: string;
}

/** A duration as both the agent and a reader need it: no adding up left to do. */
export interface AgentDuration {
  seconds: number;
  /** `1h 05m`, as the window writes it. */
  text: string;
}

/** What the app's Settings shows of an agent's access: not part of the client's protocol. */
export interface AgentAccessDTO {
  enabled: boolean;
  /** Empty while off: there is nothing to copy. */
  token: string;
}
