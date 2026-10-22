import { describe, expect, it } from 'vitest';
import type { DeckPrompt } from '../../desktop-app/src/shared/deck-protocol';
import { ACCENTS, GLYPHS, KeyContext, PRESS_AGAIN, faceFor, formatDuration, hasLongPress, planPress, playsOnPress, playsOnQuestion, tickPeriodMs, ticksWithTheClock } from '../src/faces';
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
  it.each(KEY_KINDS)('FaceFor_%s_Offline_ItsOwnGlyphGreyAndSaysOffline', kind => {
    const face = faceFor(kind, { link: 'offline', message: null, now: NOW, armed: false });
    expect(face).toMatchObject({ tone: 'idle', glyph: GLYPHS[kind], hint: 'offline' });
  });

  it.each(KEY_KINDS)('FaceFor_%s_Incompatible_SaysUpdateApp', kind => {
    const face = faceFor(kind, { link: 'incompatible', message: null, now: NOW, armed: false });
    expect(face).toMatchObject({ tone: 'idle', glyph: GLYPHS[kind], hint: 'update app' });
  });

  it('FaceFor_OnlineButNoStateYet_IsOffline', () => {
    expect(faceFor('session', { link: 'online', message: null, now: NOW, armed: false }).hint).toBe('offline');
  });

  it('FaceFor_SessionNothingRunning_OffersToStartATask', () => {
    const face = faceFor('session', online());
    expect(face).toMatchObject({ title: 'START', hint: 'pick a task', glyph: 'list', tone: 'ready' });
    expect(face.big).toBeUndefined();
  });

  it('FaceFor_SessionTracking_GreenWithTheTimeSinceTheState', () => {
    const later = new Date(Date.parse(STATE_AT) + 15_000);
    const face = faceFor('session', online(stateMessage({ session: session({ elapsedSeconds: 600 }) }), { now: later }));
    expect(face).toMatchObject({ title: 'SPR-1', big: '10:15', accent: ACCENTS.green, glyph: 'play', tone: 'ready' });
  });

  it('FaceFor_SessionPaused_AmberAndTheTimeStands', () => {
    const later = new Date(Date.parse(STATE_AT) + 15_000);
    const face = faceFor('session', online(stateMessage({ session: session({ status: 'paused' }) }), { now: later }));
    expect(face).toMatchObject({ title: 'SPR-1', big: '10:00', accent: ACCENTS.amber, glyph: 'pause' });
  });

  it('FaceFor_SessionWithTheBarsIcon_DrawsItsPixels', () => {
    const pixels = [['#FF0000', null]];
    const face = faceFor('session', online(stateMessage({ session: session(), icon: { pixels, label: 'meeting' } })));
    expect(face.pixels).toBe(pixels);
  });

  it.each(['not-done', 'done', 'discard'] as const)('FaceFor_%s_NoSession_IsGrey', kind => {
    expect(faceFor(kind, online()).tone).toBe('idle');
    expect(faceFor(kind, online(stateMessage({ session: session() }))).tone).toBe('ready');
  });

  it('FaceFor_DoneArmed_FilledAmberAndAsksToPressAgain', () => {
    const face = faceFor('done', online(stateMessage({ session: session() }), { armed: true }));
    expect(face).toMatchObject({ title: 'NOT YOURS', hint: PRESS_AGAIN, accent: ACCENTS.amber, tone: 'ask' });
  });

  it('FaceFor_DiscardArmed_FilledRedAndAsksToPressAgain', () => {
    const face = faceFor('discard', online(stateMessage({ session: session() }), { armed: true }));
    expect(face).toMatchObject({ title: 'DISCARD?', hint: PRESS_AGAIN, accent: ACCENTS.red, tone: 'ask' });
  });

  it('FaceFor_ArmedWithoutASession_AsksNothing', () => {
    expect(faceFor('discard', online(stateMessage(), { armed: true }))).toMatchObject({ title: 'DISCARD', tone: 'idle' });
  });

  it.each(['yes', 'no'] as const)('FaceFor_%s_NothingAsked_IsGrey', kind => {
    expect(faceFor(kind, online())).toMatchObject({ title: kind.toUpperCase(), tone: 'idle' });
  });

  it.each<[DeckPrompt, [string, string], [string, string]]>([
    ['standup', ['JOIN', 'stand-up'], ['SKIP', 'stand-up']],
    ['wrap-up', ['WRAP UP', 'end the day'], ['NOT NOW', 'keep going']],
    ['wrap-up-confirm', ['CONFIRM', 'wrap-up'], ['NOT NOW', 'keep going']],
    ['resume', ['RESUME', 'the task'], ['LEAVE IT', 'stopped']]
  ])('FaceFor_YesAndNo_%sAsked_FilledWithTheirAnswer', (prompt, [yesTitle, yesHint], [noTitle, noHint]) => {
    const ctx = online(stateMessage({ prompt }));
    expect(faceFor('yes', ctx)).toMatchObject({ title: yesTitle, hint: yesHint, accent: ACCENTS.green, tone: 'ask' });
    expect(faceFor('no', ctx)).toMatchObject({ title: noTitle, hint: noHint, accent: ACCENTS.red, tone: 'ask' });
  });

  it.each(KEY_KINDS)('FaceFor_%s_EveryState_TitleFitsTheKey', kind => {
    // A title is one line; ten capitals is what the smallest size holds.
    const states = [
      online(),
      online(stateMessage({ session: session() })),
      online(stateMessage({ session: session() }), { armed: true }),
      ...(['standup', 'wrap-up', 'wrap-up-confirm', 'resume'] as const).map(prompt => online(stateMessage({ session: session(), prompt })))
    ];
    for (const ctx of states) expect(faceFor(kind, ctx).title.length).toBeLessThanOrEqual(10);
  });
});

describe('one-shots', () => {
  it('PlaysOnPress_TheEnds_PlayAndTheRestDoNot', () => {
    expect(['finish', 'discard', 'stop'].every(a => playsOnPress(a as never))).toBe(true);
    expect(['pause', 'resume', 'open-picker', 'prompt-yes', 'prompt-no'].some(a => playsOnPress(a as never))).toBe(false);
  });

  it('PlaysOnQuestion_OnlyTheAnswers', () => {
    expect(KEY_KINDS.filter(playsOnQuestion)).toEqual(['yes', 'no']);
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

describe("the bar's icon in motion", () => {
  const still = [['#000001']];
  const motion = { fps: 10, poses: [[['#111111']], [['#222222']]], sequence: [0, 1] };
  const moving = (status: 'tracking' | 'paused' = 'tracking') =>
    stateMessage({ session: session({ status }), icon: { pixels: still, label: 'SPR-1', motion } });

  it('FaceFor_SessionWithAMovingIcon_ThePoseOfTheMoment', () => {
    const at = (ms: number) => faceFor('session', online(moving(), { now: new Date(ms) })).pixels;
    expect([at(0), at(100), at(200)]).toEqual([[['#111111']], [['#222222']], [['#111111']]]);
  });

  it('TickPeriodMs_ByWhatMoves', () => {
    expect(tickPeriodMs(null, 1000)).toBeNull();
    expect(tickPeriodMs(stateMessage(), 1000)).toBeNull();
    expect(tickPeriodMs(stateMessage({ session: session() }), 1000)).toBe(1000);
    expect(tickPeriodMs(stateMessage({ session: session({ status: 'paused' }) }), 1000)).toBeNull();
    // The paused stopwatch blinks: a moving icon ticks paused too.
    expect(tickPeriodMs(moving('paused'), 1000)).toBe(100);
    expect(tickPeriodMs(moving(), 1000)).toBe(100);
    // A motion that cannot be played is no motion.
    const broken = stateMessage({ session: session(), icon: { pixels: still, label: 'x', motion: { ...motion, sequence: [7] } } });
    expect(tickPeriodMs(broken, 1000)).toBe(1000);
  });
});
