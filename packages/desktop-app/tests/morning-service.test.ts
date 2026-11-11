import { describe, it, expect } from 'vitest';
import { MorningService, MorningDeps, MORNING_SEEN_KEY } from '../src/main/services/morning-service';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskOwnership } from '../src/shared/task-ownership';
import type { TaskDTO } from '../src/shared/dtos';

const NOW = new Date(2026, 10, 10, 9, 8);
const task = (key: string, extra: Partial<TaskDTO> = {}): TaskDTO => ({
  id: `t-${key}`, projectId: 'p', key, title: `Title of ${key}`, status: 'todo', ...extra
});
const MG12 = task('MG-12', { status: 'in_progress' });
const MG22 = task('MG-22', { status: 'in_progress' });
const PF31 = task('PF-31', { status: 'in_progress' });
const THEIRS = task('OPS-1', { status: 'in_progress', ownership: TaskOwnership.OTHER });

/** A morning with everything the card can say; each test changes one thing. */
function morning(overrides: Partial<MorningDeps> = {}) {
  const settings = new Map<string, unknown>();
  const deps: MorningDeps = {
    isWorkingDay: () => true,
    getSetting: <T>(key: string, fallback: T) => (settings.has(key) ? (settings.get(key) as T) : fallback),
    setSetting: (key, value) => { settings.set(key, value); },
    hasSession: () => false,
    loggedOn: () => false,
    recentTasks: () => [MG12, PF31],
    lastEndOf: () => new Date(2026, 10, 9, 17, 31).toISOString(),
    listedTasks: () => [MG12, MG22, PF31, THEIRS],
    schedule: () => ({ standupTime: '09:30' }),
    now: () => NOW,
    ...overrides
  };
  return { service: new MorningService(deps), settings };
}

/** The morning card (S4b): the first look at Today on a working day. */
describe('MorningService', () => {
  it('GetMorning_FirstLook_TheLastTaskTheStandupAndMyTasksInProgress', () => {
    const { service } = morning();

    expect(service.getMorning()).toEqual({
      dateKey: '2026-11-10',
      lastTask: { id: MG12.id, key: 'MG-12', title: MG12.title, stoppedAtUtc: new Date(2026, 10, 9, 17, 31).toISOString() },
      standupAt: '09:30',
      // The last task is the card's first line; a teammate's is not "your" work.
      inProgress: [{ id: MG22.id, key: 'MG-22', title: MG22.title }, { id: PF31.id, key: 'PF-31', title: PF31.title }]
    });
  });

  it.each([
    ['a day off', { isWorkingDay: () => false }],
    ['a session open', { hasSession: () => true }],
    ['something logged today', { loggedOn: () => true }]
  ] as const)('GetMorning_%s_None', (_name, overrides) => {
    expect(morning(overrides).service.getMorning()).toBeNull();
  });

  it('MarkSeen_NoneForTheRestOfTheDay_BackTomorrow', () => {
    let now = NOW;
    const { service, settings } = morning({ now: () => now });

    service.markSeen();

    expect(settings.get(MORNING_SEEN_KEY)).toBe('2026-11-10');
    expect(service.getMorning()).toBeNull();
    now = new Date(2026, 10, 11, 8, 0);
    expect(service.getMorning()).not.toBeNull();
  });

  it.each([
    ['done', task('MG-12', { status: 'done' })],
    ['someone else\'s', task('MG-12', { ownership: TaskOwnership.OTHER })],
    ['ad-hoc', task('X', { id: 'adhoc_1_x' })]
  ])('LastTask_%s_SkippedForTheNext', (_name, first) => {
    const { service } = morning({ recentTasks: () => [first, PF31] });

    expect(service.getMorning()?.lastTask?.key).toBe('PF-31');
  });

  it('LastTask_NeverLogged_NoLine', () => {
    const { service } = morning({ lastEndOf: () => null });

    expect(service.getMorning()?.lastTask).toBeNull();
  });

  it.each([
    ['past', new Date(2026, 10, 10, 9, 30), { standupTime: '09:30' }],
    ['off', NOW, { standupTime: '09:30', enableStandupPrompt: false }]
  ] as const)('Standup_%s_NoLine', (_name, now, schedule) => {
    const { service } = morning({ now: () => now, schedule: () => schedule });

    expect(service.getMorning()?.standupAt).toBeNull();
  });

  it('LastEndOf_TheLatestEntrysEnd', () => {
    const db = new DatabaseConnection(':memory:');
    const repo = new WorklogRepository(db);
    db.getDb().prepare("INSERT INTO projects (id, key, name, created_at_utc) VALUES ('p', 'P', 'P', '2026-01-01T00:00:00.000Z')").run();
    db.getDb().prepare("INSERT INTO tasks (id, project_id, key, title, status, created_at_utc) VALUES ('t', 'p', 'K-1', 'T', 'todo', '2026-01-01T00:00:00.000Z')").run();
    const log = (id: string, start: string, seconds: number) =>
      repo.saveWorklog({ id, sessionId: id, taskId: 't', durationSeconds: seconds, startedAtUtc: start, comment: '', createdAtUtc: start });
    log('a', '2026-11-09T15:00:00.000Z', 3600);
    log('b', '2026-11-09T16:00:00.000Z', 1860);

    expect(repo.getLastEndOf('t')).toBe('2026-11-09T16:31:00.000Z');
    expect(repo.getLastEndOf('none')).toBeNull();
  });
});
