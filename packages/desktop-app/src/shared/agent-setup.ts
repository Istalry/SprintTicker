import { AGENT_DEFAULT_PORT, AGENT_PORT_ENV, AGENT_TOKEN_ENV } from './agent-protocol';

/**
 * What Settings › AI agents tells the user to give an agent
 * (AGENT-INTERFACE.md §7): the command the installer carries and the lines
 * Claude Code and Claude desktop need, with this machine's paths and the
 * token filled in. The app's side only -- the agent's client never reads it.
 */

/** Under `process.resourcesPath`, where `extraResources` puts them. */
export const AGENT_SCRIPT_RESOURCE = 'agent/sprintticker.mjs';
export const AGENT_COMMAND_RESOURCE = 'agent/sprintticker.cmd';
/** The MCP server's name in the agent's configuration. */
export const AGENT_MCP_NAME = 'sprintticker';
/**
 * Makes the app's own executable a plain Node, which runs the bundled
 * script: nothing else to install.
 */
export const RUN_AS_NODE_ENV = 'ELECTRON_RUN_AS_NODE';

/** How this build runs the command. */
export interface AgentLaunch {
  /** The executable that runs the script: SprintTicker.exe, or Electron in development. */
  exe: string;
  script: string;
  /** The `.cmd` an agent's shell can run, when the build carries one. */
  command: string | null;
}

/**
 * Why this build cannot give an agent the command: the portable build runs
 * from a temporary folder gone at its exit, and a development checkout has
 * it only after `pnpm agent:build`.
 */
export type AgentSetupMissing = 'portable' | 'not-built';

export interface AgentSetupDTO {
  /** One line for a terminal: `claude mcp add …`. */
  claudeCode: string;
  /** The `mcpServers` entry of `claude_desktop_config.json`. */
  claudeDesktop: string;
  /** The `.cmd`'s path, for an agent that runs commands; null in development. */
  command: string | null;
}

export interface AgentAccessDTO {
  enabled: boolean;
  /** Empty while off: there is nothing to copy. */
  token: string;
  /** The setup lines, while on and when this build can run the command. */
  setup: AgentSetupDTO | null;
  /** Why there are none while on. */
  missing?: AgentSetupMissing;
}

/** The environment the MCP server starts with. */
export function agentEnvironment(token: string, port: number): Record<string, string> {
  return {
    [RUN_AS_NODE_ENV]: '1',
    [AGENT_TOKEN_ENV]: token,
    // Named only off the default: a check run beside the user's app (local-api-port.ts).
    ...(port === AGENT_DEFAULT_PORT ? {} : { [AGENT_PORT_ENV]: String(port) })
  };
}

export function agentSetup(launch: AgentLaunch, token: string, port: number): AgentSetupDTO {
  const env = agentEnvironment(token, port);
  const envFlags = Object.entries(env).map(([key, value]) => `-e ${key}=${value}`).join(' ');
  return {
    claudeCode: `claude mcp add ${AGENT_MCP_NAME} --scope user ${envFlags} -- "${launch.exe}" "${launch.script}" mcp`,
    claudeDesktop: JSON.stringify({ mcpServers: { [AGENT_MCP_NAME]: { command: launch.exe, args: [launch.script, 'mcp'], env } } }, null, 2),
    command: launch.command
  };
}
