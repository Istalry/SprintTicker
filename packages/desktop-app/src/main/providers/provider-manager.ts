import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { AdHocProvider } from './adhoc-provider';
import { OpenProjectProvider } from './openproject-provider';
import { JiraProvider } from './jira-provider';
import { CustomServerProvider } from './custom-server-provider';
import { ProviderId } from '../../shared/provider-names';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { SecretStore } from '../db/secret-store';
import { ProjectDTO, ProviderCapabilitiesDTO, TaskDTO } from '../../shared/dtos';
import type { TaskClaim } from '../../shared/task-claim';
import { doneStateFor, FlowSettingKey, readDoneStateByProject } from '../../shared/flow-settings';
import { isCustomServerConfigured } from '../../shared/custom-server';
import {
  isJiraConfigured,
  isOpenProjectConfigured,
  PROVIDER_SETTING_DEFAULTS,
  ProviderSettingKey,
  ProviderSettingKeyValue
} from '../../shared/provider-settings';

/**
 * What a provider can do, read off its optional methods, so the window hides
 * a control the provider lacks instead of offering one that fails.
 */
export function providerCapabilities(provider: ITaskProvider): ProviderCapabilitiesDTO {
  return {
    providerId: provider.providerId,
    canAssign: typeof provider.assignToMe === 'function',
    canTransition: provider.movesTaskStatus !== false,
    canFindWorklog: typeof provider.findWorklog === 'function',
    canFetchByKey: typeof provider.getTaskByKey === 'function',
    hasHolidays: typeof provider.getNonWorkingDays === 'function',
    hasEvents: typeof provider.getEventsSince === 'function',
    providerName: provider.providerName
  };
}

/**
 * Service managing registered Task Providers (OpenProject and AdHoc), provider credentials,
 * active provider selection, and offline worklog queue flushing.
 */
export class ProviderManager {
  private _providers: Map<string, ITaskProvider> = new Map();
  private _activeProviderId: string = 'openproject';
  private _settingsRepo: SettingsRepository;
  private _secrets: SecretStore;

  /// <summary>
  /// Initializes the Task Provider Manager, registering default remote and fallback local providers.
  /// </summary>
  /**
   * No worklog repository parameter: ProviderManager no longer reads or writes
   * the sync queue. OfflineSyncWorker is its sole owner, and having a second
   * dispatcher here is what let the same row be POSTed twice.
   */
  constructor(settingsRepo?: SettingsRepository, options: { appVersion?: string } = {}) {
    this._settingsRepo = settingsRepo || new SettingsRepository();
    this._secrets = new SecretStore(this._settingsRepo);

    const openProjectProvider = new OpenProjectProvider();
    const jiraProvider = new JiraProvider();
    const customServerProvider = new CustomServerProvider({
      appVersion: options.appVersion,
      // Kept, so Settings and the window name the server before this run reads it.
      onServerName: name => this._settingsRepo.setSetting(ProviderSettingKey.CUSTOM_SERVER_NAME, name)
    });
    const adHocProvider = new AdHocProvider();

    this.registerProvider(openProjectProvider);
    this.registerProvider(jiraProvider);
    this.registerProvider(customServerProvider);
    this.registerProvider(adHocProvider);

    this.reinitializeProviders();

    this._activeProviderId = this._settingsRepo.getSetting('active_provider_id', 'openproject');
  }

  /// <summary>
  /// Reads a provider setting, falling back to the single shared default for that key.
  /// </summary>
  private readSetting(key: ProviderSettingKeyValue): string {
    return this._settingsRepo.getSetting(key, PROVIDER_SETTING_DEFAULTS[key]);
  }

  /**
   * The key ad-hoc tasks show, in the lists and on the bar.
   *
   * Named the "fallback ticket" once, with a promise that ad-hoc hours were
   * logged against it. Nothing ever did that, and nothing will: ad-hoc time
   * stays in local history. The setting is what it can honestly be, a label.
   */
  public getAdHocTaskKey(): string {
    return this.readSetting(ProviderSettingKey.FALLBACK_TICKET_KEY).trim() || PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.FALLBACK_TICKET_KEY];
  }

  /**
   * Jira, OpenProject or a SprintTicker server has credentials: an install
   * set up before the first run existed, which it never opens on its own for.
   */
  public isRemoteConfigured(): boolean {
    return (
      isCustomServerConfigured(this.readSetting(ProviderSettingKey.CUSTOM_SERVER_URL), this._secrets.getSecret(ProviderSettingKey.CUSTOM_SERVER_TOKEN)) ||
      isOpenProjectConfigured(this.readSetting(ProviderSettingKey.OP_DOMAIN), this._secrets.getSecret(ProviderSettingKey.OP_API_KEY)) ||
      isJiraConfigured(
        this.readSetting(ProviderSettingKey.JIRA_SITE),
        this.readSetting(ProviderSettingKey.JIRA_EMAIL),
        this._secrets.getSecret(ProviderSettingKey.JIRA_API_TOKEN)
      )
    );
  }

  /// <summary>
  /// Re-reads stored domain credentials and status mappings from database settings.
  /// </summary>
  public reinitializeProviders(): void {
    const opProvider = this._providers.get('openproject');
    if (opProvider) {
      void opProvider.initialize({
        domain: this.readSetting(ProviderSettingKey.OP_DOMAIN),
        // Through the SecretStore, not readSetting: what is on disk is
        // ciphertext, and handing that to the provider produces a 401 that
        // looks like a bad key rather than a failed decryption.
        apiToken: this._secrets.getSecret(ProviderSettingKey.OP_API_KEY),
        opStatusInProgress: this.readSetting(ProviderSettingKey.OP_STATUS_IN_PROGRESS),
        opStatusToTest: this.readSetting(ProviderSettingKey.OP_STATUS_TO_TEST),
        opStatusToReview: this.readSetting(ProviderSettingKey.OP_STATUS_TO_REVIEW),
        opCompletionAction: this.readSetting(ProviderSettingKey.OP_COMPLETION_ACTION),
        opTaskScope: this.readSetting(ProviderSettingKey.OP_TASK_SCOPE),
        opTaskQuery: this.readSetting(ProviderSettingKey.OP_TASK_QUERY)
      })
        .catch(err => console.error('[ProviderManager] opProvider.initialize failed:', err));
    }

    const jiraProvider = this._providers.get('jira');
    if (jiraProvider) {
      void jiraProvider.initialize({
        domain: this.readSetting(ProviderSettingKey.JIRA_SITE),
        jiraEmail: this.readSetting(ProviderSettingKey.JIRA_EMAIL),
        // Through the SecretStore for the same reason as the OpenProject key:
        // what is on disk is ciphertext.
        apiToken: this._secrets.getSecret(ProviderSettingKey.JIRA_API_TOKEN),
        jiraTaskScope: this.readSetting(ProviderSettingKey.JIRA_TASK_SCOPE),
        jiraTaskQuery: this.readSetting(ProviderSettingKey.JIRA_TASK_QUERY),
        jiraTransitionInProgress: this.readSetting(ProviderSettingKey.JIRA_TRANSITION_IN_PROGRESS),
        jiraTransitionToTest: this.readSetting(ProviderSettingKey.JIRA_TRANSITION_TO_TEST),
        jiraTransitionToReview: this.readSetting(ProviderSettingKey.JIRA_TRANSITION_TO_REVIEW),
        jiraCompletionAction: this.readSetting(ProviderSettingKey.JIRA_COMPLETION_ACTION)
      })
        .catch(err => console.error('[ProviderManager] jiraProvider.initialize failed:', err));
    }

    const customServerProvider = this._providers.get(ProviderId.CUSTOM);
    if (customServerProvider) {
      void customServerProvider.initialize({
        baseUrl: this.readSetting(ProviderSettingKey.CUSTOM_SERVER_URL),
        apiToken: this._secrets.getSecret(ProviderSettingKey.CUSTOM_SERVER_TOKEN),
        serverName: this.readSetting(ProviderSettingKey.CUSTOM_SERVER_NAME)
      })
        .catch(err => console.error('[ProviderManager] customServerProvider.initialize failed:', err));
    }

    const adHocProvider = this._providers.get('adhoc');
    if (adHocProvider) {
      void adHocProvider.initialize({
        fallbackKey: this.readSetting(ProviderSettingKey.FALLBACK_TICKET_KEY)
      })
        .catch(err => console.error('[ProviderManager] adHocProvider.initialize failed:', err));
    }
  }

  /**
   * The active provider's days off between two date keys: OpenProject's
   * holidays, a SprintTicker server's `calendar`. Null when it keeps none --
   * Jira. It used to ask the first provider that could, which was
   * OpenProject's whoever was active: a Jira user's calendar read an
   * OpenProject instance they may never have set up.
   */
  public async getNonWorkingDays(fromKey: string, toKey: string): Promise<string[] | null> {
    const provider = this.getActiveProvider();
    return provider.getNonWorkingDays ? provider.getNonWorkingDays(fromKey, toKey) : null;
  }

  /// <summary>
  /// Registers a task provider instance with the provider registry.
  /// </summary>
  public registerProvider(provider: ITaskProvider): void {
    this._providers.set(provider.providerId, provider);
  }

  /// <summary>
  /// Retrieves a specific task provider by its ID.
  /// </summary>
  public getProvider(providerId: string): ITaskProvider | undefined {
    return this._providers.get(providerId);
  }

  /// <summary>
  /// Retrieves the currently active task provider instance.
  /// </summary>
  public getActiveProvider(): ITaskProvider {
    return this._providers.get(this._activeProviderId) || this._providers.get('openproject')!;
  }

  /** What the active provider can do. */
  public getActiveCapabilities(): ProviderCapabilitiesDTO {
    return providerCapabilities(this.getActiveProvider());
  }

  /// <summary>
  /// Sets the active task provider identifier.
  /// </summary>
  public setActiveProviderId(providerId: string): void {
    if (this._providers.has(providerId)) {
      this._activeProviderId = providerId;
      this._settingsRepo.setSetting('active_provider_id', providerId);
    }
  }

  /// <summary>
  /// Fetches remote or local projects from the active provider.
  /// </summary>
  public async getProjects(): Promise<ProjectDTO[]> {
    return this.getActiveProvider().getProjects();
  }

  /// <summary>
  /// Fetches remote or local tasks for a project from the active provider.
  /// </summary>
  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    return this.getActiveProvider().getTasks(projectId);
  }

  /**
   * One task by the key the user typed, from the active provider; null when
   * it has none by that key. Throws when the provider cannot fetch by key --
   * the picker hides the button then (`canFetchByKey`), so a call is a bug.
   */
  public async getTaskByKey(key: string): Promise<TaskDTO | null> {
    const provider = this.getActiveProvider();
    if (typeof provider.getTaskByKey !== 'function') {
      throw new Error(`${provider.providerId} cannot fetch a task by its key.`);
    }
    return provider.getTaskByKey(key);
  }

  /// <summary>
  /// Updates remote task status on the active provider.
  /// </summary>
  public async updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done', projectId?: string): Promise<boolean> {
    return this.getActiveProvider().updateTaskStatus(taskId, status, this.doneStateOf(status, projectId));
  }

  /**
   * The project's own Done state, or undefined for the completion action.
   * Read at each Done, so a change in Settings applies to the next one.
   */
  private doneStateOf(status: 'in_progress' | 'to_test' | 'to_review' | 'done', projectId: string | undefined): string | undefined {
    if (status !== 'done' || !projectId) return undefined;
    const setting = readDoneStateByProject(this._settingsRepo.getSetting<unknown>(FlowSettingKey.DONE_STATE_BY_PROJECT, null));
    return doneStateFor(setting, projectId) ?? undefined;
  }

  /**
   * The page of a task on the provider it came from -- or the active one
   * when that is not known -- or null when there is none to open.
   */
  public taskPageUrlFor(providerId: string | undefined, task: Pick<TaskDTO, 'id' | 'key'>): string | null {
    const provider = providerId ? this._providers.get(providerId) : this.getActiveProvider();
    return provider?.getTaskPageUrl?.(task) ?? null;
  }

  /**
   * Assigns a task nobody owns to the user, on the provider it came from --
   * or the active one when that is not known (a session from before
   * migration 9). Null when that provider cannot assign, which is no
   * failure: a project made here has nobody to assign. Throws when the
   * provider is not registered, or the request fails.
   */
  public async assignToMeFor(providerId: string | undefined, taskId: string): Promise<TaskClaim | null> {
    const provider = providerId ? this._providers.get(providerId) : this.getActiveProvider();
    if (!provider) {
      throw new Error(`No registered provider with id "${providerId}"`);
    }
    return provider.assignToMe ? provider.assignToMe(taskId) : null;
  }

  /**
   * Moves a task on a *named* provider: the one it came from, not whichever
   * is active by the time the session ends. Throws when no such provider is
   * registered, like {@link logTimeForProvider}.
   */
  public async updateTaskStatusFor(
    providerId: string,
    taskId: string,
    status: 'in_progress' | 'to_test' | 'to_review' | 'done',
    projectId?: string
  ): Promise<boolean> {
    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`No registered provider with id "${providerId}"`);
    }
    return provider.updateTaskStatus(taskId, status, this.doneStateOf(status, projectId));
  }

  /// <summary>
  /// Logs spent time to the active provider and triggers background queue flushing on success.
  /// </summary>
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    try {
      // Deliberately does not drain the sync queue on success. OfflineSyncWorker
      // is the queue's sole dispatcher; a second one here raced it and could
      // POST the same row twice, billing the time to the provider twice.
      return await this.getActiveProvider().logTime(payload);
    } catch (err) {
      console.warn(`[ProviderManager] Direct logTime to ${this._activeProviderId} failed. Worklog buffered locally.`, err);
      return { success: false };
    }
  }

  /// <summary>
  /// Processes all pending worklogs in SQLite worklog_sync_queue.
  /// </summary>
  /**
   * Sends a worklog through a *named* provider.
   *
   * The queue records which provider each row was created for. Dispatching via
   * the active provider instead means that switching provider mid-day delivers
   * everything still queued to whichever one happens to be selected -- posting
   * OpenProject worklogs into AdHoc, where they vanish.
   */
  public async logTimeForProvider(
    providerId: string,
    payload: WorklogPayload
  ): Promise<{ success: boolean; remoteWorklogId?: string }> {
    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`No registered provider with id "${providerId}"`);
    }
    return provider.logTime(payload);
  }
}

