import { describe, it, expect } from 'vitest';
import {
  DECK_ACTIONS,
  DECK_MAX_ID_LENGTH,
  DeckStateMessage,
  deckElapsedSeconds,
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
        const raw = action === 'start' ? { id: 'k1', action, taskId: 'T-1' } : { id: 'k1', action };
        expect(parseDeckRequest(raw).action).toBe(action);
      }
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
      ['start without a task', { id: 'k1', action: 'start' }],
      ['start with a numeric task', { id: 'k1', action: 'start', taskId: 42 }],
      ['confirmed not a boolean', { id: 'k1', action: 'discard', confirmed: 'yes' }]
    ])('ParseDeckRequest_%s_Throws', (_label, raw) => {
      expect(() => parseDeckRequest(raw)).toThrow(ArgumentException);
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
        prompt: null,
        mode: 'WORK'
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
