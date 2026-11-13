import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AddTimeDialog } from '../../src/renderer/components/AddTimeDialog';
import { RowMenu } from '../../src/renderer/components/RowMenu';
import { StopMenu } from '../../src/renderer/components/StopMenu';
import { ShortcutSettings } from '../../src/renderer/components/ShortcutSettings';
import { DataSettings } from '../../src/renderer/views/Settings/DataSettings';
import { ModeChip } from '../../src/renderer/components/ModeChip';
import { ActiveTaskHeroCard } from '../../src/renderer/components/ActiveTaskHeroCard';
import { installElectronApi, TRACKING_SESSION } from './electron-api-mock';

const focused = () => document.activeElement;
const escape = () => fireEvent.keyDown(document.body, { key: 'Escape' });

/** Opens Add time from a button, as History does. */
const AddTimeOpener: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Add time</button>
      <AddTimeDialog
        opening={open ? { dateKey: '2026-11-13' } : null}
        onClose={() => { setOpen(false); onClose?.(); }}
        onAdded={() => undefined}
      />
    </>
  );
};

/** P15a2: dialogs, menus and the focus (REVIEW-2026-11 A1-A5, C4). */
describe('Focus', () => {
  describe('a dialog', () => {
    it('Open_FocusMovesIn_Escape_ClosesAndGivesTheFocusBack', async () => {
      installElectronApi();
      const closed = vi.fn();
      render(<AddTimeOpener onClose={closed} />);
      const opener = screen.getByRole('button', { name: 'Add time' });
      opener.focus();

      fireEvent.click(opener);
      const dialog = await screen.findByRole('dialog', { name: 'Add time' });
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.contains(focused())).toBe(true);

      // Escape is heard wherever the focus is: it used to need the focus inside.
      escape();

      expect(closed).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(focused()).toBe(opener);
    });

    it('Tab_FromTheLastControl_StaysInside', async () => {
      installElectronApi();
      render(<AddTimeOpener />);
      fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add time' });
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea')];
      controls[controls.length - 1].focus();

      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });

      expect(focused()).toBe(controls[0]);
    });
  });

  describe('a menu', () => {
    it('Open_FirstItemFocused_ArrowsMove_EscapeGivesTheButtonBack', () => {
      render(<RowMenu name="MG-12" menuName="MG-12" items={[{ label: 'Move…', run: vi.fn() }, { label: 'Delete', run: vi.fn(), danger: true }]} />);
      const button = screen.getByRole('button', { name: 'More for MG-12' });

      fireEvent.click(button);
      expect(focused()).toBe(screen.getByRole('menuitem', { name: 'Move…' }));
      fireEvent.keyDown(focused() ?? document.body, { key: 'ArrowDown' });
      expect(focused()).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
      fireEvent.keyDown(focused() ?? document.body, { key: 'ArrowDown' });
      expect(focused()).toBe(screen.getByRole('menuitem', { name: 'Move…' }));

      escape();

      expect(screen.queryByRole('menu')).toBeNull();
      expect(focused()).toBe(button);
    });

    it('ModeChip_Escape_ClosesIt', async () => {
      installElectronApi();
      render(<ModeChip />);
      fireEvent.click(await screen.findByRole('button', { name: /^Mode:/ }));
      expect(screen.getByRole('menu', { name: 'Mode' })).toBeTruthy();

      escape();

      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('StopMenu_DiscardAsked_KeepItHasTheFocus_EscapeClosesTheMenu', () => {
      render(<StopMenu session={TRACKING_SESSION} offerDone doneMeans="Jira moves it to its done state" onComplete={vi.fn()} onDiscard={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'More ways to stop' }));

      fireEvent.click(screen.getByRole('menuitem', { name: /Discard…/ }));

      expect(focused()).toBe(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep it' }));
      escape();
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('Stop_StartTakesTheFocus', () => {
    installElectronApi();
    const props = {
      onPause: vi.fn(), onResume: vi.fn(), onComplete: vi.fn(), onDiscard: vi.fn(), onOpenTaskModal: vi.fn(),
      onInterrupt: vi.fn(), onAssign: vi.fn(), onBack: vi.fn(), onStopInterruption: vi.fn(), onPrevious: vi.fn()
    };
    const { rerender } = render(<ActiveTaskHeroCard session={TRACKING_SESSION} {...props} />);
    const stop = screen.getByRole('button', { name: /^Stop$/ });
    stop.focus();

    fireEvent.click(stop);
    rerender(<ActiveTaskHeroCard session={null} {...props} />);

    expect(focused()).toBe(screen.getByRole('button', { name: /Start a task/ }));
  });

  it('ChangeKeys_TheFieldTakesTheFocus', async () => {
    installElectronApi();
    render(<ShortcutSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Change the shortcut for Interrupt' }));

    // `autoFocus` on the span did nothing: the chord went nowhere.
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Press the new shortcut for Interrupt' }));
  });

  it('Erase_KeepThemHasTheFocus_ThenEraseGetsItBack', () => {
    installElectronApi();
    render(<DataSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Erase…' }));
    expect(focused()).toBe(screen.getByRole('button', { name: 'Keep them' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));

    expect(focused()).toBe(screen.getByRole('button', { name: 'Erase…' }));
  });
});
