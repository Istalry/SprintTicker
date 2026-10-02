/**
 * The Windows AppUserModelID: what Windows files this app's toasts and
 * taskbar button under.
 *
 * It must equal `appId` in electron-builder.json, which is the ID the
 * installer writes onto the Start-menu shortcut. Windows shows a toast only
 * for an ID it can tie to a shortcut, so with the two apart -- this used to
 * be `com.busybar.desktop` -- an installed copy could post toasts that never
 * appeared. A test holds them equal.
 */
export const APP_USER_MODEL_ID = 'io.github.istalry.sprintticker';

/**
 * Every ID this app has posted under. The notification listener skips them
 * all, so the app's own toasts are never mirrored back onto the bar -- they
 * reach it once, explicitly, from ProviderEventService. The old ID stays
 * because Windows keeps a notification's history under the ID it was posted
 * with.
 */
export const OWN_APP_USER_MODEL_IDS: readonly string[] = [APP_USER_MODEL_ID, 'com.busybar.desktop'];
