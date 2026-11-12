/**
 * Where the window opens when something outside it asks (redesign P12): the
 * tray's End my day…, and the toasts that lead somewhere. Main names the
 * place; the window decides how to show it.
 */
export type WindowRoute = 'today' | 'end-day';

const ROUTES: readonly WindowRoute[] = ['today', 'end-day'];

export function isWindowRoute(value: unknown): value is WindowRoute {
  return typeof value === 'string' && (ROUTES as readonly string[]).includes(value);
}
