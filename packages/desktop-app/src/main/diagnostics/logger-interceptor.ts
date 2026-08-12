import util from 'util';

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

  public intercept(): void {
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

  public getLogs(): string[] {
    return [...this.logs];
  }
}
