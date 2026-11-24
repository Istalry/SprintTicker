import { AGENT_COMMANDS, AGENT_TOKEN_ENV, AgentCommandSpec, AgentRequest, agentCommand } from '../../desktop-app/src/shared/agent-protocol';
import { ask, AskResult, ClientSettings, failureMessage } from './client';

/** How the command ends, for a script or an agent reading `$?`. */
export const EXIT = {
  OK: 0,
  /** SprintTicker answered with a refusal: off, a wrong token, a day that is not one... */
  REFUSED: 1,
  /** The command line was not understood. */
  USAGE: 2,
  /** Nothing answered: SprintTicker is not running. */
  NOT_RUNNING: 3
} as const;

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export type Asker = (command: string, request: AgentRequest, settings: ClientSettings) => Promise<AskResult>;

/** `--help`: every command, from the protocol's own list. */
export function usage(): string {
  const lines = [
    'sprintticker -- ask the running SprintTicker app.',
    '',
    'Usage: sprintticker <command> [arguments] [--json]',
    '       sprintticker mcp        (an MCP server over stdio, for Claude Code and Claude desktop)',
    '',
    'Commands:'
  ];
  for (const command of AGENT_COMMANDS) {
    const args = Object.entries(command.params).map(([name, p]) => (p.required ? `<${name}>` : `[${name}]`)).join(' ');
    lines.push(`  ${`${command.name} ${args}`.trimEnd().padEnd(22)} ${command.description}`);
  }
  lines.push(
    '',
    'Options:',
    '  --json                 the answer as JSON, for a program',
    '  --<parameter> <value>  a parameter by name',
    '',
    `The token comes from ${AGENT_TOKEN_ENV}: copy it from SprintTicker, Settings › Data › AI agents.`
  );
  return lines.join('\n');
}

/**
 * The parameters of `command` from what follows it on the command line:
 * positional in the order the protocol lists them, or `--name value`; the
 * last positional takes the rest of the words ("tasks lantern glow").
 */
export function parseArgs(command: AgentCommandSpec, args: readonly string[]): { request: AgentRequest; json: boolean } | string {
  const request: AgentRequest = {};
  const positional: string[] = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const spec = command.params[name];
      if (!spec) return `${command.name} has no --${name}.`;
      if (spec.type === 'boolean') request[name] = true;
      else {
        const value = args[++i];
        if (value === undefined) return `--${name} needs a value.`;
        request[name] = value;
      }
      continue;
    }
    positional.push(arg);
  }
  const names = Object.entries(command.params).filter(([, p]) => p.type === 'string').map(([name]) => name);
  if (positional.length > 0 && names.length === 0) return `${command.name} takes no arguments.`;
  names.forEach((name, i) => {
    if (i >= positional.length || request[name] !== undefined) return;
    request[name] = i === names.length - 1 ? positional.slice(i).join(' ') : positional[i];
  });
  for (const [name, spec] of Object.entries(command.params)) {
    if (spec.required && (request[name] === undefined || request[name] === '')) return `${command.name} needs <${name}>.`;
  }
  return { request, json };
}

/**
 * Runs one command line and answers its exit code. The answer's text is the
 * app's own: this prints it, and decides nothing (AGENT-INTERFACE.md §1).
 */
export async function runCli(argv: readonly string[], settings: ClientSettings, io: CliIo, asker: Asker = ask): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    io.out(usage());
    return name ? EXIT.OK : EXIT.USAGE;
  }
  const command = agentCommand(name);
  if (!command) {
    io.err(`No command "${name}". Run sprintticker --help.`);
    return EXIT.USAGE;
  }
  const parsed = parseArgs(command, rest);
  if (typeof parsed === 'string') {
    io.err(`${parsed} Run sprintticker --help.`);
    return EXIT.USAGE;
  }

  const result = await asker(command.name, parsed.request, settings);
  if (result.ok) {
    io.out(parsed.json ? JSON.stringify(result.answer, null, 2) : result.answer.text);
    return EXIT.OK;
  }
  if (parsed.json && result.failure.kind === 'refused') io.out(JSON.stringify(result.failure.error, null, 2));
  else io.err(failureMessage(result.failure));
  return result.failure.kind === 'not-running' ? EXIT.NOT_RUNNING : EXIT.REFUSED;
}
