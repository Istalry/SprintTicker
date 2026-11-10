import { describe, it, expect, afterEach } from 'vitest';
import { providerCapabilities, ProviderManager } from '../src/main/providers/provider-manager';
import { ITaskProvider } from '../src/main/providers/task-provider-interface';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProviderSettingKey } from '../src/shared/provider-settings';

/** The required members only: a provider that can do nothing optional. */
const bare = (extra: Partial<ITaskProvider> = {}): ITaskProvider => ({
  providerId: 'bare',
  providerName: 'Bare',
  minimumLoggableSeconds: 1,
  initialize: async () => true,
  getProjects: async () => [],
  getTasks: async () => [],
  reconcileRemoteState: async () => ({ remoteLoggedTimeToday: null }),
  logTime: async () => ({ success: true }),
  updateTaskStatus: async () => true,
  ...extra
});

describe('providerCapabilities', () => {
  it('ProviderCapabilities_NoOptionalMethods_CanOnlyMoveStatus', () => {
    expect(providerCapabilities(bare())).toEqual({
      providerId: 'bare',
      canAssign: false,
      canTransition: true,
      canFindWorklog: false,
      canFetchByKey: false,
      hasHolidays: false
    });
  });

  it('ProviderCapabilities_EveryOptionalMethod_CanDoEverything', () => {
    const full = bare({
      assignToMe: async () => ({ outcome: 'assigned' }) as never,
      findWorklog: async () => null,
      getTaskByKey: async () => null,
      getNonWorkingDays: async () => []
    });

    expect(providerCapabilities(full)).toMatchObject({
      canAssign: true,
      canTransition: true,
      canFindWorklog: true,
      canFetchByKey: true,
      hasHolidays: true
    });
  });

  it('ProviderCapabilities_StatusNeverMoves_CannotTransition', () => {
    expect(providerCapabilities(bare({ movesTaskStatus: false })).canTransition).toBe(false);
  });

  describe('the adapters', () => {
    let db: DatabaseConnection | undefined;
    afterEach(() => db?.close());

    const activeOf = (providerId: string) => {
      db = new DatabaseConnection(':memory:');
      const settings = new SettingsRepository(db);
      settings.setSetting(ProviderSettingKey.ACTIVE_PROVIDER_ID, providerId);
      return new ProviderManager(settings).getActiveCapabilities();
    };

    it('Jira_AssignsAndMovesButHasNoHolidays', () => {
      expect(activeOf('jira')).toEqual({
        providerId: 'jira',
        canAssign: true,
        canTransition: true,
        canFindWorklog: true,
        canFetchByKey: false,
        hasHolidays: false
      });
    });

    it('OpenProject_AssignsMovesAndReadsHolidays', () => {
      expect(activeOf('openproject')).toEqual({
        providerId: 'openproject',
        canAssign: true,
        canTransition: true,
        canFindWorklog: true,
        canFetchByKey: false,
        hasHolidays: true
      });
    });

    it('AdHoc_CanDoNothingRemote', () => {
      // No remote: Done and the move to In Progress are hidden, not offered.
      expect(activeOf('adhoc')).toEqual({
        providerId: 'adhoc',
        canAssign: false,
        canTransition: false,
        canFindWorklog: false,
        canFetchByKey: false,
        hasHolidays: false
      });
    });
  });
});
