import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LoggerInterceptor } from '../src/main/diagnostics/logger-interceptor';
import { redactNotificationSummary, resetNotificationDebugCache } from '../src/main/diagnostics/notification-redaction';

/**
 * `LoggerInterceptor` is a process-wide singleton that replaces `console`, and
 * whatever it captures is put into the diagnostics bundle users attach to bug
 * reports. Both of those make it worth testing and awkward to test:
 *
 * - Every case must `restore()`. Leaving the interception in place would route
 *   every later test in this worker through it, and vitest forwards captured
 *   console lines over rpc -- the mechanism behind the
 *   `Closing rpc while onUserConsoleLog was pending` teardown failure that
 *   exits non-zero on a run where every test passed.
 * - The real `console` methods are stubbed first, so the suite's own output is
 *   not multiplied by the lines these tests deliberately write.
 */
describe('LoggerInterceptor', () => {
  let interceptor: LoggerInterceptor;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    interceptor = LoggerInterceptor.getInstance();
    interceptor.clear();
  });

  afterEach(() => {
    interceptor.restore();
    interceptor.clear();
    vi.restoreAllMocks();
  });

  it('GetInstance_CalledTwice_ReturnsSameInstance', () => {
    expect(LoggerInterceptor.getInstance()).toBe(LoggerInterceptor.getInstance());
  });

  it('Intercept_ConsoleLog_CapturesWithInfoLevel', () => {
    interceptor.intercept();
    console.log('engine started');

    const logs = interceptor.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('[INFO]');
    expect(logs[0]).toContain('engine started');
  });

  it('Intercept_WarnAndError_TagTheirOwnLevels', () => {
    interceptor.intercept();
    console.warn('provider slow');
    console.error('provider failed');

    const logs = interceptor.getLogs();
    expect(logs[0]).toContain('[WARN]');
    expect(logs[1]).toContain('[ERROR]');
  });

  it('Intercept_AnyLevel_StillWritesToTheRealConsole', () => {
    // Held before intercepting: afterwards `console.log` is the wrapper, and the
    // spy is what it delegates to.
    const realConsoleLog = vi.mocked(console.log);
    interceptor.intercept();
    console.log('passed through');

    // Capturing must not swallow output: a developer watching the terminal has
    // to keep seeing what the app prints.
    expect(realConsoleLog).toHaveBeenCalledWith('passed through');
  });

  it('Intercept_MultipleArguments_FormatsThemLikeConsoleDoes', () => {
    interceptor.intercept();
    console.log('sync %s finished in %dms', 'jira', 42, { rows: 3 });

    // util.format, not a join: the placeholders are the reason the raw
    // arguments are not simply concatenated.
    expect(interceptor.getLogs()[0]).toContain('sync jira finished in 42ms');
    expect(interceptor.getLogs()[0]).toContain('rows: 3');
  });

  it('Intercept_EntryWritten_IsPrefixedWithAnIsoTimestamp', () => {
    interceptor.intercept();
    console.log('anything');

    expect(interceptor.getLogs()[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] /);
  });

  it('Intercept_MoreThanTheCap_DropsOldestAndKeepsNewest', () => {
    interceptor.intercept();
    for (let i = 0; i < 2050; i++) console.log(`line ${i}`);

    const logs = interceptor.getLogs();
    // The ring is bounded so a long-running session cannot grow it without
    // limit; it is the oldest that must go, since the newest lines are the
    // ones next to whatever went wrong.
    expect(logs).toHaveLength(2000);
    expect(logs[logs.length - 1]).toContain('line 2049');
    expect(logs.some(l => l.includes('line 0'))).toBe(false);
  });

  it('GetLogs_MutatedByCaller_DoesNotChangeTheBuffer', () => {
    interceptor.intercept();
    console.log('original');

    interceptor.getLogs().push('injected by a caller');

    expect(interceptor.getLogs()).toHaveLength(1);
    expect(interceptor.getLogs()[0]).toContain('original');
  });

  it('Intercept_CalledTwice_DoesNotRecordEachLineTwice', () => {
    interceptor.intercept();
    interceptor.intercept();
    console.log('once');

    // Without the idempotence guard the second call wraps the first wrapper,
    // so every line is captured twice and restore() unwraps only one layer.
    expect(interceptor.getLogs()).toHaveLength(1);
  });

  it('Restore_AfterIntercept_StopsCapturingAndPutsConsoleBack', () => {
    const before = console.log;
    interceptor.intercept();
    expect(console.log).not.toBe(before);

    interceptor.restore();
    console.log('after restore');

    expect(console.log).toBe(before);
    expect(interceptor.getLogs()).toHaveLength(0);
  });

  it('Restore_CalledWithoutIntercept_IsASafeNoOp', () => {
    const before = console.log;
    interceptor.restore();
    expect(console.log).toBe(before);
  });

  it('Intercept_RedactedNotificationSummary_KeepsMessageTextOutOfTheBundle', () => {
    // The reason this class is worth testing at all. Its output goes into the
    // diagnostics bundle users attach to bug reports, which is how 1,175 real
    // toast records once left a machine. Redaction happens at the call site --
    // the interceptor cannot tell content from diagnostics -- so what is
    // asserted here is that a correctly redacted line stays redacted all the
    // way through.
    resetNotificationDebugCache();
    interceptor.intercept();

    console.log(`[Notification] Slack: ${redactNotificationSummary('Standup', 'the merge is blocked')}`);

    const line = interceptor.getLogs()[0];
    expect(line).not.toContain('the merge is blocked');
    expect(line).not.toContain('Standup');
    expect(line).toContain('<redacted');
    expect(line).toContain('Slack'); // the app name identifies the rule and is not content
  });
});
