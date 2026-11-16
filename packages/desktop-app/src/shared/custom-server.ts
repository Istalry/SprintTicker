/**
 * A server on the SprintTicker Provider API (`Documentation/PROVIDER-API.md`):
 * what the window and main must agree on about its address.
 *
 * Shared because Settings checks the address as the user types it, and main
 * checks it again before sending the token anywhere: one rule, or the window
 * accepts an address main then refuses (CLAUDE.md §3).
 */

/** The contract this SprintTicker speaks; `/capabilities` must answer it. */
export const CUSTOM_SERVER_CONTRACT = 1;

/** The path every base URL ends with (PROVIDER-API 3.1). */
export const CUSTOM_SERVER_PATH_SUFFIX = `/v${CUSTOM_SERVER_CONTRACT}`;

/** Hosts where plain http is allowed: development only (PROVIDER-API 3.2). */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The address as typed, tidied: trimmed, without a trailing slash, and with
 * `https://` in front of a bare host -- never `http://`, which would send the
 * token in clear text to a server whose scheme the user did not spell out.
 */
export function sanitizeServerUrl(raw: string | null | undefined): string {
  let url = (raw ?? '').trim().replace(/\/+$/, '');
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/**
 * What is wrong with an address, in a sentence for the user, or null when
 * it is usable: https (http on this machine only), and ending in the
 * contract's version, `/v1`.
 */
export function serverUrlProblem(raw: string | null | undefined): string | null {
  const url = sanitizeServerUrl(raw);
  if (!url) return 'Enter the address of your server.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL at all: the sentence says what one looks like.
    return 'This is not an address. It looks like https://tracker.example.com/sprintticker/v1.';
  }
  if (parsed.protocol === 'http:' && !LOCAL_HOSTS.has(parsed.hostname)) {
    return 'The address must start with https://. Plain http is only for a server on this computer.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'The address must start with https://.';
  }
  if (parsed.search || parsed.hash) return 'The address has no ? or # part.';
  if (!parsed.pathname.endsWith(CUSTOM_SERVER_PATH_SUFFIX)) {
    return `The address ends with the version of the API, ${CUSTOM_SERVER_PATH_SUFFIX}.`;
  }
  return null;
}

/** True when the provider has an address it may use and a token. */
export function isCustomServerConfigured(url: string, token: string): boolean {
  return serverUrlProblem(url) === null && token.trim().length > 0;
}
