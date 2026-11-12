import { describe, it, expect } from 'vitest';
import {
  DECK_ACTIONS,
  DECK_ICON_FPS,
  DECK_MAX_ICON_POSES,
  DECK_MAX_ICON_STEPS,
  DECK_MAX_ID_LENGTH,
  DECK_MAX_RECENT,
  DECK_PATH,
  DECK_PROTOCOL_VERSION,
  DeckState,
  DeckStateMessage,
  deckElapsedSeconds,
  deckIconPixels,
  deckProtocolOfUrl,
  deckStateForProtocol,
  deckUrl,
  isPlayableMotion,
  parseDeckRequest
} from '../src/shared/deck-protocol';
import { ArgumentException } from '../src/shared/dtos';

/**
 * The Stream Deck protocol: the one file the plugin and the app share, so
 * what it accepts is what the app acts on.
 */
describe('Deck protocol', () => {
  describe('parseDeckRequest', () => {
    it('ParseDeckRequest_EveryKnownAction_IsAccepted', () => {
      for (const action of DECK_ACTIONS) {
        expect(parseDeckRequest({ id: 'k1', action, index: 1 }).action).toBe(action);
      }
    });

    it('ParseDeckRequest_StartRecent_KeepsItsIndex', () => {
      expect(parseDeckRequest({ id: 'k1', action: 'start-recent', index: DECK_MAX_RECENT }))
        .toEqual({ id: 'k1', action: 'start-recent', index: DECK_MAX_RECENT });
      // Any other action has no use for one, and it is dropped.
      expect(parseDeckRequest({ id: 'k1', action: 'pause', index: 2 })).toEqual({ id: 'k1', action: 'pause' });
    });

    it.each([
      ['no index', undefined],
      ['zero', 0],
      ['past the recent tasks', DECK_MAX_RECENT + 1],
      ['a fraction', 1.5],
      ['a string', '1']
    ])('ParseDeckRequest_StartRecentWith%s_Throws', (_label, index) => {
      expect(() => parseDeckRequest({ id: 'k1', action: 'start-recent', index })).toThrow(ArgumentException);
    });

    it('ParseDeckRequest_UnknownFields_AreDropped', () => {
      expect(parseDeckRequest({ id: 'k1', action: 'pause', taskId: 'T-1', shell: 'rm -rf /' })).toEqual({ id: 'k1', action: 'pause' });
    });

    it('ParseDeckRequest_Confirmed_KeptOnlyWhenTrue', () => {
      expect(parseDeckRequest({ id: 'k1', action: 'discard', confirmed: true })).toEqual({ id: 'k1', action: 'discard', confirmed: true });
      expect(parseDeckRequest({ id: 'k1', action: 'discard', confirmed: false })).toEqual({ id: 'k1', action: 'discard' });
    });

    it.each([
      ['not an object', 'pause'],
      ['null', null],
      ['an array', [{ id: 'k1', action: 'pause' }]],
      ['no id', { action: 'pause' }],
      ['an empty id', { id: '', action: 'pause' }],
      ['a numeric id', { id: 7, action: 'pause' }],
      ['an id too long', { id: 'x'.repeat(DECK_MAX_ID_LENGTH + 1), action: 'pause' }],
      ['an unknown action', { id: 'k1', action: 'format-disk' }],
      ['an inherited action name', { id: 'k1', action: 'toString' }],
      // Removed with the favourite and Away keys (2026-10-22): an old plugin's request is refused, not guessed at.
      ['the removed start', { id: 'k1', action: 'start', taskId: 'T-1' }],
      ['the removed toggle-away', { id: 'k1', action: 'toggle-away' }],
      ['the removed list-tasks', { id: 'k1', action: 'list-tasks' }],
      ['confirmed not a boolean', { id: 'k1', action: 'discard', confirmed: 'yes' }]
    ])('ParseDeckRequest_%s_Throws', (_label, raw) => {
      expect(() => parseDeckRequest(raw)).toThrow(ArgumentException);
    });
  });

  describe('the protocol a plugin speaks', () => {
    it.each([
      ['no query: plugin 0.5', DECK_PATH, 1],
      ['no URL at all', undefined, 1],
      ['protocol 1 named', `${DECK_PATH}?protocol=1`, 1],
      ['protocol 2 named', `${DECK_PATH}?protocol=2`, 2],
      ['a newer one than the app has', `${DECK_PATH}?protocol=9`, DECK_PROTOCOL_VERSION],
      ['zero', `${DECK_PATH}?protocol=0`, 1],
      ['nonsense', `${DECK_PATH}?protocol=two`, 1],
      ['a negative', `${DECK_PATH}?protocol=-2`, 1]
    ])('DeckProtocolOfUrl_%s', (_label, url, expected) => {
      expect(deckProtocolOfUrl(url)).toBe(expected);
    });

    it('DeckUrl_NamesThisProtocol_WhichTheAppReadsBack', () => {
      const url = deckUrl();
      expect(url).toBe(`ws://127.0.0.1:39123${DECK_PATH}?protocol=${DECK_PROTOCOL_VERSION}`);
      expect(deckProtocolOfUrl(url.slice(url.indexOf(DECK_PATH)))).toBe(DECK_PROTOCOL_VERSION);
    });
  });

  describe('deckStateForProtocol', () => {
    const v2 = (over: Partial<DeckState> = {}): DeckState => ({
      session: {
        taskId: 'adhoc_1', taskKey: 'ADHOC-1', taskTitle: 'Interruption 09:30', isAdHoc: true, status: 'tracking',
        elapsedSeconds: 60, finishNeedsConfirmation: false,
        interruption: { title: 'Interruption 09:30', backToKey: 'MG-12' }, ownerName: 'Rin'
      },
      icon: null,
      prompt: null,
      toPlace: 3,
      previousTask: null,
      recent: [{ taskId: 'T2', taskKey: 'PF-31', taskTitle: 'Thing' }],
      standupRunning: null,
      nothingTimingInHours: false,
      ...over
    });

    it('DeckStateForProtocol_2_AsItIs', () => {
      const state = v2();
      expect(deckStateForProtocol(state, 2)).toBe(state);
    });

    it('DeckStateForProtocol_1_OnlyWhatPlugin05Knows', () => {
      const state = deckStateForProtocol(v2(), 1);

      expect(Object.keys(state).sort()).toEqual(['icon', 'prompt', 'session']);
      expect(Object.keys(state.session!).sort()).toEqual(
        ['elapsedSeconds', 'finishNeedsConfirmation', 'isAdHoc', 'status', 'taskId', 'taskKey', 'taskTitle']);
    });

    it.each([
      ['back', 'resume'],
      ['lunch', null],
      ['standup', 'standup'],
      ['wrap-up-confirm', 'wrap-up-confirm']
    ] as const)('DeckStateForProtocol_1_Prompt%sReads%s', (prompt, expected) => {
      // Plugin 0.5 looks a prompt up in a table of four: an unknown one would break every key.
      expect(deckStateForProtocol(v2({ prompt }), 1).prompt).toBe(expected);
    });

    it('DeckStateForProtocol_1_NoSession_StaysNone', () => {
      expect(deckStateForProtocol(v2({ session: null }), 1).session).toBeNull();
    });
  });

  describe('deckElapsedSeconds', () => {
    const message = (status: 'tracking' | 'paused' | null): DeckStateMessage => ({
      type: 'state',
      at: '2026-10-22T10:00:00.000Z',
      state: {
        session: status
          ? { taskId: 'T', taskKey: 'K', taskTitle: 'Title', isAdHoc: false, status, elapsedSeconds: 100, finishNeedsConfirmation: false }
          : null,
        icon: null,
        prompt: null
      }
    });

    it('DeckElapsedSeconds_Tracking_CountsOnFromTheState', () => {
      expect(deckElapsedSeconds(message('tracking'), new Date('2026-10-22T10:01:05.900Z'))).toBe(165);
    });

    it('DeckElapsedSeconds_Paused_StaysPut', () => {
      expect(deckElapsedSeconds(message('paused'), new Date('2026-10-22T11:00:00.000Z'))).toBe(100);
    });

    it('DeckElapsedSeconds_NoSession_IsZero', () => {
      expect(deckElapsedSeconds(message(null), new Date('2026-10-22T11:00:00.000Z'))).toBe(0);
    });

    it('DeckElapsedSeconds_ClockBehindTheState_NeverCountsBack', () => {
      expect(deckElapsedSeconds(message('tracking'), new Date('2026-10-22T09:59:00.000Z'))).toBe(100);
    });
  });
});

describe('icon motion', () => {
  const pose = (colour: string) => [[colour]];
  const motion = { fps: 10, poses: [pose('#111111'), pose('#222222')], sequence: [0, 0, 1] };
  const icon = { pixels: pose('#000001'), label: 'MG-12', motion };

  it('IsPlayableMotion_Bounded_AndEveryStepNamesAPose', () => {
    expect(isPlayableMotion(motion)).toBe(true);
    for (const broken of [
      null,
      'motion',
      { ...motion, fps: 0 },
      { ...motion, fps: DECK_ICON_FPS + 1 },
      { ...motion, poses: [] },
      { ...motion, poses: [pose('#111111'), 'x'] },
      { ...motion, sequence: [] },
      { ...motion, sequence: [0, 2] },
      { ...motion, sequence: [0, 0.5] },
      { ...motion, sequence: Array(DECK_MAX_ICON_STEPS + 1).fill(0) },
      { ...motion, poses: Array(DECK_MAX_ICON_POSES + 1).fill(pose('#111111')) }
    ]) {
      expect(isPlayableMotion(broken)).toBe(false);
    }
  });

  it('DeckIconPixels_StepsByTheWallClock', () => {
    // 100 ms a step: 0, 0, 1, then round again.
    expect([0, 150, 250, 350].map(ms => deckIconPixels(icon, new Date(ms)))).toEqual([pose('#111111'), pose('#111111'), pose('#222222'), pose('#111111')]);
  });

  it('DeckIconPixels_StillOrUnplayable_TheStillPixels', () => {
    expect(deckIconPixels({ pixels: pose('#000001'), label: 'x' }, new Date(0))).toEqual(pose('#000001'));
    expect(deckIconPixels({ ...icon, motion: { ...motion, sequence: [5] } }, new Date(0))).toEqual(pose('#000001'));
  });
});
