import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';
import { ADHOC_PROJECT_ID } from '../../shared/adhoc-project';

/**
 * Local task provider adapter mapping custom ad-hoc entries to fallback ticket ID (MISC-1).
 */
export class AdHocProvider implements ITaskProvider {
  public readonly providerId: string = 'adhoc';
  public readonly providerName: string = 'Ad-Hoc / Custom Fallback';
  /** Nothing leaves the machine, so the only floor is a whole second. */
  public readonly minimumLoggableSeconds: number = 1;
  private fallbackKey: string = 'MISC-1';

  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this.fallbackKey = credentials.fallbackKey || 'MISC-1';
    return true;
  }

  public async getProjects(): Promise<ProjectDTO[]> {
    return [{ id: ADHOC_PROJECT_ID, key: ADHOC_PROJECT_ID, name: 'Custom Ad-Hoc / Misc Overhead', providerId: this.providerId }];
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    return [
      { id: 'ADHOC-01', projectId, key: this.fallbackKey, title: 'Sprint Planning & Stand-up', status: 'done' }
    ];
  }

  /** There is no remote to reconcile against, so there is no figure to give. */
  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number | null }> {
    return { remoteLoggedTimeToday: null };
  }

  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    console.log(`[AdHocProvider] Logging ad-hoc time under ${this.fallbackKey}: ${payload.durationSeconds}s ("${payload.comment}")`);
    // No remote, so no remote id: one made up here would be kept as the
    // handle for correcting an entry that exists nowhere.
    return { success: true };
  }

  public async updateTaskStatus(_taskId: string, _status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    return false;
  }
}
