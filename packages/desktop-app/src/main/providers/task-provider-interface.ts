import { ProjectDTO, TaskDTO } from '../../shared/dtos';
import { ProviderEventDTO } from '../../shared/provider-events';

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
  /**
   * How much time the remote already holds for today, or `null` if this
   * provider cannot find out.
   *
   * The null is load-bearing. Jira has no single endpoint for "time I logged
   * today" -- it needs a JQL search on `worklogDate` and then a worklog fetch
   * per issue -- and AdHoc has no remote at all, so both used to answer `0`.
   * A caller cannot tell that apart from "you logged nothing today", and the
   * wrong reading is the one a UI would render. `null` says "do not display a
   * figure", which is the only honest answer either can give.
   *
   * OpenProject returns a real total, and returns `null` when the fetch fails
   * rather than understating the day as zero.
   */
  reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number | null }>;
  logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }>;

  /**
   * The id of the entry `logTime` made, found by the marker its comment
   * carries (`syncMarker`), or null when no entry on the task near
   * `startedAtUtc` carries it. For entries sent before their id was kept
   * (migration 8), or whose answer had none.
   *
   * Throws on failure, like getProjects: null must mean "not there", never
   * "could not look", or a correction would be given up on an entry that
   * exists.
   *
   * The three worklog methods are optional because a provider without a
   * remote has nothing to correct; the queue reports such a provider as
   * unable rather than calling it.
   */
  findWorklog?(taskId: string, startedAtUtc: string, marker: string): Promise<string | null>;
  /**
   * Replaces the entry's duration, start and comment. Throws; an entry
   * deleted at the provider is a permanent `ProviderRequestError` (404).
   */
  updateWorklog?(taskId: string, remoteWorklogId: string, payload: WorklogPayload): Promise<void>;
  /** Deletes the entry. One already gone (404) counts as deleted, not as a failure. */
  deleteWorklog?(taskId: string, remoteWorklogId: string): Promise<void>;
  updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean>;

  /**
   * Where one task stands, read on its own: `open`, `closed` (done on the
   * provider), or `gone` -- deleted, or no longer visible to the user, which
   * the provider answers alike with a 404. For a tracked task that left the
   * list, so the user is told which of those it was. Throws on any other
   * failure; optional, since a provider without a remote has no answer.
   */
  getTaskStanding?(taskId: string): Promise<'open' | 'closed' | 'gone'>;

  /**
   * What happened to the user's tasks after `sinceUtc` (exclusive): assigned,
   * mentioned, commented, status changed, date alert. Optional -- a provider
   * without a remote has nothing to report -- and listed in
   * `PROVIDERS_WITH_EVENTS` when present.
   *
   * **Throws on failure**, like getProjects. An empty array means "nothing
   * happened", and a poll that read a failure that way would move its cursor
   * past events it never saw.
   *
   * Timestamps are the provider's own; the caller's cursor advances on them.
   */
  getEventsSince?(sinceUtc: string): Promise<ProviderEventDTO[]>;

  /** Where the provider lists every notification, for a summary toast. */
  getEventsInboxUrl?(): string | null;
}
