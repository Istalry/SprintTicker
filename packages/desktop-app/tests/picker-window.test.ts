import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PickerScreenLike,
  PickerWindowLike,
  PickerWindowManager
} from '../src/main/windows/picker-window-manager';
import type { Rectangle } from '../src/main/windows/mini-window-manager';
import { PICKER_WINDOW_SIZE } from '../src/main/windows/window-constants';
import { PICKER_WINDOW_HASH, PickerWindowMode, pickerWindowHash, readPickerWindowHash } from '../src/shared/picker-window';
import { ArgumentNullException } from '../src/shared/dtos';

const PRIMARY: Rectangle = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND: Rectangle = { x: 1920, y: 0, width: 1280, height: 1024 };

/** A window that records what was done to it and fires its own events. */
class FakePickerWindow implements PickerWindowLike {
  public destroyed = false;
  public visible = false;
  public readonly shown = vi.fn();
  public readonly focused = vi.fn();
  public readonly handle = Buffer.alloc(8);
  private readonly handlers = new Map<string, Array<() => void>>();

  constructor(public readonly bounds: Rectangle, public readonly mode: PickerWindowMode) {}

  isDestroyed(): boolean { return this.destroyed; }
  isVisible(): boolean { return this.visible; }
  show(): void { this.visible = true; this.shown(); }
  focus(): void { this.focused(); }
  getNativeWindowHandle(): Buffer { return this.handle; }
  once(event: 'ready-to-show', listener: () => void): this { return this.on(event, listener); }
  on(event: string, listener: () => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
    return this;
  }
  /** As Electron does: destroyed, then 'closed'. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fire('closed');
  }
  fire(event: string): void {
    for (const l of this.handlers.get(event) ?? []) l();
  }
}

describe('PickerWindowManager', () => {
  let made: FakePickerWindow[];
  let createWindow: ReturnType<typeof vi.fn<(bounds: Rectangle, mode: PickerWindowMode) => PickerWindowLike>>;
  let raise: ReturnType<typeof vi.fn<(handle: Buffer) => Promise<boolean>>>;
  let fallback: ReturnType<typeof vi.fn<(mode: PickerWindowMode, raise: boolean) => boolean>>;
  let cursorOn: Rectangle;
  let manager: PickerWindowManager;

  const screen: PickerScreenLike = {
    getCursorScreenPoint: () => ({ x: cursorOn.x + 10, y: cursorOn.y + 10 }),
    getDisplayNearestPoint: () => ({ workArea: cursorOn })
  };

  beforeEach(() => {
    made = [];
    cursorOn = PRIMARY;
    createWindow = vi.fn((bounds: Rectangle, mode: PickerWindowMode) => {
      const win = new FakePickerWindow(bounds, mode);
      made.push(win);
      return win;
    });
    raise = vi.fn(async () => true);
    fallback = vi.fn(() => true);
    manager = new PickerWindowManager({ createWindow, screen, raiser: { raise }, fallback });
  });

  it('Constructor_MissingDependency_Throws', () => {
    expect(() => new PickerWindowManager(undefined as never)).toThrow(ArgumentNullException);
    expect(() => new PickerWindowManager({ createWindow, screen, raiser: { raise }, fallback: undefined as never }))
      .toThrow(ArgumentNullException);
    expect(() => new PickerWindowManager({ createWindow, screen, raiser: undefined as never, fallback }))
      .toThrow(ArgumentNullException);
  });

  it('Open_MakesTheWindowCentredOnTheDisplayThePointerIsOn', () => {
    cursorOn = SECOND;

    expect(manager.open('start')).toBe(true);

    const { width, height } = PICKER_WINDOW_SIZE;
    expect(made[0].bounds).toEqual({
      x: SECOND.x + (SECOND.width - width) / 2,
      y: SECOND.y + (SECOND.height - height) / 2,
      width,
      height
    });
    expect(made[0].mode).toBe('start');
  });

  it('Open_ShowsItOnlyWhenReady', () => {
    manager.open('start');
    expect(made[0].shown).not.toHaveBeenCalled();

    made[0].fire('ready-to-show');

    expect(made[0].shown).toHaveBeenCalled();
    expect(made[0].focused).toHaveBeenCalled();
  });

  it('Open_FromTheTrayOrTheMiniTimer_DoesNotAskWindowsForTheForeground', () => {
    // A click on either is the user's, and gives the app the foreground.
    manager.open('start');
    made[0].fire('ready-to-show');

    expect(raise).not.toHaveBeenCalled();
  });

  it('Open_WithRaise_RaisesItPastTheForegroundLock', () => {
    // A deck press reaches Stream Deck: focus() alone only flashes the taskbar.
    manager.open('start', { raise: true });
    made[0].fire('ready-to-show');

    expect(raise).toHaveBeenCalledWith(made[0].handle);
  });

  it('Open_Twice_SameMode_BringsTheOneForward', () => {
    manager.open('start');
    made[0].fire('ready-to-show');
    made[0].shown.mockClear();

    expect(manager.open('start', { raise: true })).toBe(true);

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(made[0].shown).toHaveBeenCalled();
    expect(raise).toHaveBeenCalledWith(made[0].handle);
  });

  it('Open_Twice_StillLoading_LeavesItToShowItself', () => {
    manager.open('start');

    manager.open('start');

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(made[0].shown).not.toHaveBeenCalled();
  });

  it('Open_AnotherMode_ReplacesTheWindow', () => {
    manager.open('start');

    manager.open('assign');

    expect(made).toHaveLength(2);
    expect(made[0].destroyed).toBe(true);
    expect(made[1].mode).toBe('assign');
    expect(manager.isOpen()).toBe(true);
  });

  it('Blur_ClosesIt', () => {
    manager.open('start');
    made[0].fire('ready-to-show');

    made[0].fire('blur');

    expect(made[0].destroyed).toBe(true);
    expect(manager.isOpen()).toBe(false);
  });

  it('Closed_ByTheUser_ANewOpenMakesANewWindow', () => {
    manager.open('start');
    made[0].destroy();

    manager.open('start');

    expect(made).toHaveLength(2);
  });

  it('Open_CreateThrows_FallsBackToTheMainWindowsPicker', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createWindow.mockImplementation(() => { throw new Error('no GPU process'); });

    expect(manager.open('assign', { raise: true })).toBe(true);

    expect(fallback).toHaveBeenCalledWith('assign', true);
    expect(manager.isOpen()).toBe(false);
  });

  it('Open_CreateThrowsAndNoMainWindow_AnswersFalse', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createWindow.mockImplementation(() => { throw new Error('no GPU process'); });
    fallback.mockReturnValue(false);

    expect(manager.open('start')).toBe(false);
  });

  it('Dispose_ClosesItAndIsSafeTwice', () => {
    manager.open('start');

    manager.dispose();
    manager.dispose();

    expect(made[0].destroyed).toBe(true);
    expect(manager.isOpen()).toBe(false);
  });

  it('ReadyToShow_AfterDispose_ShowsNothing', () => {
    manager.open('start');
    manager.dispose();

    made[0].fire('ready-to-show');

    expect(made[0].shown).not.toHaveBeenCalled();
  });

  it('Bounds_SmallDisplay_FitInsideIt', () => {
    cursorOn = { x: 0, y: 0, width: 500, height: 400 };

    manager.open('start');

    expect(made[0].bounds).toEqual({ x: 0, y: 0, width: 500, height: 400 });
  });
});

describe('the picker window hash', () => {
  it('PickerWindowHash_EachMode_ReadsBackAsItself', () => {
    for (const mode of ['start', 'assign'] as const) {
      expect(readPickerWindowHash(`#${pickerWindowHash(mode)}`)).toBe(mode);
    }
    expect(pickerWindowHash('start')).toBe(PICKER_WINDOW_HASH);
  });

  it('ReadPickerWindowHash_OtherHashes_AreNotThePicker', () => {
    expect(readPickerWindowHash('')).toBeNull();
    expect(readPickerWindowHash('#mini')).toBeNull();
    expect(readPickerWindowHash('#pickers')).toBeNull();
  });

  it('ReadPickerWindowHash_Place_IsPlace', () => {
    // The mini timer's ↳ (P12d).
    expect(readPickerWindowHash(`#${pickerWindowHash('place')}`)).toBe('place');
  });

  it('ReadPickerWindowHash_UnknownMode_OpensStart', () => {
    expect(readPickerWindowHash('#picker?mode=elsewhere')).toBe('start');
  });
});
