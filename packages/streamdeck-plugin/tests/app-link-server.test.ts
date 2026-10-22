import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckBackend, DeckServer } from '../../desktop-app/src/main/api/deck-server';
import { WebhookServer } from '../../desktop-app/src/main/api/webhook-server';
import { DECK_PATH, DeckRequest, DeckStateMessage } from '../../desktop-app/src/shared/deck-protocol';
import { AppLink } from '../src/app-link';
import { DeckController, KeyHandle } from '../src/controller';
import { session, stateMessage } from './support/states';

/**
 * The plugin's link against the app's own socket, over loopback: the real
 * WebhookServer and DeckServer, and Node's global WebSocket as the plugin
 * uses it. The two packages agree on the protocol by sharing its module;
 * this is what shows they agree on the wire too -- and that the handshake
 * Node sends carries no Origin, which the app would refuse.
 */
describe('AppLink against the app', () => {
  let http: WebhookServer;
  let deck: DeckServer;
  let link: AppLink;
  let listeners: Set<(m: DeckStateMessage) => void>;
  let performed: DeckRequest[];
  let current: DeckStateMessage;

  const until = (check: () => boolean) =>
    vi.waitFor(
      () => {
        if (!check()) throw new Error('not yet');
      },
      { timeout: 3000, interval: 5 }
    );

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    listeners = new Set();
    performed = [];
    current = stateMessage({ session: session() });
    const backend: DeckBackend = {
      getStateMessage: () => current,
      subscribe: listener => {
        listeners.add(listener);
        listener(current);
        return () => listeners.delete(listener);
      },
      perform: request => {
        performed.push(request);
        return request.action === 'list-tasks'
          ? { type: 'tasks', id: request.id, tasks: [{ id: 'T-1', key: 'SPR-1', title: 'Fix', projectName: 'Sprint' }] }
          : { type: 'result', id: request.id, ok: true };
      }
    };
    http = new WebhookServer(0);
    await http.start();
    deck = new DeckServer(backend);
    http.onUpgrade(DECK_PATH, (req, socket, head) => deck.handleUpgrade(req, socket, head));
    link = new AppLink({ url: `ws://127.0.0.1:${http.getStatus().port}${DECK_PATH}` });
  });

  afterEach(async () => {
    link.stop();
    await deck.close();
    await http.stop();
    vi.restoreAllMocks();
  });

  it('Start_AppRunning_OnlineWithItsState', async () => {
    link.start();
    await until(() => link.message !== null);
    expect(link.status).toBe('online');
    expect(link.message?.state.session?.taskKey).toBe('SPR-1');
  });

  it('State_AppPushes_TheLinkHearsIt', async () => {
    link.start();
    await until(() => link.message !== null);
    current = stateMessage({ mode: 'AWAY' });
    for (const listener of listeners) listener(current);
    await until(() => link.message?.state.mode === 'AWAY');
  });

  it('Request_ReachesTheAppAndComesBack', async () => {
    link.start();
    await until(() => link.status === 'online');
    const answer = await link.request({ action: 'list-tasks' });
    expect(answer).toMatchObject({ type: 'tasks', tasks: [{ key: 'SPR-1' }] });
    expect(performed).toHaveLength(1);
    expect(performed[0]).toMatchObject({ action: 'list-tasks' });
  });

  it('Press_SessionKey_PausesTheAppsSession', async () => {
    link.start();
    const controller = new DeckController(link, { log: () => undefined });
    const alerts: string[] = [];
    const key: KeyHandle = { id: 'k', setImage: () => Promise.resolve(), showAlert: () => (alerts.push('k'), Promise.resolve()) };
    controller.appear('session', key);
    await until(() => link.message !== null);
    await controller.press('k');
    expect(performed.map(r => r.action)).toEqual(['pause']);
    expect(alerts).toEqual([]);
    controller.dispose();
  });

  it('Close_AppQuits_Offline', async () => {
    link.start();
    await until(() => link.status === 'online');
    await deck.close();
    await until(() => link.status === 'offline');
    expect(link.message).toBeNull();
  });
});
