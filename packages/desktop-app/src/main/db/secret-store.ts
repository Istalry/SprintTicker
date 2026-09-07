import { safeStorage } from 'electron';
import { SettingsRepository } from './repositories/settings-repository';

/**
 * Marker on a stored value that has been encrypted, and the format version.
 *
 * A prefix rather than a separate column, because every install that already
 * exists has a plaintext key sitting in `settings` and there has to be a way to
 * tell the two apart on read. Versioned so a future format change can migrate
 * rather than guess.
 */
const ENCRYPTED_PREFIX = 'enc:v1:';

/** The subset of Electron's `safeStorage` this module needs. */
export interface SecretCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Encryption backed by the OS keystore -- DPAPI on Windows, Keychain on macOS,
 * libsecret on Linux.
 *
 * Every method is guarded, because `safeStorage` is not always there to be
 * called. Under Vitest the `electron` module resolves to a path string, so the
 * import above is `undefined` rather than an error; on Linux without a keyring
 * the API exists but reports no encryption. Both degrade to plaintext, which is
 * what the app did before this module existed.
 */
const electronCrypto: SecretCrypto = {
  // Deliberately called per operation, never cached at module load. On macOS
  // and Linux `isEncryptionAvailable()` answers false until `app.ready`, and a
  // value read at import time would pin the answer to the wrong one.
  isEncryptionAvailable: () => {
    try {
      return safeStorage?.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  },
  encryptString: (plainText: string) => safeStorage.encryptString(plainText),
  decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted)
};

/**
 * Reads and writes the settings that hold credentials.
 *
 * Separate from {@link SettingsRepository} rather than folded into it: only two
 * settings are secrets, and making every read go through decryption would mean
 * every caller had to care about a keystore that might not answer. Callers name
 * a secret explicitly by using this class.
 *
 * What this protects against is a plaintext API key on disk -- read by a backup
 * tool, a file-sync client, or anything else running as the user. It is not a
 * defence against the user's own account being compromised, because DPAPI
 * unwraps for exactly that account.
 */
export class SecretStore {
  private readonly _settingsRepo: SettingsRepository;
  private readonly _crypto: SecretCrypto;
  /** So an unavailable keystore is reported once, not on every read. */
  private _warnedUnavailable = false;

  constructor(settingsRepo: SettingsRepository, crypto: SecretCrypto = electronCrypto) {
    if (!settingsRepo) throw new Error('SecretStore requires a SettingsRepository.');
    this._settingsRepo = settingsRepo;
    this._crypto = crypto;
  }

  /**
   * Returns the plaintext secret, or the empty string when there is none.
   *
   * Never throws. A caller that cannot read a credential must see the same
   * thing it sees on a fresh install -- "not configured" -- because the
   * alternative is a crash on a code path the user reaches by copying their
   * database to a new machine.
   */
  public getSecret(key: string): string {
    if (!key) throw new Error('Secret key is required');

    const stored = this._settingsRepo.getSetting<string>(key, '');
    if (typeof stored !== 'string' || stored.length === 0) return '';

    if (!stored.startsWith(ENCRYPTED_PREFIX)) {
      // Written before this module existed, or written while the keystore was
      // unavailable. Upgrade it in place so the plaintext stops sitting there,
      // but return it either way -- a failed upgrade must not lose the key.
      this.setSecret(key, stored);
      return stored;
    }

    try {
      return this._crypto.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'));
    } catch (err) {
      // Expected whenever the database is opened by a different OS account or
      // on a different machine: DPAPI and Keychain both scope the key that way,
      // so the ciphertext is genuinely unreadable and the user has to re-enter
      // it. Reported rather than swallowed, so the log says why the provider
      // suddenly looks unconfigured.
      console.warn(
        `[SecretStore] Could not decrypt "${key}". This usually means the database was created ` +
          'by a different user account or on another machine; re-enter the credential in Settings.',
        err
      );
      return '';
    }
  }

  /** Stores a secret, encrypted when the OS keystore will do it. */
  public setSecret(key: string, value: string): void {
    if (!key) throw new Error('Secret key is required');

    // An empty value means "not configured", and every caller tests it as a
    // plain string. Encrypting it would make that test fail for a setting that
    // has nothing worth protecting.
    if (!value) {
      this._settingsRepo.setSetting(key, '');
      return;
    }

    if (!this._crypto.isEncryptionAvailable()) {
      if (!this._warnedUnavailable) {
        this._warnedUnavailable = true;
        console.warn(
          '[SecretStore] OS keystore unavailable; provider credentials will be stored in plain text.'
        );
      }
      this._settingsRepo.setSetting(key, value);
      return;
    }

    try {
      const encrypted = this._crypto.encryptString(value).toString('base64');
      this._settingsRepo.setSetting(key, `${ENCRYPTED_PREFIX}${encrypted}`);
    } catch (err) {
      // Storing the credential matters more than storing it encrypted: a user
      // whose keystore fails should still have a working provider.
      console.warn(`[SecretStore] Encryption of "${key}" failed; storing in plain text.`, err);
      this._settingsRepo.setSetting(key, value);
    }
  }

  /** True when the value on disk for this key is ciphertext. */
  public isEncrypted(key: string): boolean {
    return this._settingsRepo.getSetting<string>(key, '').startsWith(ENCRYPTED_PREFIX);
  }
}
