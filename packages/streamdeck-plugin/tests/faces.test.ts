import { describe, expect, it } from 'vitest';
import type { DeckPrompt } from '../../desktop-app/src/shared/deck-protocol';
import { ACCENTS, KeyContext, faceFor, formatDuration, hasLongPress, planPress, ticksWithTheClock } from '../src/faces';
import { KEY_KINDS } from '../src/key-kinds';
import { STATE_AT, session, stateMessage } from './support/states';

const NOW = new Date(STATE_AT);

function online(message = stateMessage(), extra: Partial<KeyContext> = {}): KeyContext {
  return { link: 'online', message, now: NOW, armed: false, ...extra };
}

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [59, '0:59'],
    [61, '1:01'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [5050, '1:24:10'],
    [36000, '10:00:00']
  ])('FormatDuration_%i_Is%s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('FormatDuration_NegativeOrFractional_FloorsAtZero', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(61.9)).toBe('1:01');
  });
});

describe('faceFor', () => {
  it.each(KEY_KINDS)('FaceFor_%s_Offline_FadedAndSaysOffline', kind => {
    const face = faceFor(kind, { link: 'offline', message: null, now: NOW, armed: false });
    expect(face.dim).toBe(true);
    expect(face.accent).toBe(ACCENTS.grey);
    expect(face.glyph).toBe('unplugged');
    expect(face.lines.at(-1)).toBe('OFFLINE');
  });

  it.each(KEY_KINDS)('FaceFor_%s_Incompatible_SaysUpdateAppWithItsOwnGlyph', kind => {
    const face = faceFor(kind, { link: 'incompatible', message: null, now: NOW, armed: false });
    expect(face.dim).toBe(true);
    expect(face.glyph).not.toBe('unplugged');
    expect(face.lines.at(-1)).toBe('UPDATE APP');
  });

  it('FaceFor_OnlineButNoStateYet_IsOffline', () => {
    expect(faceFor('session', { link: 'online', message: null, now: NOW, armed: false }).lines.at(-1)).toBe('OFFLINE');
  });

  it('FaceFor_SessionNothingRunning_OffersToStartATask', () => {
    const face = faceFor('session', online());
    expect(face).toMatchObject({ lines: ['START', 'A TASK'], glyph: 'list', dim: false });
    expect(face.big).toBeUndefined();
  });

  it('FaceFor_SessionTracking_GreenWithTheTimeSinceTheState', () => {
    const later = new Date(Date.parse(STATE_AT) + 15_000);
    const face = faceFor('session', online(stateMessage({ session: session({ elapsedSeconds: 600 }) }), { now: later }));
    expect(face).toMatchObject({ lines: ['SPR-1'], big: '10:15', accent: ACCENTS.green, glyph: 'play', dim: false });
  });

  it('FaceFor_SessionPaused_AmberAndTheTimeStands', () => {
    const later = new Date(Date.parse(STATE_AT) + 15_000);
    const face = faceFor('session', online(stateMessage({ session: session({ status: 'paused' }) }), { now: later }));
    expect(face).toMatchObject({ lines: ['SPR-1', 'PAUSED'], big: '10:00', accent: ACCENTS.amber, glyph: 'pause' });
  });

  it('FaceFor_SessionWithTheBarsIcon_DrawsItsPixels', () => {
    const pixels = [['#FF0000', null]];
    const face = faceFor('session', online(stateMessage({ session: session(), icon: { pixels, label: 'meeting' } })));
    expect(face.pixels).toBe(pixels);
  });

  it.each(['not-done', 'done', 'discard'] as const)('FaceFor_%s_NoSession_IsDimmed', kind => {
    expect(faceFor(kind, online()).dim).toBe(true);
    expect(faceFor(kind, online(stateMessage({ session: session() }))).dim).toBe(false);
  });

  it('FaceFor_DoneArmed_AsksToPressAgain', () => {
    const face = faceFor('done', online(stateMessage({ session: session() }), { armed: true }));
    expect(face.lines).toEqual(['NOT YOURS?', 'PRESS', 'AGAIN']);
    expect(face.accent).toBe(ACCENTS.amber);
  });

  it('FaceFor_DiscardArmed_AsksToPressAgain', () => {
    const face = faceFor('discard', online(stateMessage({ session: session() }), { armed: true }));
    expect(face.lines).toEqual(['DISCARD?', 'PRESS', 'AGAIN']);
  });

  it('FaceFor_ArmedWithoutASession_AsksNothing', () => {
    expect(faceFor('discard', online(stateMessage(), { armed: true })).lines).toEqual(['DISCARD']);
  });

  it.each(['yes', 'no'] as const)('FaceFor_%s_NothingAsked_IsDimmed', kind => {
    expect(faceFor(kind, online())).toMatchObject({ lines: [kind.toUpperCase()], dim: true });
  });

  it.each<[DeckPrompt, string[], string[]]>([
    ['standup', ['JOIN', 'STAND-UP'], ['SKIP', 'STAND-UP']],
    ['wrap-up', ['WRAP', 'UP'], ['NOT', 'NOW']],
    ['wrap-up-confirm', ['CONFIRM', 'WRAP-UP'], ['NOT', 'NOW']],
    ['resume', ['RESUME', 'IT'], ['LEAVE', 'IT']]
  ])('FaceFor_YesAndNo_%sAsked_SayTheirAnswer', (prompt, yes, no) => {
    const ctx = online(stateMessage({ prompt }));
    expect(faceFor('yes', ctx)).toMatchObject({ lines: yes, accent: ACCENTS.green, dim: false });
    expect(faceFor('no', ctx)).toMatchObject({ lines: no, accent: ACCENTS.red, dim: false });
  });
});

describe('planPress', () => {
  it.each(KEY_KINDS)('PlanPress_%s_Offline_DoesNothing', kind => {
    expect(planPress(kind, { link: 'offline', message: null, now: NOW, armed: false })).toEqual({ type: 'none', reason: 'offline' });
    expect(planPress(kind, { link: 'incompatible', message: stateMessage(), now: NOW, armed: false })).toEqual({ type: 'none', reason: 'offline' });
  });

  it('PlanPress_SessionHeld_OpensThePickerWhateverRuns', () => {
    for (const message of [stateMessage(), stateMessage({ session: session() }), stateMessage({ session: session({ status: 'paused' }) })]) {
      expect(planPress('session', online(message), true)).toEqual({ type: 'request', action: 'open-picker' });
    }
  });

  it('PlanPress_OtherKeysHeld_SameAsATap', () => {
    const message = stateMessage({ session: session(), prompt: 'standup' });
    for (const kind of KEY_KINDS.filter(k => !hasLongPress(k))) {
      expect(planPress(kind, online(message), true)).toEqual(planPress(kind, online(message)));
    }
  });

  it('PlanPress_Session_PicksPausesOrResumes', () => {
    expect(planPress('session', online())).toEqual({ type: 'request', action: 'open-picker' });
    expect(planPress('session', online(stateMessage({ session: session() })))).toEqual({ type: 'request', action: 'pause' });
    expect(planPress('session', online(stateMessage({ session: session({ status: 'paused' }) })))).toEqual({ type: 'request', action: 'resume' });
  });

  it('PlanPress_NotDone_StopsTheSession', () => {
    expect(planPress('not-done', online(stateMessage({ session: session() })))).toEqual({ type: 'request', action: 'stop' });
    expect(planPress('not-done', online())).toEqual({ type: 'none', reason: 'nothing' });
  });

  it('PlanPress_DoneOnTheUsersTask_FinishesAtOnce', () => {
    expect(planPress('done', online(stateMessage({ session: session() })))).toEqual({ type: 'request', action: 'finish' });
  });

  it('PlanPress_DoneOnATaskNoLongerTheirs_AsksThenConfirms', () => {
    const message = stateMessage({ session: session({ finishNeedsConfirmation: true }) });
    expect(planPress('done', online(message))).toEqual({ type: 'arm' });
    expect(planPress('done', online(message, { armed: true }))).toEqual({ type: 'request', action: 'finish', confirmed: true });
  });

  it('PlanPress_DoneArmedByTheAppsAnswer_Confirms', () => {
    // The state still says the task is the user's; the app's refusal armed the key.
    const message = stateMessage({ session: session({ finishNeedsConfirmation: false }) });
    expect(planPress('done', online(message, { armed: true }))).toEqual({ type: 'request', action: 'finish', confirmed: true });
  });

  it('PlanPress_Discard_AlwaysAsksFirst', () => {
    const message = stateMessage({ session: session() });
    expect(planPress('discard', online(message))).toEqual({ type: 'arm' });
    expect(planPress('discard', online(message, { armed: true }))).toEqual({ type: 'request', action: 'discard', confirmed: true });
    expect(planPress('discard', online())).toEqual({ type: 'none', reason: 'nothing' });
  });

  it('PlanPress_YesAndNo_AnswerOnlyWhatIsAsked', () => {
    expect(planPress('yes', online())).toEqual({ type: 'none', reason: 'nothing' });
    expect(planPress('no', online())).toEqual({ type: 'none', reason: 'nothing' });
    const asked = online(stateMessage({ prompt: 'standup' }));
    expect(planPress('yes', asked)).toEqual({ type: 'request', action: 'prompt-yes' });
    expect(planPress('no', asked)).toEqual({ type: 'request', action: 'prompt-no' });
  });

  it('PlanPress_YesAndNo_NeverTheSameAction', () => {
    // The user's rule (2026-10-22): one key, one answer, whatever the press.
    for (const prompt of ['standup', 'wrap-up', 'wrap-up-confirm', 'resume'] as const) {
      for (const armed of [false, true]) {
        const ctx = online(stateMessage({ prompt }), { armed });
        expect(planPress('yes', ctx)).toEqual({ type: 'request', action: 'prompt-yes' });
        expect(planPress('no', ctx)).toEqual({ type: 'request', action: 'prompt-no' });
      }
    }
  });
});

describe('ticksWithTheClock', () => {
  it('TicksWithTheClock_OnlyTheSessionKey', () => {
    expect(KEY_KINDS.filter(ticksWithTheClock)).toEqual(['session']);
  });
});

describe('hasLongPress', () => {
  it('HasLongPress_OnlyTheSessionKey', () => {
    // Never yes or no: an answer must not depend on how long a key is held.
    expect(KEY_KINDS.filter(hasLongPress)).toEqual(['session']);
  });
});
