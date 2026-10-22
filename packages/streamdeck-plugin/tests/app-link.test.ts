import { beforeEach, describe, expect, it } from 'vitest';
import { DECK_PROTOCOL_VERSION } from '../../desktop-app/src/shared/deck-protocol';
import { AppLink, RECONNECT_DELAYS_MS, REQUEST_TIMEOUT_MS, SocketLike } from '../src/app-link';
import { FakeClock } from './support/fake-clock';
import { session, stateMessage } from './support/states';

class FakeSocket implements SocketLike {
  public readyState = 0;
  public readonly sent: Record<string, unknown>[] = [];
  public closed = false;
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  public onclose: ((ev: unknown) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;

  public send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  public close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  /** The app answers the handshake and greets. */
  public accept(protocol: number = DECK_PROTOCOL_VERSION): void {
    this.readyState = 1;
    this.onopen?.({});
    this.receive({ type: 'hello', protocol });
  }

  public receive(message: unknown): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  /** The connection ends: refused, or the app quit. */
  public drop(): void {
    this.readyState = 3;
    this.onerror?.({});
    this.onclose?.({});
  }
}

describe('AppLink', () => {
  let clock: FakeClock;
  let sockets: FakeSocket[];
  let urls: string[];
  let changes: number;
  let link: AppLink;

  const makeLink = (connect?: (url: string) => SocketLike) =>
    new AppLink({
      connect:
        connect ??
        (url => {
          urls.push(url);
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        }),
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout
    });

  beforeEach(() => {
    clock = new FakeClock();
    sockets = [];
    urls = [];
    changes = 0;
    link = makeLink();
    link.onChange(() => changes++);
  });

  const latest = () => sockets.at(-1)!;

  it('Start_Default_DialsTheAppsDeckSocket', () => {
    link.start();
    expect(urls).toEqual(['ws://127.0.0.1:39123/api/v1/deck']);
    expect(link.status).toBe('offline');
  });

  it('Start_Twice_DialsOnce', () => {
    link.start();
    link.start();
    expect(sockets).toHaveLength(1);
  });

  it('Hello_SameProtocol_Online', () => {
    link.start();
    latest().accept();
    expect(link.status).toBe('online');
    expect(changes).toBe(1);
  });

  it('State_Online_ExposedAndTold', () => {
    link.start();
    latest().accept();
    const message = stateMessage({ session: session() });
    latest().receive(message);
    expect(link.message).toEqual(message);
    expect(changes).toBe(2);
  });

  it('Hello_OtherProtocol_IncompatibleAndTrustsNothing', () => {
    link.start();
    latest().accept(DECK_PROTOCOL_VERSION + 1);
    latest().receive(stateMessage());
    expect(link.status).toBe('incompatible');
    expect(link.message).toBeNull();
    // Stays connected: the app's upgrade is found when it restarts.
    expect(latest().closed).toBe(false);
  });

  it('Receive_NotJson_Ignored', () => {
    link.start();
    latest().accept();
    latest().receive('{nope');
    expect(link.status).toBe('online');
  });

  it('Close_AppQuits_OfflineAndRedialsWithBackoff', () => {
    link.start();
    for (const delay of [...RECONNECT_DELAYS_MS, RECONNECT_DELAYS_MS.at(-1)!]) {
      const before = sockets.length;
      latest().drop();
      clock.advance(delay - 1);
      expect(sockets).toHaveLength(before);
      clock.advance(1);
      expect(sockets).toHaveLength(before + 1);
    }
  });

  it('Close_AfterAHello_BackoffStartsOver', () => {
    link.start();
    latest().drop();
    clock.advance(RECONNECT_DELAYS_MS[0]);
    latest().drop();
    clock.advance(RECONNECT_DELAYS_MS[1]);
    latest().accept();
    latest().drop();
    expect(link.status).toBe('offline');
    expect(link.message).toBeNull();
    clock.advance(RECONNECT_DELAYS_MS[0]);
    expect(sockets).toHaveLength(4);
  });

  it('Connect_Throws_RetriesLikeARefusal', () => {
    let calls = 0;
    link = makeLink(() => {
      calls++;
      throw new Error('no WebSocket');
    });
    link.start();
    clock.advance(RECONNECT_DELAYS_MS[0]);
    expect(calls).toBe(2);
  });

  it('Request_Offline_NullWithoutSending', async () => {
    link.start();
    await expect(link.request({ action: 'pause' })).resolves.toBeNull();
    expect(latest().sent).toEqual([]);
  });

  it('Request_Answered_ResolvesTheAnswer', async () => {
    link.start();
    latest().accept();
    const pending = link.request({ action: 'finish', confirmed: true });
    const sent = latest().sent[0];
    expect(sent).toMatchObject({ action: 'finish', confirmed: true });
    expect(typeof sent.id).toBe('string');
    // Someone else's answer first: not this request's.
    latest().receive({ type: 'result', id: 'other', ok: true });
    latest().receive({ type: 'result', id: sent.id, ok: false, error: 'no-session', message: 'Gone.' });
    await expect(pending).resolves.toEqual({ type: 'result', id: sent.id, ok: false, error: 'no-session', message: 'Gone.' });
    expect(clock.pending).toBe(0);
  });

  it('Request_EachGetsItsOwnId', () => {
    link.start();
    latest().accept();
    void link.request({ action: 'pause' });
    void link.request({ action: 'resume' });
    const [a, b] = latest().sent;
    expect(a.id).not.toBe(b.id);
  });

  it('Request_NoAnswer_NullAfterTheTimeout', async () => {
    link.start();
    latest().accept();
    const pending = link.request({ action: 'pause' });
    clock.advance(REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it('Request_ConnectionDrops_NullAtOnce', async () => {
    link.start();
    latest().accept();
    const pending = link.request({ action: 'pause' });
    latest().drop();
    await expect(pending).resolves.toBeNull();
  });

  it('Stop_ClosesAndStopsRedialling', async () => {
    link.start();
    latest().accept();
    const pending = link.request({ action: 'pause' });
    link.stop();
    await expect(pending).resolves.toBeNull();
    expect(latest().closed).toBe(true);
    expect(link.status).toBe('offline');
    latest().drop();
    clock.advance(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('Stop_WhileWaitingToRedial_CancelsTheRedial', () => {
    link.start();
    latest().drop();
    link.stop();
    clock.advance(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('Close_OfASocketLetGo_ChangesNothing', () => {
    link.start();
    const first = latest();
    link.stop();
    link.start();
    latest().accept();
    first.drop();
    first.receive(stateMessage({ prompt: 'standup' }));
    expect(link.status).toBe('online');
    expect(link.message).toBeNull();
    expect(sockets).toHaveLength(2);
  });
});
