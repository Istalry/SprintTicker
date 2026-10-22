import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { WebhookServer } from '../src/main/api/webhook-server';
import { DECK_MAX_CLIENTS, DeckBackend, DeckServer } from '../src/main/api/deck-server';
import {
  DECK_MAX_MESSAGE_BYTES,
  DECK_PATH,
  DECK_PROTOCOL_VERSION,
  DeckRequest,
  DeckServerMessage,
  DeckStateMessage
} from '../src/shared/deck-protocol';

/**
 * The Stream Deck's socket, end to end over loopback: a real HTTP server, a
 * real WebSocket client, and a backend that records what reached it.
 */
describe('DeckServer', () => {
  let http: WebhookServer;
  let deck: DeckServer;
  let backend: DeckBackend & { listeners: Set<(m: DeckStateMessage) => void>; performed: DeckRequest[] };
  let url: string;
  const sockets: WebSocket[] = [];

  const state = (taskKey: string | null): DeckStateMessage => ({
    type: 'state',
    at: '2026-10-22T10:00:00.000Z',
    state: {
      session: taskKey
        ? { taskId: 'T', taskKey, taskTitle: 'Title', isAdHoc: false, status: 'tracking', elapsedSeconds: 5, finishNeedsConfirmation: false }
        : null,
      icon: null,
      prompt: null
    }
  });

  /** Opens a socket and collects every message it receives. */
  const connect = (headers: Record<string, string> = {}) =>
    new Promise<{ ws: WebSocket; messages: DeckServerMessage[] }>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      sockets.push(ws);
      const messages: DeckServerMessage[] = [];
      ws.on('message', data => messages.push(JSON.parse(data.toString())));
      ws.once('open', () => resolve({ ws, messages }));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
    });

  const until = async (check: () => boolean) => {
    await vi.waitFor(() => {
      if (!check()) throw new Error('not yet');
    }, { timeout: 2000, interval: 5 });
  };

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const listeners = new Set<(m: DeckStateMessage) => void>();
    const performed: DeckRequest[] = [];
    backend = {
      listeners,
      performed,
      getStateMessage: () => state('SPR-1'),
      subscribe: listener => {
        listeners.add(listener);
        listener(state('SPR-1'));
        return () => listeners.delete(listener);
      },
      perform: request => {
        performed.push(request);
        return { type: 'result', id: request.id, ok: true };
      }
    };
    http = new WebhookServer(0);
    await http.start();
    deck = new DeckServer(backend);
    http.onUpgrade(DECK_PATH, (req, socket, head) => deck.handleUpgrade(req, socket, head));
    url = `ws://127.0.0.1:${http.getStatus().port}${DECK_PATH}`;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await deck.close();
    await http.stop();
    vi.restoreAllMocks();
  });

  describe('the handshake', () => {
    it('Connect_FromALocalProgram_HelloThenTheState', async () => {
      const { messages } = await connect();
      await until(() => messages.length >= 2);

      expect(messages[0]).toEqual({ type: 'hello', protocol: DECK_PROTOCOL_VERSION });
      expect(messages[1]).toMatchObject({ type: 'state', state: { session: { taskKey: 'SPR-1' } } });
    });

    it('Connect_WithAnOrigin_RefusedBeforeTheUpgrade', async () => {
      // What a web page's `new WebSocket('ws://127.0.0.1:39123/...')` sends.
      await expect(connect({ Origin: 'https://example.com' })).rejects.toThrow('HTTP 403');
      expect(deck.getClientCount()).toBe(0);
    });

    it('Connect_ToAnotherPath_NotFound', async () => {
      url = url.replace(DECK_PATH, '/api/v1/other');

      await expect(connect()).rejects.toThrow('HTTP 404');
    });

    it('Connect_WithAQueryString_StillTheDeck', async () => {
      url = `${url}?plugin=1`;

      const { messages } = await connect();
      await until(() => messages.length >= 2);
    });

    it('Connect_PastTheLimit_Refused', async () => {
      for (let i = 0; i < DECK_MAX_CLIENTS; i++) await connect();

      await expect(connect()).rejects.toThrow('HTTP 503');
    });

    it('Connect_ASecondDeck_GetsTheStateWithoutResubscribing', async () => {
      await connect();
      const second = await connect();
      await until(() => second.messages.length >= 2);

      expect(second.messages[1]).toMatchObject({ type: 'state' });
      expect(backend.listeners.size).toBe(1);
    });
  });

  describe('messages', () => {
    it('Send_ARequest_PerformedAndAnswered', async () => {
      const { ws, messages } = await connect();

      ws.send(JSON.stringify({ id: 'k1', action: 'pause' }));
      await until(() => messages.some(m => m.type === 'result'));

      expect(backend.performed).toEqual([{ id: 'k1', action: 'pause' }]);
      expect(messages.find(m => m.type === 'result')).toEqual({ type: 'result', id: 'k1', ok: true });
    });

    it.each([
      ['malformed JSON', '{not json', ''],
      ['an unknown action', JSON.stringify({ id: 'k3', action: 'shutdown' }), 'k3'],
      ['no id', JSON.stringify({ action: 'pause' }), '']
    ])('Send_%s_RefusedAsInvalidAndNothingPerformed', async (_label, text, id) => {
      const { ws, messages } = await connect();

      ws.send(text);
      await until(() => messages.some(m => m.type === 'result'));

      expect(messages.find(m => m.type === 'result')).toMatchObject({ type: 'result', id, ok: false, error: 'invalid-request' });
      expect(backend.performed).toEqual([]);
    });

    it('Send_Binary_RefusedAsInvalid', async () => {
      const { ws, messages } = await connect();

      ws.send(Buffer.from(JSON.stringify({ id: 'k4', action: 'pause' })), { binary: true });
      await until(() => messages.some(m => m.type === 'result'));

      expect(backend.performed).toEqual([]);
    });

    it('Send_PastTheSizeCap_SocketClosed', async () => {
      const { ws } = await connect();
      const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)));

      ws.send('x'.repeat(DECK_MAX_MESSAGE_BYTES + 1));

      expect(await closed).toBe(1009);
      expect(backend.performed).toEqual([]);
    });

    it('StateChanged_EveryDeckHearsIt', async () => {
      const a = await connect();
      const b = await connect();
      await until(() => a.messages.length >= 2 && b.messages.length >= 2);

      for (const listener of backend.listeners) listener(state('SPR-2'));
      await until(() => [a, b].every(c => c.messages.some(m => m.type === 'state' && m.state.session?.taskKey === 'SPR-2')));
    });
  });

  describe('closing', () => {
    it('LastDeckGone_StopsHearingTheState', async () => {
      const { ws } = await connect();
      expect(backend.listeners.size).toBe(1);

      ws.close();
      await until(() => backend.listeners.size === 0);
    });

    it('Close_WithADeckConnected_TheHttpServerStillStops', async () => {
      const { ws } = await connect();
      const closed = new Promise<void>(resolve => ws.once('close', () => resolve()));

      await deck.close();
      await http.stop();

      await closed;
      expect(backend.listeners.size).toBe(0);
    });
  });

  it('Constructor_NoBackend_Throws', () => {
    expect(() => new DeckServer(undefined as unknown as DeckBackend)).toThrow();
  });

  it('OnUpgrade_APathWithoutSlash_Throws', () => {
    expect(() => http.onUpgrade('api/v1/deck', () => undefined)).toThrow();
  });
});
