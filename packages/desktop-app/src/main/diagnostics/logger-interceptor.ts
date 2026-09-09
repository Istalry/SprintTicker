import util from 'util';

/**
 * Copies everything written to `console` into a bounded in-memory ring, so the
 * diagnostics export can carry the log a user would otherwise have to find in a
 * terminal they never opened.
 *
 * **What goes through here reaches a bug report.** `DiagnosticExporter` puts
 * `getLogs()` straight into the bundle users are asked to attach, which is how
 * notification titles and bodies once left the machine -- see
 * `notification-redaction.ts`. Anything logged about a notification must be
 * redacted at the call site; this class cannot tell content from diagnostics
 * and does not try.
 */
export class LoggerInterceptor {
  private static instance: LoggerInterceptor;
  private logs: string[] = [];
  private readonly MAX_LOGS = 2000;

  private originalLog: typeof console.log;
  private originalWarn: typeof console.warn;
  private originalError: typeof console.error;

  private constructor() {
    this.originalLog = console.log;
    this.originalWarn = console.warn;
    this.originalError = console.error;
  }

  public static getInstance(): LoggerInterceptor {
    if (!LoggerInterceptor.instance) {
      LoggerInterceptor.instance = new LoggerInterceptor();
    }
    return LoggerInterceptor.instance;
  }

  private intercepting = false;

  /**
   * Redirects `console` through this class. Safe to call more than once.
   *
   * The guard is not defensive tidiness. Without it a second call captures the
   * *first* call's wrapper as the "original", so every line would be recorded
   * twice and `restore()` would only unwrap one layer, leaving `console`
   * permanently wrapped. The originals are re-read here rather than in the
   * constructor so that what is restored is whatever was in place when
   * interception actually began.
   */
  public intercept(): void {
    if (this.intercepting) return;
    this.intercepting = true;
    this.originalLog = console.log;
    this.originalWarn = console.warn;
    this.originalError = console.error;

    console.log = (...args: unknown[]) => {
      this.capture('INFO', ...args);
      this.originalLog.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      this.capture('WARN', ...args);
      this.originalWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      this.capture('ERROR', ...args);
      this.originalError.apply(console, args);
    };
  }

  private capture(level: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    this.logs.push(`[${timestamp}] [${level}] ${message}`);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
  }

  /**
   * Puts the original `console` methods back.
   *
   * Needed because `intercept()` is otherwise irreversible on a process-wide
   * singleton: a test that intercepts leaves every later test in the same
   * worker logging through this class, and vitest forwards each captured line
   * over its rpc channel. That is the mechanism behind the
   * `Closing rpc while onUserConsoleLog was pending` teardown failure recorded
   * in ROADMAP -- a green suite that exits non-zero. Any caller that intercepts
   * outside the main process must restore.
   */
  public restore(): void {
    if (!this.intercepting) return;
    this.intercepting = false;
    console.log = this.originalLog;
    console.warn = this.originalWarn;
    console.error = this.originalError;
  }

  /** Empties the ring. Exists so a test starts from a known state, not for production use. */
  public clear(): void {
    this.logs = [];
  }

  public getLogs(): string[] {
    return [...this.logs];
  }
}
