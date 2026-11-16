import { LOCAL_API_PORT } from '../../shared/deck-protocol';

/** The switch that moves the local API off its port: `--local-api-port=39124`. */
export const LOCAL_API_PORT_SWITCH = '--local-api-port=';

/**
 * The port the local API listens on: {@link LOCAL_API_PORT}, unless the
 * command line names another.
 *
 * For the checks that start a second SprintTicker beside the user's own --
 * `verify:packed`, the documentation's capture. Both run on a throwaway
 * profile, so the single-instance lock, which is per profile, lets them
 * start; but the port is one per machine, and the user's app holds it with
 * their bar and their Stream Deck behind it. `verify:packed` used to
 * taskkill every SprintTicker.exe to get it back -- the user's included.
 *
 * Nothing the user runs passes this: the Stream Deck plugin and every
 * caller of the local API know only {@link LOCAL_API_PORT}. A value that is
 * not a port above 1023 is ignored, never half-applied.
 */
export function localApiPortFrom(argv: readonly string[]): number {
  const arg = argv.find(a => a.startsWith(LOCAL_API_PORT_SWITCH));
  if (!arg) return LOCAL_API_PORT;
  const value = arg.slice(LOCAL_API_PORT_SWITCH.length);
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(port) && port > 1023 && port <= 65535 ? port : LOCAL_API_PORT;
}
