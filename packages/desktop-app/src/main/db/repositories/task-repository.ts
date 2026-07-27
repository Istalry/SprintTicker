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

    const stmt = this.dbConn.getDb().prepare<[string], {
      id: string;
      project_id: string;
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
  }

  /**
   * Upserts a task record into SQLite.
   */
  public saveTask(task: TaskDTO): void {
    if (!task.id || !task.projectId || !task.key || !task.title) {
      throw new Error('Task ID, Project ID, Key, and Title are required');
    }

    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO tasks (id, project_id, key, title, status, created_at_utc)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        key = excluded.key,
        title = excluded.title,
        status = excluded.status
    `);

    stmt.run(task.id, task.projectId, task.key, task.title, task.status, new Date().toISOString());
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
}
