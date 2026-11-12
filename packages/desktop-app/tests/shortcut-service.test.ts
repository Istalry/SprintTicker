import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ShortcutCommands, ShortcutRegistry, ShortcutService } from '../src/main/services/shortcut-service';
import { FlowSettingKey } from '../src/shared/flow-settings';
import { ToastPresenter } from '../src/main/services/toast-presenter';
import { ActiveSessionDTO } from '../src/shared/dtos';
import {
  acceleratorFromKeyEvent,
  chordCaution,
  chordProblem,
  ChordKeyEvent,
  describeAccelerator,
  INTERRUPT_SHORTCUT_KEY
} from '../src/shared/interrupt-shortcut';

const press = (over: Partial<ChordKeyEvent>): ChordKeyEvent => ({
  key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over
});

describe('the chord rules', () => {
  it.each(['Ctrl+Alt+Shift+I', 'Ctrl+Shift+F12', 'Alt+Space', 'Super+1', 'Ctrl+Alt+Shift+Super+Pause'])(
    'ChordProblem_%s_None', accelerator => {
      expect(chordProblem(accelerator)).toBeNull();
    });

  it.each([
    ['a bare key', 'I'],
    ['Shift alone', 'Shift+I'],
    ['a modifier twice', 'Ctrl+Ctrl+I'],
    ['modifiers out of order', 'Shift+Ctrl+I'],
    ['no key', 'Ctrl+Alt'],
    ['a key Electron has no name for', 'Ctrl+é'],
    ['nothing', '']
  ])('ChordProblem_%s_Refused', (_label, accelerator) => {
    expect(chordProblem(accelerator)).not.toBeNull();
  });

  it('ChordCaution_CtrlAltAlone_SaysAltGr', () => {
    expect(chordCaution('Ctrl+Alt+E')).toMatch(/AltGr/);
    expect(chordCaution('Ctrl+Alt+Shift+E')).toBeNull();
  });

  it('DescribeAccelerator_Super_ReadsWin', () => {
    expect(describeAccelerator('Ctrl+Super+I')).toBe('Ctrl+Win+I');
  });
});

describe('recording a chord', () => {
  it('AcceleratorFromKeyEvent_ModifiersOnly_WaitsForTheKey', () => {
    expect(acceleratorFromKeyEvent(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
  });

  it('AcceleratorFromKeyEvent_Letter_ModifiersInElectronsOrder', () => {
    expect(acceleratorFromKeyEvent(press({ key: 'I', code: 'KeyI', ctrlKey: true, altKey: true, shiftKey: true })))
      .toBe('Ctrl+Alt+Shift+I');
  });

  it('AcceleratorFromKeyEvent_Azerty_TheLetterOnTheKey', () => {
    // AZERTY's A sits where QWERTY has Q; Windows' virtual key is A.
    expect(acceleratorFromKeyEvent(press({ key: 'a', code: 'KeyQ', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+A');
  });

  it('AcceleratorFromKeyEvent_AltGrCharacter_FallsBackToTheCode', () => {
    expect(acceleratorFromKeyEvent(press({ key: '€', code: 'KeyE', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+E');
  });

  it('AcceleratorFromKeyEvent_AzertyDigit_FromTheCode', () => {
    expect(acceleratorFromKeyEvent(press({ key: '&', code: 'Digit1', ctrlKey: true, altKey: true, shiftKey: true })))
      .toBe('Ctrl+Alt+Shift+1');
  });

  it('AcceleratorFromKeyEvent_NamedKeys_ElectronsNames', () => {
    expect(acceleratorFromKeyEvent(press({ key: 'F9', code: 'F9', metaKey: true }))).toBe('Super+F9');
    expect(acceleratorFromKeyEvent(press({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }))).toBe('Alt+Up');
    expect(acceleratorFromKeyEvent(press({ key: ' ', code: 'Space', ctrlKey: true }))).toBe('Ctrl+Space');
  });
});

const SESSION: ActiveSessionDTO = {
  sessionId: 's1', projectId: 'p1', taskId: 't1', taskKey: 'SCRUM-12', taskTitle: 'Login page', isAdHoc: false, status: 'TRACKING'
} as ActiveSessionDTO;

const INTERRUPTED: ActiveSessionDTO = {
  ...SESSION,
  isAdHoc: true,
  interruption: {
    id: 'int_1', name: null, title: 'Interruption 10:30', startedAtUtc: '2026-10-14T08:30:00.000Z', index: 1,
    source: 'window', interruptedSessionId: 's1', interruptedTaskKey: 'SCRUM-12', interruptedTaskTitle: 'T',
    interruptedWasPaused: false
  }
};

const DEFAULT_CHORDS = ['Ctrl+Alt+Shift+I', 'Ctrl+Alt+Shift+S', 'Ctrl+Alt+Shift+P', 'Ctrl+Alt+Shift+B'];

/** The four global shortcuts (P12e). */
describe('ShortcutService', () => {
  let db: DatabaseConnection;
  let settings: SettingsRepository;
  let held: Map<string, () => void>;
  let taken: Set<string>;
  let shortcuts: ShortcutRegistry & { register: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn> };
  let toasts: ToastPresenter & { show: ReturnType<typeof vi.fn> };
  let commands: { [K in keyof ShortcutCommands]: ReturnType<typeof vi.fn> };
  let seen: boolean;
  let current: ActiveSessionDTO | null;

  const make = () => new ShortcutService({
    shortcuts, settings, toasts,
    commands: commands as unknown as ShortcutCommands,
    getCurrentSession: () => current,
    isSeen: () => seen
  });
  const stored = () => settings.getSetting<Record<string, { enabled: boolean; accelerator: string }> | null>(FlowSettingKey.SHORTCUTS, null);

  beforeEach(() => {
    db = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(db);
    held = new Map();
    taken = new Set();
    shortcuts = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        if (taken.has(accelerator) || held.has(accelerator)) return false;
        held.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => { held.delete(accelerator); })
    };
    toasts = { show: vi.fn().mockReturnValue(true) };
    commands = {
      interrupt: vi.fn().mockReturnValue({ ...SESSION, taskKey: 'adhoc_1', isAdHoc: true }),
      back: vi.fn().mockReturnValue(SESSION),
      openPicker: vi.fn(),
      previous: vi.fn().mockReturnValue('PF-31')
    };
    seen = false;
    current = SESSION;
  });

  afterEach(() => db.close());

  describe('registering', () => {
    it('Start_Default_AllFourOn', () => {
      // On by default (the redesign's decision, 2026-11-09).
      const service = make();
      service.start();

      expect([...held.keys()]).toEqual(DEFAULT_CHORDS);
      expect(Object.values(service.getStatus()).every(s => s.enabled && s.registered && s.problem === null)).toBe(true);
    });

    it('Start_OldInterruptChordOn_CarriesOverOnce', () => {
      settings.setSetting(INTERRUPT_SHORTCUT_KEY, { enabled: true, accelerator: 'Ctrl+Shift+F9' });
      make().start();

      expect(stored()?.interrupt).toEqual({ enabled: true, accelerator: 'Ctrl+Shift+F9' });
      expect(settings.getSetting(INTERRUPT_SHORTCUT_KEY, null)).toBeNull();
      expect(held.has('Ctrl+Shift+F9')).toBe(true);
    });

    it('Start_OldInterruptChordTurnedOff_StaysOff', () => {
      // The user's own off, before the default became on.
      settings.setSetting(INTERRUPT_SHORTCUT_KEY, { enabled: false, accelerator: 'Ctrl+Alt+Shift+I' });
      const service = make();
      service.start();

      expect(service.getStatus().interrupt.enabled).toBe(false);
      expect(held.has('Ctrl+Alt+Shift+I')).toBe(false);
      expect(held.size).toBe(3);
    });

    it('Start_OldChordIsAnotherShortcuts_KeepsTheDefault', () => {
      settings.setSetting(INTERRUPT_SHORTCUT_KEY, { enabled: true, accelerator: 'Ctrl+Alt+Shift+S' });
      make().start();

      expect(stored()?.interrupt.accelerator).toBe('Ctrl+Alt+Shift+I');
    });

    it('Start_ShortcutsAlreadyStored_TheOldKeyIsDroppedUnread', () => {
      settings.setSetting(FlowSettingKey.SHORTCUTS, { interrupt: { enabled: true, accelerator: 'Ctrl+Shift+F8' } });
      settings.setSetting(INTERRUPT_SHORTCUT_KEY, { enabled: true, accelerator: 'Ctrl+Shift+F9' });
      make().start();

      expect(held.has('Ctrl+Shift+F8')).toBe(true);
      expect(held.has('Ctrl+Shift+F9')).toBe(false);
      expect(settings.getSetting(INTERRUPT_SHORTCUT_KEY, null)).toBeNull();
    });

    it('Start_StoredChordNoLongerValid_UsesTheDefault', () => {
      settings.setSetting(FlowSettingKey.SHORTCUTS, { back: { enabled: true, accelerator: 'Shift+B' } });
      make().start();

      expect(held.has('Ctrl+Alt+Shift+B')).toBe(true);
    });

    it('Set_NewChord_StoresAndLetsGoOfTheOldOne', () => {
      const service = make();
      service.start();

      const status = service.set('switch', { enabled: true, accelerator: 'Ctrl+Shift+F9' });

      expect(status.switch).toEqual({ enabled: true, accelerator: 'Ctrl+Shift+F9', registered: true, problem: null });
      expect(held.has('Ctrl+Alt+Shift+S')).toBe(false);
      expect(stored()?.switch).toEqual({ enabled: true, accelerator: 'Ctrl+Shift+F9' });
      expect(stored()?.interrupt).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });
    });

    it('Set_Off_UnregistersThatOneAlone', () => {
      const service = make();
      service.start();

      expect(service.set('previous', { enabled: false, accelerator: 'Ctrl+Alt+Shift+P' }).previous.registered).toBe(false);
      expect(held.has('Ctrl+Alt+Shift+P')).toBe(false);
      expect(held.size).toBe(3);
    });

    it('Set_ChordAnotherAppHolds_StoredOnButSaysTaken', () => {
      taken.add('Ctrl+Shift+F9');
      const service = make();

      expect(service.set('back', { enabled: true, accelerator: 'Ctrl+Shift+F9' }).back)
        .toEqual({ enabled: true, accelerator: 'Ctrl+Shift+F9', registered: false, problem: 'taken' });
    });

    it('Set_ChordAnotherShortcutHolds_Refused', () => {
      // One press, one action.
      const service = make();
      service.start();

      expect(() => service.set('back', { enabled: true, accelerator: 'Ctrl+Alt+Shift+I' })).toThrow(/already Interrupt's/);
      expect(stored()).toBeNull();
    });

    it('Set_ElectronThrows_ReadsAsNotRegistered', () => {
      shortcuts.register.mockImplementation(() => { throw new Error('conversion failure'); });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const service = make();

      expect(service.set('interrupt', { enabled: true, accelerator: 'Ctrl+Pause' }).interrupt.problem).toBe('taken');
      warn.mockRestore();
    });

    it.each([
      ['an invalid chord', 'interrupt', { enabled: true, accelerator: 'Shift+I' }, /Shift only types capitals/],
      ['enabled not a boolean', 'interrupt', { enabled: 'true', accelerator: 'Ctrl+Alt+Shift+I' }, /on or off/],
      ['no chord', 'interrupt', { enabled: true }, /chord/],
      ['not a shortcut', 'pause', { enabled: true, accelerator: 'Ctrl+Alt+Shift+Q' }, /Not a shortcut/]
    ])('Set_%s_RefusedAndNothingStored', (_label, action, chord, message) => {
      const service = make();

      expect(() => service.set(action as never, chord as never)).toThrow(message);
      expect(stored()).toBeNull();
      expect(shortcuts.register).not.toHaveBeenCalled();
    });

    it('SetRecording_LetsGoOfEveryChordUntilDone', () => {
      // Registered, Windows would take the press the window is recording.
      const service = make();
      service.start();

      service.setRecording(true);
      expect(held.size).toBe(0);
      service.set('interrupt', { enabled: true, accelerator: 'Ctrl+Shift+F9' });
      expect(held.size).toBe(0);

      expect(service.setRecording(false).interrupt.registered).toBe(true);
      expect([...held.keys()]).toEqual(['Ctrl+Shift+F9', ...DEFAULT_CHORDS.slice(1)]);
    });

    it('Dispose_UnregistersThemAll', () => {
      const service = make();
      service.start();

      service.dispose();

      expect(held.size).toBe(0);
      expect(shortcuts.unregister).toHaveBeenCalledTimes(4);
    });
  });

  describe('a press', () => {
    const pressIt = (chord: string) => {
      make().start();
      held.get(chord)!();
    };

    it('Interrupt_Unseen_InterruptsAndToastsTheTaskPaused', () => {
      pressIt('Ctrl+Alt+Shift+I');

      expect(commands.interrupt).toHaveBeenCalledTimes(1);
      expect(toasts.show).toHaveBeenCalledWith({
        title: 'Interruption started',
        body: 'SCRUM-12 is paused until you are back. Place it on a task when it ends.',
        route: 'today'
      });
    });

    it('Interrupt_DuringAnInterruption_ToastsAnother', () => {
      current = INTERRUPTED;
      pressIt('Ctrl+Alt+Shift+I');

      expect(toasts.show).toHaveBeenCalledWith({
        title: 'Another interruption started',
        body: 'SCRUM-12 still waits, paused. Place it on a task when it ends.',
        route: 'today'
      });
    });

    it('Interrupt_AdHocBefore_NamesItByTitle', () => {
      current = { ...SESSION, taskKey: 'adhoc_9', taskTitle: 'Call with Marc', isAdHoc: true };
      pressIt('Ctrl+Alt+Shift+I');

      expect(toasts.show.mock.calls[0][0].body).toMatch(/^Call with Marc is paused/);
    });

    it('Interrupt_NothingRunning_NoTaskNamed', () => {
      current = null;
      pressIt('Ctrl+Alt+Shift+I');

      expect(toasts.show.mock.calls[0][0].body).toBe('Place it on a task when it ends.');
    });

    it('Interrupt_Seen_NoToast', () => {
      // The window, the mini timer or the bar shows the new timer already.
      seen = true;
      pressIt('Ctrl+Alt+Shift+I');

      expect(commands.interrupt).toHaveBeenCalledTimes(1);
      expect(toasts.show).not.toHaveBeenCalled();
    });

    it('Interrupt_Refused_ToastsWhy', () => {
      commands.interrupt.mockImplementation(() => { throw new Error('The schedule service is not running.'); });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      pressIt('Ctrl+Alt+Shift+I');

      expect(toasts.show).toHaveBeenCalledWith({ title: 'No interruption started', body: 'The schedule service is not running.', route: 'today' });
      warn.mockRestore();
    });

    it('Back_DuringAnInterruption_GoesBackAndSaysSo', () => {
      current = INTERRUPTED;
      pressIt('Ctrl+Alt+Shift+B');

      expect(commands.back).toHaveBeenCalledTimes(1);
      expect(toasts.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Back on SCRUM-12', route: 'today' }));
    });

    it('Back_OutsideAnInterruption_DoesNothing', () => {
      pressIt('Ctrl+Alt+Shift+B');

      expect(commands.back).not.toHaveBeenCalled();
      expect(toasts.show).not.toHaveBeenCalled();
    });

    it('Back_InterruptionHoldingNothing_DoesNothing', () => {
      current = { ...INTERRUPTED, interruption: { ...INTERRUPTED.interruption!, interruptedSessionId: null, interruptedTaskKey: null } };
      pressIt('Ctrl+Alt+Shift+B');

      expect(commands.back).not.toHaveBeenCalled();
    });

    it('Switch_OpensThePicker_NoToast', () => {
      pressIt('Ctrl+Alt+Shift+S');

      expect(commands.openPicker).toHaveBeenCalledTimes(1);
      expect(toasts.show).not.toHaveBeenCalled();
    });

    it('Previous_StartsIt_AndSaysWhich', () => {
      pressIt('Ctrl+Alt+Shift+P');

      expect(commands.previous).toHaveBeenCalledTimes(1);
      expect(toasts.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Back on PF-31' }));
    });

    it('Previous_NoneBefore_NoToast', () => {
      commands.previous.mockReturnValue(null);
      pressIt('Ctrl+Alt+Shift+P');

      expect(toasts.show).not.toHaveBeenCalled();
    });

    it('Previous_DuringAnInterruption_DoesNothing', () => {
      // As the tray's: none during an interruption.
      current = INTERRUPTED;
      pressIt('Ctrl+Alt+Shift+P');

      expect(commands.previous).not.toHaveBeenCalled();
    });

    it('Previous_Fails_ToastsWhy', () => {
      commands.previous.mockImplementation(() => { throw new Error('The task is gone.'); });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      pressIt('Ctrl+Alt+Shift+P');

      expect(toasts.show).toHaveBeenCalledWith({ title: 'The previous task did not start', body: 'The task is gone.', route: 'today' });
      warn.mockRestore();
    });
  });
});
