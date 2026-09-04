import { describe, it, expect, afterEach } from 'vitest';
import {
  isNotificationDebugEnabled,
  redactNotificationSummary,
  redactNotificationText,
  resetNotificationDebugCache
} from '../src/main/diagnostics/notification-redaction';

/**
 * Notification titles and bodies are the user's private messages. They reached
 * `console.log` on every notification, and from there the diagnostics export
 * that users are asked to attach to bug reports.
 */
describe('Notification redaction', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    resetNotificationDebugCache();
  });

  function withDebugFlag(): void {
    process.argv = [...originalArgv, '--debug-notifications'];
    resetNotificationDebugCache();
  }

  it('RedactNotificationText_ByDefault_ReplacesContentWithALengthOnlyPlaceholder', () => {
    expect(redactNotificationText('Payroll spreadsheet attached')).toBe('<redacted 28 chars>');
  });

  it('RedactNotificationText_EmptyString_StaysEmpty', () => {
    // "The body was empty" and "the body was dropped" are different bugs, and
    // the placeholder has to keep them apart.
    expect(redactNotificationText('')).toBe('');
  });

  it('RedactNotificationText_NullOrUndefined_ReturnsEmptyString', () => {
    expect(redactNotificationText(null)).toBe('');
    expect(redactNotificationText(undefined)).toBe('');
  });

  it('RedactNotificationSummary_TitleAndBody_JoinsBothPlaceholders', () => {
    expect(redactNotificationSummary('Bob', 'ping')).toBe('<redacted 3 chars>: <redacted 4 chars>');
  });

  it('RedactNotificationSummary_TitleOnly_OmitsTheSeparator', () => {
    expect(redactNotificationSummary('Bob')).toBe('<redacted 3 chars>');
  });

  it('IsNotificationDebugEnabled_WithoutTheFlag_IsFalse', () => {
    process.argv = originalArgv.filter(arg => arg !== '--debug-notifications');
    resetNotificationDebugCache();

    expect(isNotificationDebugEnabled()).toBe(false);
  });

  it('RedactNotificationText_WithDebugFlag_ReturnsTheOriginalText', () => {
    // Without an escape hatch, the only way to find out why a rule matched the
    // wrong app is to add a console.log and rebuild.
    withDebugFlag();

    expect(isNotificationDebugEnabled()).toBe(true);
    expect(redactNotificationText('Payroll spreadsheet')).toBe('Payroll spreadsheet');
    expect(redactNotificationSummary('Bob', 'ping')).toBe('Bob: ping');
  });
});
