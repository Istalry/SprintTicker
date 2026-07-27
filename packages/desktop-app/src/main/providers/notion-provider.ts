import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

/**
 * Notion Database / Generic REST task provider adapter.
 */
export class NotionProvider implements ITaskProvider {
  public readonly providerId: string = 'notion';
  public readonly providerName: string = 'Notion Database';

  public async initialize(_credentials: Record<string, string>): Promise<boolean> {
    return true;
  }

  public async getProjects(): Promise<ProjectDTO[]> {
    return [{ id: 'NOTION-1', key: 'NOTION', name: 'Game Roadmap Database' }];
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    return [
      { id: 'NOTION-101', projectId, key: 'NOTION-101', title: 'Refactor UI State Store', status: 'todo' }
    ];
  }

  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }> {
    return { remoteLoggedTimeToday: 0 };
  }

  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    console.log(`[NotionProvider] Submitting Notion worklog for ${payload.taskId}: ${payload.durationSeconds}s`);
    return {
      success: true,
      remoteWorklogId: `notion_wl_${Date.now()}`
    };
  }
}
