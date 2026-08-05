import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

/**
 * Local task provider adapter mapping custom ad-hoc entries to fallback ticket ID (MISC-1).
 */
export class AdHocProvider implements ITaskProvider {
  public readonly providerId: string = 'adhoc';
  public readonly providerName: string = 'Ad-Hoc / Custom Fallback';
  private fallbackKey: string = 'MISC-1';

  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this.fallbackKey = credentials.fallbackKey || 'MISC-1';
    return true;
  }

  public async getProjects(): Promise<ProjectDTO[]> {
    return [{ id: 'ADHOC', key: 'ADHOC', name: 'Custom Ad-Hoc / Misc Overhead' }];
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    return [
      { id: 'ADHOC-01', projectId, key: this.fallbackKey, title: 'Sprint Planning & Stand-up', status: 'done' }
    ];
  }

  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }> {
    return { remoteLoggedTimeToday: 0 };
  }

  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    console.log(`[AdHocProvider] Logging ad-hoc time under ${this.fallbackKey}: ${payload.durationSeconds}s ("${payload.comment}")`);
    return {
      success: true,
      remoteWorklogId: `adhoc_wl_${Date.now()}`
    };
  }

  public async updateTaskStatus(_taskId: string, _status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    return false;
  }
}
