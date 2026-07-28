import { DatabaseConnection } from '../database-connection';
import { ProjectDTO } from '../../../shared/dtos';

/**
 * Repository layer for managing projects in SQLite.
 */
export class ProjectRepository {
  private dbConn: DatabaseConnection;

  constructor(dbConn?: DatabaseConnection) {
    this.dbConn = dbConn || DatabaseConnection.getInstance();
  }

  /**
   * Retrieves all project records from SQLite.
   */
  public getAllProjects(): ProjectDTO[] {
    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return [];

      const stmt = db.prepare<[], {
        id: string;
        key: string;
        name: string;
        provider_id: string;
      }>('SELECT id, key, name, provider_id FROM projects ORDER BY key ASC');

      const rows = stmt.all();
      return rows.map(r => ({
        id: r.id,
        key: r.key,
        name: r.name,
        providerId: r.provider_id
      }));
    } catch (err) {
      console.warn('[ProjectRepository] Failed to fetch projects:', err);
      return [];
    }
  }

  /**
   * Upserts a project record.
   */
  public saveProject(project: ProjectDTO): void {
    if (!project.id || !project.key || !project.name) {
      throw new Error('Project ID, Key, and Name are required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      const stmt = db.prepare(`
        INSERT INTO projects (id, key, name, provider_id, created_at_utc)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          key = excluded.key,
          name = excluded.name,
          provider_id = excluded.provider_id
      `);

      stmt.run(project.id, project.key, project.name, project.providerId || 'local', new Date().toISOString());
    } catch (err) {
      console.warn('[ProjectRepository] Failed to save project:', err);
    }
  }

  /**
   * Renames / edits a project's key and name.
   */
  public renameProject(id: string, name: string, key: string): void {
    if (!id || !name || !key) {
      throw new Error('Project ID, Key, and Name are required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      const stmt = db.prepare(`
        UPDATE projects SET name = ?, key = ? WHERE id = ?
      `);

      stmt.run(name, key, id);
    } catch (err) {
      console.warn('[ProjectRepository] Failed to rename project:', err);
    }
  }

  /**
   * Deletes a project and its associated tasks from SQLite.
   */
  public deleteProject(id: string): void {
    if (!id) {
      throw new Error('Project ID is required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      const deleteTasksStmt = db.prepare('DELETE FROM tasks WHERE project_id = ?');
      deleteTasksStmt.run(id);

      const deleteProjStmt = db.prepare('DELETE FROM projects WHERE id = ?');
      deleteProjStmt.run(id);
    } catch (err) {
      console.warn('[ProjectRepository] Failed to delete project:', err);
    }
  }
}
