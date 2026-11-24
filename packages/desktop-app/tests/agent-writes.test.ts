import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { UndoService } from '../src/main/services/undo-service';
import { undoableSessionEnding } from '../src/main/services/undoable-commands';
import { AgentService } from '../src/main/services/agent-service';
import { UNDO_WINDOW_MS } from '../src/main/sync/sync-constants';
import { END_THE_INTERRUPTION_FIRST } from '../src/shared/interruption';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * The agent's writes (AGENT-INTERFACE.md §6) on the real engine, through the
 * window's own Stop and Done with their Undo: an agent's call does what a
 * click does, and the user can take it back for ten seconds.
 */
describe('AgentService, the writes', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;
  let tasks: TaskRepository;
  let sessions: SessionRepository;
  let engine: TimeTrackingEngine;
  let undo: UndoService;
  let agent: AgentService;
  let sent: Array<{ taskId: string; durationSeconds: number }>;
  let moved: string[];
  const renderer = { renderTaskCompletionConfetti: vi.fn(), renderTaskLogged: vi.fn() };

  const PROJECT: ProjectDTO = { id: 'P', key: 'MG', name: 'Mango', providerId: 'jira' } as ProjectDTO;
  const A: TaskDTO = { id: 'A', projectId: 'P', key: 'MG-12', title: 'Export the week', status: 'todo' };
  const B: TaskDTO = { id: 'B', projectId: 'P', key: 'MG-13', title: 'Fix the glow', status: 'todo' };

  /** A on the clock for 30 minutes. */
  const runA = () => {
    engine.startTask(A.id);
    const open = sessions.getActiveSession()!;
    sessions.saveSession({ ...open, startTimeUtc: new Date(Date.now() - 30 * 60_000).toISOString() });
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 10, 24, 10, 0, 0));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    worklogs = new WorklogRepository(dbConn);
    tasks = new TaskRepository(dbConn);
    sessions = new SessionRepository(dbConn);
    const projects = new ProjectRepository(dbConn);
    projects.saveProject(PROJECT);
    tasks.saveTask(A);
    tasks.saveTask(B);
    sent = [];
    moved = [];
    const remote = { providerId: 'jira', providerName: 'Jira', minimumLoggableSeconds: 60, findWorklog: async () => null };
    const manager = {
      getActiveProvider: () => remote,
      getProvider: () => remote,
      getProjects: async () => [PROJECT],
      getTasks: async () => [A, B],
      updateTaskStatus: async (taskId: string, status: string) => { moved.push(`${taskId}:${status}`); return true; },
      updateTaskStatusFor: async (_p: string, taskId: string, status: string) => { moved.push(`${taskId}:${status}`); return true; },
      logTimeForProvider: async (_p: string, payload: { taskId: string; durationSeconds: number }) => {
        sent.push({ taskId: payload.taskId, durationSeconds: payload.durationSeconds });
        return { success: true, remoteWorklogId: `r${sent.length}` };
      }
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(sessions, worklogs, tasks, manager, projects);
    undo = new UndoService();
    agent = new AgentService({
      session: () => engine.getCurrentSession(),
      worklogsOn: day => worklogs.getWorklogsByDate(day),
      worklogsBetween: (from, to) => worklogs.getWorklogsBetween(from, to),
      toPlace: () => [],
      schedule: () => null,
      weekChanges: () => null,
      providerName: () => 'Jira',
      isWorkingDay: () => true,
      listedTasks: () => tasks.getAllListed(),
      ownTasks: () => tasks.getOwnListed(),
      projects: () => projects.getAllProjects()
    }, {
      startTask: (taskId, title) => { engine.startTask(taskId, false, title); },
      isInterrupted: () => engine.isInterrupted(),
      ending: undoableSessionEnding({ db: dbConn.getDb(), undo, engine }, renderer),
      pause: () => { engine.pauseSession(); },
      resume: () => { engine.resumeSession(); }
    });
  });

  afterEach(() => {
    undo.dispose();
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Start_ByKey_TimesIt', () => {
    const answer = agent.run('start', { task: 'mg-12' });

    expect(engine.getCurrentSession()?.taskId).toBe(A.id);
    expect(answer.text).toMatch(/^MG-12 Export the week is running/);
  });

  it('Start_WithOneRunning_SwitchesAndSaysWhatWasLogged', () => {
    runA();

    const answer = agent.run('start_task', { task: 'MG-13' });

    expect(engine.getCurrentSession()?.taskId).toBe(B.id);
    expect(answer.text).toMatch(/^Stopped MG-12 Export the week after 30m, logged\. MG-13 Fix the glow is running/);
    expect(worklogs.getTodaysWorklogs().map(w => [w.taskId, w.durationSeconds])).toEqual([[A.id, 1800]]);
  });

  it('Start_TheTaskRunning_SaysSo_ChangesNothing', () => {
    runA();
    const before = engine.getCurrentSession()!.sessionId;

    expect(agent.run('start', { task: 'MG-12' }).text).toMatch(/is already being timed/);
    expect(engine.getCurrentSession()?.sessionId).toBe(before);
  });

  it('Start_OwnWorkSharingAKey_RefusedWithTheCandidates_ThenByIdWorks', () => {
    const first = engine.createOwnTask('Code review');
    engine.createOwnTask('Team sync');

    expect(() => agent.run('start', { task: first.key })).toThrow(expect.objectContaining({ code: 'invalid-request', message: expect.stringContaining('Code review') }));
    agent.run('start', { task: first.id });
    expect(engine.getCurrentSession()?.taskTitle).toBe('Code review');
  });

  it('Start_DuringAnInterruption_RefusedAsTheWindowRefuses', () => {
    runA();
    engine.startInterruption();

    expect(() => agent.run('start', { task: 'MG-13' })).toThrow(END_THE_INTERRUPTION_FIRST);
  });

  it('Start_AnUnknownKey_NotFound', () => {
    expect(() => agent.run('start', { task: 'MG-99' })).toThrow(expect.objectContaining({ code: 'not-found' }));
  });

  it('Stop_LogsIt_UndoableForTenSeconds_ThenSent', async () => {
    runA();

    const answer = agent.run('stop', { note: 'Pairing with Rin' });

    expect(answer.text).toBe('Stopped MG-12 Export the week: 30m logged. The user can undo it in SprintTicker for ten seconds; after that it is sent.');
    expect(worklogs.getTodaysWorklogs()[0].comment).toBe('Pairing with Rin');
    expect(undo.current()).not.toBeNull();
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    await vi.waitFor(() => expect(sent).toEqual([{ taskId: A.id, durationSeconds: 1800 }]));
  });

  it('Stop_ThenTheUsersUndo_TheTaskRunsAgain', () => {
    runA();
    agent.run('stop');

    expect(undo.run()).toBe(true);

    expect(engine.getCurrentSession()?.taskId).toBe(A.id);
    expect(worklogs.getTodaysWorklogs()).toEqual([]);
  });

  it('Stop_DuringAnInterruption_EndsIt_TheHeldTaskRunsAgain', () => {
    runA();
    engine.startInterruption();

    expect(agent.run('stop').text).toMatch(/^Ended the interruption .* it waits to be placed\. MG-12 Export the week is running/);
    expect(engine.getCurrentSession()?.taskId).toBe(A.id);
  });

  it('Done_DuringAnInterruption_Refused', () => {
    runA();
    engine.startInterruption();

    expect(() => agent.run('done', { confirmed: true })).toThrow(/no task to mark done/);
  });

  it('Done_WithoutConfirmed_AsksFirst_NothingChanges', () => {
    runA();

    expect(() => agent.run('mark_done', {})).toThrow(expect.objectContaining({
      code: 'needs-confirmation', message: 'Marking MG-12 done changes it at Jira. Ask the user, then call again with confirmed.'
    }));
    expect(engine.getCurrentSession()?.taskId).toBe(A.id);
  });

  it('Done_Confirmed_LogsAndMarksDone_AfterTheUndo', async () => {
    runA();

    expect(agent.run('done', { confirmed: true }).text).toMatch(/^Done: MG-12 Export the week, 30m logged\./);
    expect(engine.getCurrentSession()).toBeNull();
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    await vi.waitFor(() => expect(moved).toContain('A:done'));
  });

  it('PauseResume_AsTheButton_RefusedWhenThereIsNothingTo', () => {
    expect(() => agent.run('pause')).toThrow(expect.objectContaining({ code: 'refused' }));
    runA();

    expect(agent.run('pause').text).toMatch(/is paused/);
    expect(() => agent.run('pause')).toThrow(/paused already/);
    expect(agent.run('resume').text).toMatch(/is running/);
    expect(() => agent.run('resume')).toThrow(/not paused/);
  });

  it('Writes_WithoutActions_Refused_ReadsStillAnswer', () => {
    const readsOnly = new AgentService({
      session: () => null, worklogsOn: () => [], worklogsBetween: () => [], toPlace: () => [], schedule: () => null,
      weekChanges: () => null, providerName: () => 'Jira', isWorkingDay: () => true, listedTasks: () => [A], ownTasks: () => [], projects: () => []
    });

    expect(() => readsOnly.run('start', { task: 'MG-12' })).toThrow(expect.objectContaining({ code: 'refused' }));
    expect(readsOnly.run('now').text).toBe('Nothing is being timed.');
  });
});
