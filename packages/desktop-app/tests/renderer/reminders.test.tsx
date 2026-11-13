import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReminderCard } from '../../src/renderer/components/ReminderPrompt';
import { MiniBar } from '../../src/renderer/components/MiniBar';
import { TodayView } from '../../src/renderer/views/Today/TodayView';
import { installElectronApi } from './electron-api-mock';
import type { ReminderDTO } from '../../src/shared/dtos';

const NOTHING: ReminderDTO = { id: 'nothing-timing:x', kind: 'nothing-timing', sinceUtc: 'x', minutes: 10 };
const PAUSED: ReminderDTO = { id: 'long-pause:S1:x', kind: 'long-pause', sinceUtc: 'x', minutes: 30, taskKey: 'MG-12' };
const CALL: ReminderDTO = { id: 'interruption:i1', kind: 'interruption-running', sinceUtc: 'x', minutes: 20, name: 'Call with Marc', heldTaskKey: 'MG-12' };
const STANDUP: ReminderDTO = { id: 'standup:S2', kind: 'standup-running', sinceUtc: 'x', minutes: 25, taskKey: 'ADHOC-1' };

/**
 * The "still...?" reminders (P8d) on Today and the mini timer. The quiet
 * answer dismisses this occurrence; the other acts through the commands
 * every surface uses.
 */
describe('reminders', () => {
  const card = (reminder: ReminderDTO) => {
    const openPicker = vi.fn();
    const onAnswered = vi.fn();
    render(<ReminderCard reminder={reminder} openPicker={openPicker} onAnswered={onAnswered} />);
    return { openPicker, onAnswered };
  };

  it.each([
    [NOTHING, 'Nothing timing for 10 min', 'Not now'],
    [PAUSED, '30 min paused on MG-12', 'Still paused'],
    [CALL, '20 min on "Call with Marc"', 'Still on it'],
    [STANDUP, '25 min in the stand-up', 'Still in it']
  ])('Card_%#_SaysHowLongAndTheQuietAnswerDismisses', (reminder, heading, quiet) => {
    const bridge = installElectronApi();
    const { onAnswered } = card(reminder);

    expect(screen.getByText(heading)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: quiet }));

    expect(bridge.api.dismissReminder).toHaveBeenCalledWith(reminder.id);
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it('NothingTiming_StartATask_OpensThePickerAndDismisses', () => {
    const bridge = installElectronApi();
    const { openPicker } = card(NOTHING);

    fireEvent.click(screen.getByRole('button', { name: '▶ Start a task…' }));

    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(bridge.api.dismissReminder).toHaveBeenCalledWith(NOTHING.id);
  });

  it.each([
    [PAUSED, '▶ Resume', 'resumeSession'],
    [CALL, '↩ Back to MG-12', 'backFromInterruption'],
    [{ ...CALL, heldTaskKey: undefined }, '■ Stop', 'stopInterruption']
  ] as const)('Act_%#_RunsTheCommand', (reminder, label, method) => {
    const bridge = installElectronApi();
    card(reminder);

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(bridge.api[method]).toHaveBeenCalledTimes(1);
    expect(bridge.api.dismissReminder).not.toHaveBeenCalled();
  });

  it('Standup_End_StopsTheSessionAsStopDoes', () => {
    const bridge = installElectronApi();
    card(STANDUP);

    fireEvent.click(screen.getByRole('button', { name: 'End stand-up' }));

    expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, false);
  });

  it('TodayView_AskedThenGone_TheCardFollowsMain', async () => {
    const bridge = installElectronApi({ getReminder: async () => PAUSED });
    render(<TodayView session={null} worklogs={[]} onPause={() => undefined} onResume={() => undefined}
      onComplete={() => undefined} onDiscard={() => undefined} onInterrupt={() => undefined} onOpenPicker={() => undefined} />);

    expect(await screen.findByRole('region', { name: 'Still paused?' })).toBeTruthy();
    act(() => bridge.emit('onReminder', null));
    expect(screen.queryByRole('region', { name: 'Still paused?' })).toBeNull();
  });

  it('TodayView_TwoQuestions_OneCardAtATime_TheOtherCounted', async () => {
    const bridge = installElectronApi({
      getReminder: async () => PAUSED,
      getCeremonyPrompt: async () => ({ type: 'STANDUP', title: 'Stand-up', at: '09:30' })
    });
    render(<TodayView session={null} worklogs={[]} onPause={() => undefined} onResume={() => undefined}
      onComplete={() => undefined} onDiscard={() => undefined} onInterrupt={() => undefined} onOpenPicker={() => undefined} />);

    // The stand-up first (C5, the user's choice): the reminder waits behind it.
    expect(await screen.findByRole('region', { name: 'The stand-up' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Still paused?' })).toBeNull();
    expect(screen.getByText('1 more question after this one')).toBeTruthy();

    act(() => bridge.emit('onCeremonyPrompt', null));
    expect(await screen.findByRole('region', { name: 'Still paused?' })).toBeTruthy();
    expect(screen.queryByText(/more question/)).toBeNull();
  });

  it('MiniBar_Reminder_TakesTheRow_StartOpensThePickerWindow', async () => {
    const bridge = installElectronApi({ getReminder: async () => NOTHING });
    render(<MiniBar />);

    fireEvent.click(await screen.findByRole('button', { name: '▶ Start a task…' }));

    expect(bridge.api.openTaskPicker).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Nothing timing for 10 min')).toBeNull();
  });

  it('MiniBar_AQuestionAndAReminder_TheQuestionFirst', async () => {
    installElectronApi({
      getReminder: async () => NOTHING,
      getResumePrompt: async () => ({ taskKey: 'MG-12', taskTitle: 't', after: 'interruption' as const })
    });
    render(<MiniBar />);

    expect(await screen.findByText('Back to MG-12?')).toBeTruthy();
    expect(screen.queryByText('Nothing timing for 10 min')).toBeNull();
  });
});
