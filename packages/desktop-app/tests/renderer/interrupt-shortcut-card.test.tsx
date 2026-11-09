import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InterruptShortcutCard } from '../../src/renderer/components/InterruptShortcutCard';
import { installElectronApi } from './electron-api-mock';

const checkbox = () => screen.getByRole('checkbox', { name: /Use the shortcut/ }) as HTMLInputElement;
const status = (over: Record<string, unknown> = {}) => ({
  enabled: false, accelerator: 'Ctrl+Alt+Shift+I', registered: false, problem: null, ...over
});

describe('InterruptShortcutCard', () => {
  it('Mount_OffByDefault_ShowsTheSuggestedChord', async () => {
    installElectronApi();
    render(<InterruptShortcutCard />);

    await vi.waitFor(() => expect(checkbox().disabled).toBe(false));
    expect(checkbox().checked).toBe(false);
    expect(screen.getByText('Ctrl+Alt+Shift+I')).toBeTruthy();
  });

  it('Toggle_On_RegistersTheChordShown', async () => {
    const bridge = installElectronApi();
    render(<InterruptShortcutCard />);
    await vi.waitFor(() => expect(checkbox().disabled).toBe(false));

    fireEvent.click(checkbox());

    await vi.waitFor(() => expect(checkbox().checked).toBe(true));
    expect(bridge.api.setInterruptShortcut).toHaveBeenCalledWith({ enabled: true, accelerator: 'Ctrl+Alt+Shift+I' });
  });

  it('Taken_SaysNotActive', async () => {
    // On, but Windows gave the chord to another app: never shown as working.
    installElectronApi({ getInterruptShortcut: vi.fn().mockResolvedValue(status({ enabled: true, problem: 'taken' })) });
    render(<InterruptShortcutCard />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not active: another app holds Ctrl\+Alt\+Shift\+I/);
  });

  it('Record_NewChord_LetsGoThenStoresAndRegisters', async () => {
    const bridge = installElectronApi({
      getInterruptShortcut: vi.fn().mockResolvedValue(status({ enabled: true, registered: true })),
      setInterruptShortcutRecording: vi.fn().mockResolvedValue(status({ enabled: true, accelerator: 'Ctrl+Shift+F9', registered: true }))
    });
    render(<InterruptShortcutCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    expect(bridge.api.setInterruptShortcutRecording).toHaveBeenCalledWith(true);

    const field = screen.getByRole('textbox', { name: 'Press the new shortcut' });
    fireEvent.keyDown(field, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.keyDown(field, { key: 'F9', code: 'F9', ctrlKey: true, shiftKey: true });

    await vi.waitFor(() => expect(bridge.api.setInterruptShortcutRecording).toHaveBeenLastCalledWith(false));
    expect(bridge.api.setInterruptShortcut).toHaveBeenCalledWith({ enabled: true, accelerator: 'Ctrl+Shift+F9' });
    expect(await screen.findByText('Ctrl+Shift+F9')).toBeTruthy();
  });

  it('Record_ShiftOnly_RefusedAndStillRecording', async () => {
    const bridge = installElectronApi();
    render(<InterruptShortcutCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'I', code: 'KeyI', shiftKey: true });

    expect(screen.getByRole('alert').textContent).toMatch(/Shift only types capitals/);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(bridge.api.setInterruptShortcut).not.toHaveBeenCalled();
  });

  it('Record_Escape_GivesTheChordBack', async () => {
    const bridge = installElectronApi();
    render(<InterruptShortcutCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', code: 'Escape' });

    await vi.waitFor(() => expect(bridge.api.setInterruptShortcutRecording).toHaveBeenLastCalledWith(false));
    expect(bridge.api.setInterruptShortcut).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('CtrlAltAlone_CautionsAboutAltGr', async () => {
    installElectronApi({ getInterruptShortcut: vi.fn().mockResolvedValue(status({ accelerator: 'Ctrl+Alt+E' })) });
    render(<InterruptShortcutCard />);

    expect(await screen.findByText(/AltGr/)).toBeTruthy();
  });

  it('SetRefused_SaysWhy', async () => {
    installElectronApi({ setInterruptShortcut: vi.fn().mockRejectedValue(new Error('A shortcut needs Ctrl, Alt or Win')) });
    render(<InterruptShortcutCard />);
    await vi.waitFor(() => expect(checkbox().disabled).toBe(false));

    fireEvent.click(checkbox());

    expect(await screen.findByText(/Could not change it: .*needs Ctrl, Alt or Win/)).toBeTruthy();
    expect(checkbox().checked).toBe(false);
  });
});
