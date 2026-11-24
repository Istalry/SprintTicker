import { AGENT_COMMANDS, AGENT_PROTOCOL_VERSION, AgentCommandSpec, AgentRequest, agentCommand } from '../../desktop-app/src/shared/agent-protocol';
import { ClientSettings, failureMessage } from './client';
import type { Asker } from './cli';

/**
 * The MCP server (AGENT-INTERFACE.md §1): the same commands as tools, over
 * stdio, as newline-delimited JSON-RPC 2.0 -- no SDK, so nothing ships in the
 * app but this file. Each tool forwards to the running app and returns its
 * text, and its JSON as structured content.
 */

/** The MCP revisions this server speaks, newest first; a client asking another gets the newest. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

/** What the host is told about the server: when to use it, in a sentence or two. */
export const SERVER_INSTRUCTIONS = 'SprintTicker tracks the user\'s working time against their tasks (Jira, OpenProject, or their own). '
  + 'Use these tools to answer what they worked on, how long, and what is left to send or place. '
  + 'Answers are already totalled and worded: quote the figures rather than adding them up.';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** A command as an MCP tool: its schema from the protocol's parameters. */
export function toolOf(command: AgentCommandSpec) {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [name, spec] of Object.entries(command.params)) properties[name] = { type: spec.type, description: spec.description };
  const required = Object.entries(command.params).filter(([, spec]) => spec.required).map(([name]) => name);
  return {
    name: command.tool,
    title: command.name,
    description: command.description,
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
    annotations: {
      readOnlyHint: !command.writes,
      // The app's own Undo takes a write back for ten seconds; nothing is destroyed.
      destructiveHint: false,
      openWorldHint: false
    }
  };
}

export class McpServer {
  constructor(
    private readonly _settings: ClientSettings,
    private readonly _asker: Asker,
    private readonly _version: string
  ) {}

  /** Answers one line of input: a response to send, or null for a notification. */
  public async handleLine(line: string): Promise<JsonRpcResponse | null> {
    if (!line.trim()) return null;
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Not JSON.' } };
    }
    if (!message || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: INVALID_REQUEST, message: 'Not a JSON-RPC request.' } };
    }
    // A notification (no id) is never answered: initialized, cancelled...
    if (message.id === undefined) return null;
    const id = message.id;
    try {
      return { jsonrpc: '2.0', id, result: await this.handle(message.method, message.params ?? {}) };
    } catch (err) {
      const code = err instanceof McpError ? err.code : INVALID_REQUEST;
      return { jsonrpc: '2.0', id, error: { code, message: (err as Error).message } };
    }
  }

  private async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
        return {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'sprintticker', title: 'SprintTicker', version: this._version },
          instructions: SERVER_INSTRUCTIONS
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: AGENT_COMMANDS.map(toolOf) };
      case 'tools/call':
        return this.call(params);
      default:
        throw new McpError(METHOD_NOT_FOUND, `No method "${method}".`);
    }
  }

  private async call(params: Record<string, unknown>): Promise<unknown> {
    const name = params.name;
    const command = typeof name === 'string' ? agentCommand(name) : undefined;
    if (!command) throw new McpError(INVALID_PARAMS, `No tool "${String(name)}".`);
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    if (typeof args !== 'object' || Array.isArray(args)) throw new McpError(INVALID_PARAMS, 'Arguments are an object.');
    const request: AgentRequest = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' || typeof value === 'boolean') request[key] = value;
    }

    const result = await this._asker(command.name, request, this._settings);
    // A refusal is the tool's answer, not a protocol error: the model reads
    // it and can fix the call, or tell the user what to turn on.
    if (!result.ok) return { content: [{ type: 'text', text: failureMessage(result.failure) }], isError: true };
    return {
      content: [{ type: 'text', text: result.answer.text }],
      structuredContent: { ...(result.answer.data as object), readAt: result.answer.readAt, protocol: AGENT_PROTOCOL_VERSION },
      isError: false
    };
  }
}

class McpError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
  }
}
