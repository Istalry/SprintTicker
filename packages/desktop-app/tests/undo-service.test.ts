import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { UndoService } from '../src/main/services/undo-service';
import { WorklogCorrectionService } from '../src/main/services/worklog-correction-service';
import {
  addUndoably,
  correctUndoably,
  deleteUndoably,
  discardUndoably,
  endDayUndoably,
  moveUndoably,
  splitUndoably,
  stopUndoably,
  UndoableDeps,
  WorklogEditDeps
} from '../src/main/services/undoable-commands';
import { UNDO_WINDOW_MS } from '../src/main/sync/sync-constants';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';

describe('UndoService', () => {
  let now: number;
  let service: UndoService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    now = Date.now();
    service = new UndoService();
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  const action = (undo = vi.fn(() => true), commit = vi.fn()) => ({ kind: 'stop' as const, label: 'Stopped A-1', undo, commit });

  it('Run_At9900ms_Undoes', () => {
    const a = action();
    service.offer(a);

    vi.advanceTimersByTime(9_900);

    expect(service.run()).toBe(true);
    expect(a.undo).toHaveBeenCalledTimes(1);
    expect(a.commit).not.toHaveBeenCalled();
  });

  it('Run_At10100ms_IsRefusedAndTheActionCommitted', () => {
    const a = action();
    service.offer(a);

    vi.advanceTimersByTime(10_100);

    expect(service.run()).toBe(false);
    expect(a.undo).not.toHaveBeenCalled();
    expect(a.commit).toHaveBeenCalledTimes(1);
  });

  it('Run_ExactlyAtTheEnd_IsRefused', () => {
    // The worker may claim a row at that very millisecond.
    const a = action();
    service.offer(a);
    vi.setSystemTime(now + UNDO_WINDOW_MS);

    expect(service.run()).toBe(false);
  });

  it('Offer_ASecond_CommitsTheFirstAtOnce', () => {
    const first = action();
    const second = action();
    service.offer(first);
    service.offer(second);

    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(service.run()).toBe(true);
    expect(second.undo).toHaveBeenCalled();
    expect(first.undo).not.toHaveBeenCalled();
  });

  it('Run_Twice_OnlyTheFirstUndoes', () => {
    service.offer(action());
    expect(service.run()).toBe(true);
    expect(service.run()).toBe(false);
  });

  it('Run_UndoCannot_CommitsAndSaysSo', () => {
    const a = action(vi.fn(() => false));
    service.offer(a);

    expect(service.run()).toBe(false);
    expect(a.commit).toHaveBeenCalledTimes(1);
    expect(service.current()).toBeNull();
  });

  it('Current_SaysWhatAndUntilWhen_ThenNothing', () => {
    const changes: unknown[] = [];
    service.onChanged(state => changes.push(state));
    service.offer(action());

    expect(service.current()).toEqual({
      kind: 'stop',
      label: 'Stopped A-1',
      expiresAtUtc: new Date(now + UNDO_WINDOW_MS).toISOString(),
      outcome: 'sent'
    });
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(service.current()).toBeNull();
    expect(changes).toHaveLength(2);
    expect(changes[1]).toBeNull();
  });
});

describe('undoable commands', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;
  let tasks: TaskRepository;
  let sessions: SessionRepository;
  let engine: TimeTrackingEngine;
  let undo: UndoService;
  let deps: UndoableDeps;
  let edits: WorklogEditDeps;
  let sent: Array<{ taskId: string; durationSeconds: number }>;
  let moved: string[];
  const renderer = { renderTaskCompletionConfetti: vi.fn(), renderTaskLogged: vi.fn() };

  const PROJECT: ProjectDTO = { id: 'P', key: 'P', name: 'Project', providerId: 'jira' } as ProjectDTO;
  const A: TaskDTO = { id: 'A', projectId: 'P', key: 'A-1', title: 'One', status: 'todo' };
  const B: TaskDTO = { id: 'B', projectId: 'P', key: 'B-1', title: 'Two', status: 'todo' };

  const queueRows = () => dbConn.getDb().prepare('SELECT operation, status FROM worklog_sync_queue ORDER BY rowid').all();
  /** A session on A that has run for 30 minutes. */
  const runA = () => {
    engine.startTask(A.id);
    const open = sessions.getActiveSession()!;
    sessions.saveSession({ ...open, startTimeUtc: new Date(Date.now() - 30 * 60_000).toISOString() });
    return open.sessionId;
  };
  const drain = () => engine.getSyncWorker().processPendingQueue();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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
    const remote = {
      providerId: 'jira',
      providerName: 'Jira',
      minimumLoggableSeconds: 60,
      findWorklog: async () => null,
      updateWorklog: async () => undefined,
      deleteWorklog: async () => undefined
    };
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
    deps = { db: dbConn.getDb(), undo, engine };
    const corrections = new WorklogCorrectionService(worklogs, manager, () => engine.getSyncWorker().dispatchAfterHold(), Date.now, {
      getTask: id => tasks.getTaskById(id),
      destinationOf: id => engine.sendDestinationOfTask(id),
      retireAdHocIfUnused: id => engine.retireAdHocTaskIfUnused(id),
      createOwnTask: (title, id, project) => engine.createOwnTask(title, id, project),
      findOwnTask: (title, project) => engine.findOwnTask(title, project)
    });
    edits = { db: dbConn.getDb(), undo, worklogs, corrections, ownProjectIdFor: name => engine.ownProjectFor(name).project.id, onRestored: vi.fn() };
  });

  afterEach(() => {
    undo.dispose();
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('StopThenUndo_ReopensTheSameSession_NothingSentOrMoved', async () => {
    const sessionId = runA();
    const statusBefore = tasks.getTaskById(A.id)?.status;
    stopUndoably(deps, renderer, 'Over', true);
    expect(engine.getCurrentSession()).toBeNull();
    expect(tasks.getTaskById(A.id)?.status).toBe('done');

    vi.advanceTimersByTime(9_900);
    expect(undo.run()).toBe(true);

    expect(engine.getCurrentSession()?.sessionId).toBe(sessionId);
    expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    expect(worklogs.getTodaysWorklogs()).toEqual([]);
    expect(queueRows()).toEqual([]);
    expect(tasks.getTaskById(A.id)?.status).toBe(statusBefore);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(sent).toEqual([]);
    expect(moved).not.toContain('A:done');
  });

  it('Stop_LeftAlone_IsSentAndMovedWhenTheHoldEnds', async () => {
    runA();
    stopUndoably(deps, renderer, 'Over', true);
    expect(moved).not.toContain('A:done');

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(moved).toContain('A:done');
    expect(undo.run()).toBe(false);
  });

  it('Stop_UndoAfterARowWasClaimed_IsRefusedAndTheTimeKept', async () => {
    runA();
    stopUndoably(deps, renderer, 'Over');
    // Some other path claimed the row early: what was sent cannot be taken back.
    const row = worklogs.getSyncQueueSnapshot().items[0];
    worklogs.claimSyncItem(row.id);

    expect(undo.run()).toBe(false);
    expect(engine.getCurrentSession()).toBeNull();
    expect(worklogs.getTodaysWorklogs()).toHaveLength(1);
  });

  it('Stop_ThenANewTaskStarted_UndoIsRefused', () => {
    runA();
    stopUndoably(deps, renderer, 'Over');
    engine.startTask(B.id);

    expect(undo.run()).toBe(false);
    expect(engine.getCurrentSession()?.taskId).toBe(B.id);
  });

  // What the Undo bar says beside its button (P15a3, REVIEW-2026-11 C3):
  // "Sent in 7 s" only when something will be.
  it('Stop_SaysItWillBeSent', () => {
    runA();
    stopUndoably(deps, renderer, 'Over');

    expect(undo.current()?.outcome).toBe('sent');
  });

  it('StopAnInterruption_SaysItWaitsToPlace', () => {
    runA();
    engine.startInterruption();
    stopUndoably(deps, renderer);

    expect(undo.current()?.outcome).toBe('to-place');
  });

  it.each([
    ['Stop', () => stopUndoably(deps, renderer)],
    ['Discard', () => discardUndoably(deps)]
  ])('%sAnInterruptionThenUndo_ItRunsAgain_TheTaskWaitsPausedAgain', (_name, end) => {
    // Its end resumes the held task now (2026-11-16): Undo puts both back.
    const sessionId = runA();
    const fragment = engine.startInterruption();
    end();
    expect(engine.getCurrentSession()).toMatchObject({ sessionId, status: 'TRACKING' });

    // The held task running again is not "another session started".
    expect(undo.currentResumes()).toBe(sessionId);

    expect(undo.run()).toBe(true);

    expect(engine.getCurrentSession()).toMatchObject({ sessionId: fragment.sessionId, status: 'TRACKING' });
    expect(engine.isInterrupted()).toBe(true);
    engine.stopSession();
    expect(engine.getCurrentSession()).toMatchObject({ sessionId, status: 'TRACKING' });
  });

  it('Discard_SaysNothingIsKept', () => {
    runA();
    discardUndoably(deps);

    expect(undo.current()?.outcome).toBe('nothing');
  });

  it('DiscardThenUndo_BringsTheSessionBack', () => {
    const sessionId = runA();
    discardUndoably(deps);
    expect(engine.getCurrentSession()).toBeNull();

    expect(undo.run()).toBe(true);

    expect(engine.getCurrentSession()?.sessionId).toBe(sessionId);
    expect(worklogs.getTodaysWorklogs()).toEqual([]);
  });

  describe('End my day', () => {
    const wrapUp = () => {
      if (engine.getCurrentSession()?.interruption) engine.stopInterruption();
      if (engine.getCurrentSession()) engine.stopSession('Wrap-up');
    };

    it('EndDayThenUndo_TheSessionRunsAgain_NoShutdown', () => {
      runA();
      const onCommit = vi.fn();
      const onUndo = vi.fn();

      endDayUndoably(deps, wrapUp, { onCommit, onUndo });
      expect(engine.getCurrentSession()).toBeNull();
      expect(undo.current()?.label).toBe('Day ended');
      expect(undo.run()).toBe(true);

      expect(engine.getCurrentSession()?.taskId).toBe(A.id);
      expect(onUndo).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
      expect(worklogs.getTodaysWorklogs()).toEqual([]);
    });

    it('EndDayDuringAnInterruption_UndoBringsBothBack', () => {
      runA();
      engine.startInterruption();

      endDayUndoably(deps, wrapUp);
      expect(engine.getCurrentSession()).toBeNull();
      expect(undo.run()).toBe(true);

      const back = engine.getCurrentSession();
      expect(back?.interruption).toBeTruthy();
      expect(back?.interruption?.interruptedTaskKey).toBe(A.key);
    });

    it('EndDay_LeftAlone_CommitsAfterTheWindow', async () => {
      runA();
      const onCommit = vi.fn();

      endDayUndoably(deps, wrapUp, { onCommit });
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(undo.run()).toBe(false);
    });

    it('EndDay_NothingRunning_StillOffersUndoForTheShutdown', () => {
      const onUndo = vi.fn();

      endDayUndoably(deps, wrapUp, { onUndo });

      expect(undo.run()).toBe(true);
      expect(onUndo).toHaveBeenCalledTimes(1);
    });
  });

  describe('worklog edits', () => {
    /** A 30-minute worklog on A, already sent to Jira. */
    const sentWorklog = async () => {
      runA();
      engine.stopSession('Over');
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      return worklogs.getTodaysWorklogs()[0];
    };

    it('CorrectThenUndo_PutsTheWorklogAndItsQueueBack', async () => {
      const before = await sentWorklog();
      const rowsBefore = queueRows();

      correctUndoably(edits, before.id, { durationSeconds: 600, startedAtUtc: before.startedAtUtc, comment: 'Shorter' });
      expect(queueRows()).toHaveLength(rowsBefore.length + 1);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(before.id)).toMatchObject({ durationSeconds: before.durationSeconds, comment: 'Over' });
      expect(queueRows()).toEqual(rowsBefore);
      expect(edits.onRestored).toHaveBeenCalled();
    });

    it('MoveThenUndo_PutsItBackOnItsTask', async () => {
      const before = await sentWorklog();

      moveUndoably(edits, before.id, B.id);
      expect(worklogs.getWorklogById(before.id)?.taskId).toBe(B.id);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(before.id)?.taskId).toBe(A.id);
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }]);
    });

    it('SplitThenUndo_TheEntryWholeAgain_TheRestGone', async () => {
      const before = await sentWorklog();
      const at = new Date(Date.parse(before.startedAtUtc) + 10 * 60_000).toISOString();

      const { second } = splitUndoably(edits, before.id, { atUtc: at, taskId: B.id });
      expect(queueRows()).toEqual([
        { operation: 'CREATE', status: 'SYNCED' }, { operation: 'UPDATE', status: 'PENDING' }, { operation: 'CREATE', status: 'PENDING' }
      ]);
      expect(undo.current()?.label).toMatch(/^Split A-1 · \d/);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(before.id)?.durationSeconds).toBe(before.durationSeconds);
      expect(worklogs.getWorklogById(second.id)).toBeNull();
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }]);
    });

    it('SplitOntoNewOwnWorkThenUndo_TheOwnWorkGoneToo', async () => {
      const before = await sentWorklog();
      const at = new Date(Date.parse(before.startedAtUtc) + 10 * 60_000).toISOString();

      const { second } = splitUndoably(edits, before.id, { atUtc: at, ownTitle: 'Code review' });
      const own = tasks.getTaskById(second.taskId);
      expect(own).toMatchObject({ title: 'Code review', projectId: 'ADHOC' });
      // The shortening goes to Jira; the rest, own work, goes nowhere.
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }, { operation: 'UPDATE', status: 'PENDING' }]);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(second.id)).toBeNull();
      expect(tasks.getTaskById(second.taskId)).toBeNull();
      expect(worklogs.getWorklogById(before.id)?.durationSeconds).toBe(before.durationSeconds);
    });

    it('MoveToNewOwnWorkThenUndo_BackOnItsTask_TheOwnWorkGone', async () => {
      const before = await sentWorklog();

      const moved = moveUndoably(edits, before.id, { ownTitle: 'Code review' });
      expect(tasks.getTaskById(moved.taskId)).toMatchObject({ title: 'Code review' });
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }, { operation: 'DELETE', status: 'PENDING' }]);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(before.id)?.taskId).toBe(A.id);
      expect(tasks.getTaskById(moved.taskId)).toBeNull();
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }]);
    });

    it('AddToNewOwnWorkThenUndo_LeavesNothing', () => {
      const added = addUndoably(edits, {
        taskId: '', ownTitle: 'Code review', durationSeconds: 1800,
        startedAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(), comment: ''
      });
      expect(tasks.getTaskById(added.taskId)).toMatchObject({ title: 'Code review' });
      expect(queueRows()).toEqual([]);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(added.id)).toBeNull();
      expect(tasks.getTaskById(added.taskId)).toBeNull();
    });

    it('AddInANewProjectOfYoursThenUndo_TheProjectGoneToo', () => {
      const added = addUndoably(edits, {
        taskId: '', ownTitle: 'Backup files', ownProject: 'Dash', durationSeconds: 1800,
        startedAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(), comment: ''
      });
      const own = tasks.getTaskById(added.taskId);
      expect(own).toMatchObject({ title: 'Backup files', projectId: 'DASH', key: 'DASH-1' });
      expect(added.taskId.startsWith('own_')).toBe(true);
      expect(engine.ownProjectFor('dash').exists).toBe(true);
      expect(queueRows()).toEqual([]);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(added.id)).toBeNull();
      expect(tasks.getTaskById(added.taskId)).toBeNull();
      expect(engine.ownProjectFor('Dash').exists).toBe(false);
    });

    it('MoveIntoAProjectOfYoursThenUndo_TheProjectStays', async () => {
      const before = await sentWorklog();
      engine.createOwnTask('Earlier', undefined, 'Dash');

      const moved = moveUndoably(edits, before.id, { ownTitle: 'Backup files', ownProject: ' DASH ' });
      expect(tasks.getTaskById(moved.taskId)).toMatchObject({ projectId: 'DASH', key: 'DASH-2' });
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(before.id)?.taskId).toBe(A.id);
      expect(tasks.getTaskById(moved.taskId)).toBeNull();
      expect(engine.ownProjectFor('Dash').exists).toBe(true);
    });

    it('AddToAnOwnTaskOfThatName_TakesItUp_UndoKeepsIt', () => {
      const existing = engine.createOwnTask('Backup files', undefined, 'Dash');

      const added = addUndoably(edits, {
        taskId: '', ownTitle: 'backup files', ownProject: 'dash', durationSeconds: 1800,
        startedAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(), comment: ''
      });
      expect(added.taskId).toBe(existing.id);
      expect(tasks.getTasksByProjectId('DASH')).toHaveLength(1);
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(added.id)).toBeNull();
      expect(tasks.getTaskById(existing.id)).not.toBeNull();
    });

    it('SendDestinationOfTask_OwnWork_None_NeverTheActiveProvider', () => {
      const own = engine.createOwnTask('Code review');

      expect(engine.sendDestinationOfTask(own.id)).toBeNull();
      expect(engine.sendDestinationOfTask(A.id)).not.toBeNull();
    });

    it('DeleteThenUndo_BringsItBack', async () => {
      const before = await sentWorklog();

      deleteUndoably(edits, before.id);
      expect(worklogs.getWorklogById(before.id)).toBeNull();
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(before.id)?.durationSeconds).toBe(before.durationSeconds);
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }]);
    });

    it('AddThenUndo_LeavesNothing', () => {
      const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();

      const added = addUndoably(edits, { taskId: A.id, durationSeconds: 1800, startedAtUtc: yesterday, comment: 'Review' });
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'PENDING' }]);
      expect(undo.current()?.label).toBe('Added to A-1 · 30m');
      expect(undo.run()).toBe(true);

      expect(worklogs.getWorklogById(added.id)).toBeNull();
      expect(queueRows()).toEqual([]);
    });

    it('Add_LeftAlone_SentAfterTheHold', async () => {
      const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();

      addUndoably(edits, { taskId: A.id, durationSeconds: 1800, startedAtUtc: yesterday, comment: 'Review' });
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

      await vi.waitFor(() => expect(sent).toEqual([{ taskId: A.id, durationSeconds: 1800 }]));
      expect(undo.run()).toBe(false);
    });

    it('Delete_LeftAlone_DeletesAtTheProviderAfterTheHold', async () => {
      const before = await sentWorklog();

      deleteUndoably(edits, before.id);
      await drain();
      expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }, { operation: 'DELETE', status: 'PENDING' }]);

      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
      await vi.waitFor(() => expect(queueRows()).toEqual([{ operation: 'CREATE', status: 'SYNCED' }, { operation: 'DELETE', status: 'SYNCED' }]));
      expect(undo.run()).toBe(false);
    });
  });
});
