import { describe, it, expect } from 'vitest';
import {
  classifyDeviceResponse,
  toIsoWithLocalOffset
} from '../src/main/hardware/busybar-driver';

/**
 * The guide gives three non-2xx statuses distinct meanings, and the driver
 * collapsed all of them -- along with "no answer at all" -- into `false`. A
 * display legitimately owned by something else counted as a failed frame; a
 * device asking to be retried was never retried; an oversized payload was
 * resent until it was dropped.
 */
describe('Device response classification', () => {
  function response(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
  }

  it('ClassifyDeviceResponse_Success_IsOk', () => {
    expect(classifyDeviceResponse(response(200))).toBe('ok');
  });

  it('ClassifyDeviceResponse_409_IsAPriorityConflictNotAFailure', () => {
    // Something with a higher draw priority owns the display. The frame was
    // genuinely not wanted; nothing went wrong.
    expect(classifyDeviceResponse(response(409))).toBe('conflict');
  });

  it('ClassifyDeviceResponse_413_IsPermanent', () => {
    // Retrying sends the same bytes, so it can only fail the same way.
    expect(classifyDeviceResponse(response(413))).toBe('too_large');
  });

  it('ClassifyDeviceResponse_503_IsWorthRetrying', () => {
    expect(classifyDeviceResponse(response(503))).toBe('busy');
  });

  it('ClassifyDeviceResponse_OtherErrorStatus_IsAPlainError', () => {
    expect(classifyDeviceResponse(response(500))).toBe('error');
  });

  it('ClassifyDeviceResponse_NoResponse_IsUnreachable', () => {
    // A timeout and a refused connection are the same event to the caller.
    expect(classifyDeviceResponse(null)).toBe('unreachable');
  });
});

/**
 * The device sets its real-time clock from whatever string it is given and
 * applies no conversion of its own.
 */
describe('RTC timestamp formatting', () => {
  it('ToIsoWithLocalOffset_AnyDate_CarriesAnOffsetRatherThanZ', () => {
    // `toISOString` renders UTC with a `Z`, which left the bar showing UTC --
    // two hours behind for a user in Paris in summer.
    const formatted = toIsoWithLocalOffset(new Date());

    expect(formatted.endsWith('Z')).toBe(false);
    expect(formatted).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('ToIsoWithLocalOffset_AnyDate_RendersLocalWallClockTime', () => {
    const date = new Date(2026, 8, 5, 14, 30, 45);
    const formatted = toIsoWithLocalOffset(date);

    // The date and time components are the local ones, not their UTC equivalent.
    expect(formatted.startsWith('2026-09-05T14:30:45')).toBe(true);
  });

  it('ToIsoWithLocalOffset_AnyDate_IsParsedBackToTheSameInstant', () => {
    const date = new Date(2026, 0, 15, 9, 5, 3);

    expect(new Date(toIsoWithLocalOffset(date)).getTime()).toBe(date.getTime());
  });
});
