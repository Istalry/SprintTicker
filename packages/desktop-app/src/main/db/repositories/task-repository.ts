import type Database from 'better-sqlite3';
import { DatabaseConnection } from '../database-connection';
import { createId, IdPrefix, isAdHocTaskId } from '../id-generator';
import { TOMBSTONE_PROJECT_ID } from '../migrations';
import { ArgumentException, ArgumentNullException, TaskDTO } from '../../../shared/dtos';
import { ADHOC_PROJECT_ID } from '../../../shared/adhoc-project';
import { parseTaskOwnership, TaskOwnership, TaskOwnershipValue } from '../../../shared/task-ownership';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey } from '../../../shared/provider-settings';
import { StarIdentity, starIdentity } from '../../../shared/task-stars';
import { ProviderId } from '../../../shared/provider-names';
import { UNKNOWN_PROJECT_PROVIDER_ID } from '../../../shared/local-provider';

/**
 * The columns every read selects, under the DTO's names: three queries
 * listed them by hand, and one forgetting a new column drops it silently.
 */
const TASK_COLUMNS =
  'id, project_id as projectId, key, title, status, priority_rank as priorityRank, description, ' +
  'ownership, assignee_name as assigneeName, unsorted';

/** A `tasks` row as TASK_COLUMNS reads it. */
interface TaskRow {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  priorityRank: number | null;
  description: string | null;
  ownership: string | null;
  assigneeName: string | null;
  unsorted: number | null;
}

/** True for a `tasks` row that some worklog references. */
const HAS_WORKLOGS = 'EXISTS (SELECT 1 FROM worklogs w WHERE w.task_id = tasks.id)';

/**
 * Takes the tasks matching `where` off the lists: deletes those with no logged
 * time and archives the rest.
 *
 * The one way tasks leave this database. A worklog is billable time, and the
 * sync prune used to delete the task under it whenever the provider stopped
 * listing it -- reassigned, closed, moved -- which left history naming a task
 * id nothing could resolve. `worklogs.task_id` is now a foreign key, so a
 * plain DELETE of such a task fails; this is what every caller uses instead.
 *
 * `where` is SQL over `tasks`, with `?` placeholders bound from `params`.
 */
export function retireTasks(db: Database.Database, where: string, params: unknown[]): { archived: number; deleted: number } {
  const retire = db.transaction(() => ({
    archived: db
      .prepare(`UPDATE tasks SET archived_at_utc = ? WHERE (${where}) AND archived_at_utc IS NULL AND ${HAS_WORKLOGS}`)
      .run(new Date().toISOString(), ...params).changes,
    deleted: db.prepare(`DELETE FROM tasks WHERE (${where}) AND NOT ${HAS_WORKLOGS}`).run(...params).changes
  }));
  return retire();
}

/**
 * Repository layer for managing tasks and ad-hoc task creation in SQLite.
 */
export class TaskRepository {
  private dbConn: DatabaseConnection;

  constructor(dbConn?: DatabaseConnection) {
    this.dbConn = dbConn || DatabaseConnection.getInstance();
  }

  /**
   * The connection this repository reads and writes through.
   *
   * Exposed so a collaborator constructed as a fallback can bind to the *same*
   * database rather than silently resolving the DatabaseConnection singleton,
   * which opens a second, on-disk connection and deadlocks schema migrations.
   */
  public getConnection(): DatabaseConnection {
    return this.dbConn;
  }

  /**
   * Retrieves tasks for a given project ID.
   */
  public getTasksByProjectId(projectId: string): TaskDTO[] {
    if (!projectId) {
      throw new Error('Project ID is required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return [];

      // Whoever's they are: each list applies the user's task visibility
      // (`task-visibility.ts`), and each row says whose it is.
      const stmt = db.prepare<[string], TaskRow>(
        `SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id = ? AND archived_at_utc IS NULL`
      );

      const rows = stmt.all(projectId);
      return rows.map(r => TaskRepository.toDto(r));
    } catch (err) {
      console.warn('[TaskRepository] Failed to fetch tasks:', err);
      return [];
    }
  }

  /**
   * Every task the lists hold, whoever's, across projects: the picker's
   * search and its "All projects". Ad-hoc work is left out -- the picker
   * offers it as Recent and as "a task of my own" -- and so are interruptions
   * of the model before P6, still marked unsorted.
   */
  public getAllListed(): TaskDTO[] {
    return this.dbConn.getDb().prepare<[string, string], TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks
        WHERE archived_at_utc IS NULL AND unsorted = 0 AND project_id NOT IN (?, ?)`
    ).all(ADHOC_PROJECT_ID, TOMBSTONE_PROJECT_ID).map(r => TaskRepository.toDto(r));
  }

  /**
   * Seconds logged per project since `sinceUtc`, for "most used" in the
   * picker. Read from the worklogs, so a project used only through ad-hoc
   * work counts nothing.
   */
  public getProjectSecondsSince(sinceUtc: string): Record<string, number> {
    if (!sinceUtc) throw new ArgumentNullException('sinceUtc');
    const rows = this.dbConn.getDb().prepare<[string], { projectId: string; seconds: number }>(
      `SELECT t.project_id AS projectId, SUM(w.duration_seconds) AS seconds
         FROM worklogs w JOIN tasks t ON t.id = w.task_id
        WHERE w.started_at_utc >= ?
        GROUP BY t.project_id`
    ).all(sinceUtc);
    return Object.fromEntries(rows.map(r => [r.projectId, r.seconds]));
  }

  /**
   * Retrieves a single task record by its ID, archived or not -- history has
   * to be able to name a task the lists no longer show.
   */
  public getTaskById(taskId: string): TaskDTO | null {
    if (!taskId) return null;

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return null;

      const stmt = db.prepare<[string], TaskRow>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`);

      const row = stmt.get(taskId);
      if (!row) return null;

      return TaskRepository.toDto(row);
    } catch (err) {
      console.warn('[TaskRepository] Failed to fetch task by id:', err);
      return null;
    }
  }

  /**
   * Whether the task is still in the user's lists: its row exists, the sync
   * has not archived it, and it is not someone else's. Asked before anything
   * restarts a task on the user's behalf -- a task reassigned, closed or
   * moved since is no longer theirs to track without asking. A teammate's
   * task in progress is listed now, so the row alone no longer says so.
   */
  public isListed(taskId: string): boolean {
    if (!taskId) return false;
    const db = this.dbConn.getDb();
    const row = db
      .prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM tasks WHERE id = ? AND archived_at_utc IS NULL AND ownership != '${TaskOwnership.OTHER}'`
      )
      .get(taskId);
    return (row?.n ?? 0) > 0;
  }

  /**
   * Records whose the task is, as a single read of it said (the minute
   * check, P8e2). True when that changed the row; the assignee's name is
   * kept only for someone else's task, as the sync keeps it.
   */
  public setOwnership(taskId: string, ownership: TaskOwnershipValue, assigneeName?: string): boolean {
    if (!taskId) throw new ArgumentNullException('taskId');
    const name = ownership === TaskOwnership.OTHER ? (assigneeName ?? null) : null;
    const result = this.dbConn.getDb()
      .prepare('UPDATE tasks SET ownership = ?, assignee_name = ? WHERE id = ? AND (ownership IS NOT ? OR assignee_name IS NOT ?)')
      .run(ownership, name, taskId, ownership, name);
    return result.changes > 0;
  }

  /** Whose the task is; the user's for a task with no row, as for one from before ownership. */
  public ownershipOf(taskId: string): TaskDTO['ownership'] {
    if (!taskId) return TaskOwnership.MINE;
    const row = this.dbConn.getDb()
      .prepare<[string], { ownership: string }>('SELECT ownership FROM tasks WHERE id = ?')
      .get(taskId);
    return parseTaskOwnership(row?.ownership);
  }

  /**
   * Whether the sync has archived the task: its row is kept for its history,
   * but the provider no longer lists it for the user. False for a task with
   * no row at all, which says nothing about where it stands.
   */
  public isArchived(taskId: string): boolean {
    if (!taskId) return false;
    const row = this.dbConn.getDb()
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE id = ? AND archived_at_utc IS NOT NULL')
      .get(taskId);
    return (row?.n ?? 0) > 0;
  }

  /**
   * A row as a DTO; a NULL priority or description is left off rather than
   * carried as null, and so is the ownership of the user's own task -- what
   * a DTO without one has always meant.
   */
  private static toDto(row: TaskRow): TaskDTO {
    const task: TaskDTO = {
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      title: row.title,
      status: row.status
    };
    if (row.priorityRank !== null && row.priorityRank !== undefined) task.priorityRank = row.priorityRank;
    if (row.description) task.description = row.description;
    const ownership = parseTaskOwnership(row.ownership);
    if (ownership !== TaskOwnership.MINE) task.ownership = ownership;
    if (row.assigneeName && ownership === TaskOwnership.OTHER) task.assigneeName = row.assigneeName;
    if (row.unsorted === 1) task.unsorted = true;
    return task;
  }

  /**
   * Upserts a task record into SQLite.
   *
   * The priority is overwritten along with everything else, so a priority the
   * provider no longer reports clears rather than lingering, and so does a
   * description. So is the archive
   * mark: a task the provider lists again -- reassigned back, reopened --
   * returns to the lists with its history attached.
   */
  public saveTask(task: TaskDTO): void {
    if (!task.id || !task.projectId || !task.key || !task.title) {
      throw new Error('Task ID, Project ID, Key, and Title are required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      const stmt = db.prepare(`
        INSERT INTO tasks (id, project_id, key, title, status, priority_rank, description, ownership, assignee_name, created_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          key = excluded.key,
          title = excluded.title,
          status = excluded.status,
          priority_rank = excluded.priority_rank,
          description = excluded.description,
          ownership = excluded.ownership,
          assignee_name = excluded.assignee_name,
          archived_at_utc = NULL
      `);

      stmt.run(
        task.id, task.projectId, task.key, task.title, task.status,
        task.priorityRank ?? null, task.description ?? null,
        task.ownership ?? TaskOwnership.MINE,
        task.ownership === TaskOwnership.OTHER ? (task.assigneeName ?? null) : null,
        new Date().toISOString()
      );
    } catch (err) {
      console.warn('[TaskRepository] Failed to save task:', err);
    }
  }

  /**
   * The listed ad-hoc task with this title, if there is one: the most recent.
   * For a task started on the user's behalf every day, which would otherwise
   * leave a new row in the ad-hoc list each morning.
   */
  public findAdHocTaskByTitle(title: string): TaskDTO | null {
    if (!title) return null;
    const row = this.dbConn.getDb().prepare<[string, string], TaskRow>(
      `SELECT ${TASK_COLUMNS}
       FROM tasks WHERE project_id = ? AND title = ? AND archived_at_utc IS NULL
       ORDER BY created_at_utc DESC LIMIT 1`
    ).get(ADHOC_PROJECT_ID, title);
    return row ? TaskRepository.toDto(row) : null;
  }

  /**
   * Creates a custom ad-hoc task, shown under `adHocKey` (the configured ad-hoc key).
   *
   * `unsorted` for an interruption's task, whose name the app made up: it
   * waits for the user to name it or move its time (migration 13). Never
   * written by `saveTask`, so a later save of the row keeps it.
   */
  public createAdHocTask(customTitle: string, adHocKey: string = PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.FALLBACK_TICKET_KEY], unsorted: boolean = false): TaskDTO {
    if (!customTitle) {
      throw new Error('Custom title is required for ad-hoc task creation');
    }

    const taskId = createId(IdPrefix.ADHOC_TASK);
    const adHocTask: TaskDTO = {
      id: taskId,
      projectId: ADHOC_PROJECT_ID,
      key: adHocKey,
      title: customTitle,
      status: 'in_progress'
    };

    this.saveTask(adHocTask);
    if (unsorted) {
      this.dbConn.getDb().prepare('UPDATE tasks SET unsorted = 1 WHERE id = ?').run(taskId);
      adHocTask.unsorted = true;
    }
    return adHocTask;
  }

  /**
   * Names an ad-hoc task, and so every worklog on it in History, which reads
   * the title from the row. Clears the unsorted mark: the user has named it.
   *
   * @throws ArgumentException for a task that is not ad-hoc, or an empty name.
   */
  public renameAdHocTask(taskId: string, title: string): void {
    if (!taskId || !isAdHocTaskId(taskId)) throw new ArgumentException(`${String(taskId)} is not an ad-hoc task.`, 'taskId');
    if (!title || !title.trim()) throw new ArgumentException('An ad-hoc task needs a name.', 'title');
    this.dbConn.getDb().prepare('UPDATE tasks SET title = ?, unsorted = 0 WHERE id = ?').run(title.trim(), taskId);
  }

  /** The ad-hoc tasks still waiting to be named or assigned, oldest first. */
  public getUnsortedTasks(): TaskDTO[] {
    return this.dbConn.getDb().prepare<[], TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE unsorted = 1 AND archived_at_utc IS NULL ORDER BY created_at_utc ASC`
    ).all().map(r => TaskRepository.toDto(r));
  }

  /**
   * Whether a task can be offered to switch back to or pick again: its row
   * is in the lists and it has a name -- an interruption nobody has named
   * yet is not, as Recent leaves it out (S7).
   */
  public isOffered(taskId: string): boolean {
    if (!taskId) return false;
    const row = this.dbConn.getDb()
      .prepare<[string], { n: number }>(
        'SELECT COUNT(*) AS n FROM tasks WHERE id = ? AND archived_at_utc IS NULL AND unsorted = 0'
      )
      .get(taskId);
    return (row?.n ?? 0) > 0;
  }

  /**
   * The tasks of the latest sessions, each once, the most recently started
   * first; only those that can be offered (`isOffered`). No table of their
   * own: the sessions are the record.
   */
  public getRecent(limit: number): TaskDTO[] {
    if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentException('The limit must be a positive integer.', 'limit');
    const columns = TASK_COLUMNS.split(', ').map(c => `t.${c}`).join(', ');
    return this.dbConn.getDb().prepare<[number], TaskRow>(
      `SELECT ${columns}
         FROM tasks t
         JOIN (SELECT task_id, MAX(start_time_utc) AS last_start FROM active_sessions GROUP BY task_id) s
           ON s.task_id = t.id
        WHERE t.archived_at_utc IS NULL AND t.unsorted = 0
        ORDER BY s.last_start DESC
        LIMIT ?`
    ).all(limit).map(r => TaskRepository.toDto(r));
  }

  /** The identity a task's star is kept under, or null for a task with no row. */
  private starIdentityOf(taskId: string): StarIdentity | null {
    const row = this.dbConn.getDb().prepare<[string], { id: string; key: string; providerId: string | null }>(
      `SELECT t.id, t.key, p.provider_id AS providerId
         FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.id = ?`
    ).get(taskId);
    if (!row) return null;
    return starIdentity(row, row.providerId ?? undefined, isAdHocTaskId(row.id));
  }

  /**
   * Stars a task. Starring it again keeps the first star's time and records
   * the row now under it.
   *
   * @throws ArgumentException for a task with no row.
   */
  public star(taskId: string): void {
    if (!taskId) throw new ArgumentException('A task id is required.', 'taskId');
    const identity = this.starIdentityOf(taskId);
    if (!identity) throw new ArgumentException(`No task ${taskId} to star.`, 'taskId');
    this.dbConn.getDb().prepare(
      `INSERT INTO task_stars (provider_id, task_key, task_id, starred_at_utc) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_id, task_key) DO UPDATE SET task_id = excluded.task_id`
    ).run(identity.providerId, identity.taskKey, taskId, new Date().toISOString());
  }

  /** Takes a task's star off; nothing to do for a task with no row or no star. */
  public unstar(taskId: string): void {
    if (!taskId) throw new ArgumentException('A task id is required.', 'taskId');
    const identity = this.starIdentityOf(taskId);
    if (!identity) return;
    this.dbConn.getDb()
      .prepare('DELETE FROM task_stars WHERE provider_id = ? AND task_key = ?')
      .run(identity.providerId, identity.taskKey);
  }

  /**
   * The starred tasks the lists hold now, most recently starred first. A
   * star whose task is retired stays, and its task comes back with it when a
   * sync fetches it again -- matched on the key, under any id.
   */
  public getStarred(): TaskDTO[] {
    const db = this.dbConn.getDb();
    const stars = db.prepare<[], { providerId: string; taskKey: string; taskId: string | null }>(
      'SELECT provider_id AS providerId, task_key AS taskKey, task_id AS taskId FROM task_stars ORDER BY starred_at_utc DESC'
    ).all();
    const columns = TASK_COLUMNS.split(', ').map(c => `t.${c}`).join(', ');
    const byId = db.prepare<[string], TaskRow>(
      `SELECT ${columns} FROM tasks t WHERE t.id = ? AND t.archived_at_utc IS NULL`
    );
    const byKey = db.prepare<[string, string, string, string], TaskRow>(
      `SELECT ${columns}
         FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.key = ? AND t.archived_at_utc IS NULL AND t.id NOT LIKE ?
          AND COALESCE(p.provider_id, ?) = ?
        ORDER BY t.created_at_utc DESC
        LIMIT 1`
    );
    const remember = db.prepare('UPDATE task_stars SET task_id = ? WHERE provider_id = ? AND task_key = ?');

    const tasks: TaskDTO[] = [];
    for (const star of stars) {
      // By the key's shape too: a project of the local provider files its
      // tasks under 'adhoc' with keys of their own.
      const row = star.providerId === ProviderId.ADHOC && isAdHocTaskId(star.taskKey)
        ? byId.get(star.taskKey)
        : byKey.get(star.taskKey, `${IdPrefix.ADHOC_TASK}%`, UNKNOWN_PROJECT_PROVIDER_ID, star.providerId);
      if (!row) continue;
      if (row.id !== star.taskId) remember.run(row.id, star.providerId, star.taskKey);
      tasks.push(TaskRepository.toDto(row));
    }
    return tasks;
  }

  /**
   * Removes a task from the lists: deleted if no time was logged against it,
   * archived otherwise. Deleting it from the app does not delete the hours.
   */
  public deleteTask(taskId: string): void {
    if (!taskId) {
      throw new Error('Task ID is required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      retireTasks(db, 'id = ?', [taskId]);
    } catch (err) {
      console.warn('[TaskRepository] Failed to delete task:', err);
    }
  }

  /**
   * Makes sure a worklog for `task` has a row to reference, creating an
   * archived one if there is none.
   *
   * A session outlives its task more easily than it sounds: a sync pass can
   * prune the task while it is being tracked, and a session can be started on
   * an id that was never cached. Before the foreign key that orphaned the
   * worklog; after it, the insert would fail and the tracked time would be
   * lost. The session still knows the key and title it showed, so the row it
   * leaves behind is named properly -- and archived, since no list offered it.
   */
  public ensureTaskExists(task: { id: string; key?: string; title?: string; projectId?: string }): void {
    if (!task.id) throw new Error('Task ID is required');

    const now = new Date().toISOString();
    this.dbConn.getDb().prepare(`
      INSERT INTO tasks (id, project_id, key, title, status, created_at_utc, archived_at_utc)
      VALUES (?, ?, ?, ?, 'done', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(task.id, task.projectId || TOMBSTONE_PROJECT_ID, task.key || task.id, task.title || task.id, now, now);
  }

  /**
   * Updates an existing task's title, key, or status.
   */
  public updateTask(task: TaskDTO): void {
    this.saveTask(task);
  }

  /**
   * Bulk imports tasks into a target project.
   */
  public importTasks(
    projectId: string,
    rawTasks: Array<{ key: string; title: string; status?: 'todo' | 'in_progress' | 'done' }>
  ): TaskDTO[] {
    if (!projectId || !Array.isArray(rawTasks)) return [];

    const imported: TaskDTO[] = [];
    for (const t of rawTasks) {
      if (!t.key || !t.title) continue;
      const taskId = `${projectId}_${t.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const taskObj: TaskDTO = {
        id: taskId,
        projectId,
        key: t.key.toUpperCase(),
        title: t.title.trim(),
        status: t.status || 'todo'
      };
      this.saveTask(taskObj);
      imported.push(taskObj);
    }
    return imported;
  }

  /**
   * Retires every task of a project that is NOT in the provided active list --
   * see `retireTasks` for what retiring means. Excludes tasks starting with
   * 'adhoc_'.
   */
  public deleteTasksNotIn(projectId: string, activeTaskIds: string[]): void {
    if (!projectId || !Array.isArray(activeTaskIds)) return;

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      if (activeTaskIds.length === 0) {
        // No active tasks: retire all of this project's tasks (except adhoc)
        retireTasks(db, 'project_id = ? AND id NOT LIKE ?', [projectId, 'adhoc_%']);
        return;
      }

      const placeholders = activeTaskIds.map(() => '?').join(',');
      retireTasks(db, `project_id = ? AND id NOT IN (${placeholders}) AND id NOT LIKE ?`, [
        projectId,
        ...activeTaskIds,
        'adhoc_%'
      ]);
    } catch (err) {
      console.warn(`[TaskRepository] Failed to delete outdated tasks for project ${projectId}:`, err);
    }
  }
}
