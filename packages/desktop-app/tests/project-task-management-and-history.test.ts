import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';

describe('Project & Task Management and Worklog History Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let worklogRepo: WorklogRepository;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(process.cwd(), `test_proj_mgmt_${Date.now()}.db`);
    dbConn = new DatabaseConnection(testDbPath);
    projectRepo = new ProjectRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
  });

  afterEach(() => {
    dbConn.close();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        // Ignore file cleanup lock on windows
      }
    }
  });

  it('ProjectRepository_SaveAndGetAllProjects_ReturnsCreatedProjects', () => {
    projectRepo.saveProject({
      id: 'GAME1',
      key: 'GAME1',
      name: 'RPG Sandbox',
      providerId: 'local'
    });

    const projs = projectRepo.getAllProjects();
    expect(projs.length).toBeGreaterThanOrEqual(1); // GAME1 created
    const found = projs.find(p => p.id === 'GAME1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('RPG Sandbox');
  });

  it('ProjectRepository_RenameProject_UpdatesProjectNameAndKey', () => {
    projectRepo.saveProject({ id: 'TESTPROJ', key: 'TESTPROJ', name: 'Original Name' });
    projectRepo.renameProject('TESTPROJ', 'Renamed Project', 'NEWKEY');

    const projs = projectRepo.getAllProjects();
    const updated = projs.find(p => p.id === 'TESTPROJ');
    expect(updated?.name).toBe('Renamed Project');
    expect(updated?.key).toBe('NEWKEY');
  });

  it('ProjectRepository_DeleteProject_DeletesProjectAndAssociatedTasks', () => {
    projectRepo.saveProject({ id: 'DELPROJ', key: 'DELPROJ', name: 'To Delete' });
    taskRepo.saveTask({ id: 'DELPROJ_1', projectId: 'DELPROJ', key: 'DEL-1', title: 'Task 1', status: 'todo' });

    projectRepo.deleteProject('DELPROJ');

    const projs = projectRepo.getAllProjects();
    expect(projs.find(p => p.id === 'DELPROJ')).toBeUndefined();

    const tasks = taskRepo.getTasksByProjectId('DELPROJ');
    expect(tasks.length).toBe(0);
  });

  it('TaskRepository_DeleteTask_DeletesSpecificTask', () => {
    taskRepo.saveTask({ id: 'PROJ_101', projectId: 'PROJ', key: 'PROJ-101', title: 'Task to Delete', status: 'todo' });
    expect(taskRepo.getTasksByProjectId('PROJ').some(t => t.id === 'PROJ_101')).toBe(true);

    taskRepo.deleteTask('PROJ_101');
    expect(taskRepo.getTasksByProjectId('PROJ').some(t => t.id === 'PROJ_101')).toBe(false);
  });

  it('TaskRepository_ImportTasks_BulkCreatesTasks', () => {
    const raw = [
      { key: 'IMP-1', title: 'Imported Task One', status: 'todo' as const },
      { key: 'IMP-2', title: 'Imported Task Two', status: 'in_progress' as const }
    ];

    const imported = taskRepo.importTasks('PROJ', raw);
    expect(imported.length).toBe(2);

    const projTasks = taskRepo.getTasksByProjectId('PROJ');
    expect(projTasks.some(t => t.key === 'IMP-1')).toBe(true);
    expect(projTasks.some(t => t.key === 'IMP-2')).toBe(true);
  });

  it('WorklogRepository_GetWorklogsByDateAndDailySummary_ReturnsAggregatedMetrics', () => {
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split('T')[0];

    worklogRepo.saveWorklog({
      id: 'wl_hist_1',
      sessionId: 'sess_1',
      taskId: 'PROJ-101',
      durationSeconds: 1800,
      startedAtUtc: nowIso,
      comment: 'Historical session 1',
      createdAtUtc: nowIso
    });

    worklogRepo.saveWorklog({
      id: 'wl_hist_2',
      sessionId: 'sess_2',
      taskId: 'PROJ-101',
      durationSeconds: 1200,
      startedAtUtc: nowIso,
      comment: 'Historical session 2',
      createdAtUtc: nowIso
    });

    const logs = worklogRepo.getWorklogsByDate(todayStr);
    expect(logs.length).toBe(2);

    const summary = worklogRepo.getDailySummary(todayStr);
    expect(summary.totalSeconds).toBe(3000);
    expect(summary.tasksCount).toBe(1);
    expect(summary.items[0].durationSeconds).toBe(3000);
  });
});
