import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebhookServer } from '../../desktop-app/src/main/api/webhook-server';
import { AgentAccess, AgentApi } from '../../desktop-app/src/main/api/agent-api';
import { AgentRefusal } from '../../desktop-app/src/main/services/agent-service';
import { AGENT_API_PREFIX, AGENT_COMMANDS, AGENT_PROTOCOL_VERSION, AGENT_TOKEN_ENV, AgentRequest } from '../../desktop-app/src/shared/agent-protocol';
import { ask, settingsFrom, ClientSettings } from '../src/client';
import { EXIT, parseArgs, runCli, usage } from '../src/cli';
import { McpServer, MCP_PROTOCOL_VERSIONS, toolOf } from '../src/mcp';
import packageJson from '../package.json';

/**
 * The command and the MCP server against the app's real local server and
 * agent routes -- the screening, the Host and the token -- with the
 * commands stubbed: what they answer is the app's (agent-service.test.ts).
 */
describe('sprintticker, the AI agent\'s client', () => {
  let server: WebhookServer;
  let settings: ClientSettings;
  let runs: Array<[string, AgentRequest]>;
  let access: AgentAccess;
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (t: string) => { out.push(t); }, err: (t: string) => { err.push(t); } };

  beforeEach(async () => {
    out.length = 0;
    err.length = 0;
    runs = [];
    server = new WebhookServer(0);
    await server.start();
    const store = new Map<string, unknown>();
    access = new AgentAccess({
      getSetting: <T>(key: string, value: T) => (store.has(key) ? store.get(key) as T : value),
      setSetting: (key, value) => { store.set(key, value); },
      getSecret: key => String(store.get(`secret:${key}`) ?? ''),
      setSecret: (key, value) => { store.set(`secret:${key}`, value); }
    });
    access.setEnabled(true);
    const port = server.getStatus().port;
    const api = new AgentApi({
      run: (name, request) => {
        runs.push([name, request]);
        if (request.day === 'someday') throw new AgentRefusal('invalid-request', '"someday" is not a day.');
        return { protocol: AGENT_PROTOCOL_VERSION, readAt: '2026-11-24T10:00:00+01:00', text: `the ${name} answer`, data: { name } };
      }
    }, access, () => port);
    server.onPost(AGENT_API_PREFIX, (path, body, headers) => api.handle(path, body, headers));
    settings = settingsFrom({ SPRINTTICKER_PORT: String(port), [AGENT_TOKEN_ENV]: access.token() });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('the command line', () => {
    it('Day_Yesterday_PrintsTheAppsText', async () => {
      expect(await runCli(['day', 'yesterday'], settings, io)).toBe(EXIT.OK);

      expect(out).toEqual(['the day answer']);
      expect(runs).toEqual([['day', { day: 'yesterday' }]]);
    });

    it('Json_PrintsTheWholeAnswer', async () => {
      await runCli(['week', '--json', '--week', 'last-week'], settings, io);

      expect(JSON.parse(out[0])).toMatchObject({ protocol: AGENT_PROTOCOL_VERSION, text: 'the week answer', data: { name: 'week' } });
      expect(runs[0]).toEqual(['week', { week: 'last-week' }]);
    });

    it('Tasks_TheRestOfTheWordsAreTheSearch', async () => {
      await runCli(['tasks', 'lantern', 'glow'], settings, io);

      expect(runs[0]).toEqual(['tasks', { search: 'lantern glow' }]);
    });

    it('ATool_ByItsMcpName_Works_Too', async () => {
      expect(await runCli(['get_running'], settings, io)).toBe(EXIT.OK);
      expect(runs[0][0]).toBe('now');
    });

    it('ARefusal_ItsWordsOnStderr_Exit1', async () => {
      expect(await runCli(['day', 'someday'], settings, io)).toBe(EXIT.REFUSED);

      expect(err).toEqual(['"someday" is not a day.']);
    });

    it('AWrongToken_SaysWhereToCopyIt', async () => {
      expect(await runCli(['now'], { ...settings, token: 'nope' }, io)).toBe(EXIT.REFUSED);

      expect(err[0]).toMatch(/Settings › Data › AI agents/);
    });

    it('AccessOff_SaysHowToTurnItOn', async () => {
      access.setEnabled(false);

      expect(await runCli(['now'], settings, io)).toBe(EXIT.REFUSED);
      expect(err[0]).toMatch(/off: turn it on/);
    });

    it('AppNotRunning_SaysSo_Exit3_NeverReadsTheFile', async () => {
      await server.stop();

      expect(await runCli(['now'], settings, io)).toBe(EXIT.NOT_RUNNING);
      expect(err[0]).toMatch(/SprintTicker is not running/);
    });

    it.each([
      [['nope'], /No command "nope"/],
      [['tasks'], /tasks needs <search>/],
      [['now', 'extra'], /now takes no arguments/],
      [['day', '--when', 'x'], /day has no --when/]
    ])('Usage_%j_Exit2_NothingAsked', async (argv, message) => {
      expect(await runCli(argv, settings, io)).toBe(EXIT.USAGE);

      expect(err[0]).toMatch(message);
      expect(runs).toEqual([]);
    });

    it('Help_ListsEveryCommandOfTheProtocol', async () => {
      expect(await runCli(['--help'], settings, io)).toBe(EXIT.OK);
      for (const command of AGENT_COMMANDS) expect(out[0]).toContain(command.name);
      expect(usage()).toContain(AGENT_TOKEN_ENV);
    });

    it('ParseArgs_ABooleanFlag_IsTrue', () => {
      const spec = { name: 'x', tool: 'x', description: '', writes: true, params: { confirmed: { type: 'boolean' as const, description: '' } } };

      expect(parseArgs(spec, ['--confirmed'])).toEqual({ request: { confirmed: true }, json: false });
    });

    it('Settings_ThePortAndTokenFromTheEnvironment_TheDefaultPortOtherwise', () => {
      expect(settingsFrom({})).toEqual({ port: 39123, token: '' });
      expect(settingsFrom({ SPRINTTICKER_PORT: 'abc', [AGENT_TOKEN_ENV]: ' t ' })).toEqual({ port: 39123, token: 't' });
    });

    it('AnAppBeforeTheAgentsRoutes_SaysToUpdateIt', async () => {
      const fetchOld = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'Endpoint Not Found' }), { status: 404 }));

      const result = await ask('now', {}, settings, fetchOld as unknown as typeof fetch);

      expect(result).toMatchObject({ ok: false, failure: { kind: 'unexpected', message: expect.stringMatching(/update it/) } });
    });
  });

  describe('the MCP server', () => {
    /** `id` null sends a notification: no id at all. */
    const rpc = (mcp: McpServer, method: string, params?: unknown, id: number | null = 1) =>
      mcp.handleLine(JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }));

    it('Initialize_EchoesAKnownRevision_NamesItself', async () => {
      const mcp = new McpServer(settings, ask, packageJson.version);

      const known = await rpc(mcp, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
      const unknown = await rpc(mcp, 'initialize', { protocolVersion: '1999-01-01' });

      expect(known).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sprintticker', version: packageJson.version } } });
      expect(unknown).toMatchObject({ result: { protocolVersion: MCP_PROTOCOL_VERSIONS[0] } });
    });

    it('Notifications_AreNeverAnswered', async () => {
      expect(await rpc(new McpServer(settings, ask, '1'), 'notifications/initialized', undefined, null)).toBeNull();
    });

    it('ToolsList_EveryCommand_ReadsMarkedReadOnly', async () => {
      const answer = await rpc(new McpServer(settings, ask, '1'), 'tools/list') as { result: { tools: Array<ReturnType<typeof toolOf>> } };

      expect(answer.result.tools.map(t => t.name)).toEqual(AGENT_COMMANDS.map(c => c.tool));
      const findTasks = answer.result.tools.find(t => t.name === 'find_tasks')!;
      expect(findTasks.inputSchema).toMatchObject({ type: 'object', required: ['search'] });
      expect(answer.result.tools.filter(t => !AGENT_COMMANDS.find(c => c.tool === t.name)!.writes).every(t => t.annotations.readOnlyHint)).toBe(true);
    });

    it('ToolsCall_ForwardsToTheApp_TextAndStructuredContent', async () => {
      const answer = await rpc(new McpServer(settings, ask, '1'), 'tools/call', { name: 'get_day', arguments: { day: 'yesterday' } });

      expect(answer).toMatchObject({ result: { content: [{ type: 'text', text: 'the day answer' }], structuredContent: { name: 'day' }, isError: false } });
      expect(runs[0]).toEqual(['day', { day: 'yesterday' }]);
    });

    it('ToolsCall_ARefusal_IsTheToolsErrorAnswer_NotAProtocolError', async () => {
      const answer = await rpc(new McpServer(settings, ask, '1'), 'tools/call', { name: 'get_day', arguments: { day: 'someday' } });

      expect(answer).toMatchObject({ result: { content: [{ type: 'text', text: '"someday" is not a day.' }], isError: true } });
    });

    it.each([
      ['an unknown method', 'resources/list', undefined, -32601],
      ['an unknown tool', 'tools/call', { name: 'nope' }, -32602]
    ])('%s_AProtocolError', async (_name, method, params, code) => {
      expect(await rpc(new McpServer(settings, ask, '1'), method, params)).toMatchObject({ error: { code } });
    });

    it('NotJson_AParseError', async () => {
      expect(await new McpServer(settings, ask, '1').handleLine('{nope')).toMatchObject({ id: null, error: { code: -32700 } });
    });
  });
});
