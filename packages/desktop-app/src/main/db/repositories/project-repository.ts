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

  /**
   * Deletes all projects (and their tasks) that are NOT in the provided active list.
   * Excludes the 'ADHOC' built-in project.
   */
  public deleteProjectsNotIn(activeProjectIds: string[]): void {
    if (!Array.isArray(activeProjectIds)) return;

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      // Ensure ADHOC is never deleted
      const safeProjectIds = [...activeProjectIds, 'ADHOC'];

      // We need to dynamically build the query parameters
      const placeholders = safeProjectIds.map(() => '?').join(',');
      
      // First find which projects we are going to delete, so we can delete their tasks too
      const findStmt = db.prepare(`SELECT id FROM projects WHERE id NOT IN (${placeholders})`);
      const projectsToDelete = findStmt.all(...safeProjectIds) as { id: string }[];

      if (projectsToDelete.length === 0) return;

      console.log(`[ProjectRepository] Deleting ${projectsToDelete.length} outdated projects...`);

      // Delete tasks for those projects
      const deleteTasksStmt = db.prepare('DELETE FROM tasks WHERE project_id = ?');
      // Delete the projects themselves
      const deleteProjStmt = db.prepare('DELETE FROM projects WHERE id = ?');

      const transaction = db.transaction((projects: { id: string }[]) => {
        for (const p of projects) {
          deleteTasksStmt.run(p.id);
          deleteProjStmt.run(p.id);
        }
      });

      transaction(projectsToDelete);
      
    } catch (err) {
      console.warn('[ProjectRepository] Failed to delete outdated projects:', err);
    }
  }
}
