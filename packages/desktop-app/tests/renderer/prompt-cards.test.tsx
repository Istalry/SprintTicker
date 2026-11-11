import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BreakCard, StandupCard } from '../../src/renderer/components/PromptCards';
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
      ['Join', 'joinStandup', []],
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
});
