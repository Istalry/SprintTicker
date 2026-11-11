import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BreakCard, JOINED_MINUTES_AGO, LunchQuestionCard, StandupCard, joinedAt } from '../../src/renderer/components/PromptCards';
import { MiniBar } from '../../src/renderer/components/MiniBar';
import { TodayView } from '../../src/renderer/views/Today/TodayView';
import { installElectronApi, TRACKING_SESSION } from './electron-api-mock';
import { ActiveSessionDTO, CeremonyPromptDTO } from '../../src/shared/dtos';

const STANDUP: CeremonyPromptDTO = { type: 'STANDUP', title: 'Daily Stand-Up', at: '09:30' };
const PAUSED: ActiveSessionDTO = { ...TRACKING_SESSION, status: 'PAUSED', lastPauseStartUtc: '2026-10-14T12:50:00.000Z' };

/**
 * The questions as cards on Today (redesign P8c, S6). They used to be
 * dialogs, which main brought forward to ask; now nothing takes the focus,
 * and a card waits until it is answered.
 */
describe('prompt cards', () => {
  describe('the stand-up', () => {
    it('Render_TaskRunning_SaysItKeepsRunningUntilJoin', () => {
      installElectronApi();
      render(<StandupCard prompt={STANDUP} session={TRACKING_SESSION} />);

      expect(screen.getByText('Stand-up at 09:30')).toBeTruthy();
      expect(screen.getByRole('region', { name: 'The stand-up' }).textContent).toMatch(/SPR-142 keeps running until you press Join/);
    });

    it.each([
      ['Join', 'joinStandup', [undefined]],
      ['Skip today', 'cancelStandupPrompt', []],
      ['Remind me in 10 min', 'snoozeCeremony', ['STANDUP', 10]]
    ] as const)('%s_Clicked_AnswersMain', (label, method, args) => {
      const bridge = installElectronApi();
      render(<StandupCard prompt={STANDUP} session={null} />);

      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(bridge.api[method]).toHaveBeenCalledWith(...args);
    });

    it('TodayView_AskedThenAnsweredElsewhere_TheCardComesAndGoes', async () => {
      const bridge = installElectronApi({ getCeremonyPrompt: async () => STANDUP });
      render(<TodayView session={null} worklogs={[]} onPause={() => undefined} onResume={() => undefined}
        onComplete={() => undefined} onDiscard={() => undefined} onInterrupt={() => undefined} onOpenPicker={() => undefined} />);

      expect(await screen.findByRole('region', { name: 'The stand-up' })).toBeTruthy();

      act(() => bridge.emit('onCeremonyPrompt', null));

      expect(screen.queryByRole('region', { name: 'The stand-up' })).toBeNull();
    });

    it('TodayView_TheWrapUpAsked_NoStandupCard', async () => {
      installElectronApi({ getCeremonyPrompt: async () => ({ type: 'EOD', title: 'End-of-Day Wrap-Up', at: '17:30' }) });
      render(<TodayView session={null} worklogs={[]} onPause={() => undefined} onResume={() => undefined}
        onComplete={() => undefined} onDiscard={() => undefined} onInterrupt={() => undefined} onOpenPicker={() => undefined} />);
      await act(async () => undefined);

      expect(screen.queryByRole('region', { name: 'The stand-up' })).toBeNull();
    });
  });

  describe('Lunch and Away', () => {
    it('Work_ShowsNothing', () => {
      installElectronApi();
      const { container } = render(<BreakCard mode="WORK" session={PAUSED} onLeaveAway={() => undefined} />);

      expect(container.textContent).toBe('');
    });

    it('Lunch_TaskPaused_SaysUntilWhenAndResumes', async () => {
      const bridge = installElectronApi();
      render(<BreakCard mode="LUNCH" session={PAUSED} onLeaveAway={() => undefined} />);

      expect(await screen.findByText('Lunch until 13:30')).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Lunch' }).textContent).toMatch(/SPR-142 is paused, as it was; nothing is sent/);
      fireEvent.click(screen.getByRole('button', { name: 'Resume SPR-142' }));

      expect(bridge.api.resumeSession).toHaveBeenCalledTimes(1);
    });

    it('Away_TaskPaused_BackResumesThenLeavesAway', async () => {
      const bridge = installElectronApi();
      const left: string[] = [];
      render(<BreakCard mode="AWAY" session={PAUSED} onLeaveAway={() => left.push('away')} />);

      fireEvent.click(screen.getByRole('button', { name: 'Back: resume SPR-142' }));
      await act(async () => undefined);

      expect(bridge.api.resumeSession).toHaveBeenCalledTimes(1);
      expect(left).toEqual(['away']);
    });

    it('Away_NothingPaused_ImBackLeavesAway', () => {
      installElectronApi();
      const left: string[] = [];
      render(<BreakCard mode="AWAY" session={null} onLeaveAway={() => left.push('away')} />);

      expect(screen.getByRole('region', { name: 'Away' }).textContent).toMatch(/Nothing is timing/);
      fireEvent.click(screen.getByRole('button', { name: "I'm back" }));

      expect(left).toEqual(['away']);
    });
  });

  describe('joined late, and lunch during an interruption (P8c2)', () => {
    it('JoinedAt_MinutesAgo_IsThatMuchBeforeNow_NowIsNothing', () => {
      const now = Date.parse('2026-11-11T08:35:00.000Z');
      expect(joinedAt(0, now)).toBeUndefined();
      expect(joinedAt(5, now)).toBe('2026-11-11T08:30:00.000Z');
      expect(JOINED_MINUTES_AGO).toEqual([0, 2, 5, 10, 15]);
    });

    it('Join_JoinedFiveMinutesAgo_SendsTheTime', () => {
      const bridge = installElectronApi();
      render(<StandupCard prompt={STANDUP} session={TRACKING_SESSION} />);

      fireEvent.change(screen.getByLabelText('When you joined'), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Join' }));

      const sent = vi.mocked(bridge.api.joinStandup).mock.calls[0][0];
      expect(Date.now() - Date.parse(sent ?? '')).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
      expect(Date.now() - Date.parse(sent ?? '')).toBeLessThan(5 * 60_000 + 1000);
    });

    it('StandupCard_DuringAnInterruption_SaysJoiningEndsIt', () => {
      installElectronApi();
      const during = { ...TRACKING_SESSION, taskTitle: 'Call with Marc', interruption: { index: 1 } as never };
      render(<StandupCard prompt={STANDUP} session={during} />);

      expect(screen.getByRole('region', { name: 'The stand-up' }).textContent).toMatch(/Join\? It ends "Call with Marc", which waits to be placed/);
    });

    it.each([['Start lunch', true], ['Not now', false]] as const)('LunchQuestion_%s_AnswersMain', (label, start) => {
      const bridge = installElectronApi();
      render(<LunchQuestionCard prompt={{ type: 'LUNCH', title: 'Lunch time', at: '12:30', endsInterruption: 'Call with Marc' }} />);

      expect(screen.getByRole('region', { name: 'Lunch time' }).textContent).toMatch(/It ends "Call with Marc"/);
      fireEvent.click(screen.getByRole('button', { name: label }));

      expect(bridge.api.answerLunchQuestion).toHaveBeenCalledWith(start);
    });

    it('MiniBar_LunchQuestion_TakesTheRow', async () => {
      const bridge = installElectronApi({ getCeremonyPrompt: async () => ({ type: 'LUNCH' as const, title: 'Lunch time', at: '12:30', endsInterruption: 'Call with Marc' }) });
      render(<MiniBar />);

      fireEvent.click(await screen.findByRole('button', { name: 'Start lunch' }));

      expect(bridge.api.answerLunchQuestion).toHaveBeenCalledWith(true);
    });
  });
});
