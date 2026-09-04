/**
 * Keeps notification content out of anything that is stored or exported.
 *
 * This is not hypothetical tidiness: a WAL captured from the Windows
 * notification database, containing 1,175 real toast records with channel names
 * and message text, was committed to this repository. Titles and bodies also
 * reached `console.log` on every notification, from where `LoggerInterceptor`
 * copied them into the diagnostics export that users are asked to attach to bug
 * reports.
 *
 * Default is to redact. `--debug-notifications` restores full text for local
 * troubleshooting, because otherwise the only way to find out why a rule matched
 * the wrong app is to add a `console.log` and rebuild.
 */

let cachedFlag: boolean | null = null;

/**
 * Whether the process was launched with `--debug-notifications`.
 *
 * Read from `process.argv` rather than a setting so it cannot be turned on
 * persistently by accident, and so it is visible in the command that started the
 * app.
 */
export function isNotificationDebugEnabled(): boolean {
  if (cachedFlag === null) {
    cachedFlag = process.argv.includes('--debug-notifications');
  }
  return cachedFlag;
}

/** Test seam; also used when argv is rewritten between runs. */
export function resetNotificationDebugCache(): void {
  cachedFlag = null;
}

/**
 * Replaces notification text with a length-only placeholder.
 *
 * The length is kept because it distinguishes "the body was empty" from "the
 * body was dropped", which is the distinction most listener bugs turn on.
 */
export function redactNotificationText(text: string | undefined | null): string {
  if (text === undefined || text === null) return '';
  if (isNotificationDebugEnabled()) return text;
  if (text.length === 0) return '';
  return `<redacted ${text.length} chars>`;
}

/**
 * Redacts a `title: body` pair into a single log-safe fragment.
 *
 * App id and app name are deliberately *not* redacted -- they identify which
 * rule matched, carry no message content, and are the whole point of the log.
 */
export function redactNotificationSummary(
  title: string | undefined | null,
  body?: string | undefined | null
): string {
  const parts = [redactNotificationText(title), redactNotificationText(body)].filter(Boolean);
  return parts.join(': ');
}
