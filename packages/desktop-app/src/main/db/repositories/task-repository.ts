import type Database from 'better-sqlite3';
import { DatabaseConnection } from '../database-connection';
import { createId, IdPrefix } from '../id-generator';
import { TOMBSTONE_PROJECT_ID } from '../migrations';
import { TaskDTO } from '../../../shared/dtos';

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

      const stmt = db.prepare<[string], {
        id: string;
        projectId: string;
        key: string;
        title: string;
        status: 'todo' | 'in_progress' | 'done';
        priorityRank: number | null;
        description: string | null;
      }>('SELECT id, project_id as projectId, key, title, status, priority_rank as priorityRank, description FROM tasks WHERE project_id = ? AND archived_at_utc IS NULL');

      const rows = stmt.all(projectId);
      return rows.map(r => TaskRepository.toDto(r));
    } catch (err) {
      console.warn('[TaskRepository] Failed to fetch tasks:', err);
      return [];
    }
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

      const stmt = db.prepare<[string], {
        id: string;
        projectId: string;
        key: string;
        title: string;
        status: 'todo' | 'in_progress' | 'done';
        priorityRank: number | null;
        description: string | null;
      }>('SELECT id, project_id as projectId, key, title, status, priority_rank as priorityRank, description FROM tasks WHERE id = ?');

      const row = stmt.get(taskId);
      if (!row) return null;

      return TaskRepository.toDto(row);
    } catch (err) {
      console.warn('[TaskRepository] Failed to fetch task by id:', err);
      return null;
    }
  }

  /** A row as a DTO; a NULL priority or description is left off rather than carried as null. */
  private static toDto(
    row: Omit<TaskDTO, 'priorityRank' | 'description'> & { priorityRank: number | null; description: string | null }
  ): TaskDTO {
    const task: TaskDTO = {
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      title: row.title,
      status: row.status
    };
    if (row.priorityRank !== null && row.priorityRank !== undefined) task.priorityRank = row.priorityRank;
    if (row.description) task.description = row.description;
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
        INSERT INTO tasks (id, project_id, key, title, status, priority_rank, description, created_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          key = excluded.key,
          title = excluded.title,
          status = excluded.status,
          priority_rank = excluded.priority_rank,
          description = excluded.description,
          archived_at_utc = NULL
      `);

      stmt.run(
        task.id, task.projectId, task.key, task.title, task.status,
        task.priorityRank ?? null, task.description ?? null, new Date().toISOString()
      );
    } catch (err) {
      console.warn('[TaskRepository] Failed to save task:', err);
    }
  }

  /**
   * Creates a custom Ad-Hoc task mapped to a fallback ticket key.
   */
  public createAdHocTask(customTitle: string, fallbackKey: string = 'MISC-1'): TaskDTO {
    if (!customTitle) {
      throw new Error('Custom title is required for ad-hoc task creation');
    }

    const taskId = createId(IdPrefix.ADHOC_TASK);
    const adHocTask: TaskDTO = {
      id: taskId,
      projectId: 'ADHOC',
      key: fallbackKey,
      title: customTitle,
      status: 'in_progress'
    };

    this.saveTask(adHocTask);
    return adHocTask;
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
