import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkdaySettings } from '../../src/renderer/views/Settings/WorkdaySettings';
import { SETTINGS_ENTRIES } from '../../src/renderer/views/Settings/settings-groups';
import { AUTO_SAVE_DELAY_MS } from '../../src/renderer/hooks/auto-save-scheduler';
import { normalizeScheduleSettings } from '../../src/shared/schedule-defaults';
import { DEFAULT_PROMPT_DELAYS, FlowSettingKey } from '../../src/shared/flow-settings';
import { ScheduleSettingsDTO } from '../../src/shared/dtos';
import { installElectronApi } from './electron-api-mock';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const STORED: ScheduleSettingsDTO = { ...normalizeScheduleSettings({}), standupTime: '09:45' };
const row = (name: string) => screen.getByRole('group', { name });
const saved = (bridge: ReturnType<typeof installElectronApi>, what: Partial<ScheduleSettingsDTO>) => waitFor(
  () => expect(bridge.api.saveScheduleSettings).toHaveBeenCalledWith(expect.objectContaining(what)),
  { timeout: AUTO_SAVE_DELAY_MS * 3 }
);
const savesNothing = async (bridge: ReturnType<typeof installElectronApi>) => {
  await new Promise(r => setTimeout(r, AUTO_SAVE_DELAY_MS * 2));
  expect(bridge.api.saveScheduleSettings).not.toHaveBeenCalled();
};

/** Settings · My workday as rows (P16c, S21). */
describe('Settings · My workday', () => {
  it('Render_TheRowsOfS21_InItsOrder', async () => {
    installElectronApi();
    render(<WorkdaySettings />);
    await screen.findByRole('group', { name: 'Stand-up' });

    const titles = screen.getAllByRole('group')
      .map(g => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)
      .filter(Boolean);
    expect(titles).toEqual([
      'Working days', 'Stand-up', 'Lunch', 'End my day', 'My week closes',
      'Nothing timing in working hours', 'A pause that runs long', 'A stand-up still running', 'An interruption still running',
      'A timer left running overnight', 'A long pause starts a new entry'
    ]);
    expect(screen.queryByText(/AGILE CEREMONIES/)).toBeNull();
  });

  it('Mount_BeforeStoredSettingsArrive_WritesNothing', async () => {
    // Auto-save is gated on the read: the defaults written over the stored
    // schedule would silently move every ceremony.
    const read = deferred<ScheduleSettingsDTO>();
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockReturnValue(read.promise) });

    render(<WorkdaySettings />);

    await savesNothing(bridge);
  });

  it('StandupTime_AfterLoad_SavesTheEdit', async () => {
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue(STORED) });
    render(<WorkdaySettings />);
    const standup = (await screen.findByLabelText('Stand-up time')) as HTMLInputElement;
    await waitFor(() => expect(standup.value).toBe('09:45'));

    fireEvent.change(standup, { target: { value: '10:15' } });

    await saved(bridge, { standupTime: '10:15' });
  });

  it('LunchEndBeforeItsStart_SaysSoUnderLunchAndSavesNothing', async () => {
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue(STORED) });
    render(<WorkdaySettings />);
    const end = (await screen.findByLabelText('Lunch ends')) as HTMLInputElement;
    await waitFor(() => expect(end.value).toBe(STORED.lunchEnd));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fireEvent.change(end, { target: { value: '11:00' } });

    expect(within(row('Lunch')).getByRole('alert').textContent).toMatch(/Lunch must end after it starts/);
    await savesNothing(bridge);
  });

  it('TimerLeftOvernight_StoredOff_ShowsOffAndSavesTheChange', async () => {
    // The page writes the whole schedule: a field it does not carry is lost.
    const bridge = installElectronApi({
      getScheduleSettings: vi.fn().mockResolvedValue({ ...STORED, askAboutForgottenSessions: false })
    });
    render(<WorkdaySettings />);
    const toggle = (await screen.findByRole('switch', { name: 'A timer left running overnight' })) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(false));

    fireEvent.click(toggle);

    await saved(bridge, { askAboutForgottenSessions: true });
  });

  it('WorkingDays_StoredWeek_ShowsWhichArePressed', async () => {
    installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue({ ...STORED, workingDays: [1, 2, 3, 4] }) });
    render(<WorkdaySettings />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Fri' }).getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByRole('button', { name: 'Thu' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('WorkingDays_SaturdayTurnedOn_SavesIt', async () => {
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue(STORED) });
    render(<WorkdaySettings />);
    const saturday = await screen.findByRole('button', { name: 'Sat' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mon' }).getAttribute('aria-pressed')).toBe('true'));

    fireEvent.click(saturday);

    await saved(bridge, { workingDays: [1, 2, 3, 4, 5, 6] });
  });

  it('WorkingDays_EveryDayOff_SaysSoAndSavesNothing', async () => {
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue({ ...STORED, workingDays: [3] }) });
    render(<WorkdaySettings />);
    const wednesday = await screen.findByRole('button', { name: 'Wed' });
    await waitFor(() => expect(wednesday.getAttribute('aria-pressed')).toBe('true'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fireEvent.click(wednesday);

    expect(within(row('Working days')).getByRole('alert').textContent).toMatch(/at least one working day/);
    expect(screen.getByText('No working day')).toBeTruthy();
    await savesNothing(bridge);
  });

  it('WorkingDays_HolidaysFromTheProvider_SaysSo', async () => {
    installElectronApi({
      getProviderCapabilities: vi.fn().mockResolvedValue({
        providerId: 'jira', canAssign: true, canTransition: true, canFindWorklog: true, canFetchByKey: true, hasHolidays: true
      })
    });
    render(<WorkdaySettings />);

    expect(await screen.findByText('No reminders on other days, nor on a holiday Jira lists.')).toBeTruthy();
  });

  it('WeekCloses_TheLastWorkingDay_SundayLast', async () => {
    installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue({ ...STORED, workingDays: [1, 2, 3, 4] }) });
    render(<WorkdaySettings />);
    expect(await screen.findByText('Thursday, end of day')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sun' }));

    // Monday first: a week worked on Sunday closes on Sunday, not on Thursday.
    expect(screen.getByText('Sunday, end of day')).toBeTruthy();
  });

  it('SplitPause_Chosen_SavesIt', async () => {
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue(STORED) });
    render(<WorkdaySettings />);
    const pick = (await screen.findByRole('combobox', { name: 'A long pause starts a new entry' })) as HTMLSelectElement;
    await waitFor(() => expect(pick.value).toBe('15'));

    fireEvent.change(pick, { target: { value: '0' } });

    await saved(bridge, { splitPauseMinutes: 0 });
    expect(screen.getByText(/^Never: one entry per day\./)).toBeTruthy();
  });

  it('SplitPause_StoredOverADay_ShownAsItIsAndRefused', async () => {
    // A value no menu offers still reads as itself, and is said to be wrong.
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue({ ...STORED, splitPauseMinutes: 600 }) });
    render(<WorkdaySettings />);
    const pick = (await screen.findByRole('combobox', { name: 'A long pause starts a new entry' })) as HTMLSelectElement;
    await waitFor(() => expect(pick.value).toBe('600'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));

    expect(within(row('A long pause starts a new entry')).getByRole('alert').textContent).toMatch(/0 \(never\) to 480/);
    await savesNothing(bridge);
  });

  it('Reminder_DelayChosen_SavesTheFlowSetting', async () => {
    const bridge = installElectronApi();
    render(<WorkdaySettings />);
    const pick = (await screen.findByRole('combobox', { name: 'A pause that runs long' })) as HTMLSelectElement;
    await waitFor(() => expect(pick.disabled).toBe(false));
    expect(pick.value).toBe(String(DEFAULT_PROMPT_DELAYS.longPause));

    fireEvent.change(pick, { target: { value: '45' } });

    await waitFor(() => expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith(
      FlowSettingKey.PROMPT_DELAYS, { ...DEFAULT_PROMPT_DELAYS, longPause: 45 }
    ));
    expect(bridge.api.saveScheduleSettings).not.toHaveBeenCalled();
  });

  it('Reminder_SaveRefused_SaysSo', async () => {
    installElectronApi({ saveFlowSetting: vi.fn().mockRejectedValue(new Error('disk full')) });
    render(<WorkdaySettings />);
    const pick = (await screen.findByRole('combobox', { name: 'Nothing timing in working hours' })) as HTMLSelectElement;
    await waitFor(() => expect(pick.disabled).toBe(false));

    fireEvent.change(pick, { target: { value: '30' } });

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not change the reminders: .*disk full/);
  });

  it('ShowMe_EndOfDay_ShowsThePromptAndSaysSo', async () => {
    const bridge = installElectronApi();
    render(<WorkdaySettings />);

    fireEvent.click(within(await screen.findByRole('group', { name: 'End my day' })).getByRole('button', { name: 'Show me' }));

    expect(await screen.findByText('The end-of-day prompt is up.')).toBeTruthy();
    expect(bridge.api.triggerEodPrompt).toHaveBeenCalledTimes(1);
  });

  it('ShowMe_Standup_Refused_SaysSo', async () => {
    installElectronApi({ triggerStandupPrompt: vi.fn().mockResolvedValue({ success: false }) });
    render(<WorkdaySettings />);

    fireEvent.click(within(await screen.findByRole('group', { name: 'Stand-up' })).getByRole('button', { name: 'Show me' }));

    expect(await screen.findByText('Could not show the stand-up reminder.')).toBeTruthy();
  });

  it('EverySearchEntryOfTheGroup_IsARow', async () => {
    // The search sends the user here by these names: each must be a row.
    installElectronApi();
    render(<WorkdaySettings />);
    await screen.findByRole('group', { name: 'Stand-up' });

    for (const entry of SETTINGS_ENTRIES.filter(e => e.group === 'workday')) {
      expect(screen.getByRole('group', { name: entry.label }), entry.label).toBeTruthy();
    }
  });
});
