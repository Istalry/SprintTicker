import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ShortcutSettings } from '../../src/renderer/components/ShortcutSettings';
import { installElectronApi, SHORTCUTS } from './electron-api-mock';
import type { ShortcutsStatusDTO } from '../../src/shared/dtos';

const checkbox = (name: string) => screen.getByRole('switch', { name: `Use the shortcut for ${name}` }) as HTMLInputElement;
const row = (name: string) => screen.getByRole('group', { name: `${name} shortcut` });
const withInterrupt = (over: Record<string, unknown>): ShortcutsStatusDTO => ({ ...SHORTCUTS, interrupt: { ...SHORTCUTS.interrupt, ...over } });

/** The four global shortcuts (P12e): on by default, each recorded on its own. */
describe('ShortcutSettings', () => {
  it('Mount_FourShortcuts_OnWithTheirChords', async () => {
    installElectronApi();
    render(<ShortcutSettings />);

    await vi.waitFor(() => expect(checkbox('Interrupt').disabled).toBe(false));
    for (const [name, chord] of [
      ['Interrupt', 'Ctrl+Alt+Shift+I'], ['Switch task', 'Ctrl+Alt+Shift+S'],
      ['Previous task', 'Ctrl+Alt+Shift+P'], ['Back', 'Ctrl+Alt+Shift+B']
    ]) {
      expect(checkbox(name).checked).toBe(true);
      expect(within(row(name)).getByText(chord)).toBeTruthy();
    }
  });

  it('Toggle_Off_StoresThatShortcutAlone', async () => {
    const bridge = installElectronApi();
    render(<ShortcutSettings />);
    await vi.waitFor(() => expect(checkbox('Back').disabled).toBe(false));

    fireEvent.click(checkbox('Back'));

    await vi.waitFor(() => expect(checkbox('Back').checked).toBe(false));
    expect(bridge.api.setShortcut).toHaveBeenCalledWith('back', { enabled: false, accelerator: 'Ctrl+Alt+Shift+B' });
    expect(checkbox('Interrupt').checked).toBe(true);
  });

  it('Taken_SaysNotActive_OnItsRow', async () => {
    // On, but Windows gave the chord to another app: never shown as working.
    installElectronApi({ getShortcuts: vi.fn().mockResolvedValue(withInterrupt({ registered: false, problem: 'taken' })) });
    render(<ShortcutSettings />);

    await screen.findByText(/Not active: another app holds Ctrl\+Alt\+Shift\+I/);
    expect(within(row('Interrupt')).getByRole('alert')).toBeTruthy();
    expect(within(row('Back')).queryByRole('alert')).toBeNull();
  });

  it('Record_NewChord_LetsGoThenStoresAndRegisters', async () => {
    const after = { ...SHORTCUTS, switch: { ...SHORTCUTS.switch, accelerator: 'Ctrl+Shift+F9' } };
    const bridge = installElectronApi({ setShortcutsRecording: vi.fn().mockResolvedValue(after) });
    render(<ShortcutSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the shortcut for Switch task' }));
    expect(bridge.api.setShortcutsRecording).toHaveBeenCalledWith(true);

    const field = screen.getByRole('textbox', { name: 'Press the new shortcut for Switch task' });
    fireEvent.keyDown(field, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.keyDown(field, { key: 'F9', code: 'F9', ctrlKey: true, shiftKey: true });

    await vi.waitFor(() => expect(bridge.api.setShortcutsRecording).toHaveBeenLastCalledWith(false));
    expect(bridge.api.setShortcut).toHaveBeenCalledWith('switch', { enabled: true, accelerator: 'Ctrl+Shift+F9' });
    expect(await within(row('Switch task')).findByText('Ctrl+Shift+F9')).toBeTruthy();
  });

  it('Record_ShiftOnly_RefusedAndStillRecording', async () => {
    const bridge = installElectronApi();
    render(<ShortcutSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the shortcut for Interrupt' }));

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'I', code: 'KeyI', shiftKey: true });

    expect(screen.getByRole('alert').textContent).toMatch(/Shift only types capitals/);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(bridge.api.setShortcut).not.toHaveBeenCalled();
  });

  it('Record_Escape_GivesTheChordsBack', async () => {
    const bridge = installElectronApi();
    render(<ShortcutSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the shortcut for Interrupt' }));

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', code: 'Escape' });

    await vi.waitFor(() => expect(bridge.api.setShortcutsRecording).toHaveBeenLastCalledWith(false));
    expect(bridge.api.setShortcut).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('CtrlAltAlone_CautionsAboutAltGr', async () => {
    installElectronApi({ getShortcuts: vi.fn().mockResolvedValue(withInterrupt({ accelerator: 'Ctrl+Alt+E' })) });
    render(<ShortcutSettings />);

    expect(await screen.findByText(/AltGr/)).toBeTruthy();
  });

  it('SetRefused_SaysWhyOnItsRow', async () => {
    installElectronApi({ setShortcut: vi.fn().mockRejectedValue(new Error("That shortcut is already Back's.")) });
    render(<ShortcutSettings />);
    await vi.waitFor(() => expect(checkbox('Interrupt').disabled).toBe(false));

    fireEvent.click(checkbox('Interrupt'));

    expect(await within(row('Interrupt')).findByText(/already Back's/)).toBeTruthy();
    expect(checkbox('Interrupt').checked).toBe(true);
  });
});
