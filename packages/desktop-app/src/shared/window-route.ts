/**
 * Where the window opens when something outside it asks (redesign P12): the
 * tray's End my day…, and the toasts that lead somewhere (P12c). Main names
 * the place; the window decides how to show it.
 *
 * - `today`: Today, where every question waits as a card.
 * - `end-day`: Today with End my day open.
 * - `undo`: Today with the Undo bar's button focused.
 * - `account`: Settings › Account, where credentials are entered again.
 */
export type WindowRoute = 'today' | 'end-day' | 'undo' | 'account';

const ROUTES: readonly WindowRoute[] = ['today', 'end-day', 'undo', 'account'];

export function isWindowRoute(value: unknown): value is WindowRoute {
  return typeof value === 'string' && (ROUTES as readonly string[]).includes(value);
}
