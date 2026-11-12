import { SettingsRepository } from '../db/repositories/settings-repository';
import { compareSemver } from '../updater/update-checker';
import { ArgumentException, ArgumentNullException } from '../../shared/dtos';
import { NoticeKind, NoticesDTO } from '../../shared/sync-health';

/** The version the user last saw Today on; an install records its own, silently. */
export const LAST_SEEN_VERSION_KEY = 'last_seen_version';
/** "No account yet" put away for good. */
export const NO_ACCOUNT_NOTICE_KEY = 'no_account_notice_dismissed';

/**
 * Today's one-time notices (S31, P11b): "Updated to 1.5.0", and "No account
 * yet". Kept in main, like every question, so a window opened later reads
 * the same thing and a dismissal holds across restarts.
 */
export class NoticeService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly currentVersion: string
  ) {
    if (!settings) throw new ArgumentNullException('settings');
    if (!currentVersion) throw new ArgumentNullException('currentVersion');
    // A fresh install has nothing to announce: it is its own first version.
    if (this.lastSeen() === null) this.settings.setSetting(LAST_SEEN_VERSION_KEY, currentVersion);
  }

  public getNotices(): NoticesDTO {
    const seen = this.lastSeen();
    return {
      updatedTo: seen !== null && compareSemver(this.currentVersion, seen) > 0 ? this.currentVersion : null,
      noAccountDismissed: this.settings.getSetting<boolean>(NO_ACCOUNT_NOTICE_KEY, false) === true
    };
  }

  /** Not now, or What's new: either way the notice has been seen. */
  public dismiss(kind: NoticeKind): NoticesDTO {
    if (kind === 'updated') this.settings.setSetting(LAST_SEEN_VERSION_KEY, this.currentVersion);
    else if (kind === 'no-account') this.settings.setSetting(NO_ACCOUNT_NOTICE_KEY, true);
    else throw new ArgumentException(`Unknown notice: ${String(kind)}.`, 'kind');
    return this.getNotices();
  }

  private lastSeen(): string | null {
    const value = this.settings.getSetting<string | null>(LAST_SEEN_VERSION_KEY, null);
    return typeof value === 'string' && value ? value : null;
  }
}
