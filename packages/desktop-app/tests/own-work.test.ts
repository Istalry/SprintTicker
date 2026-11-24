import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { OWN_PROJECT_PROVIDER_ID } from '../src/shared/local-provider';
import { ADHOC_PROJECT_ID } from '../src/shared/adhoc-project';
import { WORKLOG_COMMENTS } from '../src/shared/worklog-comments';
import { projectMarkOf } from '../src/shared/project-mark';
import { checkOwnWork, nextOwnTaskKey, ownProjectKeyFor, parseOwnWorkLine, sameOwnName } from '../src/shared/own-work';

/** Work of your own on the fly (LOCAL-WORK-AND-CALENDAR.md §2, phase T1). */
describe('work of your own on the fly', () => {
  describe('the one line', () => {
    it.each([
      ['Backup files', { title: 'Backup files' }],
      ['Dash: Backup files', { project: 'Dash', title: 'Backup files' }],
      ['Dash: Backup files: before v2', { project: 'Dash', title: 'Backup files', note: 'before v2' }],
      ['Dash: Backup: before v2: and the art', { project: 'Dash', title: 'Backup', note: 'before v2: and the art' }],
      ['  Dash :  Backup files  ', { project: 'Dash', title: 'Backup files' }],
      ['Sync at 10:30', { title: 'Sync at 10:30' }],
      ['Dash: ', { title: 'Dash:' }],
      [': Backup', { title: ': Backup' }]
    ])('ParseOwnWorkLine_%j', (line, expected) => {
      expect(parseOwnWorkLine(line)).toEqual(expected);
    });

    it('SameOwnName_CaseAndSpacesAside', () => {
      expect(sameOwnName('Backup  files ', 'backup files')).toBe(true);
      expect(sameOwnName('Backup files', 'Backup file')).toBe(false);
    });

    it('OwnProjectKeyFor_LettersAndDigits_FreeAmongEveryKey', () => {
      expect(ownProjectKeyFor('Dash', [])).toBe('DASH');
      expect(ownProjectKeyFor('Prisme présentation 2', [])).toBe('PRISME');
      expect(ownProjectKeyFor('Dash', ['dash', 'DASH2'])).toBe('DASH3');
      expect(ownProjectKeyFor('!!!', [])).toBe('OWN');
    });

    it('NextOwnTaskKey_OnePastTheHighest', () => {
      expect(nextOwnTaskKey('DASH', [])).toBe('DASH-1');
      expect(nextOwnTaskKey('DASH', ['DASH-1', 'DASH-7', 'OTHER-9', 'DASH-x'])).toBe('DASH-8');
    });

    it('CheckOwnWork_TrimsAndRefusesWhatIsNotOne', () => {
      expect(checkOwnWork({ title: ' Backup ', project: ' Dash ', note: '' })).toEqual({ title: 'Backup', project: 'Dash' });
      expect(checkOwnWork({ title: '' })).toBeNull();
      expect(checkOwnWork({ title: 'Backup', project: 3 })).toBeNull();
      expect(checkOwnWork({ title: 'x'.repeat(201) })).toBeNull();
      expect(checkOwnWork('Backup')).toBeNull();
    });
  });

  describe('the engine', () => {
    let db: DatabaseConnection;
    let engine: TimeTrackingEngine;
    let projects: ProjectRepository;
    let tasks: TaskRepository;
    let worklogs: WorklogRepository;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      vi.setSystemTime(new Date(2026, 10, 24, 10, 0, 0));
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      db = new DatabaseConnection(':memory:');
      projects = new ProjectRepository(db);
      tasks = new TaskRepository(db);
      worklogs = new WorklogRepository(db);
      // An online project with the key a new one would want: names stay apart.
      projects.saveProject({ id: 'DASH', key: 'DASH', name: 'Dash', providerId: 'jira' });
      const remote = { providerId: 'jira', providerName: 'Jira', minimumLoggableSeconds: 60, findWorklog: async () => null };
      const manager = {
        getActiveProvider: () => remote,
        getProvider: () => remote,
        logTimeForProvider: async () => ({ success: true, remoteWorklogId: 'r1' })
      } as unknown as ProviderManager;
      engine = new TimeTrackingEngine(new SessionRepository(db), worklogs, tasks, manager, projects);
    });

    afterEach(() => {
      engine.dispose();
      db.close();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('StartOwnWork_ANewProject_IsMadeHere_ApartFromTheOnlineOneOfTheSameName', () => {
      const session = engine.startOwnWork({ project: 'dash', title: 'Backup files', note: 'before v2' });

      const own = projects.getAllProjects().find(p => p.providerId === OWN_PROJECT_PROVIDER_ID)!;
      expect(own).toMatchObject({ id: 'DASH2', key: 'DASH2', name: 'dash' });
      expect(session).toMatchObject({ projectId: 'DASH2', taskKey: 'DASH2-1', taskTitle: 'Backup files', isAdHoc: false, note: 'before v2' });
      expect(session.taskId.startsWith('own_')).toBe(true);
      expect(projects.getAllProjects().find(p => p.id === 'DASH')?.providerId).toBe('jira');
    });

    it('StartOwnWork_TheSameProjectAgain_TakesTheNextKey_NoSecondProject', () => {
      engine.startOwnWork({ project: 'Dash', title: 'Backup files' });
      const second = engine.startOwnWork({ project: ' DASH ', title: 'Clean the art' });

      expect(projects.getAllProjects().filter(p => p.providerId === OWN_PROJECT_PROVIDER_ID)).toHaveLength(1);
      expect(second.taskKey).toBe('DASH2-2');
    });

    it('StartOwnWork_TheSameNameAgain_TakesUpItsTask_CaseAside', () => {
      const first = engine.startOwnWork({ project: 'Dash', title: 'Backup files' });
      vi.advanceTimersByTime(20 * 60_000);
      const again = engine.startOwnWork({ project: 'dash', title: ' backup  FILES ' });

      expect(again.taskId).toBe(first.taskId);
      expect(again).toMatchObject({ taskKey: 'DASH2-1', taskTitle: 'Backup files' });
      expect(tasks.getTasksByProjectId('DASH2')).toHaveLength(1);
    });

    it('StartOwnWork_NoProject_TheSameNameAgain_OneTask', () => {
      const first = engine.startOwnWork({ title: 'Code review' });
      vi.advanceTimersByTime(20 * 60_000);
      const again = engine.startOwnWork({ title: 'code review' });

      expect(again.taskId).toBe(first.taskId);
      expect(again.taskTitle).toBe('Code review');
    });

    it('FindOwnTask_TheSameNameInAnotherProject_IsAnotherTask', () => {
      engine.startOwnWork({ project: 'Dash', title: 'Backup files' });

      expect(engine.findOwnTask('Backup files', 'Prisme')).toBeNull();
      expect(engine.findOwnTask('Backup files')).toBeNull();
      expect(engine.findOwnTask('backup files', 'DASH')?.key).toBe('DASH2-1');
    });

    it('StartOwnWork_NoProject_IsWorkOfYourOwnAsBefore', () => {
      const session = engine.startOwnWork({ title: 'Backup files', note: 'before v2' });

      expect(session).toMatchObject({ isAdHoc: true, taskTitle: 'Backup files', note: 'before v2' });
      expect(tasks.getTaskById(session.taskId)?.projectId).toBe(ADHOC_PROJECT_ID);
      expect(projects.getAllProjects().some(p => p.providerId === OWN_PROJECT_PROVIDER_ID)).toBe(false);
    });

    it('TheNote_SurvivesARestart_AndIsTheEntrysComment_OverTheAppsWords', () => {
      engine.startOwnWork({ project: 'Dash', title: 'Backup files', note: 'before v2' });
      vi.advanceTimersByTime(20 * 60_000);
      expect(new SessionRepository(db).getActiveSession()?.note).toBe('before v2');

      // A switch: the app's words for how it ended give way to the note.
      engine.startOwnWork({ title: 'Other' });

      expect(worklogs.getTodaysWorklogs().find(w => w.taskTitle === 'Backup files')?.comment).toBe('before v2');
    });

    it('AStopComment_TheUsersWords_WinOverTheNote', () => {
      engine.startOwnWork({ project: 'Dash', title: 'Backup files', note: 'before v2' });
      vi.advanceTimersByTime(20 * 60_000);

      engine.stopSession('Copied to the NAS');

      expect(worklogs.getTodaysWorklogs()[0].comment).toBe('Copied to the NAS');
    });

    it('NoNote_TheAppsWordsAsBefore', () => {
      engine.startOwnWork({ project: 'Dash', title: 'Backup files' });
      vi.advanceTimersByTime(20 * 60_000);

      engine.stopSession(WORKLOG_COMMENTS.BAR_STOP);

      expect(worklogs.getTodaysWorklogs()[0].comment).toBe(WORKLOG_COMMENTS.BAR_STOP);
    });
  });
});

describe('a sync while work of your own is timed', () => {
  let db: DatabaseConnection;
  let engine: TimeTrackingEngine;
  let projects: ProjectRepository;
  const askedAbout: string[] = [];

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    askedAbout.length = 0;
    db = new DatabaseConnection(':memory:');
    projects = new ProjectRepository(db);
    const remote = {
      providerId: 'openproject', providerName: 'OpenProject', minimumLoggableSeconds: 60,
      // Asked about a local id, a provider answers 404: gone.
      getTaskStanding: async (id: string) => { askedAbout.push(id); return { state: 'gone' }; }
    };
    const manager = {
      getActiveProvider: () => remote,
      getProvider: () => remote,
      getProjects: async () => [{ id: '7', key: 'dash', name: 'Dash', providerId: 'openproject' }],
      getTasks: async () => [{ id: '40', projectId: '7', key: 'OP-40', title: 'Backup the build server', status: 'todo' }],
      getTaskStanding: remote.getTaskStanding,
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(new SessionRepository(db), new WorklogRepository(db), new TaskRepository(db), manager, projects);
    await engine.getSyncWorker().syncTasksAndProjects();
  });

  afterEach(() => {
    engine.dispose();
    db.close();
    vi.restoreAllMocks();
  });

  // rc1 of 2.0.2: the sync protected the running own task as a provider's,
  // found it missing from the provider's list, asked the provider about a
  // local id and read its 404 as gone -- "DASH2-1 is no longer on
  // OpenProject", and Done asked first.
  it('Sync_OwnWorkRunning_StaysListed_AndTheProviderIsNotAsked', async () => {
    engine.startOwnWork({ project: 'Dash', title: 'Backup files' });

    await engine.getSyncWorker().syncTasksAndProjects();

    const session = engine.getCurrentSession()!;
    expect(session.taskUnlisted).toBeUndefined();
    expect(session.taskLeftBecause).toBeUndefined();
    expect(askedAbout).toEqual([]);
    expect(projects.getAllProjects().filter(p => p.providerId === OWN_PROJECT_PROVIDER_ID)).toHaveLength(1);
  });
});

describe('the mark of a project of the same name', () => {
  it('ProjectMarkOf_OnlyWhereAnOwnAndAnOnlineNameCollide', () => {
    const online = { id: 'DASH', key: 'DASH', name: 'Dash', providerId: 'jira' };
    const own = { id: 'DASH2', key: 'DASH2', name: 'dash ', providerId: 'sprintticker' };
    const other = { id: 'OPS', key: 'OPS', name: 'Ops', providerId: 'jira' };
    const ownToo = { id: 'OPS2', key: 'OPS2', name: 'Ops', providerId: 'jira' };

    expect(projectMarkOf(own, [online, own, other])).toBe('computer');
    expect(projectMarkOf(online, [online, own, other])).toBe('provider');
    expect(projectMarkOf(other, [online, own, other, ownToo])).toBeNull();
    expect(projectMarkOf(online, [online, other])).toBeNull();
  });
});
