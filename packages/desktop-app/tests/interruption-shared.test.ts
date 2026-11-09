import { describe, it, expect } from 'vitest';
import { IdPrefix } from '../src/main/db/id-generator';
import {
  ADHOC_TASK_ID_PREFIX,
  AD_HOC_TITLE_MAX_CHARS,
  checkAdHocTitle,
  interruptionTitle,
  isAdHocSession
} from '../src/shared/interruption';

/**
 * The parts of Interrupt the window shares with main: the made-up name, the
 * rule for a name the user gives, and telling ad-hoc work apart.
 */
describe('interruption, shared', () => {
  it('AdHocTaskIdPrefix_IsMains', () => {
    // Two copies of one constant: the renderer cannot import main's.
    expect(ADHOC_TASK_ID_PREFIX).toBe(IdPrefix.ADHOC_TASK);
  });

  it('InterruptionTitle_LocalTime_TwoDigitHoursAndMinutes', () => {
    expect(interruptionTitle(new Date(2026, 10, 9, 9, 5))).toBe('Interruption 09:05');
    expect(interruptionTitle(new Date(2026, 10, 9, 14, 32))).toBe('Interruption 14:32');
  });

  it('CheckAdHocTitle_Spaces_AreTrimmed', () => {
    expect(checkAdHocTitle('  Call with Marc  ')).toBe('Call with Marc');
  });

  it.each([[''], ['   '], [undefined], [42], ['x'.repeat(AD_HOC_TITLE_MAX_CHARS + 1)]])(
    'CheckAdHocTitle_Refused_%#', title => {
      expect(() => checkAdHocTitle(title)).toThrow();
    }
  );

  it('CheckAdHocTitle_AtTheLimit_IsTaken', () => {
    expect(checkAdHocTitle('x'.repeat(AD_HOC_TITLE_MAX_CHARS))).toHaveLength(AD_HOC_TITLE_MAX_CHARS);
  });

  it('IsAdHocSession_ByTheFlagOrTheId', () => {
    expect(isAdHocSession({ isAdHoc: true, taskId: '10001' })).toBe(true);
    // A row started again from a list carries the flag false.
    expect(isAdHocSession({ isAdHoc: false, taskId: 'adhoc_1_x' })).toBe(true);
    expect(isAdHocSession({ isAdHoc: false, taskId: '10001' })).toBe(false);
  });
});
