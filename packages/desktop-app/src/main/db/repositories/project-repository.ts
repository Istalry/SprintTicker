import { DatabaseConnection } from '../database-connection';
import { retireTasks } from './task-repository';
import { ProjectDTO } from '../../../shared/dtos';
import { ADHOC_PROJECT_ID } from '../../../shared/adhoc-project';
import { OWN_PROJECT_PROVIDER_ID, UNKNOWN_PROJECT_PROVIDER_ID } from '../../../shared/local-provider';

/**
 * Repository layer for managing projects in SQLite.
 */
export class ProjectRepository {
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
   * Retrieves all project records from SQLite.
   */
  public getAllProjects(): ProjectDTO[] {
    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return [];

      // The open-task counts, one per owner, ride along so every list can
      // apply "only my projects" under the user's task visibility without a
      // query per project. Archived tasks are history, not work (CLAUDE.md
      // section 7).
      const stmt = db.prepare<[], {
        id: string;
        key: string;
        name: string;
        provider_id: string;
        open_task_count: number;
        open_unassigned_count: number;
        open_others_count: number;
      }>(`
        SELECT p.id, p.key, p.name, p.provider_id,
               COUNT(t.id) FILTER (WHERE t.ownership = 'mine') AS open_task_count,
               COUNT(t.id) FILTER (WHERE t.ownership = 'unassigned') AS open_unassigned_count,
               COUNT(t.id) FILTER (WHERE t.ownership = 'other') AS open_others_count
        FROM projects p
        LEFT JOIN tasks t
          ON t.project_id = p.id
         AND t.archived_at_utc IS NULL
         AND t.status != 'done'
        GROUP BY p.id
        ORDER BY p.key ASC`);

      const rows = stmt.all();
      return rows.map(r => ({
        id: r.id,
        key: r.key,
        name: r.name,
        providerId: r.provider_id,
        openTaskCount: r.open_task_count,
        openUnassignedCount: r.open_unassigned_count,
        openOthersCount: r.open_others_count
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

      stmt.run(project.id, project.key, project.name, project.providerId || UNKNOWN_PROJECT_PROVIDER_ID, new Date().toISOString());
    } catch (err) {
      console.warn('[ProjectRepository] Failed to save project:', err);
    }
  }

  /**
   * The provider a project came from, or null when there is no such project.
   * A session reads it when it starts, so that its time goes back to where
   * its task came from (migration 9).
   */
  public getProviderIdOf(projectId: string): string | null {
    const row = this.dbConn.getDb()
      .prepare<[string], { provider_id: string }>('SELECT provider_id FROM projects WHERE id = ?')
      .get(projectId);
    return row?.provider_id ?? null;
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
   * Deletes a project and retires its tasks: a task with logged time is
   * archived rather than deleted, so the project's history survives it.
   */
  public deleteProject(id: string): void {
    if (!id) {
      throw new Error('Project ID is required');
    }

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      retireTasks(db, 'project_id = ?', [id]);

      const deleteProjStmt = db.prepare('DELETE FROM projects WHERE id = ?');
      deleteProjStmt.run(id);
    } catch (err) {
      console.warn('[ProjectRepository] Failed to delete project:', err);
    }
  }

  /**
   * Deletes all projects that are NOT in the provided active list, and retires
   * their tasks as `deleteProject` does. Excludes the 'ADHOC' built-in project.
   */
  public deleteProjectsNotIn(activeProjectIds: string[]): void {
    if (!Array.isArray(activeProjectIds)) return;

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      // Ensure ADHOC is never deleted
      const safeProjectIds = [...activeProjectIds, ADHOC_PROJECT_ID];

      // We need to dynamically build the query parameters
      const placeholders = safeProjectIds.map(() => '?').join(',');
      
      // First find which projects we are going to delete, so we can delete their tasks too.
      // A project made here is never the provider's to list: it was deleted
      // at every sync, with its tasks, minutes after the user created it.
      const findStmt = db.prepare(`SELECT id FROM projects WHERE id NOT IN (${placeholders}) AND provider_id <> ?`);
      const projectsToDelete = findStmt.all(...safeProjectIds, OWN_PROJECT_PROVIDER_ID) as { id: string }[];

      if (projectsToDelete.length === 0) return;

      console.log(`[ProjectRepository] Deleting ${projectsToDelete.length} outdated projects...`);

      const deleteProjStmt = db.prepare('DELETE FROM projects WHERE id = ?');

      const transaction = db.transaction((projects: { id: string }[]) => {
        for (const p of projects) {
          retireTasks(db, 'project_id = ?', [p.id]);
          deleteProjStmt.run(p.id);
        }
      });

      transaction(projectsToDelete);
      
    } catch (err) {
      console.warn('[ProjectRepository] Failed to delete outdated projects:', err);
    }
  }
}
