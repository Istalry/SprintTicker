import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';

describe('Data Wipe & Task Status Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(process.cwd(), `test_wipe_${Date.now()}.db`);
    dbConn = new DatabaseConnection(testDbPath);
    projectRepo = new ProjectRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
  });

  afterEach(() => {
    dbConn.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    }
  });

  it('DatabaseConnection_WipeAllData_ClearsTablesAndReSeedsDefaultProjects', () => {
    // Add extra data
    projectRepo.saveProject({ id: 'CUSTOM', key: 'CUSTOM', name: 'Custom Project' });
    taskRepo.saveTask({ id: 'CUSTOM_1', projectId: 'CUSTOM', key: 'CUSTOM-1', title: 'Task to Wipe', status: 'todo' });

    const beforeWipe = projectRepo.getAllProjects();
    expect(beforeWipe.length).toBeGreaterThan(3);

    // Wipe everything
    dbConn.wipeAllData();

    const afterWipe = projectRepo.getAllProjects();
    // Only 3 default seeds should remain
    expect(afterWipe.length).toBe(3);
    expect(afterWipe.map(p => p.id)).toContain('PROJ');
    expect(afterWipe.map(p => p.id)).toContain('UNITY');
    expect(afterWipe.map(p => p.id)).toContain('ADMIN');
    // CUSTOM project should be gone
    expect(afterWipe.find(p => p.id === 'CUSTOM')).toBeUndefined();
  });

  it('DatabaseConnection_WipeAllData_ClearsAllTasks', () => {
    taskRepo.saveTask({ id: 'PROJ_ABC', projectId: 'PROJ', key: 'PROJ-ABC', title: 'Wipeable Task', status: 'todo' });

    dbConn.wipeAllData();

    const tasks = taskRepo.getTasksByProjectId('PROJ');
    expect(tasks.length).toBe(0);
  });

  it('TaskRepository_UpdateTask_StatusToDone_PersistsCorrectly', () => {
    taskRepo.saveTask({ id: 'PROJ_STATUS_1', projectId: 'PROJ', key: 'PROJ-S1', title: 'Status Test Task', status: 'todo' });

    taskRepo.updateTask({ id: 'PROJ_STATUS_1', projectId: 'PROJ', key: 'PROJ-S1', title: 'Status Test Task', status: 'done' });

    const tasks = taskRepo.getTasksByProjectId('PROJ');
    const updated = tasks.find(t => t.id === 'PROJ_STATUS_1');
    expect(updated?.status).toBe('done');
  });

  it('TaskRepository_UpdateTask_StatusToInProgress_PersistsCorrectly', () => {
    taskRepo.saveTask({ id: 'PROJ_STATUS_2', projectId: 'PROJ', key: 'PROJ-S2', title: 'In Progress Task', status: 'todo' });

    taskRepo.updateTask({ id: 'PROJ_STATUS_2', projectId: 'PROJ', key: 'PROJ-S2', title: 'In Progress Task', status: 'in_progress' });

    const tasks = taskRepo.getTasksByProjectId('PROJ');
    const updated = tasks.find(t => t.id === 'PROJ_STATUS_2');
    expect(updated?.status).toBe('in_progress');
  });
});
