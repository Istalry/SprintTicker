import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ResumeAfterLunchPrompt } from '../../src/renderer/components/ResumeAfterLunchPrompt';
import { installElectronApi } from './electron-api-mock';

const QUESTION = { taskKey: 'SCRUM-2', taskTitle: 'Tache 2', after: 'lunch' as const };

/**
 * After lunch, about a task that left the user's lists over the break. Main
 * owns the question -- the bar asks it too -- so the dialog only follows it.
 */
describe('resume after lunch', () => {
  it('Render_NothingAsked_ShowsNothing', async () => {
    const bridge = installElectronApi();
    render(<ResumeAfterLunchPrompt />);

    await act(async () => undefined);

    expect(bridge.api.getResumePrompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Render_AskedBeforeTheWindowOpened_ShowsTheQuestion', async () => {
    installElectronApi({ getResumePrompt: async () => QUESTION });
    render(<ResumeAfterLunchPrompt />);

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('SCRUM-2')).toBeTruthy();
    expect(screen.getByRole('alertdialog').textContent).toMatch(/no longer assigned to you/);
  });

  it('Render_AfterAnInterruption_AsksBackToTheTask', async () => {
    // Asked every time, so it does not say the task left the user's lists...
    installElectronApi({ getResumePrompt: async () => ({ ...QUESTION, after: 'interruption' as const }) });
    render(<ResumeAfterLunchPrompt />);

    expect(await screen.findByText('Back to your task?')).toBeTruthy();
    expect(screen.getByRole('alertdialog').textContent).not.toMatch(/no longer assigned/);
  });

  it('Render_AfterAnInterruption_TaskLeftTheList_SaysSo', async () => {
    // ...unless it did.
    installElectronApi({ getResumePrompt: async () => ({ ...QUESTION, after: 'interruption' as const, unlisted: true as const }) });
    render(<ResumeAfterLunchPrompt />);

    expect((await screen.findByRole('alertdialog')).textContent).toMatch(/no longer assigned to you/);
  });

  it('Render_AskedWhileOpen_ShowsTheQuestion', async () => {
    const bridge = installElectronApi();
    render(<ResumeAfterLunchPrompt />);
    await act(async () => undefined);

    act(() => bridge.emit('onResumePrompt', QUESTION));

    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it.each([
    ['Resume it', true],
    ['Leave it', false]
  ])('Answer_%s_TellsMainAndCloses', async (label, resume) => {
    const bridge = installElectronApi({ getResumePrompt: async () => QUESTION });
    render(<ResumeAfterLunchPrompt />);

    fireEvent.click(await screen.findByRole('button', { name: label }));

    expect(bridge.api.answerResumePrompt).toHaveBeenCalledWith(resume, undefined, undefined);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Render_AfterTheStandup_SaysSo', async () => {
    installElectronApi({ getResumePrompt: async () => ({ ...QUESTION, after: 'standup' as const }) });
    render(<ResumeAfterLunchPrompt />);

    const dialog = await screen.findByRole('alertdialog');

    expect(dialog.textContent).toMatch(/Resume after the stand-up\?/);
    expect(dialog.textContent).toMatch(/The stand-up stopped/);
    expect(dialog.textContent).not.toMatch(/lunch/i);
  });

    it('AnsweredOnTheBar_TheDialogCloses', async () => {
    const bridge = installElectronApi({ getResumePrompt: async () => QUESTION });
    render(<ResumeAfterLunchPrompt />);
    await screen.findByRole('alertdialog');

    act(() => bridge.emit('onResumePrompt', null));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(bridge.api.answerResumePrompt).not.toHaveBeenCalled();
  });
  it('AfterAnInterruption_ResumeCountingTheGap_SendsItsMinutes', async () => {
    // Stopped twelve minutes ago: the task waited paused through the gap.
    const ended = new Date(Date.now() - 12 * 60_000).toISOString();
    const bridge = installElectronApi({
      getResumePrompt: async () => ({ ...QUESTION, after: 'interruption' as const, interruptionEndedAtUtc: ended })
    });
    render(<ResumeAfterLunchPrompt />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume, and count the time since as work' }));

    expect(bridge.api.answerResumePrompt).toHaveBeenCalledWith(true, 12, undefined);
  });

  describe('back at your desk (P8b)', () => {
    const HELD = { ...QUESTION, after: 'lunch' as const, held: true as const };

    it('AfterLunch_AsksBackAtYourDesk', async () => {
      installElectronApi({ getResumePrompt: async () => HELD });
      render(<ResumeAfterLunchPrompt />);

      const dialog = await screen.findByRole('alertdialog', { name: 'Back at your desk?' });

      expect(dialog.textContent).toMatch(/is paused, as it was: Lunch is not timed/);
      expect(screen.getByRole('button', { name: `Resume ${QUESTION.taskKey}` })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    });

    it('IWorkedThroughIt_TellsMainToTakeThePauseBack', async () => {
      const bridge = installElectronApi({ getResumePrompt: async () => HELD });
      render(<ResumeAfterLunchPrompt />);

      fireEvent.click(await screen.findByRole('button', { name: 'I worked through it' }));

      expect(bridge.api.answerResumePrompt).toHaveBeenCalledWith(true, undefined, true);
    });

    it('AfterAway_SaysAway', async () => {
      installElectronApi({ getResumePrompt: async () => ({ ...HELD, after: 'away' as const }) });
      render(<ResumeAfterLunchPrompt />);

      expect((await screen.findByRole('alertdialog')).textContent).toMatch(/Away is not timed/);
    });
  });

  it('AfterLunch_NoGapToCount', async () => {
    installElectronApi({ getResumePrompt: async () => QUESTION });
    render(<ResumeAfterLunchPrompt />);
    await screen.findByRole('alertdialog');

    expect(screen.queryByRole('button', { name: /count the time since/ })).toBeNull();
  });
});
