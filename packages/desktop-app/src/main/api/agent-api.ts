import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { ArgumentNullException } from '../../shared/dtos';
import { AGENT_API_PREFIX, AGENT_PROTOCOL_VERSION, AgentAccessDTO, AgentAnswer, AgentError, AgentErrorCode, AgentRequest } from '../../shared/agent-protocol';
import { AgentRefusal } from '../services/agent-service';

/** Where the switch and the token are kept: the settings, and `SecretStore`. */
export interface AgentAccessStore {
  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;
  getSecret(key: string): string;
  setSecret(key: string, value: string): void;
}

export const AGENT_ACCESS_SETTING_KEY = 'agent_access_enabled';
export const AGENT_TOKEN_SECRET_KEY = 'agent_access_token';
/** 32 random bytes as hex: no agent guesses it, and it survives copy and paste. */
const TOKEN_BYTES = 32;

/**
 * The agent's access (AGENT-INTERFACE.md §5): off until the user turns it
 * on, and a token made then, which "Make a new one" replaces -- the old one
 * stops working at once, so an agent is revoked.
 */
export class AgentAccess {
  constructor(private readonly _store: AgentAccessStore) {
    if (!_store) throw new ArgumentNullException('store');
  }

  public isEnabled(): boolean {
    return this._store.getSetting<boolean>(AGENT_ACCESS_SETTING_KEY, false) === true;
  }

  public token(): string {
    return this._store.getSecret(AGENT_TOKEN_SECRET_KEY);
  }

  public get(): AgentAccessDTO {
    const enabled = this.isEnabled();
    return { enabled, token: enabled ? this.token() : '' };
  }

  /** Turns access on or off; on, with a token made if there is none. */
  public setEnabled(enabled: boolean): AgentAccessDTO {
    if (enabled && !this.token()) this.newToken();
    this._store.setSetting(AGENT_ACCESS_SETTING_KEY, enabled);
    return this.get();
  }

  /** Replaces the token: every agent given the old one is refused from now on. */
  public newToken(): AgentAccessDTO {
    this._store.setSecret(AGENT_TOKEN_SECRET_KEY, randomBytes(TOKEN_BYTES).toString('hex'));
    return this.get();
  }
}

/** What the routes run: the agent's commands. */
export interface AgentCommands {
  run(name: string, request: AgentRequest): AgentAnswer;
}

const STATUS_OF: Record<AgentErrorCode, number> = {
  off: 404,
  unauthorized: 401,
  'invalid-request': 400,
  'not-found': 404,
  refused: 409,
  'needs-confirmation': 409
};

/**
 * The agent's routes, `POST /api/v1/agent/<command>`, behind the screening
 * every POST to the local API gets (`WebhookServer.screenRequest`: no
 * `Origin`, JSON only) and three checks of their own, in this order:
 * access on, a `Host` naming this port on loopback, the bearer token.
 */
export class AgentApi {
  constructor(
    private readonly _commands: AgentCommands,
    private readonly _access: Pick<AgentAccess, 'isEnabled' | 'token'>,
    private readonly _port: () => number
  ) {
    if (!_commands) throw new ArgumentNullException('commands');
    if (!_access) throw new ArgumentNullException('access');
    if (!_port) throw new ArgumentNullException('port');
  }

  public handle(path: string, body: unknown, headers: IncomingHttpHeaders): { status: number; body: AgentAnswer | AgentError } {
    // Off, it answers as any unknown path does, with a word for the client.
    if (!this._access.isEnabled()) {
      return refuse('off', 'AI agent access is off: turn it on in SprintTicker, Settings › Data › AI agents.');
    }
    // DNS rebinding: a page on a hostile name resolving to 127.0.0.1 would
    // carry its own name here. Browsers also send an Origin, already refused.
    const port = this._port();
    const host = (headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return { status: 403, body: { protocol: AGENT_PROTOCOL_VERSION, error: 'unauthorized', message: 'Only this computer may ask.' } };
    }
    if (!tokenMatches(bearerOf(headers.authorization), this._access.token())) {
      return refuse('unauthorized', 'The token is wrong or missing: copy it from SprintTicker, Settings › Data › AI agents.');
    }
    if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
      return refuse('invalid-request', 'The body is an object of parameters.');
    }
    const name = path.slice(AGENT_API_PREFIX.length);
    try {
      return { status: 200, body: this._commands.run(name, (body ?? {}) as AgentRequest) };
    } catch (err) {
      if (err instanceof AgentRefusal) return refuse(err.code, err.message);
      throw err;
    }
  }
}

function refuse(code: AgentErrorCode, message: string): { status: number; body: AgentError } {
  return { status: STATUS_OF[code], body: { protocol: AGENT_PROTOCOL_VERSION, error: code, message } };
}

function bearerOf(authorization: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match ? match[1] : '';
}

/**
 * Constant time, so the answer's timing says nothing of how much of a guess
 * was right. Hashed first: `timingSafeEqual` needs equal lengths, and the
 * lengths must not leak either.
 */
function tokenMatches(given: string, expected: string): boolean {
  if (!given || !expected) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
