import { SettingsRepository } from '../db/repositories/settings-repository';
import { ArgumentNullException, UpdateStatusDTO } from '../../shared/dtos';
import {
  GITHUB_LATEST_RELEASE_URL,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_CHECK_USER_AGENT
} from './update-constants';

/** Raised when a check could not be completed. Never used to mean "up to date". */
export class UpdateCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateCheckError';
  }
}

/**
 * Compares two `MAJOR.MINOR.PATCH` versions.
 *
 * Returns a negative number when `a` precedes `b`, positive when it follows,
 * zero when they are equal.
 *
 * A pre-release suffix (`1.2.0-beta.1`) sorts *before* the release it precedes,
 * as semver requires -- otherwise a beta tester running `1.2.0-beta.1` would
 * never be told that `1.2.0` exists. Suffixes are compared as plain strings,
 * which is enough for the endpoint this reads: it never returns a pre-release.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, ...rest] = v.replace(/^v/, '').split('-');
    const parts = core.split('.').map(n => Number.parseInt(n, 10));
    return {
      numbers: [parts[0] || 0, parts[1] || 0, parts[2] || 0],
      preRelease: rest.join('-')
    };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] - right.numbers[i];
  }

  // Equal cores: a version carrying a pre-release suffix precedes the one without.
  if (left.preRelease === right.preRelease) return 0;
  if (!left.preRelease) return 1;
  if (!right.preRelease) return -1;
  return left.preRelease < right.preRelease ? -1 : 1;
}

/** The shape this reads out of the GitHub releases response. */
interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
}

/**
 * Asks GitHub whether a newer release exists, and reports honestly when it
 * could not find out.
 *
 * The service this replaces (audit F-18) logged "checking for updates" and
 * never checked, so the one rule here is that no failure may be reported as
 * success or as "up to date": a check that did not happen throws.
 */
export class UpdateChecker {
  public static readonly SETTINGS_KEY = 'enable_update_check';

  private readonly _currentVersion: string;
  private readonly _settingsRepo: SettingsRepository;
  private readonly _fetch: typeof globalThis.fetch;

  /**
   * `fetch` is injected so tests never reach the network, and the version is
   * passed in rather than read from `app.getVersion()` so this module carries
   * no dependency on Electron and can be exercised under Vitest.
   */
  constructor(
    currentVersion: string,
    settingsRepo: SettingsRepository,
    fetchFn: typeof globalThis.fetch = globalThis.fetch
  ) {
    if (!currentVersion) throw new ArgumentNullException('currentVersion');
    if (!settingsRepo) throw new ArgumentNullException('settingsRepo');

    this._currentVersion = currentVersion;
    this._settingsRepo = settingsRepo;
    this._fetch = fetchFn;
  }

  /** Whether the user has left the check enabled. */
  public isEnabled(): boolean {
    return this._settingsRepo.getSetting<boolean>(UpdateChecker.SETTINGS_KEY, true);
  }

  public setEnabled(enabled: boolean): void {
    this._settingsRepo.setSetting(UpdateChecker.SETTINGS_KEY, enabled);
  }

  /**
   * Performs one check.
   *
   * @throws {UpdateCheckError} if the request failed, timed out, or returned
   * something this cannot read. The caller decides what to show; it must not
   * decide that a failure means there is no update.
   */
  public async checkForUpdate(): Promise<UpdateStatusDTO> {
    if (!this.isEnabled()) {
      return { status: 'disabled', currentVersion: this._currentVersion };
    }

    let response: Response;
    try {
      response = await this._fetch(GITHUB_LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': UPDATE_CHECK_USER_AGENT
        },
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS)
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new UpdateCheckError(`Could not reach GitHub: ${reason}`);
    }

    // 404 is the ordinary answer before the first release is published, not a
    // fault -- but it is still not "you are up to date", so say what it is.
    if (response.status === 404) {
      throw new UpdateCheckError('No published release to compare against yet.');
    }

    if (!response.ok) {
      throw new UpdateCheckError(`GitHub returned ${response.status}.`);
    }

    let release: GitHubRelease;
    try {
      release = (await response.json()) as GitHubRelease;
    } catch {
      throw new UpdateCheckError('GitHub returned a response this could not read.');
    }

    const latestVersion = (release.tag_name || '').replace(/^v/, '');
    if (!latestVersion) {
      throw new UpdateCheckError('The latest release carries no tag name.');
    }

    if (compareSemver(latestVersion, this._currentVersion) <= 0) {
      return { status: 'up-to-date', currentVersion: this._currentVersion };
    }

    return {
      status: 'update-available',
      currentVersion: this._currentVersion,
      latestVersion,
      releaseUrl: release.html_url || 'https://github.com/Istalry/SprintTicker/releases/latest'
    };
  }
}
