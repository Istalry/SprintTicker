import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRefusal, AgentReadSources, AgentService, localIso } from '../src/main/services/agent-service';
import { AGENT_COMMANDS, AGENT_DEFAULT_PORT, AGENT_PROTOCOL_VERSION, agentCommand } from '../src/shared/agent-protocol';
import { LOCAL_API_PORT } from '../src/shared/deck-protocol';
import { ActiveSessionDTO, TaskDTO, WorklogDTO } from '../src/shared/dtos';
import { InterruptionToPlaceDTO } from '../src/shared/interruption';

/** Tuesday 24 November 2026, 10:00 local. */
const NOW = new Date(2026, 10, 24, 10, 0, 0);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

const entry = (over: Partial<WorklogDTO>): WorklogDTO => ({
  id: 'w', sessionId: 's', taskId: 'T-1', taskKey: 'MG-12', taskTitle: 'Export the week', durationSeconds: 3600,
  startedAtUtc: at(23, 9), comment: 'Stopped by switching task', createdAtUtc: at(23, 10), syncState: 'sent',
  projectId: 'P', projectName: 'Mango', providerSeconds: 3600, ...over
});

const running: ActiveSessionDTO = {
  sessionId: 's9', projectId: 'P', taskId: 'T-2', taskKey: 'MG-13', taskTitle: 'Fix the glow', isAdHoc: false,
  status: 'TRACKING', startTimeUtc: at(24, 9, 30), totalPausedSeconds: 0, elapsedSeconds: 1800
};

const task = (id: string, key: string, title: string, projectId = 'P'): TaskDTO => ({ id, key, title, projectId, status: 'todo' });

describe('AgentService, the reads an AI agent asks for', () => {
  let sources: AgentReadSources;
  let service: AgentService;
  let worklogs: WorklogDTO[];
  let session: ActiveSessionDTO | null;
  let toPlace: InterruptionToPlaceDTO[];

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    worklogs = [];
    session = null;
    toPlace = [];
    sources = {
      session: () => session,
      worklogsOn: day => worklogs.filter(w => new Date(w.startedAtUtc).getDate() === Number(day.slice(8))),
      worklogsBetween: () => worklogs,
      toPlace: () => toPlace,
      schedule: () => null,
      weekChanges: () => null,
      providerName: () => 'Jira',
      // Mondays to Fridays, and Monday 23 November off.
      isWorkingDay: day => day !== '2026-11-23' && [1, 2, 3, 4, 5].includes(new Date(`${day}T12:00`).getDay()),
      listedTasks: () => [task('T-1', 'MG-12', 'Export the week'), task('T-120', 'MG-120', 'Another'), task('T-2', 'MG-13', 'Fix the glow')],
      ownTasks: () => [task('adhoc_1', 'MISC-1', 'Code review', 'ADHOC')],
      projects: () => [{ id: 'P', key: 'MG', name: 'Mango' }],
      now: () => NOW
    };
    service = new AgentService(sources);
  });

  it('Protocol_ItsPortIsTheLocalApis_AndEveryCommandIsFoundByNameOrTool', () => {
    expect(AGENT_DEFAULT_PORT).toBe(LOCAL_API_PORT);
    for (const command of AGENT_COMMANDS) {
      expect(agentCommand(command.name)).toBe(command);
      expect(agentCommand(command.tool)).toBe(command);
    }
    expect(new Set(AGENT_COMMANDS.map(c => c.name)).size).toBe(AGENT_COMMANDS.length);
  });

  it.each([
    ['today', '2026-11-24'],
    ['yesterday', '2026-11-23'],
    // Monday the 23rd is off: the working day before is Friday.
    ['last-working-day', '2026-11-20'],
    ['2026-11-02', '2026-11-02']
  ])('ResolveDay_%s_OnTheAppsClock', (name, key) => {
    expect(service.resolveDay(name)).toBe(key);
  });

  it.each(['tomorrow-ish', '2026-13-40', '2026-02-30'])('ResolveDay_%s_Refused', name => {
    expect(() => service.resolveDay(name)).toThrow(AgentRefusal);
  });

  it.each([
    [undefined, '2026-11-23'],
    ['last-week', '2026-11-16'],
    ['yesterday', '2026-11-23'],
    ['2026-11-05', '2026-11-02']
  ])('ResolveWeek_%s_ItsMonday', (name, monday) => {
    expect(service.resolveWeek(name)).toBe(monday);
  });

  it('Day_TotalsGivenEntriesInOrder_StatesInTheWindowsWords', () => {
    worklogs = [
      entry({ id: 'b', startedAtUtc: at(23, 11), durationSeconds: 1800, taskKey: 'MG-13', taskTitle: 'Fix the glow', taskId: 'T-2', syncState: 'pending' }),
      entry({ id: 'a' })
    ];

    const answer = service.run('day', { day: 'yesterday' });

    expect(answer.protocol).toBe(AGENT_PROTOCOL_VERSION);
    expect(answer.readAt).toBe(localIso(NOW));
    expect(answer.text).toContain('Monday 2026-11-23: 1h 30m logged over 2 tasks, 2 entries (all sent but 1 waiting).');
    expect(answer.text).toContain('- MG-12 Export the week: 1h 00m');
    expect(answer.text.indexOf('MG-12 Export the week [Sent]')).toBeLessThan(answer.text.indexOf('MG-13 Fix the glow [Waiting to send]'));
    expect(answer.text).toContain('-- "Stopped by switching task"');
    const data = answer.data as { total: { seconds: number; text: string }; entries: Array<{ start: string; stateText: string }> };
    expect(data.total).toEqual({ seconds: 5400, text: '1h 30m' });
    expect(data.entries[0].start).toBe(localIso(new Date(at(23, 9))));
    expect(data.entries[1].stateText).toBe('Waiting to send');
  });

  it('Day_Today_TheRunningTaskSaidApart_NotInTheTotal', () => {
    session = running;

    const answer = service.run('day', {});

    expect(answer.text).toContain('nothing logged.');
    expect(answer.text).toContain('Running now, not in the total: MG-13 Fix the glow is running: 30m so far since 09:30.');
  });

  it('Now_AnInterruption_SaysWhatItHolds', () => {
    session = {
      ...running,
      taskKey: 'MISC-1', taskTitle: 'Call with Marc', isAdHoc: true, elapsedSeconds: 300,
      interruption: {
        id: 'f', name: 'Call with Marc', title: 'Call with Marc', startedAtUtc: at(24, 9, 55), index: 1, source: 'window',
        interruptedSessionId: 's9', interruptedTaskKey: 'MG-13', interruptedTaskTitle: 'Fix the glow', interruptedWasPaused: false,
        interruptedSeconds: 1500
      } as NonNullable<ActiveSessionDTO['interruption']>
    };

    expect(service.run('now').text).toBe('An interruption, "Call with Marc", is running: 5m so far since 09:55. It holds MG-13 Fix the glow, paused.');
  });

  it('Now_NothingRunning_SaysSo', () => {
    expect(service.run('get_running')).toMatchObject({ text: 'Nothing is being timed.', data: { running: null } });
  });

  it('Week_ProjectsTasksAndWhatTheProviderHolds', () => {
    worklogs = [entry({ id: 'a' }), entry({ id: 'b', startedAtUtc: at(24, 8), syncState: 'pending', providerSeconds: undefined })];

    const answer = service.run('week', {});

    expect(answer.text).toContain('Week of Monday 2026-11-23: 2h 00m logged; Jira holds 1h 00m.');
    expect(answer.text).toContain('- Mango: 2h 00m');
    expect(answer.text).toContain('  - MG-12 Export the week: 2h 00m');
    // Monday is off but worked: shown; the weekend, empty and off, is not.
    expect(answer.text).toContain('- Monday 2026-11-23: 1h 00m');
    expect(answer.text).not.toContain('Saturday');
  });

  it('Check_TheWeeksIssues_TitlesAndDetails', () => {
    worklogs = [entry({ id: 'a', syncState: 'refused', refusal: 'Issue does not exist' })];

    const answer = service.run('check_week', { week: 'this-week' });

    expect(answer.text).toMatch(/^Week of Monday 2026-11-23: 1h 00m logged\. 1 thing to look at\./);
    expect((answer.data as { issues: Array<{ kind: string }> }).issues.map(i => i.kind)).toEqual(['refused']);
  });

  it('Check_APartThatCannotBeRead_LeftOut_NotTheWholeCheck', () => {
    sources.weekChanges = () => { throw new Error('closed-week read failed'); };

    expect(service.run('check').text).toContain('Nothing to look at.');
  });

  it('ToPlace_ListsThemWithTheirTotal', () => {
    toPlace = [{
      id: 'f', name: null, title: 'Interruption at 09:02', startedAtUtc: at(24, 9, 2), endedAtUtc: at(24, 9, 17),
      durationSeconds: 900, source: 'bar', interruptedTaskKey: 'MG-12', index: 1, ofRun: 1
    }];

    expect(service.run('to-place').text).toBe('1 interruption waits to be placed: 15m.\n- 2026-11-24 09:02-09:17 15m Interruption at 09:02 (during MG-12)');
  });

  it('Tasks_AnExactKeyFirst_OwnWorkSaidSo', () => {
    const exact = service.run('tasks', { search: 'MG-12' }).data as { tasks: Array<{ key: string }> };
    expect(exact.tasks.map(t => t.key)).toEqual(['MG-12', 'MG-120']);

    const own = service.run('find_tasks', { search: 'review' });
    expect(own.text).toContain('MISC-1 Code review (own work, to do; id adhoc_1)');
    expect((own.data as { tasks: Array<{ ownWork: boolean }> }).tasks[0].ownWork).toBe(true);
  });

  it.each([
    ['an unknown command', 'nope', {}, 'not-found'],
    ['a search with no words', 'tasks', {}, 'invalid-request'],
    ['a day that is not text', 'day', { day: true }, 'invalid-request']
  ])('Run_%s_Refused', (_name, command, request, code) => {
    expect(() => service.run(command, request)).toThrow(expect.objectContaining({ code }));
  });
});
