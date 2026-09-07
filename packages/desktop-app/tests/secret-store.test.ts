import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { SecretStore, SecretCrypto } from '../src/main/db/secret-store';
import { ProviderSettingKey } from '../src/shared/provider-settings';

/**
 * Regression coverage for the credential half of audit F-11.
 *
 * The OpenProject API key sat in the `settings` table in plain text, in a file
 * under `%APPDATA%` that any backup tool, file-sync client or other process
 * running as the user can read.
 *
 * The tests that matter here are the failure modes, not the happy path.
 * Encryption that loses a credential when the keystore is unavailable, or that
 * throws when the database is opened by a different OS account, is worse than
 * the plaintext it replaced.
 */
describe('SecretStore', () => {
  const KEY = ProviderSettingKey.OP_API_KEY;
  let dbConn: DatabaseConnection;
  let settingsRepo: SettingsRepository;

  /**
   * A reversible stand-in for the OS keystore.
   *
   * `safeStorage` cannot run outside Electron, and the point of injecting the
   * crypto is that these tests never have to stub a global to find that out.
   */
  function fakeCrypto(available = true): SecretCrypto {
    return {
      isEncryptionAvailable: () => available,
      encryptString: (plain: string) => Buffer.from(`sealed:${plain}`, 'utf8'),
      decryptString: (buf: Buffer) => {
        const text = buf.toString('utf8');
        if (!text.startsWith('sealed:')) throw new Error('not sealed by this key');
        return text.slice('sealed:'.length);
      }
    };
  }

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    settingsRepo = new SettingsRepository(dbConn);
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  describe('round trip', () => {
    it('SetSecret_ThenGetSecret_ReturnsTheOriginalValue', () => {
      const store = new SecretStore(settingsRepo, fakeCrypto());

      store.setSecret(KEY, 'api-key-value');

      expect(store.getSecret(KEY)).toBe('api-key-value');
    });

    it('SetSecret_AnyValue_DoesNotLeaveThePlaintextInTheSettingsTable', () => {
      // The whole point: what lands on disk must not be readable.
      const store = new SecretStore(settingsRepo, fakeCrypto());

      store.setSecret(KEY, 'api-key-value');

      expect(settingsRepo.getSetting(KEY, '')).not.toContain('api-key-value');
      expect(store.isEncrypted(KEY)).toBe(true);
    });

    it('GetSecret_NeverWritten_ReturnsEmptyRatherThanThrowing', () => {
      // Every caller tests the empty string as "not configured".
      const store = new SecretStore(settingsRepo, fakeCrypto());

      expect(store.getSecret(KEY)).toBe('');
    });

    it('SetSecret_EmptyValue_StaysEmptyRatherThanBecomingCiphertext', () => {
      // Clearing the field must read back as not configured, not as a short
      // encrypted blob that `isOpenProjectConfigured` would call configured.
      const store = new SecretStore(settingsRepo, fakeCrypto());
      store.setSecret(KEY, 'api-key-value');

      store.setSecret(KEY, '');

      expect(store.getSecret(KEY)).toBe('');
      expect(settingsRepo.getSetting(KEY, 'unset')).toBe('');
    });
  });

  describe('installs that already have a plaintext key', () => {
    it('GetSecret_LegacyPlaintextValue_StillReturnsIt', () => {
      // Every existing install has one. Failing to read it would log the user
      // out of their provider on upgrade.
      settingsRepo.setSetting(KEY, 'written-before-encryption-existed');
      const store = new SecretStore(settingsRepo, fakeCrypto());

      expect(store.getSecret(KEY)).toBe('written-before-encryption-existed');
    });

    it('GetSecret_LegacyPlaintextValue_UpgradesItInPlace', () => {
      // Reading is the only moment the plaintext is known, so it is the only
      // chance to replace it without asking the user to retype anything.
      settingsRepo.setSetting(KEY, 'written-before-encryption-existed');
      const store = new SecretStore(settingsRepo, fakeCrypto());

      store.getSecret(KEY);

      expect(store.isEncrypted(KEY)).toBe(true);
      expect(store.getSecret(KEY)).toBe('written-before-encryption-existed');
    });

    it('GetSecret_LegacyValueAndNoKeystore_ReturnsItWithoutLosingIt', () => {
      // The upgrade attempt fails here. It must not take the credential with
      // it: a user on a Linux box with no keyring keeps a working provider.
      settingsRepo.setSetting(KEY, 'plaintext-forever');
      const store = new SecretStore(settingsRepo, fakeCrypto(false));

      expect(store.getSecret(KEY)).toBe('plaintext-forever');
      expect(settingsRepo.getSetting(KEY, '')).toBe('plaintext-forever');
    });
  });

  describe('when the keystore will not cooperate', () => {
    it('SetSecret_EncryptionUnavailable_StoresPlainTextRatherThanFailing', () => {
      // Degrading to what the app did before is the correct fallback. Refusing
      // to save would make the provider unconfigurable on that machine.
      const store = new SecretStore(settingsRepo, fakeCrypto(false));

      store.setSecret(KEY, 'api-key-value');

      expect(store.getSecret(KEY)).toBe('api-key-value');
      expect(store.isEncrypted(KEY)).toBe(false);
    });

    it('SetSecret_EncryptionThrows_StillStoresTheCredential', () => {
      const crypto: SecretCrypto = {
        ...fakeCrypto(),
        encryptString: () => {
          throw new Error('keystore locked');
        }
      };
      const store = new SecretStore(settingsRepo, crypto);

      store.setSecret(KEY, 'api-key-value');

      expect(store.getSecret(KEY)).toBe('api-key-value');
    });

    it('GetSecret_CiphertextFromAnotherAccount_ReportsNotConfiguredInsteadOfThrowing', () => {
      // DPAPI and Keychain both scope the wrapping key to the OS account, so
      // copying the database to another machine leaves genuinely unreadable
      // bytes. The user has to re-enter the key; the app must not crash first.
      const store = new SecretStore(settingsRepo, fakeCrypto());
      store.setSecret(KEY, 'api-key-value');

      const foreign = new SecretStore(settingsRepo, {
        isEncryptionAvailable: () => true,
        encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
        decryptString: () => {
          throw new Error('decryption failed');
        }
      });

      expect(foreign.getSecret(KEY)).toBe('');
    });

    it('GetSecret_UnavailableKeystore_DoesNotWarnOnEveryCall', () => {
      // A sync pass reinitialises providers on a timer; one warning per read
      // would bury the log it is trying to be useful in.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new SecretStore(settingsRepo, fakeCrypto(false));

      store.setSecret(KEY, 'a');
      store.setSecret(KEY, 'b');
      store.setSecret(KEY, 'c');

      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('argument validation', () => {
    it('Constructor_NoSettingsRepository_ThrowsRatherThanResolvingTheSingleton', () => {
      // Reaching for the DatabaseConnection singleton is what once wrote a real
      // database to disk from the test suite.
      expect(() => new SecretStore(undefined as unknown as SettingsRepository)).toThrow();
    });

    it('GetSecret_EmptyKey_Throws', () => {
      const store = new SecretStore(settingsRepo, fakeCrypto());
      expect(() => store.getSecret('')).toThrow();
    });

    it('SetSecret_EmptyKey_Throws', () => {
      const store = new SecretStore(settingsRepo, fakeCrypto());
      expect(() => store.setSecret('', 'x')).toThrow();
    });
  });
});
