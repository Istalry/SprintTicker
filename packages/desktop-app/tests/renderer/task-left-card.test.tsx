import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TodayView } from '../../src/renderer/views/Today/TodayView';
import { taskLeftHeading } from '../../src/renderer/components/TaskLeftCard';
import type { ActiveSessionDTO } from '../../src/shared/dtos';
import { formatClockTime } from '../../src/renderer/utils/formatters';
import { installElectronApi } from './electron-api-mock';

const LEFT_AT = '2026-11-10T13:32:00.000Z';
const GIVEN: ActiveSessionDTO = {
  sessionId: 'S1', projectId: 'p', taskId: 't-12', taskKey: 'MG-12', taskTitle: 'Fix the lantern glow at dusk', isAdHoc: false,
  status: 'TRACKING', startTimeUtc: '2026-11-10T12:00:00.000Z', totalPausedSeconds: 0, elapsedSeconds: 5040,
  taskUnlisted: true, taskLeftBecause: 'reassigned', taskOwnerName: 'Rin Okada', taskLeftAtUtc: LEFT_AT
};
const at = formatClockTime(new Date(LEFT_AT));

const today = (session: ActiveSessionDTO | null, onOpenPicker = vi.fn()) => {
  render(<TodayView session={session} worklogs={[]} onPause={() => undefined} onResume={() => undefined}
    onComplete={() => undefined} onDiscard={() => undefined} onInterrupt={() => undefined} onOpenPicker={onOpenPicker} />);
  return onOpenPicker;
};
const card = () => screen.queryByRole('region', { name: `MG-12 was given to Rin Okada at ${at}` });

/** The task being timed left the user's list (S5b, P8e2). */
describe('the task-left card', () => {
  afterEach(() => window.sessionStorage.clear());

  it.each([
    [{}, `MG-12 was given to Rin Okada at ${at}`],
    [{ taskOwnerName: undefined }, `MG-12 is no longer assigned to you at ${at}`],
    [{ taskLeftBecause: 'closed' as const }, `MG-12 was closed in Jira at ${at}`],
    [{ taskLeftBecause: 'gone' as const, taskLeftAtUtc: undefined }, 'MG-12 is no longer on Jira']
  ])('Heading_%#_SaysWhatHappened', (change, heading) => {
    expect(taskLeftHeading({ ...GIVEN, ...change }, 'Jira')).toBe(heading);
  });

  it('Shown_SaysTheTimeStays_AndOffersThreeWays', () => {
    installElectronApi();
    today(GIVEN);

    expect(card()?.textContent).toMatch(/Your 1h 24m so far stays on MG-12, where you did it\. Keep going, or switch\./);
    expect(screen.getByRole('button', { name: 'Keep timing on it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '↳ Move my 1h 24m…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '⇄ Switch task' })).toBeTruthy();
  });

  it('KeepTiming_GoesForThisSession_EvenReopened', () => {
    installElectronApi();
    today(GIVEN);

    fireEvent.click(screen.getByRole('button', { name: 'Keep timing on it' }));
    expect(card()).toBeNull();

    document.body.innerHTML = '';
    today(GIVEN);
    expect(card()).toBeNull();
  });

  it('KeepTiming_AnotherSession_AsksAgain', () => {
    installElectronApi();
    window.sessionStorage.setItem('task-left-kept:S0:reassigned', '1');
    today(GIVEN);

    expect(card()).not.toBeNull();
  });

  it('Switch_OpensThePicker', () => {
    installElectronApi();
    const onOpenPicker = today(GIVEN);

    fireEvent.click(screen.getByRole('button', { name: '⇄ Switch task' }));

    expect(onOpenPicker).toHaveBeenCalledWith('start');
  });

  it('Move_TheTimeGoesToTheTaskPicked', async () => {
    const bridge = installElectronApi({
      getPickerData: vi.fn().mockResolvedValue({
        previous: null, recent: [], starred: [],
        tasks: [{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }],
        projects: [{ id: 'P-1', key: 'SPR', name: 'Sprint' }],
        projectSeconds: {}
      })
    });
    today(GIVEN);

    fireEvent.click(screen.getByRole('button', { name: '↳ Move my 1h 24m…' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
    fireEvent.click(await screen.findByText('SPR-9'));

    await waitFor(() => expect(bridge.api.moveSessionTo).toHaveBeenCalledWith('T-9'));
  });

  it('Move_Refused_SaysWhy', async () => {
    installElectronApi({
      moveSessionTo: vi.fn().mockRejectedValue(new Error('The provider records at least 1 minute(s).')),
      getPickerData: vi.fn().mockResolvedValue({
        previous: null, recent: [], starred: [],
        tasks: [{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }],
        projects: [{ id: 'P-1', key: 'SPR', name: 'Sprint' }],
        projectSeconds: {}
      })
    });
    today(GIVEN);

    fireEvent.click(screen.getByRole('button', { name: '↳ Move my 1h 24m…' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
    fireEvent.click(await screen.findByText('SPR-9'));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not moved: .*at least 1 minute/);
  });

  it.each([
    ['still listed', { ...GIVEN, taskUnlisted: undefined }],
    ['an interruption', { ...GIVEN, interruption: { id: 'i' } as ActiveSessionDTO['interruption'] }]
  ])('NotShown_%s', (_name, session) => {
    installElectronApi();
    today(session);

    expect(screen.queryByRole('button', { name: 'Keep timing on it' })).toBeNull();
  });
});
