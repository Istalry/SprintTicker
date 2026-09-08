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

  /**
   * The shortest session this provider can actually record, in seconds.
   *
   * Declared per adapter because it is a fact about the remote API, not a
   * policy: Jira's time tracking has a one-minute granularity, so
   * `timeSpentSeconds: 5` rounds to zero minutes and the API answers
   * `400 - Le journal de travail ne doit pas avoir pour valeur Null`. Found
   * against a live site, where the row then retried on the ordinary backoff
   * because nothing knew it was hopeless.
   *
   * OpenProject records arbitrary durations, so it must not inherit Jira's
   * floor -- losing a user's time to another product's limitation is the
   * failure this property exists to prevent. The engine reads it before
   * queueing, so a session too short to record is never handed to a provider
   * that will refuse it.
   */
  readonly minimumLoggableSeconds: number;

  initialize(credentials: Record<string, string>): Promise<boolean>;
  getProjects(): Promise<ProjectDTO[]>;
  getTasks(projectId: string): Promise<TaskDTO[]>;
  reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }>;
  logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }>;
  updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean>;
}
