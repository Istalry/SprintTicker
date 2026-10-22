import type { DeckSession, DeckState, DeckStateMessage } from '../../../desktop-app/src/shared/deck-protocol';

/** When every state in these tests was read. */
export const STATE_AT = '2026-10-22T10:00:00.000Z';

export function session(overrides: Partial<DeckSession> = {}): DeckSession {
  return {
    taskId: 'T-1',
    taskKey: 'SPR-1',
    taskTitle: 'Fix the login page',
    isAdHoc: false,
    status: 'tracking',
    elapsedSeconds: 600,
    finishNeedsConfirmation: false,
    ...overrides
  };
}

/** A state message as the app sends it; nothing running, in WORK, unless told. */
export function stateMessage(overrides: Partial<DeckState> = {}, at: string = STATE_AT): DeckStateMessage {
  return {
    type: 'state',
    at,
    state: { session: null, icon: null, prompt: null, mode: 'WORK', ...overrides }
  };
}
