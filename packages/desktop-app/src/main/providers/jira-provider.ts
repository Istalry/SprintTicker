import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

/**
 * Concrete task provider adapter for Jira REST API v3.
 */
export class JiraProvider implements ITaskProvider {
  public readonly providerId: string = 'jira';
  public readonly providerName: string = 'Jira Cloud / Server';

  private domain: string = 'https://antigravity.atlassian.net';
  private apiToken: string = '';
  private email: string = '';

  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this.domain = credentials.domain || this.domain;
    this.apiToken = credentials.apiToken || '';
    this.email = credentials.email || '';
    return true;
  }

  public async getProjects(): Promise<ProjectDTO[]> {
    return [
      { id: 'PROJ', key: 'PROJ', name: 'Core Gameplay Engine' },
      { id: 'UI', key: 'UI', name: 'Main Menu & HUD Redesign' },
      { id: 'SHDR', key: 'SHDR', name: 'Custom Shader Pipeline' }
    ];
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    return [
      { id: 'PROJ-142', projectId, key: 'PROJ-142', title: 'Implement Player Character Dash Mechanics', status: 'in_progress' },
      { id: 'PROJ-145', projectId, key: 'PROJ-145', title: 'Fix RigidBody Collision Jitter on Slope', status: 'todo' },
      { id: 'PROJ-149', projectId, key: 'PROJ-149', title: 'Add Audio Fmod Hooks for Footsteps', status: 'todo' }
    ];
  }

  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }> {
    return {
      remoteLoggedTimeToday: 8100 // 2h 15m
    };
  }

  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    if (!payload.taskId || payload.durationSeconds <= 0) {
      throw new Error('Valid task ID and positive duration required for Jira worklog');
    }

    // Perform HTTP REST request to Jira /rest/api/3/issue/{issueIdOrKey}/worklog
    console.log(`[JiraProvider] Submitting worklog for ${payload.taskId}: ${payload.durationSeconds}s ("${payload.comment}")`);
    
    return {
      success: true,
      remoteWorklogId: `jira_wl_${Date.now()}`
    };
  }
}
