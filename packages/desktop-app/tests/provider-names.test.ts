import { describe, it, expect } from 'vitest';
import {
  ProviderId,
  providerDisplayName,
  selectableProviders,
  SELECTABLE_PROVIDERS,
  UNNAMED_PROVIDER
} from '../src/shared/provider-names';
import { OWN_PROJECT_PROVIDER_ID, UNKNOWN_PROJECT_PROVIDER_ID } from '../src/shared/local-provider';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';

describe('providerDisplayName', () => {
  it.each([
    [ProviderId.JIRA, 'Jira'],
    [ProviderId.OPENPROJECT, 'OpenProject'],
    [ProviderId.ADHOC, 'This computer'],
    [OWN_PROJECT_PROVIDER_ID, 'This computer']
  ])('ProviderDisplayName_%s_Reads%s', (id, expected) => {
    expect(providerDisplayName(id)).toBe(expected);
  });

  it('ProviderDisplayName_CustomServer_ReadsTheNameItWasGiven', () => {
    expect(providerDisplayName('forge', '  Forge Tracker ')).toBe('Forge Tracker');
  });

  it('ProviderDisplayName_CustomServerWithNoName_ReadsItsId', () => {
    expect(providerDisplayName('forge', '  ')).toBe('forge');
  });

  it('ProviderDisplayName_KnownProvider_IgnoresAServerName', () => {
    // A name is the user's for a server of their own; Jira is Jira.
    expect(providerDisplayName(ProviderId.JIRA, 'Something else')).toBe('Jira');
  });

  it.each([[UNKNOWN_PROJECT_PROVIDER_ID], [''], ['  '], [null], [undefined]])(
    'ProviderDisplayName_NotKnown_%s_ReadsYourProvider',
    id => {
      // `local` means "not known" (local-provider.ts), never "made here".
      expect(providerDisplayName(id)).toBe(UNNAMED_PROVIDER);
    }
  );

  it('SelectableProviders_NamesEachAsTheAppWritesIt', () => {
    expect(selectableProviders()).toEqual([
      { id: 'openproject', name: 'OpenProject' },
      { id: 'jira', name: 'Jira' },
      { id: 'adhoc', name: 'This computer' }
    ]);
  });

  it('Adapters_TheirNames_AreTheSharedOnes', () => {
    // The adapters' names reach toasts and the bar; a copy spelled on an
    // adapter ("Jira Cloud") would disagree with the window.
    const db = new DatabaseConnection(':memory:');
    try {
      const manager = new ProviderManager(new SettingsRepository(db));
      for (const id of SELECTABLE_PROVIDERS) {
        const provider = manager.getProvider(id);
        expect(provider?.providerId).toBe(id);
        expect(provider?.providerName).toBe(providerDisplayName(id));
      }
    } finally {
      db.close();
    }
  });
});
