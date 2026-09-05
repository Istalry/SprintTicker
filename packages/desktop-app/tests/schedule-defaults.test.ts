import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  normalizeScheduleSettings
} from '../src/shared/schedule-defaults';

describe('Schedule Defaults Unit Tests', () => {
  it('NormalizeScheduleSettings_NoStoredRow_ReturnsBothSpellingsOfEveryAlias', () => {
    const s = normalizeScheduleSettings(undefined);

    // A fresh install used to get one spelling or the other depending on
    // whether the settings screen or the scheduler read the row first.
    expect(s.lunchStartTime).toBe(s.lunchStart);
    expect(s.lunchEndTime).toBe(s.lunchEnd);
    expect(s.eodWrapUpTime).toBe(s.eodTime);
    expect(s.promptTimeoutSeconds).toBe(s.autoDismissSeconds);
  });

  it('NormalizeScheduleSettings_ShortAliasesOnly_ResolvesToCanonicalNames', () => {
    const s = normalizeScheduleSettings({
      lunchStart: '11:00',
      lunchEnd: '11:45',
      eodTime: '16:00',
      autoDismissSeconds: 30
    });

    expect(s.lunchStartTime).toBe('11:00');
    expect(s.lunchEndTime).toBe('11:45');
    expect(s.eodWrapUpTime).toBe('16:00');
    expect(s.promptTimeoutSeconds).toBe(30);
  });

  it('NormalizeScheduleSettings_CanonicalNamesOnly_PopulatesTheShortAliases', () => {
    const s = normalizeScheduleSettings({
      lunchStartTime: '11:00',
      eodWrapUpTime: '16:00',
      promptTimeoutSeconds: 30
    });

    expect(s.lunchStart).toBe('11:00');
    expect(s.eodTime).toBe('16:00');
    expect(s.autoDismissSeconds).toBe(30);
  });

  it('NormalizeScheduleSettings_AliasesDisagree_CanonicalNameWins', () => {
    // Real rows contain both keys, written by the Ceremonies view. If a writer
    // ever updates one and not the other, the scheduler's reading is the one
    // the user has actually been experiencing, so it is the one preserved.
    const s = normalizeScheduleSettings({ lunchStartTime: '12:30', lunchStart: '09:00' });

    expect(s.lunchStartTime).toBe('12:30');
    expect(s.lunchStart).toBe('12:30');
  });

  it('NormalizeScheduleSettings_ZeroTimeout_IsPreservedRatherThanTreatedAsUnset', () => {
    // 0 means "wait indefinitely". A `||` fallback would silently replace it.
    const s = normalizeScheduleSettings({ promptTimeoutSeconds: 0 });

    expect(s.promptTimeoutSeconds).toBe(0);
    expect(s.autoDismissSeconds).toBe(0);
  });

  it('NormalizeScheduleSettings_DisabledStandup_IsNotOverriddenByTheDefault', () => {
    const s = normalizeScheduleSettings({ enableStandupPrompt: false });

    expect(s.enableStandupPrompt).toBe(false);
  });

  it('DefaultScheduleSettings_ContainNoPersonalCalendarValues', () => {
    // These shipped as 10:05 and 12:18 -- one developer's real calendar.
    expect(DEFAULT_SCHEDULE_SETTINGS.standupTime).toBe('09:30');
    expect(DEFAULT_SCHEDULE_SETTINGS.lunchStartTime).toBe('12:30');
    for (const t of Object.values(DEFAULT_SCHEDULE_SETTINGS)) {
      if (typeof t === 'string') expect(t).toMatch(/^\d{2}:(00|30)$/);
    }
  });
});
