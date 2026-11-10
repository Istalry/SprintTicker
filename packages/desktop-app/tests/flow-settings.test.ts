import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROMPT_DELAYS,
  DEFAULT_SHORTCUTS,
  DEFAULT_START_SIDE_EFFECTS,
  doneStateFor,
  readCloseToTray,
  readDoneStateByProject,
  readPromptDelays,
  readProviderDisplayName,
  readShortcuts,
  readStandupTask,
  readStartSideEffects
} from '../src/shared/flow-settings';

/** What the redesigned flows read from `settings`: never a throw, always a whole value. */
describe('flow settings', () => {
  it.each([undefined, null, 'x', 42, []])('Readers_NothingUsableStored_%s_AnswerTheDefaults', stored => {
    expect(readStartSideEffects(stored)).toEqual(DEFAULT_START_SIDE_EFFECTS);
    expect(readPromptDelays(stored)).toEqual(DEFAULT_PROMPT_DELAYS);
    expect(readShortcuts(stored)).toEqual(DEFAULT_SHORTCUTS);
    expect(readDoneStateByProject(stored)).toEqual({ default: null, overrides: {} });
    expect(readCloseToTray(stored)).toBe(true);
  });

  it('StartSideEffects_PartlyStored_FillsTheRest', () => {
    expect(readStartSideEffects({ enabled: false })).toEqual({ enabled: false, afterSeconds: 120 });
    expect(readStartSideEffects({ afterSeconds: -5 })).toEqual(DEFAULT_START_SIDE_EFFECTS);
    expect(readStartSideEffects({ afterSeconds: 0 })).toEqual({ enabled: true, afterSeconds: 0 });
  });

  it('PromptDelays_OutOfRange_KeepTheDefault', () => {
    expect(readPromptDelays({ nothingTiming: 0, longPause: 45, standupRunning: 1.5, interruptionRunning: 9999 })).toEqual({
      ...DEFAULT_PROMPT_DELAYS,
      longPause: 45
    });
  });

  it('DoneState_ProjectOverride_ThenDefault', () => {
    const setting = readDoneStateByProject({ default: 'To Review', overrides: { p2: 'Done', p3: '  ', p4: 7 } });

    expect(setting.overrides).toEqual({ p2: 'Done' });
    expect(doneStateFor(setting, 'p2')).toBe('Done');
    expect(doneStateFor(setting, 'p1')).toBe('To Review');
  });

  it('Shortcuts_AChordThatCannotRegister_GoesBackToTheDefault', () => {
    const read = readShortcuts({ switch: { enabled: false, accelerator: 'Shift+S' }, back: { accelerator: 'Ctrl+Alt+B' } });

    expect(read.switch).toEqual({ enabled: false, accelerator: DEFAULT_SHORTCUTS.switch.accelerator });
    expect(read.back).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+B' });
    expect(read.interrupt).toEqual(DEFAULT_SHORTCUTS.interrupt);
  });

  it('Names_BlankIsNone', () => {
    expect(readProviderDisplayName('  ')).toBeNull();
    expect(readProviderDisplayName(' Acme Tracker ')).toBe('Acme Tracker');
    expect(readStandupTask('')).toBeNull();
    expect(readStandupTask('adhoc_1')).toBe('adhoc_1');
    expect(readCloseToTray(false)).toBe(false);
  });
});
