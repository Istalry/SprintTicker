import { beforeEach, describe, expect, it } from 'vitest';
import type { DeckRequest, DeckStateMessage } from '../../desktop-app/src/shared/deck-protocol';
import type { DeckAnswer } from '../src/app-link';
import { CONFIRM_WINDOW_MS, DeckController, KeyHandle, LONG_PRESS_MS, LinkLike, ONE_SHOT_FRAME_MS, ONE_SHOT_STEPS, TICK_MS } from '../src/controller';
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
  /** A press and its release, at once: a tap. */
  const tap = async (id: string) => {
    await controller.keyDown(id);
    await controller.keyUp(id);
  };
  /** Lets the promise callbacks of a held press settle. */
  const settle = () => new Promise(resolve => setImmediate(resolve));

  it('Constructor_NoLink_Throws', () => {
    expect(() => new DeckController(null as unknown as LinkLike)).toThrow();
  });

  it('Appear_Offline_DrawsTheOfflineFace', () => {
    link.push(null, 'offline');
    const key = new FakeKey('a');
    controller.appear('session', key);
    expect(textsOf(key.last)).toEqual(['SESSION', 'offline']);
  });

  it('Press_Offline_AlertsAndSendsNothing', async () => {
    link.push(null, 'offline');
    const key = new FakeKey('a');
    controller.appear('not-done', key);
    await tap('a');
    expect(key.alerts).toBe(1);
    expect(link.requests).toEqual([]);
  });

  it('Press_SessionTracking_SendsPause', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('session', key);
    await tap('a');
    expect(link.requests).toEqual([{ action: 'pause' }]);
    expect(key.alerts).toBe(0);
  });

  it('Press_UnknownKey_DoesNothing', async () => {
    await tap('nobody');
    expect(link.requests).toEqual([]);
  });

  it('KeyDown_AKeyWithoutALongPress_ActsAtOnce', async () => {
    link.push(tracking());
    controller.appear('not-done', new FakeKey('a'));
    await controller.keyDown('a');
    expect(link.requests).toEqual([{ action: 'stop' }]);
    await controller.keyUp('a');
    expect(link.requests).toHaveLength(1);
  });

  it('KeyUp_WithoutAKeyDown_DoesNothing', async () => {
    link.push(tracking());
    controller.appear('session', new FakeKey('a'));
    await controller.keyUp('a');
    expect(link.requests).toEqual([]);
  });

  it('Hold_SessionPastTheThreshold_OpensThePickerWhileATaskRuns', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('session', key);
    await controller.keyDown('a');
    clock.advance(LONG_PRESS_MS);
    await settle();
    // At the threshold, before the key comes up: the window is the sign.
    expect(link.requests).toEqual([{ action: 'open-picker' }]);
    await controller.keyUp('a');
    expect(link.requests).toHaveLength(1);
    expect(key.alerts).toBe(0);
  });

  it('Hold_SessionLetGoBeforeTheThreshold_Pauses', async () => {
    link.push(tracking());
    controller.appear('session', new FakeKey('a'));
    await controller.keyDown('a');
    clock.advance(LONG_PRESS_MS - 1);
    await controller.keyUp('a');
    clock.advance(LONG_PRESS_MS);
    await settle();
    expect(link.requests).toEqual([{ action: 'pause' }]);
  });

  it('Hold_SessionNothingRunning_OpensThePickerEitherWay', async () => {
    controller.appear('session', new FakeKey('a'));
    await tap('a');
    await controller.keyDown('a');
    clock.advance(LONG_PRESS_MS);
    await settle();
    expect(link.requests).toEqual([{ action: 'open-picker' }, { action: 'open-picker' }]);
  });

  it('Hold_SessionOffline_Alerts', async () => {
    link.push(null, 'offline');
    const key = new FakeKey('a');
    controller.appear('session', key);
    await controller.keyDown('a');
    clock.advance(LONG_PRESS_MS);
    await settle();
    expect(key.alerts).toBe(1);
    expect(link.requests).toEqual([]);
  });

  it('Hold_KeyLeavesWhileDown_NothingHappens', async () => {
    link.push(tracking({ status: 'paused' }));
    controller.appear('session', new FakeKey('a'));
    await controller.keyDown('a');
    controller.disappear('a');
    expect(clock.pending).toBe(0);
    await controller.keyUp('a');
    expect(link.requests).toEqual([]);
  });

  it('Hold_TheHeldPressFails_IsLogged', async () => {
    link.push(null, 'offline');
    const key = new FakeKey('a');
    key.showAlert = () => Promise.reject(new Error('socket closed'));
    controller.appear('session', key);
    await controller.keyDown('a');
    clock.advance(LONG_PRESS_MS);
    await settle();
    expect(logs.join('\n')).toContain('A held press failed');
  });

  it('Press_DiscardTwiceInTheWindow_SendsAConfirmedDiscard', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await tap('a');
    expect(link.requests).toEqual([]);
    expect(textsOf(key.last)).toEqual(['DISCARD?', 'press again']);

    clock.advance(CONFIRM_WINDOW_MS - 1);
    await tap('a');
    expect(link.requests).toEqual([{ action: 'discard', confirmed: true }]);
    expect(textsOf(key.last)).toEqual(['DISCARD']);
  });

  it('Press_DiscardAfterTheWindow_AsksAgain', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await tap('a');
    clock.advance(CONFIRM_WINDOW_MS);
    expect(textsOf(key.last)).toEqual(['DISCARD']);
    await tap('a');
    expect(link.requests).toEqual([]);
    expect(textsOf(key.last)).toEqual(['DISCARD?', 'press again']);
  });

  it('Arm_AnotherTaskStarts_TheQuestionIsWithdrawn', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await tap('a');
    link.push(tracking({ taskId: 'T-2', taskKey: 'SPR-2' }));
    expect(textsOf(key.last)).toEqual(['DISCARD']);
    // The next press asks about the new task rather than throwing it away.
    await tap('a');
    expect(link.requests).toEqual([]);
  });

  it('Arm_SameTaskTicks_TheQuestionStands', async () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('discard', key);
    await tap('a');
    link.push(tracking({ elapsedSeconds: 700 }));
    await tap('a');
    expect(link.requests).toEqual([{ action: 'discard', confirmed: true }]);
  });

  it('Press_AppAsksForConfirmation_TheKeyAsks', async () => {
    // The state said the task was the user's; the app knew better.
    link.push(tracking());
    link.answer = () => ({ type: 'result', id: 'k1', ok: false, error: 'needs-confirmation', message: 'Not yours.' });
    const key = new FakeKey('a');
    controller.appear('done', key);
    await tap('a');
    expect(link.requests).toEqual([{ action: 'finish' }]);
    expect(textsOf(key.last)).toEqual(['NOT YOURS', 'press again']);
    expect(key.alerts).toBe(0);

    link.answer = () => ({ type: 'result', id: 'k2', ok: true });
    await tap('a');
    expect(link.requests.at(-1)).toEqual({ action: 'finish', confirmed: true });
  });

  it('Press_Refused_AlertsAndLogsWhy', async () => {
    link.push(tracking());
    link.answer = () => ({ type: 'result', id: 'k1', ok: false, error: 'failed', message: 'The database is locked.' });
    const key = new FakeKey('a');
    controller.appear('not-done', key);
    await tap('a');
    expect(key.alerts).toBe(1);
    expect(logs.join('\n')).toContain('stop refused: failed -- The database is locked.');
  });

  it('Press_NoAnswer_AlertsAndLogs', async () => {
    link.push(tracking());
    link.answer = () => null;
    const key = new FakeKey('a');
    controller.appear('session', key);
    await tap('a');
    expect(key.alerts).toBe(1);
    expect(logs.join('\n')).toContain('pause got no answer');
  });

  it('Draw_StateUnchanged_SendsNoImage', () => {
    const key = new FakeKey('a');
    controller.appear('yes', key);
    link.push(stateMessage());
    link.push(stateMessage());
    expect(key.images).toHaveLength(1);
    link.push(stateMessage({ prompt: 'standup' }));
    expect(key.images).toHaveLength(2);
  });

  it('Draw_ImageRefused_IsLogged', async () => {
    const key = new FakeKey('a');
    key.failDraws = true;
    controller.appear('yes', key);
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
    await tap('a');
    expect(clock.pending).toBe(1);
    controller.disappear('a');
    expect(clock.pending).toBe(0);
    controller.disappear('a');
  });

  it('Dispose_StopsListeningAndTicking', () => {
    link.push(tracking());
    const key = new FakeKey('a');
    controller.appear('session', key);
    controller.dispose();
    expect(link.listeners.size).toBe(0);
    expect(clock.pending).toBe(0);
    link.push(stateMessage({ prompt: 'standup' }));
    expect(key.images).toHaveLength(1);
  });
  describe('one-shots', () => {
    const PLAY_MS = ONE_SHOT_FRAME_MS * (ONE_SHOT_STEPS + 1);

    it('Press_Done_PlaysItsFramesThenRestsOnTheStateThatFollowed', async () => {
      link.push(tracking());
      const key = new FakeKey('a');
      controller.appear('done', key);
      await tap('a');
      expect(link.requests).toEqual([{ action: 'finish' }]);
      const first = key.images.length;

      // The session ends while the check draws: the frames are not cut.
      link.push(stateMessage());
      clock.advance(ONE_SHOT_FRAME_MS * ONE_SHOT_STEPS);
      expect(key.images.length - first).toBe(ONE_SHOT_STEPS);
      expect(textsOf(key.last)).toEqual(['DONE']);
      expect(key.last).toContain('stroke="#22C55E"');

      clock.advance(ONE_SHOT_FRAME_MS);
      // At rest on what the state is now: nothing to finish, grey.
      expect(key.last).not.toContain('#22C55E');
      expect(clock.pending).toBe(0);
    });

    it.each(['not-done', 'discard'] as const)('Press_%s_PlaysAOneShot', async kind => {
      link.push(tracking());
      const key = new FakeKey('a');
      controller.appear(kind, key);
      await tap('a');
      if (kind === 'discard') await tap('a');
      const before = key.images.length;
      clock.advance(PLAY_MS);
      expect(key.images.length).toBeGreaterThan(before);
      expect(clock.pending).toBe(0);
    });

    it('Press_Pause_PlaysNothing', async () => {
      link.push(stateMessage({ session: session({ status: 'paused' }) }));
      const key = new FakeKey('a');
      controller.appear('session', key);
      await tap('a');
      expect(link.requests).toEqual([{ action: 'resume' }]);
      expect(clock.pending).toBe(0);
    });

    it('Question_Arrives_YesAndNoPlayOnceThenRest', () => {
      const yes = new FakeKey('y');
      const no = new FakeKey('n');
      const done = new FakeKey('d');
      controller.appear('yes', yes);
      controller.appear('no', no);
      controller.appear('done', done);
      link.push(tracking());
      const drawnDone = done.images.length;

      link.push(stateMessage({ session: session(), prompt: 'standup' }));
      clock.advance(PLAY_MS);
      for (const key of [yes, no]) {
        expect(key.images.length).toBeGreaterThanOrEqual(ONE_SHOT_STEPS + 1);
        expect(textsOf(key.last)[1]).toBe('stand-up');
      }
      expect(done.images.length).toBe(drawnDone);

      // The same question pushed again is not a new one.
      const drawnYes = yes.images.length;
      link.push(stateMessage({ session: session({ elapsedSeconds: 700 }), prompt: 'standup' }));
      expect(clock.pending).toBe(0);
      expect(yes.images.length).toBe(drawnYes);
    });

    it('Question_AppGoneAndBack_PlaysAgain', () => {
      const yes = new FakeKey('y');
      controller.appear('yes', yes);
      link.push(stateMessage({ prompt: 'wrap-up' }));
      clock.advance(PLAY_MS);
      link.push(null, 'offline');
      const drawn = yes.images.length;
      link.push(stateMessage({ prompt: 'wrap-up' }));
      clock.advance(PLAY_MS);
      expect(yes.images.length - drawn).toBeGreaterThan(1);
    });

    it('Disappear_WhilePlaying_StopsItsFrames', async () => {
      link.push(tracking());
      const key = new FakeKey('a');
      controller.appear('not-done', key);
      await tap('a');
      controller.disappear('a');
      const drawn = key.images.length;
      clock.advance(PLAY_MS);
      expect(key.images.length).toBe(drawn);
      expect(clock.pending).toBe(0);
    });
  });
});
