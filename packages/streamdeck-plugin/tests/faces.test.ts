import { describe, expect, it } from 'vitest';
import type { DeckPrompt, DeckState } from '../../desktop-app/src/shared/deck-protocol';
import {
  ACCENTS, GLYPHS, KeyContext, PRESS_AGAIN, PRESS_TWICE, answerKind, faceFor, formatDuration, hasLongPress, planPress,
  playsOnPress, playsOnQuestion, resolveKind, tickPeriodMs, ticksWithTheClock
} from '../src/faces';
import { ANSWER_KINDS, KEY_KINDS } from '../src/key-kinds';
import { STATE_AT, session, stateMessage } from './support/states';

const NOW = new Date(STATE_AT);
const PROMPTS = ['standup', 'wrap-up', 'wrap-up-confirm', 'resume', 'back', 'lunch'] as const;

function online(message = stateMessage(), extra: Partial<KeyContext> = {}): KeyContext {
  return { link: 'online', message, now: NOW, armed: false, ...extra };
}

/** States from S29's table, as the app sends them. */
const MG12 = session({ taskKey: 'MG-12' });
const INTERRUPTION = session({ taskId: 'adhoc_1', taskKey: 'ADHOC-1', isAdHoc: true, interruption: { name: null, backToKey: 'MG-12' } });
const STATES: Record<string, Partial<DeckState>> = {
  timing: { session: MG12 },
  paused: { session: session({ taskKey: 'MG-12', status: 'paused' }) },
  interruption: { session: INTERRUPTION, toPlace: 3 },
  'interruption holding nothing': { session: session({ isAdHoc: true, interruption: { name: null, backToKey: null } }) },
  'stand-up asked': { session: MG12, prompt: 'standup' },
  'stand-up running': { session: session({ taskKey: 'STANDUP', isAdHoc: true }), standupRunning: { returnsToKey: 'MG-12' } },
  'nothing timing, back?': { session: session({ taskKey: 'MG-12', status: 'paused' }), prompt: 'back' },
  'nothing timing in hours': { nothingTimingInHours: true },
  'after lunch': { session: session({ status: 'paused' }), prompt: 'resume' },
  'lunch during an interruption': { session: INTERRUPTION, prompt: 'lunch' },
  'not yours': { session: session({ taskKey: 'MG-12', finishNeedsConfirmation: true, ownerName: 'Rin' }) }
};

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

describe('S29: what A, B and C are in each state', () => {
  // [state, A, B, C] as the table writes them; '' is a blank key.
  it.each<[string, string, string, string]>([
    ['timing', 'DONE', 'STOP', 'DISCARD'],
    ['paused', 'DONE', 'STOP', 'DISCARD'],
    ['interruption', 'BACK', 'STOP', 'DISCARD ⚡'],
    ['interruption holding nothing', '', 'STOP', 'DISCARD ⚡'],
    ['stand-up asked', 'JOIN', 'SKIP', ''],
    ['stand-up running', 'END STAND-UP', '', ''],
    ['nothing timing, back?', 'BACK', 'NOT NOW', ''],
    ['nothing timing in hours', '', '', ''],
    ['after lunch', 'RESUME', 'NOT NOW', ''],
    ['lunch during an interruption', 'START LUNCH', 'NOT NOW', ''],
    ['not yours', 'DONE ANYWAY', 'STOP', 'DISCARD']
  ])('AnswerKeys_%s_AreS29s', (name, a, b, c) => {
    const ctx = online(stateMessage(STATES[name]));
    expect(ANSWER_KINDS.map(kind => faceFor(kind, ctx).title)).toEqual([a, b, c]);
  });

  it.each(Object.keys(STATES))('AnswerKeys_%s_OneColourPerPosition', name => {
    // A green, B blue-grey, C red, whatever they say; a blank key is grey.
    const ctx = online(stateMessage(STATES[name]));
    const [a, b, c] = ANSWER_KINDS.map(kind => faceFor(kind, ctx));
    if (a.title) expect(a.accent).toBe(ACCENTS.green);
    if (b.title) expect(b.accent).toBe(ACCENTS.slate);
    if (c.title) expect(c.accent).toBe(ACCENTS.red);
    for (const face of [a, b, c].filter(f => !f.title)) expect(face.tone).toBe('idle');
  });

  it.each(Object.keys(STATES))('AnswerKeys_%s_EachPressIsWhatItsFaceSays', name => {
    const ctx = online(stateMessage(STATES[name]));
    for (const kind of ANSWER_KINDS) {
      const blank = faceFor(kind, ctx).title === '';
      expect(planPress(kind, ctx).type === 'none', `${kind} in ${name}`).toBe(blank);
    }
  });

  it('AnswerKeys_ANoLongerTheUsersTask_TheSessionKeySaysSo', () => {
    const face = faceFor('session', online(stateMessage(STATES['not yours'])));
    expect(face).toMatchObject({ title: 'NOT YOURS', accent: ACCENTS.amber });
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
    expect(face).toMatchObject({ title: 'START', hint: 'pick a task', accent: ACCENTS.green, glyph: 'list', tone: 'ready' });
    expect(face.big).toBeUndefined();
  });

  it('FaceFor_SessionNothingTimingInWorkingHours_AmberNotTiming', () => {
    const face = faceFor('session', online(stateMessage({ nothingTimingInHours: true })));
    expect(face).toMatchObject({ title: 'NOT TIMING', hint: 'pick a task', accent: ACCENTS.amber, tone: 'ready' });
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

  it('FaceFor_SessionDuringAnInterruption_TheBoltAndItsTime', () => {
    expect(faceFor('session', online(stateMessage(STATES.interruption)))).toMatchObject({ title: '', big: '10:00', glyph: 'zap', accent: ACCENTS.amber });
    const named = stateMessage({ session: session({ interruption: { name: 'Call', backToKey: 'MG-12' } }) });
    expect(faceFor('session', online(named)).title).toBe('Call');
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

  it('FaceFor_Done_SaysItTakesTwoPresses', () => {
    expect(faceFor('done', online(stateMessage({ session: session() })))).toMatchObject({ title: 'DONE', hint: PRESS_TWICE, accent: ACCENTS.green });
  });

  it('FaceFor_DoneArmed_FilledGreenAndAsksToPressAgain', () => {
    const face = faceFor('done', online(stateMessage({ session: session() }), { armed: true }));
    expect(face).toMatchObject({ title: 'DONE?', hint: PRESS_AGAIN, accent: ACCENTS.green, tone: 'ask' });
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
    ['wrap-up', ['END MY DAY', 'sends the day'], ['NOT NOW', 'keep going']],
    ['wrap-up-confirm', ['CONFIRM', 'end my day'], ['NOT NOW', 'keep going']],
    ['resume', ['RESUME', 'the task'], ['NOT NOW', 'leave it']],
    ['back', ['BACK', 'SPR-1'], ['NOT NOW', 'leave it']],
    ['lunch', ['START LUNCH', 'ends it'], ['NOT NOW', 'work on']]
  ])('FaceFor_YesAndNo_%sAsked_FilledWithTheirAnswer', (prompt, [yesTitle, yesHint], [noTitle, noHint]) => {
    const ctx = online(stateMessage({ session: session(), prompt }));
    expect(faceFor('yes', ctx)).toMatchObject({ title: yesTitle, hint: yesHint, accent: ACCENTS.green, tone: 'ask' });
    expect(faceFor('no', ctx)).toMatchObject({ title: noTitle, hint: noHint, accent: ACCENTS.slate, tone: 'ask' });
  });

  it.each(KEY_KINDS)('FaceFor_%s_EveryState_TitleFitsTheKey', kind => {
    // A title is one line; twelve capitals is what the smallest size holds.
    const states = [
      online(),
      ...Object.values(STATES).flatMap(state => [online(stateMessage(state)), online(stateMessage(state), { armed: true })])
    ];
    for (const ctx of states) expect(faceFor(kind, ctx).title.length).toBeLessThanOrEqual(12);
  });
});

describe('the Interrupt key', () => {
  it.each([
    ['NothingRunning', stateMessage()],
    ['ATaskRunning', stateMessage({ session: session() })],
    ['ATaskPaused', stateMessage({ session: session({ status: 'paused' }) })],
    ['AQuestionWaiting', stateMessage({ session: session(), prompt: 'standup' })]
  ])('Interrupt_%s_ReadyAndStartsOne', (_name, message) => {
    // An interruption starts from any state; the task it stops is asked about after.
    expect(faceFor('interrupt', online(message))).toMatchObject({ title: 'INTERRUPT', glyph: 'zap', tone: 'ready' });
    expect(planPress('interrupt', online(message))).toEqual({ type: 'request', action: 'interrupt' });
  });

  it('Interrupt_DuringAnInterruption_AnotherWithWhatWaits', () => {
    const ctx = online(stateMessage(STATES.interruption));
    expect(faceFor('interrupt', ctx)).toMatchObject({ title: 'ANOTHER', hint: '3 to place' });
    expect(planPress('interrupt', ctx)).toEqual({ type: 'request', action: 'another' });
  });

  it('Interrupt_NothingToPlace_NoCount', () => {
    expect(faceFor('interrupt', online(stateMessage({ toPlace: 0 }))).hint).toBeUndefined();
  });
});

describe('Previous and Recent', () => {
  const PF31 = { taskId: 'T-3', taskKey: 'PF-31', taskTitle: 'Before' };
  const RECENT = [
    { taskId: 'T-5', taskKey: 'MG-15', taskTitle: 'One' },
    { taskId: 'T-8', taskKey: 'SR-8', taskTitle: 'Two' },
    { taskId: 'T-4', taskKey: 'OPS-4', taskTitle: 'Three' }
  ];

  it('Previous_ATaskBefore_NamesItAndStartsIt', () => {
    const ctx = online(stateMessage({ session: session(), previousTask: PF31 }));
    expect(faceFor('previous', ctx)).toMatchObject({ title: 'PREV', hint: 'PF-31', glyph: 'back', tone: 'ready' });
    expect(planPress('previous', ctx)).toEqual({ type: 'request', action: 'previous' });
  });

  it.each([
    ['none before', stateMessage({ session: session(), previousTask: null })],
    // Going back is A during an interruption, even if the app sent one.
    ['an interruption', stateMessage({ session: INTERRUPTION, previousTask: PF31 })]
  ])('Previous_%s_Blank', (_name, message) => {
    expect(faceFor('previous', online(message))).toMatchObject({ title: '', tone: 'idle' });
    expect(planPress('previous', online(message))).toEqual({ type: 'none', reason: 'nothing' });
  });

  it.each([[1, 'MG-15'], [2, 'SR-8'], [3, 'OPS-4']] as const)('Recent%i_ItsTaskAndItsIndex', (n, key) => {
    const ctx = online(stateMessage({ recent: RECENT }));
    const kind = `recent-${n}` as const;
    expect(faceFor(kind, ctx)).toMatchObject({ title: key, hint: 'START', glyph: 'play', tone: 'ready' });
    expect(planPress(kind, ctx)).toEqual({ type: 'request', action: 'start-recent', index: n });
  });

  it('Recent_DuringAnInterruption_Blank', () => {
    const ctx = online(stateMessage({ session: INTERRUPTION, recent: RECENT }));
    expect(faceFor('recent-1', ctx)).toMatchObject({ title: '', tone: 'idle' });
    expect(planPress('recent-1', ctx)).toEqual({ type: 'none', reason: 'nothing' });
  });

  it('Recent_NoSuchTask_Blank', () => {
    const ctx = online(stateMessage({ recent: RECENT.slice(0, 1) }));
    expect(faceFor('recent-2', ctx)).toMatchObject({ title: '', tone: 'idle' });
    expect(planPress('recent-3', ctx)).toEqual({ type: 'none', reason: 'nothing' });
  });
});

describe('one-shots', () => {
  it('PlaysOnPress_TheEnds_PlayAndTheRestDoNot', () => {
    expect(['finish', 'discard', 'stop', 'interrupt', 'another'].every(a => playsOnPress(a as never))).toBe(true);
    expect(['pause', 'resume', 'open-picker', 'prompt-yes', 'prompt-no', 'back', 'previous', 'start-recent'].some(a => playsOnPress(a as never))).toBe(false);
  });

  it('PlaysOnQuestion_TheAnswersAndTheKeysThatBecomeThem', () => {
    // Answer C goes blank under a question: nothing to play there.
    expect(KEY_KINDS.filter(playsOnQuestion)).toEqual(['answer-a', 'answer-b', 'yes', 'no']);
  });
});

describe('the answer keys', () => {
  const running = stateMessage({ session: session() });
  const asked = (prompt: DeckPrompt) => stateMessage({ session: session(), prompt });

  it('AnswerKind_NoState_WhatTheyAreWhileATaskRuns', () => {
    expect(answerKind('answer-a', null)).toBe('done');
    expect(answerKind('answer-b', null)).toBe('not-done');
    expect(answerKind('answer-c', null)).toBe('discard');
  });

  it.each(PROMPTS)('AnswerKind_%s_YesOnANoOnBNothingOnC', prompt => {
    const state = asked(prompt).state;
    expect(answerKind('answer-a', state)).toBe('yes');
    expect(answerKind('answer-b', state)).toBe('no');
    expect(answerKind('answer-c', state)).toBe('blank');
  });

  it.each([
    ['answer-a', 'done'],
    ['answer-b', 'not-done'],
    ['answer-c', 'discard']
  ] as const)('FaceAndPress_%s_ATaskRunning_AsTheKeyItStandsFor', (answer, fixed) => {
    for (const ctx of [online(running), online(running, { armed: true })]) {
      expect(faceFor(answer, ctx)).toEqual(faceFor(fixed, ctx));
      expect(planPress(answer, ctx)).toEqual(planPress(fixed, ctx));
    }
  });

  it.each(PROMPTS)('FaceAndPress_%s_AAndBAnswerIt', prompt => {
    const ctx = online(asked(prompt));
    expect(faceFor('answer-a', ctx)).toEqual(faceFor('yes', ctx));
    expect(faceFor('answer-b', ctx)).toEqual(faceFor('no', ctx));
    expect(planPress('answer-a', ctx)).toEqual({ type: 'request', action: 'prompt-yes' });
    expect(planPress('answer-b', ctx)).toEqual({ type: 'request', action: 'prompt-no' });
    expect(planPress('answer-c', ctx)).toEqual({ type: 'none', reason: 'nothing' });
  });

  it('FaceFor_AnswerKeysOffline_WhatTheyMeanWhileATaskRuns', () => {
    // A deck laid out with SprintTicker closed still reads.
    const off = { link: 'offline' as const, message: null, now: NOW, armed: false };
    expect(faceFor('answer-a', off)).toMatchObject({ title: 'DONE', tone: 'idle', hint: 'offline' });
    expect(faceFor('answer-b', off)).toMatchObject({ title: 'STOP', tone: 'idle', hint: 'offline' });
    expect(faceFor('answer-c', off)).toMatchObject({ title: 'DISCARD', tone: 'idle', hint: 'offline' });
  });

  it('PlanPress_AnswerADuringAnInterruption_BackInOnePress', () => {
    expect(planPress('answer-a', online(stateMessage(STATES.interruption)))).toEqual({ type: 'request', action: 'back' });
  });

  it('PlanPress_AnswerAWhileTheStandUpRuns_EndsIt', () => {
    const ctx = online(stateMessage(STATES['stand-up running']));
    expect(faceFor('answer-a', ctx)).toMatchObject({ title: 'END STAND-UP', hint: 'then MG-12' });
    expect(planPress('answer-a', ctx)).toEqual({ type: 'request', action: 'end-standup' });
  });

  it('ResolveKind_TheFixedKeys_ThemselvesWhateverIsAsked', () => {
    for (const kind of ['session', 'interrupt', 'previous', 'recent-1', 'done', 'yes'] as const) {
      expect(resolveKind(kind, online(asked('standup')))).toBe(kind);
    }
  });
});

describe('planPress', () => {
  it.each(KEY_KINDS)('PlanPress_%s_Offline_DoesNothing', kind => {
    expect(planPress(kind, { link: 'offline', message: null, now: NOW, armed: false })).toEqual({ type: 'none', reason: 'offline' });
    expect(planPress(kind, { link: 'incompatible', message: stateMessage(), now: NOW, armed: false })).toEqual({ type: 'none', reason: 'offline' });
  });

  it('PlanPress_SessionHeld_OpensThePickerWhateverTaskRuns', () => {
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

  it('PlanPress_SessionDuringAnInterruption_DoesNothingHeldOrNot', () => {
    // Pausing would end it, and choosing a task waits for its end (2026-11-12).
    const ctx = online(stateMessage(STATES.interruption));
    expect(planPress('session', ctx)).toEqual({ type: 'none', reason: 'nothing' });
    expect(planPress('session', ctx, true)).toEqual({ type: 'none', reason: 'nothing' });
  });

  it('PlanPress_NotDone_StopsTheSession', () => {
    expect(planPress('not-done', online(stateMessage({ session: session() })))).toEqual({ type: 'request', action: 'stop' });
    expect(planPress('not-done', online())).toEqual({ type: 'none', reason: 'nothing' });
  });

  it.each([
    ['the users task', false],
    ['a task no longer theirs', true]
  ])('PlanPress_DoneOn%s_AlwaysAsksThenConfirms', (_name, finishNeedsConfirmation) => {
    // DONE changes the ticket: two presses always (S29).
    const message = stateMessage({ session: session({ finishNeedsConfirmation }) });
    expect(planPress('done', online(message))).toEqual({ type: 'arm' });
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
    for (const prompt of PROMPTS) {
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
