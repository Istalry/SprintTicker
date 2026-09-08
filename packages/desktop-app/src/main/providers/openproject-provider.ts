import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO, OpStatusDTO, OpenProjectNotificationDTO, ArgumentException } from '../../shared/dtos';
import { ProviderRequestError } from './provider-errors';
import { fetchOpenProjectCollection } from './openproject-collection';
import { providerFetch, ProviderFetchOptions } from './provider-http';
import { isOpenProjectConfigured } from '../../shared/provider-settings';
import { localDateKey } from '../../shared/local-date';

/**
 * Concrete task provider adapter for OpenProject API v3.
 */
export class OpenProjectProvider implements ITaskProvider {
  public readonly providerId: string = 'openproject';
  public readonly providerName: string = 'OpenProject';

  private _domain: string = '';
  private _apiKey: string = '';
  
  // Status Mappings (populated from settings)
  private _statusIdInProgress: string = '';
  private _statusIdToTest: string = '';
  private _statusIdToReview: string = '';
  private _defaultCompletionAction: string = 'to_test';

  /**
   * How this provider reaches the network.
   *
   * Injected rather than reached for, because the ambient `fetch` is a
   * singleton in all but name and a test that has to stub a global cannot run
   * beside one that does not. The default is the real client, so production
   * callers construct it with no arguments.
   */
  private readonly _http: ProviderFetchOptions;

  constructor(http: ProviderFetchOptions = {}) {
    this._http = http;
  }

  /// <summary>
  /// Configures OpenProject domain, API credentials, and status ID mappings.
  /// </summary>
  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this._domain = credentials.domain || credentials.opDomain || '';
    this._apiKey = credentials.apiToken || credentials.apiKey || credentials.opApiKey || '';
    this._statusIdInProgress = credentials.opStatusInProgress || '';
    this._statusIdToTest = credentials.opStatusToTest || '';
    this._statusIdToReview = credentials.opStatusToReview || '';
    this._defaultCompletionAction = credentials.opCompletionAction || 'to_test';
    return true;
  }

  public static sanitizeDomain(domain: string): string {
    let clean = domain.trim().replace(/\/api\/v3\/?$/, '').replace(/\/$/, '');
    if (clean && !clean.startsWith('http://') && !clean.startsWith('https://')) {
      // Assume TLS for a bare host. The old default was `http://`, which sent
      // an API key -- a permanent credential, in a Basic header -- in clear
      // text to any instance whose scheme the user had not spelled out. A
      // self-hosted instance on plain HTTP still works; it just has to say so.
      clean = 'https://' + clean;
    }
    return clean;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`apikey:${this._apiKey.trim()}`).toString('base64')}`;
  }

  private getBaseUrl(): string {
    return OpenProjectProvider.sanitizeDomain(this._domain);
  }

  /**
   * Walks a collection on the configured instance.
   *
   * See {@link fetchOpenProjectCollection} for why this throws rather than
   * returning a partial list.
   */
  private fetchCollection(
    path: string,
    context: string,
    params: Record<string, string> = {}
  ): Promise<Array<Record<string, unknown>>> {
    return fetchOpenProjectCollection(
      this.providerId,
      this.getBaseUrl(),
      this.getAuthHeader(),
      path,
      context,
      params,
      this._http
    );
  }

  /// <summary>
  /// Converts duration in seconds to ISO 8601 duration format (e.g. PT1H30M, PT15M, PT45S).
  /// </summary>
  private formatIsoDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remSec = seconds % 60;

    let duration = 'PT';
    if (hours > 0) duration += `${hours}H`;
    if (minutes > 0) duration += `${minutes}M`;
    if (remSec > 0 || (hours === 0 && minutes === 0)) duration += `${remSec}S`;
    return duration;
  }

  /// <summary>
  /// Fetches accessible projects via OpenProject API v3 (/api/v3/projects).
  /// </summary>
  public async getProjects(): Promise<ProjectDTO[]> {
    if (!isOpenProjectConfigured(this._domain, this._apiKey)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }

    const elements = await this.fetchCollection('/api/v3/projects', 'Fetching projects');

    return elements
      .filter(p => p.templated !== true && !((p.name as string) || '').toLowerCase().includes('template'))
      .map(p => ({
        id: (p.id as number | string).toString(),
        key: (p.identifier as string) || `proj_${p.id}`,
        name: (p.name as string) || 'Untitled Project'
      }));
  }

  /// <summary>
  /// Fetches active work packages for a project via OpenProject API v3 (/api/v3/work_packages).
  /// </summary>
  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    if (!isOpenProjectConfigured(this._domain, this._apiKey)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }

    // Filter: Project ID, Assignee = me, Status = open ("o")
    const filter = `[{"project":{"operator":"=","values":["${projectId}"]}},{"assignee":{"operator":"=","values":["me"]}},{"status":{"operator":"o","values":[]}}]`;
    const elements = await this.fetchCollection(
      '/api/v3/work_packages',
      `Fetching tasks for project ${projectId}`,
      { filters: filter }
    );

    return elements
      .map(t => {
          const links = (t._links || {}) as Record<string, { href?: string; title?: string }>;
          const opStatusId = links.status?.href?.split('/').pop();
          const typeName = (links.type?.title as string) || '';
          
          let localStatus: 'todo' | 'in_progress' | 'done' = 'todo';
          
          if (opStatusId === this._statusIdInProgress) {
            localStatus = 'in_progress';
          } else if (opStatusId === this._statusIdToTest || opStatusId === this._statusIdToReview) {
            localStatus = 'done';
          }

          const rawId = (t.id as number | string).toString();
          return {
            id: rawId,
            projectId,
            key: `OP-${rawId}`,
            title: (t.subject as string) || 'Untitled Work Package',
            status: localStatus,
            _opType: typeName // Temporary prop for filtering
          };
      })
      .filter(t => t._opType.toLowerCase() !== 'epic' && t._opType.toLowerCase() !== 'milestone');
  }

  /// <summary>
  /// Fetches unread notifications for the current user from OpenProject API v3 (/api/v3/notifications).
  /// </summary>
  public async fetchUnreadNotifications(): Promise<OpenProjectNotificationDTO[]> {
    if (!this._domain || !this._apiKey) return [];

    try {
      const filter = `[{"readIAN":{"operator":"=","values":["f"]}}]`;
      const elements = await this.fetchCollection(
        '/api/v3/notifications',
        'Fetching unread notifications',
        { filters: filter }
      );

      return elements.map(n => {
        const links = (n._links || {}) as Record<string, { title?: string }>;
        return {
          id: (n.id as number | string).toString(),
          subject: (n.subject as string) || 'Notification',
          action: (n.action as string) || '',
          actorName: links.actor?.title || 'OpenProject',
          readIAN: !!n.readIAN,
          reason: (n.reason as string) || '',
          createdAt: (n.createdAt as string) || new Date().toISOString()
        };
      });
    } catch (err) {
      // Unlike getProjects/getTasks this is not a prune input -- nothing is
      // deleted on the strength of it -- so an unreachable server degrades to
      // "no notifications" rather than failing the caller.
      console.error('[OpenProjectProvider] Failed to fetch unread notifications:', err);
      return [];
    }
  }

  /// <summary>
  /// Reconciles remote time tracking metrics (total time logged today by the user).
  /// </summary>
  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }> {
    if (!this._domain || !this._apiKey) return { remoteLoggedTimeToday: 0 };

    try {
      // The user's day, not UTC's: this filter is compared against spentOn
      // values written below, and the two must agree on which day it is.
      const today = localDateKey();
      const filter = `[{"spentOn":{"operator":"=","values":["${today}"]}},{"user":{"operator":"=","values":["me"]}}]`;
      const elements = await this.fetchCollection(
        '/api/v3/time_entries',
        'Reconciling remote time entries',
        { filters: filter }
      );

      let totalSeconds = 0;
      for (const entry of elements) {
        totalSeconds += OpenProjectProvider.parseIsoDurationSeconds(entry.hours as string);
      }
      return { remoteLoggedTimeToday: totalSeconds };
    } catch (err) {
      // A failure here understates the day's total rather than corrupting it;
      // the local worklog table remains the source of truth.
      console.error('[OpenProjectProvider] Failed to reconcile remote state:', err);
      return { remoteLoggedTimeToday: 0 };
    }
  }

  /// <summary>
  /// Parses an ISO 8601 duration of the shape OpenProject returns (PTnHnMnS).
  /// </summary>
  private static parseIsoDurationSeconds(isoDuration: string): number {
    if (!isoDuration || !isoDuration.startsWith('PT')) return 0;
    const hours = /(\d+)H/.exec(isoDuration);
    const minutes = /(\d+)M/.exec(isoDuration);
    const seconds = /(\d+)S/.exec(isoDuration);
    return (
      (hours ? parseInt(hours[1], 10) : 0) * 3600 +
      (minutes ? parseInt(minutes[1], 10) : 0) * 60 +
      (seconds ? parseInt(seconds[1], 10) : 0)
    );
  }

  /// <summary>
  /// Synchronizes time tracking with OpenProject by creating a time entry on the target work package (POST /api/v3/time_entries).
  /// </summary>
  /**
   * Reports failure by throwing, like every other method here.
   *
   * It used to log and return `{ success: false }`, which reached the sync
   * queue as the string "Provider reported failure" -- the same row whether the
   * API key had been revoked or the wifi had dropped. The queue then retried a
   * revoked key on an exponential backoff until it exhausted the attempt budget
   * and parked the worklog, and nothing anywhere said why.
   *
   * The queue still decides what to do about a failure; it can now tell which
   * failure it is, because `ProviderRequestError` carries `isPermanent`.
   */
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    if (!isOpenProjectConfigured(this._domain, this._apiKey)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }
    if (!payload.taskId) throw new ArgumentException('payload.taskId is required to log time.');
    if (payload.durationSeconds <= 0) {
      throw new ArgumentException(
        `payload.durationSeconds must be greater than zero (received ${payload.durationSeconds}).`
      );
    }

    {
      const url = `${this.getBaseUrl()}/api/v3/time_entries`;
      const isoDuration = this.formatIsoDuration(payload.durationSeconds);
      // spentOn is a calendar day of work, so it is the local day the session
      // started -- taking the UTC prefix billed an evening session west of UTC
      // to tomorrow, and one started after local midnight east of UTC to
      // yesterday.
      const spentOnDate = payload.startedAtUtc
        ? localDateKey(new Date(payload.startedAtUtc))
        : localDateKey();

      const cleanTaskId = payload.taskId.replace(/^OP-/, '');

      // Deliberately not retried. `/api/v3/time_entries` has no idempotency
      // key, so a retry after a response that was sent but never received
      // bills the same session twice -- and an over-reported day is harder to
      // notice, and worse, than a missing entry the queue will resend.
      const res = await providerFetch(
        this.providerId,
        url,
        {
          method: 'POST',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            _links: {
              workPackage: { href: `/api/v3/work_packages/${cleanTaskId}` }
            },
            hours: isoDuration,
            spentOn: spentOnDate,
            comment: {
              raw: payload.comment || 'Logged via SprintTicker'
            }
          })
        },
        `Logging time on WP #${cleanTaskId}`,
        this._http
      );

      const json = await res.json() as { id?: number };
      const remoteWorklogId = json.id ? json.id.toString() : `op_wl_${Date.now()}`;
      console.log(`[OpenProjectProvider] Successfully logged ${isoDuration} on WP #${cleanTaskId} (Entry ID: ${remoteWorklogId})`);
      return { success: true, remoteWorklogId };
    }
  }

  /// <summary>
  /// Updates target work package status on OpenProject via PATCH /api/v3/work_packages/{id}.
  /// </summary>
  public async updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    if (!this._domain || !this._apiKey) return false;

    let targetStatusId = '';
    if (status === 'in_progress') {
      targetStatusId = this._statusIdInProgress;
    } else if (status === 'to_test') {
      targetStatusId = this._statusIdToTest;
    } else if (status === 'to_review') {
      targetStatusId = this._statusIdToReview;
    } else if (status === 'done') {
      targetStatusId = this._defaultCompletionAction === 'to_review' ? this._statusIdToReview : this._statusIdToTest;
    }

    // OpenProject identifies statuses numerically. This setting used to be
    // seeded with status *names* ('In progress'), and those rows still exist
    // in every database created before that default was removed. A name
    // reaches /api/v3/statuses/In%20progress and 404s, so the shape is checked
    // here in order to report what is actually wrong rather than a failed
    // request. An empty value fails the same test, which is the intended
    // "never configured" case.
    if (!/^\d+$/.test(targetStatusId)) {
      console.warn(
        `[OpenProjectProvider] No usable status ID for '${status}' (found ${JSON.stringify(targetStatusId)}). ` +
          'Choose the statuses in Settings -- OpenProject needs their numeric IDs, not their names.'
      );
      return false;
    }

    {
      const cleanTaskId = taskId.replace(/^OP-/, '');
      const getUrl = `${this.getBaseUrl()}/api/v3/work_packages/${cleanTaskId}`;
      const getRes = await providerFetch(
        this.providerId,
        getUrl,
        { headers: { 'Authorization': this.getAuthHeader(), 'Accept': 'application/json' } },
        `Reading WP #${cleanTaskId} for status update`,
        this._http
      );
      const wp = await getRes.json() as { lockVersion?: number };

      const patchUrl = `${this.getBaseUrl()}/api/v3/work_packages/${cleanTaskId}`;
      // Not retried either, though for the opposite reason to the worklog
      // POST: `lockVersion` is consumed by the write, so a second attempt
      // carries a stale one and OpenProject answers 409. Re-reading it here
      // would defeat the optimistic lock, which exists to stop this app
      // overwriting an edit somebody made in the browser meanwhile.
      await providerFetch(
        this.providerId,
        patchUrl,
        {
          method: 'PATCH',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            lockVersion: wp.lockVersion,
            _links: {
              status: { href: `/api/v3/statuses/${targetStatusId}` }
            }
          })
        },
        `Setting status of WP #${cleanTaskId}`,
        this._http
      );

      return true;
    }
  }

  /// <summary>
  /// Fetches available statuses statically from the given OpenProject domain using the provided API key.
  /// </summary>
  public static async fetchStatuses(
    domain: string,
    apiKey: string,
    http: ProviderFetchOptions = {}
  ): Promise<{ success: boolean; data?: OpStatusDTO[]; error?: string }> {
    if (!domain || !apiKey) return { success: false, error: 'Domain or API key is missing.' };

    try {
      const baseUrl = OpenProjectProvider.sanitizeDomain(domain);
      const authHeader = `Basic ${Buffer.from(`apikey:${apiKey.trim()}`).toString('base64')}`;
      const elements = await fetchOpenProjectCollection(
        'openproject',
        baseUrl,
        authHeader,
        '/api/v3/statuses',
        'Fetching statuses',
        {},
        http
      );

      return {
        success: true,
        data: elements.map(s => ({
          id: (s.id as number | string).toString(),
          name: (s.name as string) || 'Unknown',
          isClosed: !!s.isClosed
        }))
      };
    } catch (err) {
      // Reports the failure to the settings UI rather than rethrowing: this is
      // the credential probe, so "why did that not work" is exactly what the
      // user is waiting to be told.
      console.error('[OpenProjectProvider] Failed to fetch statuses statically:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown network error' };
    }
  }
}
