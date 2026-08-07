import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

/**
 * Concrete task provider adapter for OpenProject API v3.
 */
export class OpenProjectProvider implements ITaskProvider {
  public readonly providerId: string = 'openproject';
  public readonly providerName: string = 'OpenProject';

  private domain: string = '';
  private apiKey: string = '';
  
  // Status Mappings (populated from settings)
  private statusIdInProgress: string = '';
  private statusIdToTest: string = '';
  private statusIdToReview: string = '';
  private defaultCompletionAction: string = 'to_test';

  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this.domain = credentials.domain || credentials.opDomain || '';
    this.apiKey = credentials.apiToken || credentials.apiKey || credentials.opApiKey || '';
    this.statusIdInProgress = credentials.opStatusInProgress || '';
    this.statusIdToTest = credentials.opStatusToTest || '';
    this.statusIdToReview = credentials.opStatusToReview || '';
    this.defaultCompletionAction = credentials.opCompletionAction || 'to_test';
    return true;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`apikey:${this.apiKey}`).toString('base64')}`;
  }

  private getBaseUrl(): string {
    return this.domain.replace(/\/$/, '');
  }

  /**
   * Converts duration in seconds to ISO 8601 duration format (e.g. PT1H30M, PT15M, PT45S).
   */
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

  public async getProjects(): Promise<ProjectDTO[]> {
    if (!this.domain || !this.apiKey) return [];

    try {
      const url = `${this.getBaseUrl()}/api/v3/projects`;
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
        return elements.map(p => ({
          id: (p.id as number | string).toString(),
          key: (p.identifier as string) || `proj_${p.id}`,
          name: (p.name as string) || 'Untitled Project'
        }));
      }
    } catch (err) {
      console.error('[OpenProjectProvider] Failed to fetch projects:', err);
    }
    return [];
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    if (!this.domain || !this.apiKey) return [];

    try {
      const filter = `[{"project":{"operator":"=","values":["${projectId}"]}}]`;
      const url = `${this.getBaseUrl()}/api/v3/work_packages?filters=${encodeURIComponent(filter)}`;
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
        return elements.map(t => {
          const links = (t._links || {}) as Record<string, { href?: string }>;
          const opStatusId = links.status?.href?.split('/').pop();
          let localStatus: 'todo' | 'in_progress' | 'done' = 'todo';
          
          if (opStatusId === this.statusIdInProgress) {
            localStatus = 'in_progress';
          } else if (opStatusId === this.statusIdToTest || opStatusId === this.statusIdToReview) {
            localStatus = 'done';
          }

          const rawId = (t.id as number | string).toString();
          return {
            id: rawId,
            projectId,
            key: `OP-${rawId}`,
            title: (t.subject as string) || 'Untitled Work Package',
            status: localStatus
          };
        });
      }
    } catch (err) {
      console.error('[OpenProjectProvider] Failed to fetch tasks:', err);
    }
    return [];
  }

  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }> {
    return { remoteLoggedTimeToday: 0 };
  }

  /**
   * Synchronizes time tracking with OpenProject by creating a time entry on the target work package.
   */
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    if (!this.domain || !this.apiKey) {
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
      const spentOnDate = payload.startedAtUtc ? payload.startedAtUtc.split('T')[0] : new Date().toISOString().split('T')[0];

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
            raw: payload.comment || 'Logged via Antigravity BUSY Bar'
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

  public async updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    if (!this.domain || !this.apiKey) return false;

    let targetStatusId = '';
    if (status === 'in_progress') {
      targetStatusId = this.statusIdInProgress;
    } else if (status === 'to_test') {
      targetStatusId = this.statusIdToTest;
    } else if (status === 'to_review') {
      targetStatusId = this.statusIdToReview;
    } else if (status === 'done') {
      targetStatusId = this.defaultCompletionAction === 'to_review' ? this.statusIdToReview : this.statusIdToTest;
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
}

