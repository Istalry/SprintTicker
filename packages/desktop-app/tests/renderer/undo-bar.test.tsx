import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UndoBar } from '../../src/renderer/components/UndoBar';
import { installElectronApi } from './electron-api-mock';

const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

/** The window's Undo bar (D6): what was done, the time left, and Undo. */
describe('UndoBar', () => {
  it('NothingToUndo_ShowsNothing', () => {
    installElectronApi();
    render(<UndoBar />);
    expect(screen.queryByRole('status', { name: 'Undo' })).toBeNull();
  });

  it('AStop_ShowsItAndUndoRunsIt', async () => {
    const bridge = installElectronApi({
      getUndo: async () => ({ kind: 'stop', label: 'Stopped MG-12 · 1h 05m', expiresAtUtc: inSeconds(10), outcome: 'sent' as const })
    });
    render(<UndoBar />);

    expect(await screen.findByText('Stopped MG-12 · 1h 05m')).toBeTruthy();
    expect(screen.getByText(/Sent in 10 s/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(bridge.api.runUndo).toHaveBeenCalledTimes(1);
  });

  it('OpenRoute_Undo_FocusesUndo', async () => {
    // The Undo toast's click (P12c): Enter then undoes.
    const bridge = installElectronApi({
      getUndo: async () => ({ kind: 'stop', label: 'Stopped MG-12 · 1h 05m', expiresAtUtc: inSeconds(10), outcome: 'sent' as const })
    });
    render(<UndoBar />);
    await screen.findByText('Stopped MG-12 · 1h 05m');

    act(() => bridge.emit('onOpenRoute', 'undo'));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }));
  });

  it('MainSaysItEnded_TheBarGoes', async () => {
    const bridge = installElectronApi({
      getUndo: async () => ({ kind: 'delete', label: 'Deleted A-1 · 30m', expiresAtUtc: inSeconds(5), outcome: 'sent' as const })
    });
    render(<UndoBar />);
    await screen.findByText('Deleted A-1 · 30m');

    act(() => bridge.emit('onUndoChanged', null));

    expect(screen.queryByText('Deleted A-1 · 30m')).toBeNull();
  });
});
