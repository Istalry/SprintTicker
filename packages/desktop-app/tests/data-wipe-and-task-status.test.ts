import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';

describe('Data Wipe & Task Status Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    // In memory, never a file named by Date.now(): two runs starting in the
    // same millisecond opened the same file, and the second migrated a
    // schema the first had already built ("duplicate column name").
    dbConn = new DatabaseConnection(':memory:');
    projectRepo = new ProjectRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
  });

  afterEach(() => {
    dbConn.close();
  });

  it('DatabaseConnection_WipeAllData_ClearsAllProjectsAndDataCompletely', () => {
    // Add extra data
    projectRepo.saveProject({ id: 'CUSTOM', key: 'CUSTOM', name: 'Custom Project' });
    taskRepo.saveTask({ id: 'CUSTOM_1', projectId: 'CUSTOM', key: 'CUSTOM-1', title: 'Task to Wipe', status: 'todo' });

    const beforeWipe = projectRepo.getAllProjects();
    expect(beforeWipe.length).toBeGreaterThan(0);

    // Wipe everything
    dbConn.wipeAllData();

    const afterWipe = projectRepo.getAllProjects();
    // 0 projects should remain (no re-seeded default projects)
    expect(afterWipe.length).toBe(0);
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
