import {
  AGENT_API_PREFIX,
  AGENT_DEFAULT_PORT,
  AGENT_PORT_ENV,
  AGENT_PROTOCOL_VERSION,
  AGENT_TOKEN_ENV,
  AgentAnswer,
  AgentError,
  AgentRequest
} from '../../desktop-app/src/shared/agent-protocol';

/** How long an answer may take: the app answers from memory and its database, in milliseconds. */
export const ASK_TIMEOUT_MS = 10_000;

/** Where to ask, and with what: read from the environment the agent's configuration sets. */
export interface ClientSettings {
  port: number;
  token: string;
}

/** The settings from `env`: the default port unless another is named, and the token. */
export function settingsFrom(env: Record<string, string | undefined>): ClientSettings {
  const named = Number(env[AGENT_PORT_ENV]);
  const port = Number.isInteger(named) && named > 0 && named <= 65535 ? named : AGENT_DEFAULT_PORT;
  return { port, token: (env[AGENT_TOKEN_ENV] ?? '').trim() };
}

/** Why there is no answer, as the command's exit says it. */
export type AskFailure =
  /** The app answered with a refusal: its code and its words. */
  | { kind: 'refused'; error: AgentError }
  /** Nothing answers on the port: SprintTicker is not running. */
  | { kind: 'not-running'; message: string }
  /** Something answered, but not as this protocol does. */
  | { kind: 'unexpected'; message: string };

export type AskResult = { ok: true; answer: AgentAnswer } | { ok: false; failure: AskFailure };

const NOT_RUNNING = 'SprintTicker is not running: start it, then ask again. (Its records are read from the app, never from its file.)';

/**
 * Asks the running app one command (AGENT-INTERFACE.md §2). Never reads the
 * database: when nothing answers, it says SprintTicker is not running.
 */
export async function ask(
  command: string,
  request: AgentRequest,
  settings: ClientSettings,
  fetchImpl: typeof fetch = fetch
): Promise<AskResult> {
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${settings.port}${AGENT_API_PREFIX}${encodeURIComponent(command)}`, {
      method: 'POST',
      // The token in a header, never the URL: a URL ends up in logs.
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS)
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    if (cause === 'ECONNREFUSED') return { ok: false, failure: { kind: 'not-running', message: NOT_RUNNING } };
    return { ok: false, failure: { kind: 'unexpected', message: `SprintTicker did not answer: ${(err as Error).message}` } };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: { kind: 'unexpected', message: `SprintTicker answered ${response.status} with no answer this command reads.` } };
  }
  const shaped = body as Partial<AgentAnswer & AgentError> & { error?: unknown };
  // An app from before the agent's routes answers 404 NOT_FOUND, in capitals.
  if (shaped.protocol === undefined) {
    return { ok: false, failure: { kind: 'unexpected', message: 'This SprintTicker does not answer AI agents: update it.' } };
  }
  if (shaped.protocol !== AGENT_PROTOCOL_VERSION) {
    return {
      ok: false,
      failure: { kind: 'unexpected', message: `SprintTicker speaks protocol ${String(shaped.protocol)}, this command ${AGENT_PROTOCOL_VERSION}: use the sprintticker command installed with the app.` }
    };
  }
  if (response.ok) return { ok: true, answer: body as AgentAnswer };
  return { ok: false, failure: { kind: 'refused', error: body as AgentError } };
}

/** What a failure says to the reader. */
export function failureMessage(failure: AskFailure): string {
  return failure.kind === 'refused' ? failure.error.message : failure.message;
}
