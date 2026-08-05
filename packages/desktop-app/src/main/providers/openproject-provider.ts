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
    this.domain = credentials.domain || '';
    this.apiKey = credentials.apiToken || '';
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
      const json = await res.json() as { _embedded?: { elements?: unknown[] } };
      
      const elements = json?._embedded?.elements;
      if (Array.isArray(elements)) {
        return elements.map(p => ({
          id: p.id.toString(),
          key: p.identifier,
          name: p.name
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
      const json = await res.json() as { _embedded?: { elements?: Record<string, unknown>[] } };
      
      const elements = json?._embedded?.elements;
      if (Array.isArray(elements)) {
        return elements.map(t => {
          const opStatusId = t._links?.status?.href?.split('/').pop();
          let localStatus: 'todo' | 'in_progress' | 'done' = 'todo';
          
          if (opStatusId === this.statusIdInProgress) {
            localStatus = 'in_progress';
          } else if (opStatusId === this.statusIdToTest || opStatusId === this.statusIdToReview) {
            localStatus = 'done';
          }

          return {
            id: t.id.toString(),
            projectId,
            key: `OP-${t.id}`,
            title: t.subject || 'Untitled Task',
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

  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    if (!this.domain || !this.apiKey) return { success: false };
    if (!payload.taskId || payload.durationSeconds <= 0) return { success: false };

    try {
      const url = `${this.getBaseUrl()}/api/v3/time_entries`;
      const hours = (payload.durationSeconds / 3600).toFixed(2);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': this.getAuthHeader(),
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          _links: {
            workPackage: { href: `/api/v3/work_packages/${payload.taskId}` }
          },
          hours,
          spentOn: payload.startedAtUtc.split('T')[0],
          comment: {
            raw: payload.comment || 'Logged via Antigravity BUSY Bar'
          }
        })
      });

      if (res.ok) {
        const json = await res.json() as { id?: number };
        return { success: true, remoteWorklogId: json.id ? json.id.toString() : `op_wl_${Date.now()}` };
      }
    } catch (err) {
      console.error('[OpenProjectProvider] Failed to log time:', err);
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
      const getUrl = `${this.getBaseUrl()}/api/v3/work_packages/${taskId}`;
      const getRes = await fetch(getUrl, { headers: { 'Authorization': this.getAuthHeader(), 'Accept': 'application/json' } });
      if (!getRes.ok) throw new Error(`Failed to fetch WP ${taskId} for update`);
      const wp = await getRes.json() as { lockVersion?: number };

      const patchUrl = `${this.getBaseUrl()}/api/v3/work_packages/${taskId}`;
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
