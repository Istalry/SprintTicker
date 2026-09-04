/**
 * Single source of truth for task-provider setting keys and their defaults.
 *
 * These values are read in the main process (ProviderManager, IPCHandlerRegistry)
 * and seeded in the renderer's settings form. Duplicating them per call site is
 * how `op_domain` ended up shipping a developer's personal LAN address in the
 * packaged binary, and how the notification defaults drifted apart between the
 * two processes.
 *
 * This module is pure data with no imports, so it is safe on both sides of the
 * context bridge.
 */

/** Setting keys as stored in the `settings` table. */
export const ProviderSettingKey = {
  ACTIVE_PROVIDER_ID: 'active_provider_id',
  FALLBACK_TICKET_KEY: 'fallback_ticket_key',
  OP_DOMAIN: 'op_domain',
  OP_API_KEY: 'op_api_key',
  OP_STATUS_IN_PROGRESS: 'op_status_in_progress',
  OP_STATUS_TO_TEST: 'op_status_to_test',
  OP_STATUS_TO_REVIEW: 'op_status_to_review',
  OP_COMPLETION_ACTION: 'op_completion_action'
} as const;

/** Union of the setting-key string literals above. */
export type ProviderSettingKeyValue = (typeof ProviderSettingKey)[keyof typeof ProviderSettingKey];

/**
 * Defaults applied when a setting has never been written.
 *
 * `OP_DOMAIN` and `OP_API_KEY` are intentionally empty: an unconfigured
 * install has no OpenProject instance to talk to, and inventing one produces
 * connection errors that look like the user's fault. Callers must treat an
 * empty domain as "not configured" rather than as a failed request.
 */
export const PROVIDER_SETTING_DEFAULTS = {
  [ProviderSettingKey.ACTIVE_PROVIDER_ID]: 'openproject',
  [ProviderSettingKey.FALLBACK_TICKET_KEY]: 'MISC-1',
  [ProviderSettingKey.OP_DOMAIN]: '',
  [ProviderSettingKey.OP_API_KEY]: '',
  [ProviderSettingKey.OP_STATUS_IN_PROGRESS]: 'In progress',
  [ProviderSettingKey.OP_STATUS_TO_TEST]: 'In testing',
  [ProviderSettingKey.OP_STATUS_TO_REVIEW]: 'Developed',
  [ProviderSettingKey.OP_COMPLETION_ACTION]: 'to_review'
} as const satisfies Record<string, string>;

/** True when the OpenProject provider has enough configuration to issue a request. */
export function isOpenProjectConfigured(domain: string, apiKey: string): boolean {
  return domain.trim().length > 0 && apiKey.trim().length > 0;
}
