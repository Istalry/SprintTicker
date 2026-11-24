import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebhookServer } from '../src/main/api/webhook-server';
import { AgentAccess, AgentAccessStore, AgentApi, AGENT_TOKEN_SECRET_KEY } from '../src/main/api/agent-api';
import { AGENT_API_PREFIX } from '../src/shared/agent-protocol';
import { AgentRefusal } from '../src/main/services/agent-service';

/** The settings and the secrets, in memory. */
function memoryStore(): AgentAccessStore & { secrets: Map<string, string> } {
  const settings = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  return {
    secrets,
    getSetting: <T>(key: string, value: T) => (settings.has(key) ? settings.get(key) as T : value),
    setSetting: (key, value) => { settings.set(key, value); },
    getSecret: key => secrets.get(key) ?? '',
    setSecret: (key, value) => { secrets.set(key, value); }
  };
}

/**
 * The agent's routes behind the local API's screening (AGENT-INTERFACE.md
 * §5): off until turned on, a Host on loopback, the bearer token.
 */
describe('The AI agents\' routes', () => {
  let server: WebhookServer;
  let access: AgentAccess;
  let run: ReturnType<typeof vi.fn>;
  let port: number;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server = new WebhookServer(0);
    await server.start();
    port = server.getStatus().port;
    access = new AgentAccess(memoryStore());
    run = vi.fn().mockImplementation((name: string) => {
      if (name === 'nope') throw new AgentRefusal('not-found', 'No command "nope".');
      if (name === 'boom') throw new Error('a bug');
      return { protocol: 1, readAt: 'now', text: `answered ${name}`, data: {} };
    });
    const api = new AgentApi({ run }, access, () => port);
    server.onPost(AGENT_API_PREFIX, (path, body, headers) => api.handle(path, body, headers));
  });

  afterEach(async () => {
    await server.stop();
    vi.restoreAllMocks();
  });

  const ask = (command: string, headers: Record<string, string> = {}, payload: unknown = {}) =>
    server.inject({
      method: 'POST',
      url: `${AGENT_API_PREFIX}${command}`,
      payload,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.token()}`, ...headers }
    });

  it('Off_AnswersAsAnUnknownPath_WithAWordForTheClient', async () => {
    const answer = await ask('day');

    expect(answer.statusCode).toBe(404);
    expect(JSON.parse(answer.payload)).toMatchObject({ error: 'off' });
    expect(run).not.toHaveBeenCalled();
  });

  it('On_WithTheToken_RunsTheCommandWithItsParameters', async () => {
    access.setEnabled(true);

    const answer = await ask('day', {}, { day: 'yesterday' });

    expect(answer.statusCode).toBe(200);
    expect(JSON.parse(answer.payload).text).toBe('answered day');
    expect(run).toHaveBeenCalledWith('day', { day: 'yesterday' });
  });

  it.each([
    ['no token', { Authorization: '' }, 401, 'unauthorized'],
    ['a wrong token', { Authorization: 'Bearer 0123' }, 401, 'unauthorized'],
    ['a token not as a bearer', { Authorization: 'token' }, 401, 'unauthorized'],
    ['another host name, as DNS rebinding sends', { Host: `evil.example:1` }, 403, 'unauthorized'],
    ['a browser page', { Origin: 'https://evil.example' }, 403, undefined]
  ])('On_%s_Refused_NothingRun', async (_name, headers, status, code) => {
    access.setEnabled(true);

    const answer = await ask('day', headers as Record<string, string>);

    expect(answer.statusCode).toBe(status);
    if (code) expect(JSON.parse(answer.payload).error).toBe(code);
    expect(run).not.toHaveBeenCalled();
  });

  it('On_LocalhostByName_Accepted', async () => {
    access.setEnabled(true);

    expect((await ask('now', { Host: `localhost:${port}` })).statusCode).toBe(200);
  });

  it('On_ARefusal_ItsCodeAndStatus_ABug_A500', async () => {
    access.setEnabled(true);

    expect(await ask('nope')).toMatchObject({ statusCode: 404 });
    expect(JSON.parse((await ask('nope')).payload)).toMatchObject({ error: 'not-found', message: 'No command "nope".' });
    expect((await ask('boom')).statusCode).toBe(500);
    expect((await ask('day', {}, [1, 2])).statusCode).toBe(400);
  });

  it('NewToken_TheOldOneRefusedAtOnce', async () => {
    access.setEnabled(true);
    const old = access.token();

    access.newToken();

    expect(access.token()).not.toBe(old);
    expect((await ask('now', { Authorization: `Bearer ${old}` })).statusCode).toBe(401);
    expect((await ask('now')).statusCode).toBe(200);
  });

  it('Access_OffThenOn_KeepsItsToken_ShowsItOnlyWhileOn', () => {
    const store = memoryStore();
    const settings = new AgentAccess(store);

    expect(settings.get()).toEqual({ enabled: false, token: '' });
    const on = settings.setEnabled(true);
    expect(on.token).toMatch(/^[0-9a-f]{64}$/);
    expect(store.secrets.get(AGENT_TOKEN_SECRET_KEY)).toBe(on.token);
    expect(settings.setEnabled(false)).toEqual({ enabled: false, token: '' });
    expect(settings.setEnabled(true).token).toBe(on.token);
  });
});
