import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO, OpStatusDTO, OpenProjectNotificationDTO } from '../../shared/dtos';
import { ProviderRequestError } from './provider-errors';
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
      clean = 'http://' + clean;
    }
    return clean;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`apikey:${this._apiKey.trim()}`).toString('base64')}`;
  }

  private getBaseUrl(): string {
    return OpenProjectProvider.sanitizeDomain(this._domain);
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

    let res: Response;
    try {
      res = await fetch(`${this.getBaseUrl()}/api/v3/projects`, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      throw ProviderRequestError.fromTransport(this.providerId, 'Fetching projects', err);
    }

    if (!res.ok) {
      throw ProviderRequestError.fromStatus(this.providerId, res.status, 'Fetching projects');
    }

    let json: { _embedded?: { elements?: Array<Record<string, unknown>> } };
    try {
      json = (await res.json()) as { _embedded?: { elements?: Array<Record<string, unknown>> } };
    } catch (err) {
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        'Fetching projects failed: response body was not valid JSON',
        { cause: err }
      );
    }

    const elements = json?._embedded?.elements;
    if (!Array.isArray(elements)) {
      // An empty result is legitimate; a missing collection is not, and must not
      // be reported as "the user has no projects" -- the sync worker would prune
      // the entire local cache on the strength of it.
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        'Fetching projects failed: response had no _embedded.elements collection'
      );
    }

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
    const url = `${this.getBaseUrl()}/api/v3/work_packages?filters=${encodeURIComponent(filter)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/json'
        }
      });
    } catch (err) {
      throw ProviderRequestError.fromTransport(this.providerId, `Fetching tasks for project ${projectId}`, err);
    }

    if (!res.ok) {
      throw ProviderRequestError.fromStatus(this.providerId, res.status, `Fetching tasks for project ${projectId}`);
    }

    let json: { _embedded?: { elements?: Array<Record<string, unknown>> } };
    try {
      json = (await res.json()) as { _embedded?: { elements?: Array<Record<string, unknown>> } };
    } catch (err) {
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        `Fetching tasks for project ${projectId} failed: response body was not valid JSON`,
        { cause: err }
      );
    }

    const elements = json?._embedded?.elements;
    if (!Array.isArray(elements)) {
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        `Fetching tasks for project ${projectId} failed: response had no _embedded.elements collection`
      );
    }

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
      const url = `${this.getBaseUrl()}/api/v3/notifications?filters=${encodeURIComponent(filter)}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/json'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { _embedded?: { elements?: Array<Record<string, unknown>> } };
      
      const elements = json?._embedded?.elements;
      if (Array.isArray(elements)) {
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
      }
    } catch (err) {
      console.error('[OpenProjectProvider] Failed to fetch unread notifications:', err);
    }
    return [];
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
      const url = `${this.getBaseUrl()}/api/v3/time_entries?filters=${encodeURIComponent(filter)}`;
      
      const res = await fetch(url, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/json'
        }
      });
      
      if (res.ok) {
        const json = await res.json() as { _embedded?: { elements?: Array<Record<string, unknown>> } };
        const elements = json?._embedded?.elements;
        if (Array.isArray(elements)) {
          let totalSeconds = 0;
          for (const entry of elements) {
            const isoDuration = entry.hours as string;
            // Parse PTnHnMnS
            if (isoDuration && isoDuration.startsWith('PT')) {
              let h = 0, m = 0, s = 0;
              const hMatch = isoDuration.match(/(\d+)H/);
              if (hMatch) h = parseInt(hMatch[1], 10);
              const mMatch = isoDuration.match(/(\d+)M/);
              if (mMatch) m = parseInt(mMatch[1], 10);
              const sMatch = isoDuration.match(/(\d+)S/);
              if (sMatch) s = parseInt(sMatch[1], 10);
              totalSeconds += h * 3600 + m * 60 + s;
            }
          }
          return { remoteLoggedTimeToday: totalSeconds };
        }
      }
    } catch (err) {
      console.error('[OpenProjectProvider] Failed to reconcile remote state:', err);
    }
    return { remoteLoggedTimeToday: 0 };
  }

  /// <summary>
  /// Synchronizes time tracking with OpenProject by creating a time entry on the target work package (POST /api/v3/time_entries).
  /// </summary>
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    if (!this._domain || !this._apiKey) {
      console.warn('[OpenProjectProvider] Cannot log time: OpenProject domain or API key missing.');
      return { success: false };
    }
    if (!payload.taskId || payload.durationSeconds <= 0) {
      console.warn('[OpenProjectProvider] Cannot log time: Invalid task ID or duration <= 0.');
      return { success: false };
    }

    try {
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

      const res = await fetch(url, {
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
      });

      if (res.ok) {
        const json = await res.json() as { id?: number };
        const remoteWorklogId = json.id ? json.id.toString() : `op_wl_${Date.now()}`;
        console.log(`[OpenProjectProvider] Successfully logged ${isoDuration} on WP #${cleanTaskId} (Entry ID: ${remoteWorklogId})`);
        return { success: true, remoteWorklogId };
      } else {
        const errText = await res.text();
        console.error(`[OpenProjectProvider] Failed to log time (HTTP ${res.status}): ${errText}`);
      }
    } catch (err) {
      console.error('[OpenProjectProvider] Exception logging time:', err);
    }
    return { success: false };
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

    if (!targetStatusId) {
      console.warn(`[OpenProjectProvider] No status ID configured for '${status}'`);
      return false;
    }

    try {
      const cleanTaskId = taskId.replace(/^OP-/, '');
      const getUrl = `${this.getBaseUrl()}/api/v3/work_packages/${cleanTaskId}`;
      const getRes = await fetch(getUrl, { headers: { 'Authorization': this.getAuthHeader(), 'Accept': 'application/json' } });
      if (!getRes.ok) throw new Error(`Failed to fetch WP #${cleanTaskId} for status update`);
      const wp = await getRes.json() as { lockVersion?: number };

      const patchUrl = `${this.getBaseUrl()}/api/v3/work_packages/${cleanTaskId}`;
      const patchRes = await fetch(patchUrl, {
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
      });

      return patchRes.ok;
    } catch (err) {
      console.error('[OpenProjectProvider] Failed to update task status:', err);
      return false;
    }
  }

  /// <summary>
  /// Fetches available statuses statically from the given OpenProject domain using the provided API key.
  /// </summary>
  public static async fetchStatuses(domain: string, apiKey: string): Promise<{ success: boolean; data?: OpStatusDTO[]; error?: string }> {
    if (!domain || !apiKey) return { success: false, error: 'Domain or API key is missing.' };
    
    try {
      const baseUrl = OpenProjectProvider.sanitizeDomain(domain);
      const authHeader = `Basic ${Buffer.from(`apikey:${apiKey.trim()}`).toString('base64')}`;
      const url = `${baseUrl}/api/v3/statuses`;
      
      const res = await fetch(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });
      
      if (!res.ok) {
        let errorText = `HTTP ${res.status}`;
        try {
          const errJson = await res.json() as { message?: string };
          if (errJson.message) errorText += ` - ${errJson.message}`;
        } catch { /* Ignore json parse error */ }
        return { success: false, error: errorText };
      }
      
      const json = await res.json() as { _embedded?: { elements?: Array<Record<string, unknown>> } };
      const elements = json?._embedded?.elements;
      
      if (Array.isArray(elements)) {
        const statuses = elements.map(s => ({
          id: (s.id as number | string).toString(),
          name: (s.name as string) || 'Unknown',
          isClosed: !!s.isClosed
        }));
        return { success: true, data: statuses };
      } else {
        return { success: false, error: 'Unexpected response format from OpenProject.' };
      }
    } catch (err) {
      console.error('[OpenProjectProvider] Failed to fetch statuses statically:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown network error' };
    }
  }
}

