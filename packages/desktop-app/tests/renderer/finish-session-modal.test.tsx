import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { FinishSessionModal } from '../../src/renderer/components/FinishSessionModal';
import { ActiveSessionDTO } from '../../src/shared/dtos';
import { installElectronApi } from './electron-api-mock';

const SESSION = {
  sessionId: 's1',
  taskId: 'T-1',
  taskKey: 'MG-12',
  taskTitle: 'Rework the pause menu',
  projectId: 'P',
  status: 'TRACKING',
  startTimeUtc: '2026-10-16T21:00:00.000Z',
  elapsedSeconds: 2 * 3600,
  totalPausedSeconds: 0,
  isAdHoc: false
} as unknown as ActiveSessionDTO;

const open = () =>
  render(<FinishSessionModal isOpen session={SESSION} onClose={vi.fn()} onFinishOption={vi.fn()} onDiscard={vi.fn()} />);

/**
 * Finishing a session that crosses midnight files its time under each day;
 * the dialog says so before it does.
 */
describe('finishing a session across midnight', () => {
  it('Render_AcrossMidnight_SaysWhichDaysTheTimeIsFiledUnder', async () => {
    installElectronApi({
      getSessionDays: vi.fn().mockResolvedValue([
        { dateKey: '2026-10-16', seconds: 3600 },
        { dateKey: '2026-10-17', seconds: 3600 }
      ])
    });
    open();

    expect((await screen.findByText(/filed as/)).textContent).toMatch(/filed as 1h 00m on \S+, 1h 00m on \S+\./);
  });

  it('Render_WithinADay_SaysNothingOfDays', async () => {
    installElectronApi({ getSessionDays: vi.fn().mockResolvedValue([{ dateKey: '2026-10-16', seconds: 3600 }]) });
    open();
    await act(async () => undefined);

    expect(screen.queryByText(/filed as/)).toBeNull();
  });

  it('Render_TheDaysCannotBeRead_TheChoicesStillWork', async () => {
    installElectronApi({ getSessionDays: vi.fn().mockRejectedValue(new Error('gone')) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open();
    await act(async () => undefined);

    expect(screen.queryByText(/filed as/)).toBeNull();
    expect(screen.getByText(/Remain 'In Progress'/)).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
