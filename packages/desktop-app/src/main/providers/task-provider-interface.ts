import { ProjectDTO, TaskDTO } from '../../shared/dtos';

export interface WorklogPayload {
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  isAdHoc: boolean;
}

/**
 * Generic task provider contract implemented by Jira, Notion, and Ad-Hoc provider adapters.
 */
export interface ITaskProvider {
  readonly providerId: string;
  readonly providerName: string;

  initialize(credentials: Record<string, string>): Promise<boolean>;
  getProjects(): Promise<ProjectDTO[]>;
  getTasks(projectId: string): Promise<TaskDTO[]>;
  reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }>;
  logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }>;
}
