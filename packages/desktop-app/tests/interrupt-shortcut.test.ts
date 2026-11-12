import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { InterruptShortcutService, ShortcutRegistry } from '../src/main/services/interrupt-shortcut-service';
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

describe('InterruptShortcutService', () => {
  let db: DatabaseConnection;
  let settings: SettingsRepository;
  let held: Map<string, () => void>;
  let taken: Set<string>;
  let shortcuts: ShortcutRegistry & { register: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn> };
  let toasts: ToastPresenter & { show: ReturnType<typeof vi.fn> };
  let interrupt: ReturnType<typeof vi.fn>;
  let seen: boolean;
  let current: ActiveSessionDTO | null;

  const make = () => new InterruptShortcutService({
    shortcuts, settings, interrupt, toasts,
    getCurrentSession: () => current,
    isSeen: () => seen
  });

  beforeEach(() => {
    db = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(db);
    held = new Map();
    taken = new Set();
    shortcuts = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        if (taken.has(accelerator)) return false;
        held.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => { held.delete(accelerator); })
    };
    toasts = { show: vi.fn().mockReturnValue(true) };
    interrupt = vi.fn().mockReturnValue({ ...SESSION, taskKey: 'adhoc_1', isAdHoc: true });
    seen = false;
    current = SESSION;
  });

  afterEach(() => db.close());

  it('Start_Default_RegistersNothing', () => {
    const service = make();
    service.start();

    expect(shortcuts.register).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual({ enabled: false, accelerator: 'Ctrl+Alt+Shift+I', registered: false, problem: null });
  });

  it('Start_StoredOn_RegistersTheChord', () => {
    settings.setSetting(INTERRUPT_SHORTCUT_KEY, { enabled: true, accelerator: 'Ctrl+Shift+F9' });
    const service = make();
    service.start();

    expect([...held.keys()]).toEqual(['Ctrl+Shift+F9']);
    expect(service.getStatus().registered).toBe(true);
  });

  it('Start_StoredChordNoLongerValid_UsesTheDefault', () => {
    settings.setSetting(INTERRUPT_SHORTCUT_KEY, { enabled: true, accelerator: 'Shift+I' });
    make().start();

    expect([...held.keys()]).toEqual(['Ctrl+Alt+Shift+I']);
  });

  it('Set_On_StoresAndRegisters', () => {
    const service = make();

    expect(service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' }))
      .toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I', registered: true, problem: null });
    expect(settings.getSetting(INTERRUPT_SHORTCUT_KEY, null)).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });
  });

  it('Set_NewChord_LetsGoOfTheOldOne', () => {
    const service = make();
    service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });
    service.set({ enabled: true, accelerator: 'Ctrl+Shift+F9' });

    expect([...held.keys()]).toEqual(['Ctrl+Shift+F9']);
  });

  it('Set_Off_Unregisters', () => {
    const service = make();
    service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });

    expect(service.set({ enabled: false, accelerator: 'Ctrl+Alt+Shift+I' }).registered).toBe(false);
    expect(held.size).toBe(0);
  });

  it('Set_ChordAnotherAppHolds_StoredOnButSaysTaken', () => {
    taken.add('Ctrl+Alt+Shift+I');
    const service = make();

    expect(service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' }))
      .toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I', registered: false, problem: 'taken' });
  });

  it('Set_TakenThenAnother_TheProblemGoes', () => {
    taken.add('Ctrl+Alt+Shift+I');
    const service = make();
    service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });

    expect(service.set({ enabled: true, accelerator: 'Ctrl+Shift+F9' }).problem).toBeNull();
  });

  it('Set_ElectronThrows_ReadsAsNotRegistered', () => {
    shortcuts.register.mockImplementation(() => { throw new Error('conversion failure'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = make();

    expect(service.set({ enabled: true, accelerator: 'Ctrl+Pause' }).problem).toBe('taken');
    warn.mockRestore();
  });

  it.each([
    ['an invalid chord', { enabled: true, accelerator: 'Shift+I' }, /Shift only types capitals/],
    ['enabled not a boolean', { enabled: 'true', accelerator: 'Ctrl+Alt+Shift+I' }, /on or off/],
    ['no chord', { enabled: true }, /chord/]
  ])('Set_%s_RefusedAndNothingStored', (_label, setting, message) => {
    const service = make();

    expect(() => service.set(setting as never)).toThrow(message);
    expect(settings.getSetting(INTERRUPT_SHORTCUT_KEY, null)).toBeNull();
    expect(shortcuts.register).not.toHaveBeenCalled();
  });

  it('SetRecording_LetsGoUntilDone', () => {
    // Registered, Windows would take the press the window is recording.
    const service = make();
    service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });

    service.setRecording(true);
    expect(held.size).toBe(0);
    service.set({ enabled: true, accelerator: 'Ctrl+Shift+F9' });
    expect(held.size).toBe(0);

    expect(service.setRecording(false).registered).toBe(true);
    expect([...held.keys()]).toEqual(['Ctrl+Shift+F9']);
  });

  it('Dispose_Unregisters', () => {
    const service = make();
    service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });

    service.dispose();

    expect(shortcuts.unregister).toHaveBeenCalledWith('Ctrl+Alt+Shift+I');
    expect(held.size).toBe(0);
  });

  describe('a press', () => {
    const pressIt = (service: InterruptShortcutService) => {
      service.set({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });
      held.get('Ctrl+Alt+Shift+I')!();
    };

    it('Press_Unseen_InterruptsAndToastsTheTaskPaused', () => {
      pressIt(make());

      expect(interrupt).toHaveBeenCalledTimes(1);
      expect(toasts.show).toHaveBeenCalledWith({
        title: 'Interruption started',
        body: 'SCRUM-12 is paused until you are back. Place it on a task when it ends.',
        route: 'today'
      });
    });

    it('Press_DuringAnInterruption_ToastsAnother', () => {
      current = {
        ...SESSION,
        isAdHoc: true,
        interruption: {
          id: 'int_1', name: null, title: 'Interruption 10:30', startedAtUtc: '2026-10-14T08:30:00.000Z', index: 1,
          source: 'window', interruptedSessionId: 's1', interruptedTaskKey: 'SCRUM-12', interruptedTaskTitle: 'T',
          interruptedWasPaused: false
        }
      };
      pressIt(make());

      expect(toasts.show).toHaveBeenCalledWith({
        title: 'Another interruption started',
        body: 'SCRUM-12 still waits, paused. Place it on a task when it ends.',
        route: 'today'
      });
    });

    it('Press_AdHocBefore_NamesItByTitle', () => {
      current = { ...SESSION, taskKey: 'adhoc_9', taskTitle: 'Call with Marc', isAdHoc: true };
      pressIt(make());

      expect(toasts.show.mock.calls[0][0].body).toMatch(/^Call with Marc is paused/);
    });

    it('Press_NothingRunning_NoTaskNamed', () => {
      current = null;
      pressIt(make());

      expect(toasts.show.mock.calls[0][0].body).toBe('Place it on a task when it ends.');
    });

    it('Press_Seen_NoToast', () => {
      // The window, the mini timer or the bar shows the new timer already.
      seen = true;
      pressIt(make());

      expect(interrupt).toHaveBeenCalledTimes(1);
      expect(toasts.show).not.toHaveBeenCalled();
    });

    it('Press_InterruptRefused_ToastsWhy', () => {
      interrupt.mockImplementation(() => { throw new Error('The schedule service is not running.'); });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      pressIt(make());

      expect(toasts.show).toHaveBeenCalledWith({ title: 'No interruption started', body: 'The schedule service is not running.', route: 'today' });
      warn.mockRestore();
    });
  });
});
