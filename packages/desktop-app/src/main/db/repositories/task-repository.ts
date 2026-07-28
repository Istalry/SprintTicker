import { DatabaseConnection } from '../database-connection';
import { TaskDTO } from '../../../shared/dtos';

/**
 * Repository layer for managing tasks and ad-hoc task creation in SQLite.
 */
export class TaskRepository {
  private dbConn: DatabaseConnection;

  constructor(dbConn?: DatabaseConnection) {
    this.dbConn = dbConn || DatabaseConnection.getInstance();
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
      }>('SELECT id, project_id as projectId, key, title, status FROM tasks WHERE project_id = ?');

      const rows = stmt.all(projectId);
      return rows.map(r => ({
        id: r.id,
        projectId: r.projectId,
        key: r.key,
        title: r.title,
        status: r.status
      }));
    } catch (err) {
      console.warn('[TaskRepository] Failed to fetch tasks:', err);
      return [];
    }
  }

  /**
   * Upserts a task record into SQLite.
   */
  public saveTask(task: TaskDTO): void {
    if (!task.id || !task.projectId || !task.key || !task.title) {
      throw new Error('Task ID, Project ID, Key, and Title are required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      const stmt = db.prepare(`
        INSERT INTO tasks (id, project_id, key, title, status, created_at_utc)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          key = excluded.key,
          title = excluded.title,
          status = excluded.status
      `);

      stmt.run(task.id, task.projectId, task.key, task.title, task.status, new Date().toISOString());
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

    const taskId = `adhoc_${Date.now()}`;
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
   * Deletes a task record from SQLite.
   */
  public deleteTask(taskId: string): void {
    if (!taskId) {
      throw new Error('Task ID is required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      const stmt = db.prepare('DELETE FROM tasks WHERE id = ?');
      stmt.run(taskId);
    } catch (err) {
      console.warn('[TaskRepository] Failed to delete task:', err);
    }
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
}
