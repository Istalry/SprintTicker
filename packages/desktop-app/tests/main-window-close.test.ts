import { describe, it, expect, vi } from 'vitest';
import { CLOSE_TO_TRAY_TOLD_KEY, MainWindowCloseGuard, MainWindowCloseDeps, STILL_RUNNING_TOAST } from '../src/main/windows/main-window-close';

/** The dashboard's close (P12a): hidden to the tray, never holding a quit. */
describe('MainWindowCloseGuard', () => {
  function guard(over: Partial<MainWindowCloseDeps> = {}) {
    const stored = new Map<string, unknown>();
    const deps: MainWindowCloseDeps = {
      closeToTray: () => true,
      isQuitting: () => false,
      hide: vi.fn(),
      settings: {
        getSetting: <T,>(key: string, fallback: T) => (stored.has(key) ? (stored.get(key) as T) : fallback),
        setSetting: (key: string, value: unknown) => { stored.set(key, value); }
      },
      toasts: { show: vi.fn(() => true) },
      ...over
    };
    return { guard: new MainWindowCloseGuard(deps), deps, stored };
  }
  const closeEvent = () => ({ preventDefault: vi.fn() });

  it('OnClose_KeepRunning_HidesInsteadOfClosing', () => {
    const { guard: g, deps } = guard();
    const event = closeEvent();

    expect(g.onClose(event)).toBe('hidden');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(deps.hide).toHaveBeenCalled();
  });

  it('OnClose_FirstTime_SaysWhereTheAppWent_ThenNeverAgain', () => {
    const { guard: g, deps } = guard();

    g.onClose(closeEvent());
    g.onClose(closeEvent());

    expect(deps.toasts!.show).toHaveBeenCalledTimes(1);
    expect(deps.toasts!.show).toHaveBeenCalledWith(expect.objectContaining(STILL_RUNNING_TOAST));
  });

  it('OnClose_ToastClicked_OpensTheWindowOnToday', () => {
    const { guard: g, deps } = guard();

    g.onClose(closeEvent());

    expect(vi.mocked(deps.toasts!.show).mock.calls[0][0].route).toBe('today');
  });

  it('OnClose_ToastNotShown_TellsAtTheNextClose', () => {
    // A toast Windows did not take has told nobody.
    const show = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const { guard: g, stored } = guard({ toasts: { show } });

    g.onClose(closeEvent());
    expect(stored.get(CLOSE_TO_TRAY_TOLD_KEY)).toBeUndefined();
    g.onClose(closeEvent());

    expect(show).toHaveBeenCalledTimes(2);
    expect(stored.get(CLOSE_TO_TRAY_TOLD_KEY)).toBe(true);
  });

  it('OnClose_WhileQuitting_Closes', () => {
    // The tray's Quit, and Windows shutting down -- End my day's shutdown
    // included -- must never be held by a window that only hides.
    const { guard: g, deps } = guard({ isQuitting: () => true });
    const event = closeEvent();

    expect(g.onClose(event)).toBe('closing');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(deps.hide).not.toHaveBeenCalled();
  });

  it('OnClose_UserChoseQuit_Closes', () => {
    const { guard: g, deps } = guard({ closeToTray: () => false });
    const event = closeEvent();

    expect(g.onClose(event)).toBe('closing');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(deps.toasts!.show).not.toHaveBeenCalled();
  });
});
