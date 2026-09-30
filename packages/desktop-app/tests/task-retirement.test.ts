import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';

/**
 * Tasks leave the lists; their hours stay. A worklog is billable time, and the
 * sync prune, project deletion and the app's own delete button used to delete
 * the task under it, leaving history with an id nothing could name.
 */
describe('Retiring tasks keeps their history', () => {
  let db: DatabaseConnection;
  let tasks: TaskRepository;
  let projects: ProjectRepository;
  let worklogs: WorklogRepository;
  let engine: TimeTrackingEngine;

  const listed = (projectId = 'P1') => tasks.getTasksByProjectId(projectId).map(t => t.id);
  const saveTask = (id: string, projectId = 'P1') =>
    tasks.saveTask({ id, projectId, key: `KEY-${id}`, title: `Title ${id}`, status: 'todo' });
  const logTime = (taskId: string) =>
    worklogs.saveWorklog({
      id: `wl-${taskId}`,
      sessionId: 's',
      taskId,
      durationSeconds: 900,
      startedAtUtc: new Date().toISOString(),
      comment: 'work',
      createdAtUtc: new Date().toISOString()
    });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    db = new DatabaseConnection(':memory:');
    tasks = new TaskRepository(db);
    projects = new ProjectRepository(db);
    worklogs = new WorklogRepository(db);
    engine = new TimeTrackingEngine(new SessionRepository(db), worklogs, tasks, undefined, projects);
    projects.saveProject({ id: 'P1', key: 'P1', name: 'Alpha' });
  });

  afterEach(() => {
    engine.dispose();
    db.close();
    vi.restoreAllMocks();
  });

  describe('the sync prune', () => {
    it('DeleteTasksNotIn_TaskWithLoggedTime_IsArchivedAndStillNamed', () => {
      saveTask('worked');
      logTime('worked');

      tasks.deleteTasksNotIn('P1', []);

      expect(listed()).toEqual([]);
      expect(tasks.getTaskById('worked')?.key).toBe('KEY-worked');
      expect(worklogs.getTodaysWorklogs()[0]).toMatchObject({ taskKey: 'KEY-worked', taskTitle: 'Title worked' });
    });

    it('DeleteTasksNotIn_TaskNeverWorkedOn_IsDeleted', () => {
      // Archiving everything would grow the table with every pass for no one's benefit.
      saveTask('untouched');

      tasks.deleteTasksNotIn('P1', []);

      expect(tasks.getTaskById('untouched')).toBeNull();
    });

    it('DeleteTasksNotIn_TaskStillListed_IsLeftAlone', () => {
      saveTask('kept');
      saveTask('dropped');

      tasks.deleteTasksNotIn('P1', ['kept']);

      expect(listed()).toEqual(['kept']);
    });

    it('SaveTask_ArchivedTaskListedAgain_ComesBackWithItsHistory', () => {
      // Reassigned back, or reopened: the provider lists it again.
      saveTask('worked');
      logTime('worked');
      tasks.deleteTasksNotIn('P1', []);

      saveTask('worked');

      expect(listed()).toEqual(['worked']);
      expect(worklogs.getTodaysWorklogs()).toHaveLength(1);
    });

    it('DeleteProjectsNotIn_ProjectGone_ArchivesItsWorkedTasks', () => {
      saveTask('worked');
      saveTask('untouched');
      logTime('worked');

      projects.deleteProjectsNotIn([]);

      expect(projects.getAllProjects().map(p => p.id)).not.toContain('P1');
      expect(tasks.getTaskById('worked')).not.toBeNull();
      expect(tasks.getTaskById('untouched')).toBeNull();
    });
  });

  describe('deleting from the app', () => {
    it('DeleteTask_WithLoggedTime_HidesItButKeepsTheHours', () => {
      saveTask('worked');
      logTime('worked');

      tasks.deleteTask('worked');

      expect(listed()).toEqual([]);
      expect(worklogs.getTodaysWorklogs()[0].taskKey).toBe('KEY-worked');
    });

    it('DeleteProject_WithLoggedTime_KeepsTheHours', () => {
      saveTask('worked');
      logTime('worked');

      projects.deleteProject('P1');

      expect(worklogs.getTodaysWorklogs()[0].taskTitle).toBe('Title worked');
    });
  });

  describe('a session whose task is gone', () => {
    it('StopSession_TaskPrunedWhileTracking_LogsTheTimeUnderItsName', () => {
      // No worklog yet while it runs, so the prune deletes it outright. The
      // foreign key would then refuse the worklog, and the tracked time with it.
      saveTask('running');
      engine.startTask('running');
      tasks.deleteTasksNotIn('P1', []);
      expect(tasks.getTaskById('running')).toBeNull();

      const stopped = engine.stopSession();

      expect(stopped.success).toBe(true);
      expect(worklogs.getTodaysWorklogs()[0]).toMatchObject({ taskId: 'running', taskKey: 'KEY-running', taskTitle: 'Title running' });
      // Named, but not offered in any list: nothing listed it.
      expect(listed()).toEqual([]);
    });

    it('StopSession_TaskNeverCached_StillLogsTheTime', () => {
      engine.startTask('PROJ-142', false, 'Implement dash');

      engine.stopSession();

      expect(worklogs.getTodaysWorklogs()[0]).toMatchObject({ taskId: 'PROJ-142', taskTitle: 'Implement dash' });
    });
  });

  describe('history', () => {
    it('GetDailySummary_NamesTasksByTheirKeyAndTitle', () => {
      // It used to guess the key from the id and use the worklog's comment as
      // the title -- "Completed session via SprintTicker" for most sessions.
      tasks.saveTask({ id: '10001', projectId: 'P1', key: 'SCRUM-2', title: 'Fix the login', status: 'todo' });
      logTime('10001');
      const today = new Date();
      const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      expect(worklogs.getDailySummary(day).items[0]).toMatchObject({ key: 'SCRUM-2', title: 'Fix the login' });
    });
  });
});
