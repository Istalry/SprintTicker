import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ResumeAfterLunchPrompt } from '../../src/renderer/components/ResumeAfterLunchPrompt';
import { installElectronApi } from './electron-api-mock';

const QUESTION = { taskKey: 'SCRUM-2', taskTitle: 'Tache 2' };

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

    expect(bridge.api.answerResumePrompt).toHaveBeenCalledWith(resume);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('AnsweredOnTheBar_TheDialogCloses', async () => {
    const bridge = installElectronApi({ getResumePrompt: async () => QUESTION });
    render(<ResumeAfterLunchPrompt />);
    await screen.findByRole('alertdialog');

    act(() => bridge.emit('onResumePrompt', null));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(bridge.api.answerResumePrompt).not.toHaveBeenCalled();
  });
});
