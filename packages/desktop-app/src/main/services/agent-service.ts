import { ActiveSessionDTO, ArgumentNullException, ProjectDTO, ScheduleSettingsDTO, TaskDTO, WeekChangeDTO, WorklogDTO } from '../../shared/dtos';
import {
  AGENT_PROTOCOL_VERSION,
  AgentAnswer,
  AgentDuration,
  AgentErrorCode,
  AgentRequest,
  agentCommand
} from '../../shared/agent-protocol';
import { addLocalDays, localDateKey } from '../../shared/local-date';
import { formatHoursAndMinutes } from '../../shared/time-format';
import { describeSends, summarizeDay } from '../../shared/day-summary';
import { buildWeekSheet, WEEK_NO_PROJECT } from '../../shared/week-sheet';
import { checkWeek, describeWeekCheck } from '../../shared/week-issues';
import { weekStartKey } from '../../shared/working-days';
import { SYNC_STATE_WORDS } from '../../shared/sync-state-words';
import { matchesSearch } from '../../shared/task-picker';
import { END_THE_INTERRUPTION_FIRST, InterruptionToPlaceDTO } from '../../shared/interruption';
import { finishNeedsConfirmation } from '../../shared/task-left';
import { ADHOC_PROJECT_ID } from '../../shared/adhoc-project';

/** An answer the agent cannot have: its code says why, its message what to do. */
export class AgentRefusal extends Error {
  constructor(public readonly code: AgentErrorCode, message: string) {
    super(message);
    this.name = 'AgentRefusal';
  }
}

/** What the agent's answers read: what the window reads, through main's own readers. */
export interface AgentReadSources {
  session(): ActiveSessionDTO | null;
  worklogsOn(dateKey: string): WorklogDTO[];
  worklogsBetween(fromKey: string, toKey: string): WorklogDTO[];
  toPlace(): InterruptionToPlaceDTO[];
  /** The working hours, for Check my week's gaps; null leaves them out. */
  schedule(): ScheduleSettingsDTO | null;
  /** Changes made after the week of `monday` closed; null for a week still open. */
  weekChanges(monday: string): WeekChangeDTO[] | null;
  /** The active provider's name, as the window says it: "Jira". */
  providerName(): string;
  isWorkingDay(dateKey: string): boolean;
  /** Every task the lists hold, and the user's own work. */
  listedTasks(): TaskDTO[];
  ownTasks(): TaskDTO[];
  projects(): ProjectDTO[];
  now?(): Date;
}

/**
 * What the agent's writes call: the commands a click, a bar press or a deck
 * key reach, never a rule of the agent's own (AGENT-INTERFACE.md §6).
 */
export interface AgentActions {
  /** `engine.startTask`: a switch when a task runs, as the window's picker. */
  startTask(taskId: string, title: string): void;
  isInterrupted(): boolean;
  /**
   * The window's Stop and Done, with Undo: `SessionEnding.complete`. Named
   * here rather than imported so the agent's client, whose tests load this
   * file, does not type-check the engine and the driver behind it.
   */
  ending: { complete(comment?: string, markDone?: boolean): { success: boolean; loggedSeconds: number } };
  pause(): void;
  resume(): void;
}

/** How far back "last-working-day" looks before giving up: a fortnight off. */
const WORKING_DAY_LOOKBACK = 14;
/** Tasks a search names before "and N more": enough to choose from, short enough to read. */
const SEARCH_SHOWN = 15;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Answers an AI agent's questions (AGENT-INTERFACE.md §3) from what the
 * window reads, worded as the window words it. Every rule the answer needs --
 * which day "yesterday" is, the totals, a state's word -- is decided here, so
 * the command-line tool and the MCP server only forward and print.
 *
 * The reads go through `AgentReadSources`, readers only; the writes through
 * `AgentActions`, the window's own commands. Without actions, every write
 * is refused.
 */
export class AgentService {
  private readonly _now: () => Date;

  constructor(private readonly _sources: AgentReadSources, private readonly _actions: AgentActions | null = null) {
    if (!_sources) throw new ArgumentNullException('sources');
    this._now = _sources.now ?? (() => new Date());
  }

  /**
   * Runs the command named `name` with `request`'s parameters.
   *
   * @throws AgentRefusal for an unknown command or a parameter it cannot read.
   */
  public run(name: string, request: AgentRequest = {}): AgentAnswer {
    const command = agentCommand(name);
    if (!command) throw new AgentRefusal('not-found', `No command "${name}".`);
    const text = (key: string): string | undefined => {
      const value = request[key];
      if (value === undefined || value === null || value === '') return undefined;
      if (typeof value !== 'string') throw new AgentRefusal('invalid-request', `"${key}" is text.`);
      return value.trim();
    };
    switch (command.name) {
      case 'now': return this.now();
      case 'day': return this.day(text('day'));
      case 'week': return this.week(text('week'));
      case 'check': return this.check(text('week'));
      case 'to-place': return this.toPlace();
      case 'tasks': return this.tasks(text('search'));
      case 'start': return this.start(text('task'));
      case 'stop': return this.stop(text('note'));
      case 'done': return this.done(request.confirmed === true);
      case 'pause': return this.pause();
      case 'resume': return this.resume();
      default: throw new AgentRefusal('not-found', `No command "${name}".`);
    }
  }

  private answer<T>(text: string, data: T): AgentAnswer<T> {
    return { protocol: AGENT_PROTOCOL_VERSION, readAt: localIso(this._now()), text, data };
  }

  // ---- now

  private now(): AgentAnswer {
    const session = this._sources.session();
    return this.answer(describeSession(session), { running: session ? sessionData(session) : null });
  }

  // ---- day

  private day(name: string | undefined): AgentAnswer {
    const dateKey = this.resolveDay(name ?? 'today');
    const entries = [...this._sources.worklogsOn(dateKey)].sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc));
    const summary = summarizeDay(entries);
    const sends = describeSends(entries);
    const session = dateKey === localDateKey(this._now()) ? this._sources.session() : null;
    const provider = this._sources.providerName();

    const lines = [
      `${weekdayName(dateKey)} ${dateKey}: ${entries.length === 0
        ? 'nothing logged.'
        : `${formatHoursAndMinutes(summary.totalSeconds)} logged over ${plural(summary.tasks.length, 'task', 'tasks')}, ${plural(entries.length, 'entry', 'entries')}${sends ? ` (${sends})` : ''}.`}`
    ];
    if (summary.tasks.length > 0) {
      lines.push('', 'By task:');
      for (const share of summary.tasks) lines.push(`- ${share.key} ${share.title}: ${formatHoursAndMinutes(share.seconds)}`);
      lines.push('', 'Entries, in the order worked:');
      for (const entry of entries) lines.push(`- ${describeEntry(entry)}`);
    }
    if (session) lines.push('', `Running now, not in the total: ${describeSession(session)}`);

    return this.answer(lines.join('\n'), {
      day: dateKey,
      weekday: weekdayName(dateKey),
      provider,
      total: duration(summary.totalSeconds),
      sends,
      tasks: summary.tasks.map(share => ({ key: share.key, title: share.title, ...duration(share.seconds) })),
      entries: entries.map(entryData),
      running: session ? sessionData(session) : null
    });
  }

  // ---- week

  private week(name: string | undefined): AgentAnswer {
    const monday = this.resolveWeek(name);
    const dayKeys = weekDays(monday);
    const entries = this._sources.worklogsBetween(monday, dayKeys[6]);
    const sheet = buildWeekSheet(dayKeys, entries, this._sources.toPlace());
    const provider = this._sources.providerName();

    const lines = [
      `Week of ${weekdayName(monday)} ${monday}: ${formatHoursAndMinutes(sheet.total)} logged; ${provider} holds ${formatHoursAndMinutes(sheet.providerTotal)}`
        + `${sheet.toPlaceTotal > 0 ? `; ${formatHoursAndMinutes(sheet.toPlaceTotal)} of interruptions to place` : ''}.`,
      '',
      'Per day:'
    ];
    for (const day of sheet.days) {
      if (day.seconds === 0 && day.toPlaceSeconds === 0 && !this._sources.isWorkingDay(day.dateKey)) continue;
      lines.push(`- ${weekdayName(day.dateKey)} ${day.dateKey}: ${formatHoursAndMinutes(day.seconds)}`
        + `${day.toPlaceSeconds > 0 ? `, ${formatHoursAndMinutes(day.toPlaceSeconds)} to place` : ''}`);
    }
    if (sheet.projects.length > 0) {
      lines.push('', 'By project and task:');
      for (const project of sheet.projects) {
        lines.push(`- ${project.name}: ${formatHoursAndMinutes(project.total)}`);
        for (const task of project.tasks) lines.push(`  - ${task.key} ${task.title}: ${formatHoursAndMinutes(task.total)}`);
      }
    }

    return this.answer(lines.join('\n'), {
      weekStart: monday,
      provider,
      total: duration(sheet.total),
      atProvider: duration(sheet.providerTotal),
      toPlace: duration(sheet.toPlaceTotal),
      days: sheet.days.map(day => ({
        day: day.dateKey, weekday: weekdayName(day.dateKey), ...duration(day.seconds),
        atProvider: duration(day.providerSeconds), toPlace: duration(day.toPlaceSeconds)
      })),
      projects: sheet.projects.map(project => ({
        name: project.name,
        inAProject: project.name !== WEEK_NO_PROJECT,
        ...duration(project.total),
        tasks: project.tasks.map(task => ({
          key: task.key, title: task.title, ...duration(task.total), perDay: task.perDay
        }))
      }))
    });
  }

  // ---- check

  private check(name: string | undefined): AgentAnswer {
    const monday = this.resolveWeek(name);
    const dayKeys = weekDays(monday);
    const entries = this._sources.worklogsBetween(monday, dayKeys[6]);
    const session = this._sources.session();
    const nowMs = this._now().getTime();
    const provider = this._sources.providerName();
    // As Check my week reads it: a part that cannot be read leaves its item
    // out, never the whole check.
    const result = checkWeek({
      dayKeys,
      entries,
      toPlace: this._sources.toPlace(),
      schedule: this.tryRead(() => this._sources.schedule(), null),
      running: session ? { startMs: Date.parse(session.startTimeUtc), endMs: nowMs } : null,
      changes: this.tryRead(() => this._sources.weekChanges(monday), null),
      nowMs,
      providerName: provider,
      dayName: weekdayName,
      clock: ms => clock(new Date(ms))
    });
    const logged = entries.reduce((sum, e) => sum + e.durationSeconds, 0);

    const lines = [`Week of ${weekdayName(monday)} ${monday}${result.closed ? ', closed' : ''}: ${describeWeekCheck(logged, result)}`];
    for (const issue of result.issues) {
      lines.push('', `- ${issue.title}`);
      for (const detail of issue.details) lines.push(`  - ${detail}`);
    }
    return this.answer(lines.join('\n'), {
      weekStart: monday,
      closed: result.closed,
      logged: duration(logged),
      issues: result.issues.map(issue => ({ kind: issue.kind, title: issue.title, details: issue.details }))
    });
  }

  // ---- to place

  private toPlace(): AgentAnswer {
    const waiting = this._sources.toPlace();
    const total = waiting.reduce((sum, item) => sum + item.durationSeconds, 0);
    const lines = [waiting.length === 0
      ? 'No interruption waits to be placed.'
      : `${plural(waiting.length, 'interruption waits', 'interruptions wait')} to be placed: ${formatHoursAndMinutes(total)}.`];
    for (const item of waiting) {
      lines.push(`- ${dayAndClock(item.startedAtUtc)}-${clock(new Date(item.endedAtUtc))} ${formatHoursAndMinutes(item.durationSeconds)} ${item.title}`
        + `${item.interruptedTaskKey ? ` (during ${item.interruptedTaskKey})` : ''}`);
    }
    return this.answer(lines.join('\n'), {
      total: duration(total),
      interruptions: waiting.map(item => ({
        title: item.title,
        named: item.name !== null,
        start: localIso(new Date(item.startedAtUtc)),
        end: localIso(new Date(item.endedAtUtc)),
        ...duration(item.durationSeconds),
        during: item.interruptedTaskKey
      }))
    });
  }

  // ---- tasks

  private tasks(search: string | undefined): AgentAnswer {
    if (!search) throw new AgentRefusal('invalid-request', 'Name a key or words of the title to search for.');
    const projects = new Map(this._sources.projects().map(p => [p.id, p]));
    const exact = (t: TaskDTO) => t.key.toLowerCase() === search.toLowerCase();
    const listed = this._sources.listedTasks().filter(t => matchesSearch(t, search, projects.get(t.projectId)));
    const own = this._sources.ownTasks().filter(t => matchesSearch(t, search));
    // An exact key first: "MG-12" must not lose to MG-120.
    const found = [...listed, ...own].sort((a, b) => Number(exact(b)) - Number(exact(a)));
    const shown = found.slice(0, SEARCH_SHOWN);
    const lines = [found.length === 0 ? `No task matches "${search}".` : `${plural(found.length, 'task matches', 'tasks match')} "${search}":`];
    for (const task of shown) lines.push(`- ${describeTask(task, projects.get(task.projectId))}`);
    if (found.length > shown.length) lines.push(`- and ${found.length - shown.length} more: search with more words.`);
    return this.answer(lines.join('\n'), {
      count: found.length,
      tasks: shown.map(task => taskData(task, projects.get(task.projectId)))
    });
  }

  // ---- writes

  private actions(): AgentActions {
    if (!this._actions) throw new AgentRefusal('refused', 'SprintTicker cannot change the timer from here.');
    return this._actions;
  }

  private start(taskName: string | undefined): AgentAnswer {
    if (!taskName) throw new AgentRefusal('invalid-request', 'Name the task to start: its key, or its id.');
    const actions = this.actions();
    // As the window, the picker and the deck (2026-11-12): an interruption ends first.
    if (actions.isInterrupted()) throw new AgentRefusal('refused', END_THE_INTERRUPTION_FIRST);
    const task = this.findTask(taskName);
    const before = this._sources.session();
    if (before?.taskId === task.id) {
      return this.answer(`${task.key} ${task.title} is already being timed. ${describeSession(before)}`, { running: sessionData(before) });
    }
    actions.startTask(task.id, task.title);
    const after = this._sources.session();
    const switched = before ? `Stopped ${before.taskKey} ${before.taskTitle} after ${formatHoursAndMinutes(before.elapsedSeconds)}, logged. ` : '';
    return this.answer(`${switched}${describeSession(after)}`, { stopped: before ? sessionData(before) : null, running: after ? sessionData(after) : null });
  }

  private stop(note: string | undefined): AgentAnswer {
    const session = this._sources.session();
    if (!session) throw new AgentRefusal('refused', 'Nothing is being timed.');
    const interruption = session.interruption;
    const result = this.actions().ending.complete(note, false);
    if (!result.success) throw new AgentRefusal('refused', 'SprintTicker did not stop it.');
    const after = this._sources.session();
    const text = interruption
      ? `Ended the interruption "${interruption.title}" after ${formatHoursAndMinutes(session.elapsedSeconds)}: it waits to be placed. ${describeSession(after)}`
      : `Stopped ${session.taskKey} ${session.taskTitle}: ${formatHoursAndMinutes(result.loggedSeconds)} logged. `
        + 'The user can undo it in SprintTicker for ten seconds; after that it is sent.';
    return this.answer(text, { stopped: sessionData(session), logged: duration(result.loggedSeconds), running: after ? sessionData(after) : null });
  }

  private done(confirmed: boolean): AgentAnswer {
    const session = this._sources.session();
    if (!session) throw new AgentRefusal('refused', 'Nothing is being timed.');
    if (session.interruption) throw new AgentRefusal('refused', 'An interruption is no task to mark done: stop it instead.');
    // Done moves the ticket at the provider: asked always, as the deck's
    // second press (S29). An agent's call is not the user's word.
    if (!confirmed) {
      const notTheirs = finishNeedsConfirmation(session) ? ' It is no longer theirs at the provider.' : '';
      throw new AgentRefusal('needs-confirmation',
        `Marking ${session.taskKey} done changes it at ${this._sources.providerName()}.${notTheirs} Ask the user, then call again with confirmed.`);
    }
    const result = this.actions().ending.complete(undefined, true);
    if (!result.success) throw new AgentRefusal('refused', 'SprintTicker did not finish it.');
    return this.answer(
      `Done: ${session.taskKey} ${session.taskTitle}, ${formatHoursAndMinutes(result.loggedSeconds)} logged. `
        + 'The user can undo it in SprintTicker for ten seconds.',
      { finished: sessionData(session), logged: duration(result.loggedSeconds) }
    );
  }

  private pause(): AgentAnswer {
    const session = this._sources.session();
    if (session?.status !== 'TRACKING') throw new AgentRefusal('refused', session ? 'It is paused already.' : 'Nothing is being timed.');
    this.actions().pause();
    return this.answer(describeSession(this._sources.session()), { running: sessionData(this._sources.session() ?? session) });
  }

  private resume(): AgentAnswer {
    const session = this._sources.session();
    if (session?.status !== 'PAUSED') throw new AgentRefusal('refused', session ? 'It is not paused.' : 'Nothing is paused.');
    this.actions().resume();
    return this.answer(describeSession(this._sources.session()), { running: sessionData(this._sources.session() ?? session) });
  }

  /**
   * The task named by its id, or by its key among the listed tasks and the
   * user's own work. A key several tasks share -- the user's own work all
   * carries one -- is refused with them, to choose by id.
   */
  private findTask(name: string): TaskDTO {
    const all = [...this._sources.listedTasks(), ...this._sources.ownTasks()];
    const byId = all.find(t => t.id === name);
    if (byId) return byId;
    const byKey = all.filter(t => t.key.toLowerCase() === name.toLowerCase());
    if (byKey.length === 1) return byKey[0];
    const projects = new Map(this._sources.projects().map(p => [p.id, p]));
    if (byKey.length > 1) {
      throw new AgentRefusal('invalid-request', `Several tasks are ${name}: start one by its id.\n`
        + byKey.map(t => `- ${describeTask(t, projects.get(t.projectId))}`).join('\n'));
    }
    throw new AgentRefusal('not-found', `No task ${name} in the lists: search with find_tasks.`);
  }

  // ---- days and weeks

  /**
   * A day's key from its name, on the app's clock: the client and the app
   * never disagree about which day "yesterday" is.
   */
  public resolveDay(name: string): string {
    const today = localDateKey(this._now());
    switch (name.toLowerCase()) {
      case 'today': return today;
      case 'yesterday': return addLocalDays(today, -1);
      case 'last-working-day': {
        for (let back = 1; back <= WORKING_DAY_LOOKBACK; back++) {
          const key = addLocalDays(today, -back);
          if (this._sources.isWorkingDay(key)) return key;
        }
        throw new AgentRefusal('not-found', `No working day in the last ${WORKING_DAY_LOOKBACK} days.`);
      }
      default:
        if (DATE_KEY.test(name) && localDateKey(new Date(`${name}T12:00:00`)) === name) return name;
        throw new AgentRefusal('invalid-request', `"${name}" is not a day: today, yesterday, last-working-day or YYYY-MM-DD.`);
    }
  }

  /** The Monday of the week named, by a word or any of its days. */
  public resolveWeek(name: string | undefined): string {
    const thisMonday = weekStartKey(localDateKey(this._now()));
    switch ((name ?? 'this-week').toLowerCase()) {
      case 'this-week': return thisMonday;
      case 'last-week': return addLocalDays(thisMonday, -7);
      default: return weekStartKey(this.resolveDay(name!));
    }
  }

  private tryRead<T>(read: () => T, otherwise: T): T {
    try {
      return read();
    } catch (err) {
      console.warn('[AgentService] A part of the answer could not be read:', err);
      return otherwise;
    }
  }
}

const weekDays = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addLocalDays(monday, i));

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function duration(seconds: number): AgentDuration {
  return { seconds, text: formatHoursAndMinutes(seconds) };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `14:05`, local. */
function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `2026-11-12T14:05:00+01:00`: local, with its offset (AGENT-INTERFACE.md §4). */
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${localDateKey(date)}T${clock(date)}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function weekdayName(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'long' });
}

function dayAndClock(utc: string): string {
  const date = new Date(utc);
  return `${localDateKey(date)} ${clock(date)}`;
}

function describeEntry(entry: WorklogDTO): string {
  const start = new Date(entry.startedAtUtc);
  const end = new Date(start.getTime() + entry.durationSeconds * 1000);
  const state = entry.syncState ? SYNC_STATE_WORDS[entry.syncState].label : null;
  const flags = [state, entry.fromInterruption ? 'from an interruption' : null, entry.adHoc ? 'own work' : null].filter(Boolean);
  return `${clock(start)}-${clock(end)} ${formatHoursAndMinutes(entry.durationSeconds)} ${entry.taskKey ?? entry.taskId} ${entry.taskTitle ?? ''}`.trimEnd()
    + `${flags.length ? ` [${flags.join(', ')}]` : ''}${entry.comment ? ` -- "${entry.comment}"` : ''}`;
}

function entryData(entry: WorklogDTO) {
  const start = new Date(entry.startedAtUtc);
  const end = new Date(start.getTime() + entry.durationSeconds * 1000);
  return {
    taskKey: entry.taskKey ?? entry.taskId,
    taskTitle: entry.taskTitle ?? null,
    project: entry.projectName ?? null,
    start: localIso(start),
    end: localIso(end),
    startUtc: start.toISOString(),
    ...duration(entry.durationSeconds),
    note: entry.comment,
    state: entry.syncState ?? null,
    stateText: entry.syncState ? SYNC_STATE_WORDS[entry.syncState].label : null,
    fromInterruption: entry.fromInterruption === true,
    ownWork: entry.adHoc === true
  };
}

function describeSession(session: ActiveSessionDTO | null): string {
  if (!session) return 'Nothing is being timed.';
  const state = session.status === 'PAUSED' ? 'paused' : 'running';
  const time = formatHoursAndMinutes(session.elapsedSeconds);
  const held = session.interruption;
  if (held) {
    const holds = [held.interruptedTaskKey, held.interruptedTaskTitle].filter(Boolean).join(' ');
    return `An interruption, "${held.title}", is ${state}: ${time} so far since ${clock(new Date(held.startedAtUtc))}.`
      + `${holds ? ` It holds ${holds}, paused.` : ''}`;
  }
  return `${session.taskKey} ${session.taskTitle} is ${state}: ${time} so far since ${clock(new Date(session.startTimeUtc))}.`
    + `${session.isAdHoc ? ' It is own work, kept in SprintTicker.' : ''}`;
}

function sessionData(session: ActiveSessionDTO) {
  const held = session.interruption;
  return {
    taskKey: session.taskKey,
    taskTitle: session.taskTitle,
    state: session.status === 'PAUSED' ? 'paused' : 'running',
    since: localIso(new Date(session.startTimeUtc)),
    ...duration(session.elapsedSeconds),
    ownWork: session.isAdHoc,
    interruption: held
      ? { title: held.title, since: localIso(new Date(held.startedAtUtc)), holds: held.interruptedTaskKey }
      : null
  };
}

const STATUS_WORDS: Record<TaskDTO['status'], string> = { todo: 'to do', in_progress: 'in progress', done: 'done' };

function describeTask(task: TaskDTO, project: ProjectDTO | undefined): string {
  const where = task.projectId === ADHOC_PROJECT_ID ? 'own work' : project?.name ?? 'no project';
  return `${task.key} ${task.title} (${where}, ${STATUS_WORDS[task.status] ?? task.status}; id ${task.id})`;
}

function taskData(task: TaskDTO, project: ProjectDTO | undefined) {
  return {
    key: task.key,
    id: task.id,
    title: task.title,
    project: task.projectId === ADHOC_PROJECT_ID ? null : project?.name ?? null,
    status: STATUS_WORDS[task.status] ?? task.status,
    ownWork: task.projectId === ADHOC_PROJECT_ID
  };
}
