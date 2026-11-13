/**
 * The first run (S1–S3, redesign P11a): what main answers the three steps,
 * and how a failed Test connection is written out. Shared so the dialog and
 * main's tests read the same words.
 */

/** Whether the first run should open on its own: once, at the first launch. */
export const FIRST_RUN_DONE_KEY = 'first_run_done';

/** The credentials S1 tests, before anything is saved. */
export interface ConnectionTestRequestDTO {
  providerId: 'jira' | 'openproject';
  /** Jira's site, or the OpenProject server's address. */
  site: string;
  /** Jira's account email; OpenProject has none. */
  email?: string;
  /** Jira's API token, or OpenProject's API key. */
  token: string;
}

/** Why a Test connection failed, each with its own sentence (S31). */
export type ConnectionFailure = 'incomplete' | 'not-found' | 'refused' | 'network' | 'failed';

export type ConnectionTestDTO =
  | { ok: true; userName: string; projectCount: number }
  | { ok: false; reason: ConnectionFailure; host: string | null; detail: string };

/** What S2 found on the desk; only a device found starts ticked. */
export interface DeskDetectionDTO {
  bar: {
    /** The bar answered at its configured address. */
    found: boolean;
    address: string;
    connectionType: 'usb' | 'wifi' | null;
  };
  deck: {
    /** Elgato's Stream Deck app is installed for this user. */
    installed: boolean;
    /** A deck runs the plugin and is connected to the app now. */
    connected: boolean;
    /** How many decks are connected: each phone or device runs its own plugin. */
    count: number;
  };
}

/**
 * The Stream Deck plugin the installer carries, under `resources/`
 * (`electron-builder.json`'s `extraResources`), and the pack `pnpm deck:pack`
 * writes to the plugin's `dist/`. `package:win` packs it first.
 */
export const DECK_PLUGIN_RESOURCE = 'StreamDeck/SprintTicker.streamDeckPlugin';
export const DECK_PLUGIN_PACK = 'io.github.istalry.sprintticker.streamDeckPlugin';

/** Where a new API token is made: "make one ↗". */
export const TOKEN_PAGE = {
  jira: 'https://id.atlassian.com/manage-profile/security/api-tokens'
} as const;

/** The page that makes an OpenProject API key, on the server the user typed. */
export function openProjectTokenPage(site: string): string | null {
  const host = hostOf(site);
  return host ? `https://${host}/my/access_tokens` : null;
}

/** The host of what the user typed, `https://` assumed; null when it is not an address. */
export function hostOf(site: string): string | null {
  const trimmed = site.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname || null;
  } catch {
    // Not an address at all: there is no host to name.
    return null;
  }
}

/**
 * A failed Test connection, as S1 writes it: the headline and what to do.
 * `providerName` is "Jira" or "OpenProject".
 */
export function connectionFailureText(
  failure: Extract<ConnectionTestDTO, { ok: false }>,
  providerName: string
): { headline: string; hint: string } {
  const host = failure.host ?? 'That address';
  switch (failure.reason) {
    case 'incomplete':
      return { headline: 'Some fields are empty', hint: 'Fill in each field, then test again.' };
    case 'not-found':
      return {
        headline: `${host} was not found`,
        hint: `Check the address: it is the one in your browser when you open ${providerName}.`
      };
    case 'refused':
      return {
        headline: `${providerName} refused this token`,
        hint: 'It may be mistyped, expired or revoked.'
      };
    case 'network':
      return {
        headline: `${host} did not answer`,
        hint: 'Check your network connection, then test again.'
      };
    case 'failed':
      return { headline: `${providerName} answered with an error`, hint: failure.detail };
  }
}
