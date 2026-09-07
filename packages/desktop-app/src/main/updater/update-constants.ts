/**
 * Tuning for the update check.
 *
 * The check is a notification, not an installer. Builds are unsigned, so every
 * automatic update would re-trigger SmartScreen and some would be blocked
 * outright -- an in-app download would be a worse route than the manual one it
 * replaced. See ROADMAP.md §2; this becomes a real updater the day there is a
 * certificate, not before.
 */

/**
 * The releases endpoint.
 *
 * `/releases/latest` deliberately: it returns the most recent **published,
 * non-draft, non-prerelease** release, which is what makes the draft releases
 * CI produces invisible here until they are reviewed and published.
 */
export const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/Istalry/SprintTicker/releases/latest';

/**
 * GitHub rejects unauthenticated API requests without a User-Agent, so this is
 * required rather than decorative.
 */
export const UPDATE_CHECK_USER_AGENT = 'SprintTicker';

/** Abort a check rather than leaving a request pending against a dead network. */
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/**
 * Delay before the first check.
 *
 * Startup already opens the database, connects the device, binds the webhook
 * server and spawns the notification listener. An update check is the least
 * urgent thing the app does and should not compete with any of them.
 */
export const UPDATE_CHECK_STARTUP_DELAY_MS = 30_000;

/**
 * Between checks thereafter.
 *
 * Unauthenticated GitHub allows 60 requests an hour per address, so the ceiling
 * is nowhere near binding; this interval is about not being noisy, not about
 * rate limits.
 */
export const UPDATE_CHECK_INTERVAL_MS = 86_400_000; // 24 hours
