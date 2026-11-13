import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { announce, LiveAnnouncer, useAnnounce } from '../../src/renderer/components/LiveAnnouncer';
import { CommandPalette } from '../../src/renderer/components/CommandPalette';
import { installElectronApi } from './electron-api-mock';

/** What a screen reader is told (P15a5, REVIEW-2026-11 A6, A9, A10, A14). */

describe('the live region', () => {
  it('Announce_ANewSentence_IsInTheRegion', () => {
    render(<LiveAnnouncer />);
    act(() => announce('Stand-up at 09:30. Join, or skip it today.'));
    expect(screen.getByRole('status').textContent).toBe('Stand-up at 09:30. Join, or skip it today.');
  });

  it('Announce_TheSameSentenceTwice_IsClearedThenSetAgain', () => {
    vi.useFakeTimers();
    try {
      render(<LiveAnnouncer />);
      act(() => announce('Saved.'));
      act(() => announce('Saved.'));
      expect(screen.getByRole('status').textContent).toBe('');
      act(() => { vi.advanceTimersByTime(100); });
      expect(screen.getByRole('status').textContent).toBe('Saved.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('UseAnnounce_SaysItOncePerKey_NotPerRedraw', () => {
    const Card: React.FC<{ id: string; minutes: number }> = ({ id, minutes }) => {
      useAnnounce(id, `Back to MG-12? ${minutes} min not timed`);
      return null;
    };
    const { rerender } = render(<><LiveAnnouncer /><Card id="a" minutes={6} /></>);
    expect(screen.getByRole('status').textContent).toBe('Back to MG-12? 6 min not timed');
    rerender(<><LiveAnnouncer /><Card id="a" minutes={7} /></>);
    expect(screen.getByRole('status').textContent).toBe('Back to MG-12? 6 min not timed');
  });
});

describe('Ctrl+K is a combobox', () => {
  it('Arrows_MoveTheActiveDescendant_TheFocusStaysInTheField', async () => {
    installElectronApi();
    render(<CommandPalette isOpen onClose={() => undefined} session={null} toPlace={0} onAction={() => undefined} onPickTask={() => undefined} />);

    const field = screen.getByRole('combobox', { name: 'Command' });
    const first = field.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    expect(document.getElementById(first!)?.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const second = field.getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);
    expect(document.getElementById(second!)?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(screen.getAllByRole('option').every(option => option.tabIndex === -1)).toBe(true);
  });
});
