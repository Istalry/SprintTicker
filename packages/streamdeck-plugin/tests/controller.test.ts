import { beforeEach, describe, expect, it } from 'vitest';
import type { DeckRequest, DeckStateMessage } from '../../desktop-app/src/shared/deck-protocol';
import type { DeckAnswer } from '../src/app-link';
import { CONFIRM_WINDOW_MS, DeckController, KeyHandle, LinkLike, TICK_MS } from '../src/controller';
import type { LinkStatus } from '../src/faces';
import { FakeClock } from './support/fake-clock';
import { session, stateMessage } from './support/states';

type Sent = Omit<DeckRequest, 'id'>;

class FakeLink implements LinkLike {
  public status: LinkStatus = 'online';
  public message: DeckStateMessage | null = stateMessage();
  public readonly requests: Sent[] = [];
  public answer: (request: Sent) => DeckAnswer | null = () => ({ type: 'result', id: 'k1', ok: true });
  public readonly listeners = new Set<() => void>();

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public request(request: Sent): Promise<DeckAnswer | null> {
    this.requests.push(request);
    return Promise.resolve(this.answer(request));
  }

  public push(message: DeckStateMessage | null, status: LinkStatus = 'online'): void {
    this.message = message;
    this.status = status;
    for (const listener of this.listeners) listener();
  }
}

class FakeKey implements KeyHandle {
  public readonly images: string[] = [];
  public alerts = 0;
  public failDraws = false;
  constructor(public readonly id: string) {}

  public setImage(svg: string): Promise<void> {
    this.images.push(svg);
    return this.failDraws ? Promise.reject(new Error('socket closed')) : Promise.resolve();
  }

  public showAlert(): Promise<void> {
    this.alerts++;
    return Promise.resolve();
  }

  public get last(): string {
    return this.images.at(-1) ?? '';
  }
}

/** The texts a key image shows, in order. */
const textsOf = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);

describe('DeckController', () => {
  let link: FakeLink;
  let clock: FakeClock;
  let logs: string[];
  let controller: DeckController;

  beforeEach(() => {
    link = new FakeLink();
    clock = new FakeClock();
    logs = [];
    controller = new DeckController(link, {
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      log: message => logs.push(message)
    });
  });

  const tracking = (overrides = {}) => stateMessage({ session: session(overrides) });

  it('Constructor_NoLink_Throws', () => {
    expect(() => new DeckController(null as unknown as LinkLike)).toThrow();
  });

  it('Appear_Offline_DrawsTheOfflineFace', () => {
    link.push(null, 'offline');
    const key = new FakeKey('a');
    controller.appear('session', key);
    expect(textsOf(key.last)).toEqual(['SESSION', 'OFFLINE']);
  });

  it('Press_Offline_AlertsAndSendsNothing', async () => {
    link.push(null, 'offline');
    const key = new FakeKey('a');
    controller.appear('not-done', key);
    await controller.press('a');
    expect(key.alerts).toBe(1);
    expect(link.requests).toEqual([]);
  });

  it('Press_SessionTracking_SendsPause', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('session', key);
    await controller.press('a');
    expect(link.requests).toEqual([{ action: 'pause' }]);
    expect(key.alerts).toBe(0);
  });

  it('Press_UnknownKey_DoesNothing', async () => {
    await controller.press('nobody');
    expect(link.requests).toEqual([]);
  });

  it('Press_Favourite_StartsItsTask', async () => {
    const key = new FakeKey('a');
    controller.appear('favourite', key, { taskId: 'T-5', taskKey: 'SPR-5' });
    await controller.press('a');
    expect(link.requests).toEqual([{ action: 'start', taskId: 'T-5' }]);
  });

  it('Press_DiscardTwiceInTheWindow_SendsAConfirmedDiscard', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await controller.press('a');
    expect(link.requests).toEqual([]);
    expect(textsOf(key.last)).toEqual(['DISCARD?', 'PRESS', 'AGAIN']);

    clock.advance(CONFIRM_WINDOW_MS - 1);
    await controller.press('a');
    expect(link.requests).toEqual([{ action: 'discard', confirmed: true }]);
    expect(textsOf(key.last)).toEqual(['DISCARD']);
  });

  it('Press_DiscardAfterTheWindow_AsksAgain', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await controller.press('a');
    clock.advance(CONFIRM_WINDOW_MS);
    expect(textsOf(key.last)).toEqual(['DISCARD']);
    await controller.press('a');
    expect(link.requests).toEqual([]);
    expect(textsOf(key.last)).toEqual(['DISCARD?', 'PRESS', 'AGAIN']);
  });

  it('Arm_AnotherTaskStarts_TheQuestionIsWithdrawn', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await controller.press('a');
    link.push(tracking({ taskId: 'T-2', taskKey: 'SPR-2' }));
    expect(textsOf(key.last)).toEqual(['DISCARD']);
    // The next press asks about the new task rather than throwing it away.
    await controller.press('a');
    expect(link.requests).toEqual([]);
  });

  it('Arm_SameTaskTicks_TheQuestionStands', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await controller.press('a');
    link.push(tracking({ elapsedSeconds: 700 }));
    await controller.press('a');
    expect(link.requests).toEqual([{ action: 'discard', confirmed: true }]);
  });

  it('Press_AppAsksForConfirmation_TheKeyAsks', async () => {
    // The state said the task was the user's; the app knew better.
    link.push(tracking());
    link.answer = () => ({ type: 'result', id: 'k1', ok: false, error: 'needs-confirmation', message: 'Not yours.' });
    const key = new FakeKey('a');
    controller.appear('done', key);
    await controller.press('a');
    expect(link.requests).toEqual([{ action: 'finish' }]);
    expect(textsOf(key.last)).toEqual(['NOT YOURS?', 'PRESS', 'AGAIN']);
    expect(key.alerts).toBe(0);

    link.answer = () => ({ type: 'result', id: 'k2', ok: true });
    await controller.press('a');
    expect(link.requests.at(-1)).toEqual({ action: 'finish', confirmed: true });
  });

  it('Press_Refused_AlertsAndLogsWhy', async () => {
    link.push(tracking());
    link.answer = () => ({ type: 'result', id: 'k1', ok: false, error: 'failed', message: 'The database is locked.' });
    const key = new FakeKey('a');
    controller.appear('not-done', key);
    await controller.press('a');
    expect(key.alerts).toBe(1);
    expect(logs.join('\n')).toContain('stop refused: failed -- The database is locked.');
  });

  it('Press_NoAnswer_AlertsAndLogs', async () => {
    link.push(tracking());
    link.answer = () => null;
    const key = new FakeKey('a');
    controller.appear('session', key);
    await controller.press('a');
    expect(key.alerts).toBe(1);
    expect(logs.join('\n')).toContain('pause got no answer');
  });

  it('Draw_StateUnchanged_SendsNoImage', () => {
    const key = new FakeKey('a');
    controller.appear('away', key);
    link.push(stateMessage());
    link.push(stateMessage());
    expect(key.images).toHaveLength(1);
    link.push(stateMessage({ mode: 'AWAY' }));
    expect(key.images).toHaveLength(2);
  });

  it('Draw_ImageRefused_IsLogged', async () => {
    const key = new FakeKey('a');
    key.failDraws = true;
    controller.appear('away', key);
    await Promise.resolve();
    await Promise.resolve();
    expect(logs.join('\n')).toContain('Could not draw a key');
  });

  it('Ticker_SessionTracking_RedrawsTheTimeEachSecond', () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('session', key);
    expect(textsOf(key.last)).toEqual(['SPR-1', '10:00']);
    clock.advance(TICK_MS);
    expect(textsOf(key.last)).toEqual(['SPR-1', '10:01']);
    clock.advance(TICK_MS * 59);
    expect(textsOf(key.last)).toEqual(['SPR-1', '11:00']);
  });

  it('Ticker_SessionPaused_Idles', () => {
    link.push(tracking({ status: 'paused' }));
    controller.appear('session', new FakeKey('a'));
    expect(clock.pending).toBe(0);
  });

  it('Ticker_NoKeyShowsTheTime_Idles', () => {
    link.push(tracking());
    controller.appear('discard', new FakeKey('a'));
    expect(clock.pending).toBe(0);
  });

  it('Ticker_SessionKeyLeaves_Stops', () => {
    link.push(tracking());
    controller.appear('session', new FakeKey('a'));
    expect(clock.pending).toBe(1);
    controller.disappear('a');
    expect(clock.pending).toBe(0);
  });

  it('Ticker_SessionEnds_Stops', () => {
    link.push(tracking());
    controller.appear('session', new FakeKey('a'));
    link.push(stateMessage());
    expect(clock.pending).toBe(0);
  });

  it('Disappear_ArmedKey_DropsItsQuestion', async () => {
    link.push(tracking());
    controller.appear('discard', new FakeKey('a'));
    await controller.press('a');
    expect(clock.pending).toBe(1);
    controller.disappear('a');
    expect(clock.pending).toBe(0);
    controller.disappear('a');
  });

  it('SettingsChanged_Favourite_RedrawsWithItsTask', () => {
    const key = new FakeKey('a');
    controller.appear('favourite', key);
    expect(textsOf(key.last)).toEqual(['SET A', 'TASK']);
    controller.settingsChanged('a', { taskId: 'T-5', taskKey: 'SPR-5' });
    expect(textsOf(key.last)).toEqual(['SPR-5']);
    controller.settingsChanged('gone', { taskId: 'T-6' });
  });

  it('ListTasks_AppAnswers_TheTasks', async () => {
    const tasks = [{ id: 'T-1', key: 'SPR-1', title: 'Fix', projectName: 'Sprint' }];
    link.answer = () => ({ type: 'tasks', id: 'k1', tasks });
    await expect(controller.listTasks()).resolves.toEqual(tasks);
    expect(link.requests).toEqual([{ action: 'list-tasks' }]);
  });

  it('ListTasks_NoAnswer_Null', async () => {
    link.answer = () => null;
    await expect(controller.listTasks()).resolves.toBeNull();
  });

  it('Dispose_StopsListeningAndTicking', () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('session', key);
    controller.dispose();
    expect(link.listeners.size).toBe(0);
    expect(clock.pending).toBe(0);
    link.push(stateMessage({ mode: 'AWAY' }));
    expect(key.images).toHaveLength(1);
  });
});
