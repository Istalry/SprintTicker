import { ITaskProvider, TaskStanding, WorklogPayload } from './task-provider-interface';
import { ProviderId, providerDisplayName } from '../../shared/provider-names';
import { ArgumentException, ProjectDTO, TaskDTO } from '../../shared/dtos';
import { PROVIDER_EVENT_KINDS, ProviderEventDTO, ProviderEventKind } from '../../shared/provider-events';
import { ProviderRequestError } from './provider-errors';
import { providerFetch, ProviderFetchOptions } from './provider-http';
import { clampDescription } from './task-description';
import { TaskOwnership, keptByDefaultScope, ownershipOf } from '../../shared/task-ownership';
import { TaskClaim, UNNAMED_ASSIGNEE } from '../../shared/task-claim';
import { isOpenableTaskPage } from '../../shared/task-page';
import { localDateKey } from '../../shared/local-date';
import { CUSTOM_SERVER_CONTRACT, isCustomServerConfigured, sanitizeServerUrl } from '../../shared/custom-server';
import { COLLECTION_PAGE_SIZE, MAX_COLLECTION_PAGES } from './provider-constants';

/**
 * How long a read of `/capabilities` holds before it is read again: the
 * contract's "once an hour" (PROVIDER-API 5). A server that gains `events`
 * is heard within the hour, without a restart.
 */
export const CUSTOM_SERVER_CAPABILITIES_TTL_MS = 60 * 60 * 1000;

/**
 * The shortest worklog until the server has said its own: a minute, Jira's
 * floor, so a session sent before `/capabilities` answered is never one the
 * server refuses as too short. The real value replaces it at the first read.
 */
export const CUSTOM_SERVER_DEFAULT_MINIMUM_SECONDS = 60;

/** The optional parts of the contract (PROVIDER-API 5), as the server names them. */
export const CustomCapability = {
  ASSIGN: 'assign',
  TASK_STATE: 'task_state',
  CALENDAR: 'calendar',
  EVENTS: 'events',
  TODAY_TOTAL: 'today_total',
  TASK_BY_KEY: 'task_by_key'
} as const;

/** What `/capabilities` said, kept between reads. */
export interface CustomServerCapabilities {
  serverName: string;
  serverVersion: string;
  siteUrl: string;
  minimumWorklogSeconds: number;
  capabilities: ReadonlySet<string>;
  eventsInboxUrl?: string;
}

export interface CustomServerProviderOptions {
  http?: ProviderFetchOptions;
  /** For the `User-Agent` the contract asks for: `SprintTicker/<version>`. */
  appVersion?: string;
  /** Told the server's name whenever a read finds it changed, so Settings can show it before the next read. */
  onServerName?: (name: string) => void;
  /** Injected in tests; defaults to `Date.now`. */
  now?: () => number;
}

interface WireUser { id?: unknown; displayName?: unknown }
interface WireTask {
  id?: unknown;
  projectId?: unknown;
  key?: unknown;
  title?: unknown;
  status?: unknown;
  assignee?: WireUser | null;
  priorityRank?: unknown;
  description?: unknown;
  url?: unknown;
  state?: unknown;
}

const TASK_STATUSES: ReadonlySet<string> = new Set(['todo', 'in_progress', 'done']);
const EVENT_KINDS: ReadonlySet<string> = new Set(PROVIDER_EVENT_KINDS);

/**
 * A server of the user's own on the SprintTicker Provider API -- the contract
 * in `Documentation/PROVIDER-API.md`, which is the only source for what this
 * adapter may ask and expect. Where Jira and OpenProject need settings for
 * statuses and searches for their own entries, this one sends an intent and
 * a `clientRef`, and the server decides.
 *
 * **What the server can do is read, not configured.** The optional methods
 * of `ITaskProvider` are properties, set from `/capabilities`: a server
 * without `assign` has no `assignToMe`, so `providerCapabilities` -- which
 * reads the methods -- hides the control, as it does for a provider that
 * never had one. Until the first read they are all absent.
 */
export class CustomServerProvider implements ITaskProvider {
  public readonly providerId: string = ProviderId.CUSTOM;

  public getNonWorkingDays?: (fromKey: string, toKey: string) => Promise<string[]>;
  public getTaskByKey?: (key: string) => Promise<TaskDTO | null>;
  public assignToMe?: (taskId: string) => Promise<TaskClaim>;
  public getTaskStanding?: (taskId: string) => Promise<TaskStanding>;
  public getEventsSince?: (sinceUtc: string) => Promise<ProviderEventDTO[]>;
  public getEventsInboxUrl?: () => string | null;

  private _baseUrl = '';
  private _token = '';
  /** The name stored from an earlier read, shown until this run reads its own. */
  private _knownServerName = '';
  private _capabilities: CustomServerCapabilities | null = null;
  private _capabilitiesReadAt = 0;
  private _myUserId: string | undefined;
  /** Each listed task's page, from its `url`: `getTaskPageUrl` is synchronous. */
  private readonly _taskUrls = new Map<string, string>();
  private readonly _http: ProviderFetchOptions;
  private readonly _userAgent: string;
  private readonly _onServerName?: (name: string) => void;
  private readonly _now: () => number;

  constructor(options: CustomServerProviderOptions = {}) {
    this._http = options.http ?? {};
    this._userAgent = `SprintTicker/${options.appVersion?.trim() || '0.0.0'}`;
    this._onServerName = options.onServerName;
    this._now = options.now ?? Date.now;
  }

  /** The server's own name (`server.name`), or "Your server" before one is known. */
  public get providerName(): string {
    return providerDisplayName(this.providerId, this._capabilities?.serverName || this._knownServerName);
  }

  /** The server's `minimumWorklogSeconds`; a minute until it has answered. */
  public get minimumLoggableSeconds(): number {
    return this._capabilities?.minimumWorklogSeconds ?? CUSTOM_SERVER_DEFAULT_MINIMUM_SECONDS;
  }

  /** What the last read of `/capabilities` said, or null before one succeeded. */
  public get capabilities(): CustomServerCapabilities | null {
    return this._capabilities;
  }

  /**
   * Stores the address and token, and reads `/capabilities` when both are
   * there. A read that fails is logged and tried again at the next request:
   * the app starts offline as often as not.
   */
  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this._baseUrl = sanitizeServerUrl(credentials.baseUrl);
    this._token = (credentials.apiToken ?? '').trim();
    this._knownServerName = (credentials.serverName ?? '').trim();
    // Another server, or another token, is another user and other capabilities.
    this._myUserId = undefined;
    this._taskUrls.clear();
    this.applyCapabilities(null);
    if (!this.isConfigured()) return true;
    try {
      await this.readCapabilities();
    } catch (err) {
      console.warn(`[CustomServerProvider] Reading /capabilities failed; tried again at the next request: ${errorText(err)}`);
    }
    return true;
  }

  /** The account's name, from `/me`: Test connection's "Connected as". */
  public async getUserName(): Promise<string> {
    const user = await this.readMe();
    return user.displayName;
  }

  /**
   * `/capabilities` and `/me` together, for Test connection: the server's
   * name and the user's. Throws like any read.
   */
  public async testConnection(): Promise<{ serverName: string; userName: string }> {
    const caps = await this.readCapabilities();
    const user = await this.readMe();
    return { serverName: caps.serverName, userName: user.displayName };
  }

  public async getProjects(): Promise<ProjectDTO[]> {
    await this.ensureCapabilities();
    // `/me` first, every sync: it is the contract's check that the token
    // still works (6.1), before a list whose absence would empty the user's.
    await this.readMe();
    const items = await this.readCollection('/projects', 'Fetching projects');
    return items.map((p, i) => {
      const id = requireString(p.id, `project ${i} has no id`, this.providerId);
      return {
        id,
        key: typeof p.key === 'string' && p.key.trim() ? p.key.trim() : id,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : id,
        providerId: this.providerId
      };
    });
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    if (!projectId) throw new ArgumentException('projectId is required to read its tasks.');
    await this.ensureCapabilities();
    const me = await this.myUserId();
    const items = await this.readCollection(`/projects/${encodeURIComponent(projectId)}/tasks`, `Fetching the tasks of project ${projectId}`);
    return items
      .map(item => this.toTask(item as WireTask, me, projectId))
      .filter(task => task.state !== 'closed')
      .map(({ task }) => task)
      // The client applies the default scope after reading too (PROVIDER-API 6.3).
      .filter(task => keptByDefaultScope(task));
  }

  /**
   * Today's total on the server (`today_total`), or null without the
   * capability or when the read fails -- never a zero it was not told.
   */
  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number | null }> {
    if (!this.isConfigured() || !this.has(CustomCapability.TODAY_TOTAL)) return { remoteLoggedTimeToday: null };
    try {
      const body = await this.json<{ totalSeconds?: unknown }>('GET', `/worklogs/summary?day=${localDateKey()}`, 'Reading today\'s total');
      return { remoteLoggedTimeToday: typeof body.totalSeconds === 'number' && body.totalSeconds >= 0 ? body.totalSeconds : null };
    } catch (err) {
      console.warn(`[CustomServerProvider] Reading today's total failed: ${errorText(err)}`);
      return { remoteLoggedTimeToday: null };
    }
  }

  /**
   * `POST /worklogs`, idempotent on `clientRef` (6.4): a resend after a lost
   * answer is the same worklog, so the server -- not a search here -- keeps
   * the time from being billed twice. Not retried by the HTTP layer even so:
   * the queue's backoff is the retry, and it resends the same `clientRef`.
   */
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    this.validateWorklog(payload);
    if (!payload.clientRef) throw new ArgumentException('A worklog for a SprintTicker server needs its clientRef.');
    await this.ensureCapabilities();
    const body = await this.json<{ id?: unknown }>('POST', '/worklogs', `Logging time on ${payload.taskId}`, {
      clientRef: payload.clientRef,
      taskId: payload.taskId,
      startedAt: wholeSecondsUtc(payload.startedAtUtc),
      // The user's day, from their clock: the server must not recompute it.
      day: localDateKey(new Date(payload.startedAtUtc)),
      durationSeconds: Math.round(payload.durationSeconds),
      comment: payload.comment
    });
    const remoteWorklogId = typeof body.id === 'string' && body.id ? body.id : undefined;
    return { success: true, remoteWorklogId };
  }

  /**
   * The worklog a send made, by its `clientRef` (6.5). `marker` is how Jira
   * and OpenProject find theirs; here the reference is exact, and the marker
   * unused.
   */
  public async findWorklog(_taskId: string, _startedAtUtc: string, _marker: string, clientRef?: string): Promise<string | null> {
    if (!clientRef) throw new ArgumentException('A SprintTicker server finds a worklog by its clientRef.');
    await this.ensureCapabilities();
    const items = await this.readCollection(`/worklogs?clientRef=${encodeURIComponent(clientRef)}`, `Looking for worklog ${clientRef}`);
    const found = items.find(w => w.clientRef === clientRef);
    return found && typeof found.id === 'string' ? found.id : null;
  }

  /** `PATCH /worklogs/{id}`: start, day, duration and comment; never the task (6.6). */
  public async updateWorklog(_taskId: string, remoteWorklogId: string, payload: WorklogPayload): Promise<void> {
    if (!remoteWorklogId) throw new ArgumentException('remoteWorklogId is required to correct a worklog.');
    this.validateWorklog(payload);
    await this.ensureCapabilities();
    await this.request('PATCH', `/worklogs/${encodeURIComponent(remoteWorklogId)}`, `Correcting worklog ${remoteWorklogId}`, {
      startedAt: wholeSecondsUtc(payload.startedAtUtc),
      day: localDateKey(new Date(payload.startedAtUtc)),
      durationSeconds: Math.round(payload.durationSeconds),
      comment: payload.comment
    });
  }

  /** `DELETE /worklogs/{id}`; a 404 is the outcome asked for (6.7). */
  public async deleteWorklog(_taskId: string, remoteWorklogId: string): Promise<void> {
    if (!remoteWorklogId) throw new ArgumentException('remoteWorklogId is required to delete a worklog.');
    await this.ensureCapabilities();
    try {
      await this.request('DELETE', `/worklogs/${encodeURIComponent(remoteWorklogId)}`, `Deleting worklog ${remoteWorklogId}`);
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 404) return;
      throw err;
    }
  }

  /**
   * An intent, never a status (6.8): `start` for In Progress, `finish` for
   * any end as done -- the server's workflow chooses where finished goes,
   * so `doneState` has nothing to name here. A move the workflow refuses
   * (409) answers false, like a transition Jira's workflow lacks.
   */
  public async updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    if (!taskId) throw new ArgumentException('taskId is required to move a task.');
    if (!this.isConfigured()) return false;
    await this.ensureCapabilities();
    const intent = status === 'in_progress' ? 'start' : 'finish';
    try {
      await this.request('POST', `/tasks/${encodeURIComponent(taskId)}/transitions`, `Sending ${intent} for ${taskId}`, { intent });
      return true;
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 409) {
        console.warn(`[CustomServerProvider] The server refused ${intent} for ${taskId}: ${err.message}`);
        return false;
      }
      throw err;
    }
  }

  /** The task's `url`, only while it is on the server's own site (5). */
  public getTaskPageUrl(task: Pick<TaskDTO, 'id' | 'key'>): string | null {
    const url = task?.id ? this._taskUrls.get(task.id) : undefined;
    const site = this._capabilities?.siteUrl;
    if (!url || !site) return null;
    return isOpenableTaskPage(url, site) ? url : null;
  }

  // ----- optional parts, attached by applyCapabilities -----

  /** `assign` (7.1): the server checks and writes in one step, so a task taken meanwhile stays taken. */
  private async assign(taskId: string): Promise<TaskClaim> {
    if (!taskId) throw new ArgumentException('taskId is required to assign a task.');
    const conflict: { body?: unknown } = {};
    try {
      const body = await this.json<{ outcome?: unknown }>(
        'POST',
        `/tasks/${encodeURIComponent(taskId)}/assignment`,
        `Assigning ${taskId}`,
        { ifUnassigned: true },
        conflict
      );
      if (body.outcome === 'assigned' || body.outcome === 'already_mine') return { outcome: body.outcome };
      throw new ProviderRequestError(this.providerId, 'protocol', `Assigning ${taskId} failed: unknown outcome ${String(body.outcome)}`);
    } catch (err) {
      const taken = conflict.body as { outcome?: unknown; task?: WireTask } | undefined;
      if (err instanceof ProviderRequestError && err.status === 409 && taken?.outcome === 'taken') {
        const name = taken.task?.assignee?.displayName;
        return { outcome: 'taken', assigneeName: typeof name === 'string' && name.trim() ? name.trim() : UNNAMED_ASSIGNEE };
      }
      throw err;
    }
  }

  /** `task_state` (7.2): closed, gone (404), or open and whose. */
  private async standing(taskId: string): Promise<TaskStanding> {
    if (!taskId) throw new ArgumentException('taskId is required to read where a task stands.');
    const me = await this.myUserId();
    try {
      const wire = await this.json<WireTask>('GET', `/tasks/${encodeURIComponent(taskId)}`, `Reading where ${taskId} stands`);
      if (wire.state === 'closed') return { state: 'closed' };
      const assigneeId = typeof wire.assignee?.id === 'string' ? wire.assignee.id : null;
      const ownership = ownershipOf(assigneeId, me);
      const name = typeof wire.assignee?.displayName === 'string' ? wire.assignee.displayName.trim() : '';
      return { state: 'open', ownership, ...(ownership === TaskOwnership.OTHER && name ? { assigneeName: name } : {}) };
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 404) return { state: 'gone' };
      throw err;
    }
  }

  /** `calendar` (7.3): days off, both ends included. */
  private async daysOff(fromKey: string, toKey: string): Promise<string[]> {
    if (!fromKey || !toKey) throw new ArgumentException('A range of days is required.');
    const body = await this.json<{ days?: unknown }>(
      'GET',
      `/calendar/non-working-days?from=${encodeURIComponent(fromKey)}&to=${encodeURIComponent(toKey)}`,
      'Reading the days off'
    );
    if (!Array.isArray(body.days)) throw new ProviderRequestError(this.providerId, 'protocol', 'Reading the days off failed: no days in the answer');
    return body.days.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  }

  /** `task_by_key` (7.9): null for a 404, which is "no such key" and "not yours" alike. */
  private async byKey(key: string): Promise<TaskDTO | null> {
    const typed = (key ?? '').trim();
    if (!typed) throw new ArgumentException('A key is required to fetch a task.');
    const me = await this.myUserId();
    try {
      const wire = await this.json<WireTask>('GET', `/tasks?key=${encodeURIComponent(typed)}`, `Fetching ${typed}`);
      const projectId = requireString(wire.projectId, `${typed} named no project`, this.providerId);
      return this.toTask(wire, me, projectId).task;
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * `events` (7.4). `since` is inclusive on the server; the poller drops the
   * ids it has shown, so an event sharing the cursor's second is not lost.
   * Kinds this client does not know are dropped (3.5).
   */
  private async events(sinceUtc: string): Promise<ProviderEventDTO[]> {
    if (Number.isNaN(Date.parse(sinceUtc))) throw new ArgumentException(`sinceUtc is not a timestamp: ${sinceUtc}`);
    const items = await this.readCollection(`/events?since=${encodeURIComponent(wholeSecondsUtc(sinceUtc))}`, 'Fetching notifications');
    const site = this._capabilities?.siteUrl ?? '';
    const events: ProviderEventDTO[] = [];
    for (const e of items) {
      const kind = typeof e.kind === 'string' && EVENT_KINDS.has(e.kind) ? (e.kind as ProviderEventKind) : null;
      const occurredAt = typeof e.occurredAt === 'string' ? Date.parse(e.occurredAt) : NaN;
      const task = (e.task ?? {}) as { key?: unknown; title?: unknown };
      if (!kind || typeof e.id !== 'string' || Number.isNaN(occurredAt)) continue;
      const actor = (e.actor ?? {}) as WireUser;
      const url = typeof e.url === 'string' && isOpenableTaskPage(e.url, site) ? e.url : undefined;
      events.push({
        id: `${this.providerId}:${e.id}`,
        providerId: this.providerId,
        kind,
        taskKey: typeof task.key === 'string' ? task.key : '',
        taskTitle: typeof task.title === 'string' && task.title ? task.title : 'Task',
        ...(typeof actor.displayName === 'string' && actor.displayName.trim() ? { actorName: actor.displayName.trim() } : {}),
        ...(typeof e.summary === 'string' && e.summary.trim() ? { summary: e.summary.trim() } : {}),
        ...(url ? { url } : {}),
        occurredAtUtc: new Date(occurredAt).toISOString()
      });
    }
    return events;
  }

  private inboxUrl(): string | null {
    const url = this._capabilities?.eventsInboxUrl;
    const site = this._capabilities?.siteUrl;
    return url && site && isOpenableTaskPage(url, site) ? url : null;
  }

  // ----- plumbing -----

  private isConfigured(): boolean {
    return isCustomServerConfigured(this._baseUrl, this._token);
  }

  private has(capability: string): boolean {
    return this._capabilities?.capabilities.has(capability) === true;
  }

  /** Reads `/capabilities` when it never answered, or answered over an hour ago. */
  private async ensureCapabilities(): Promise<CustomServerCapabilities> {
    if (!this.isConfigured()) throw ProviderRequestError.notConfigured(this.providerId);
    if (this._capabilities && this._now() - this._capabilitiesReadAt < CUSTOM_SERVER_CAPABILITIES_TTL_MS) {
      return this._capabilities;
    }
    return this.readCapabilities();
  }

  private async readCapabilities(): Promise<CustomServerCapabilities> {
    if (!this.isConfigured()) throw ProviderRequestError.notConfigured(this.providerId);
    const context = 'Reading the server\'s capabilities';
    const body = await this.json<{
      contract?: unknown;
      server?: { name?: unknown; version?: unknown };
      siteUrl?: unknown;
      minimumWorklogSeconds?: unknown;
      capabilities?: unknown;
      eventsInboxUrl?: unknown;
    }>('GET', '/capabilities', context);
    if (body.contract !== CUSTOM_SERVER_CONTRACT) {
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        `${context} failed: the server speaks contract ${String(body.contract)}, and this SprintTicker speaks ${CUSTOM_SERVER_CONTRACT}`
      );
    }
    const serverName = typeof body.server?.name === 'string' ? body.server.name.trim() : '';
    const siteUrl = typeof body.siteUrl === 'string' ? body.siteUrl.trim() : '';
    if (!serverName || !siteUrl) {
      throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: server.name and siteUrl are required`);
    }
    const minimum = typeof body.minimumWorklogSeconds === 'number' && body.minimumWorklogSeconds >= 1
      ? Math.ceil(body.minimumWorklogSeconds)
      : CUSTOM_SERVER_DEFAULT_MINIMUM_SECONDS;
    const caps: CustomServerCapabilities = {
      serverName,
      serverVersion: typeof body.server?.version === 'string' ? body.server.version : '',
      siteUrl,
      minimumWorklogSeconds: minimum,
      capabilities: new Set(Array.isArray(body.capabilities) ? body.capabilities.filter((c): c is string => typeof c === 'string') : []),
      ...(typeof body.eventsInboxUrl === 'string' && body.eventsInboxUrl ? { eventsInboxUrl: body.eventsInboxUrl } : {})
    };
    const nameChanged = serverName !== (this._capabilities?.serverName || this._knownServerName);
    this.applyCapabilities(caps);
    this._capabilitiesReadAt = this._now();
    if (nameChanged) this._onServerName?.(serverName);
    return caps;
  }

  /** Attaches the optional methods the server declared, and detaches the rest. */
  private applyCapabilities(caps: CustomServerCapabilities | null): void {
    this._capabilities = caps;
    const has = (c: string): boolean => caps?.capabilities.has(c) === true;
    this.assignToMe = has(CustomCapability.ASSIGN) ? id => this.assign(id) : undefined;
    this.getTaskStanding = has(CustomCapability.TASK_STATE) ? id => this.standing(id) : undefined;
    this.getNonWorkingDays = has(CustomCapability.CALENDAR) ? (from, to) => this.daysOff(from, to) : undefined;
    this.getTaskByKey = has(CustomCapability.TASK_BY_KEY) ? key => this.byKey(key) : undefined;
    this.getEventsSince = has(CustomCapability.EVENTS) ? since => this.events(since) : undefined;
    this.getEventsInboxUrl = has(CustomCapability.EVENTS) ? () => this.inboxUrl() : undefined;
  }

  private async readMe(): Promise<{ id: string; displayName: string }> {
    if (!this.isConfigured()) throw ProviderRequestError.notConfigured(this.providerId);
    const body = await this.json<WireUser>('GET', '/me', 'Reading the user');
    const id = requireString(body.id, 'the user had no id', this.providerId);
    this._myUserId = id;
    const name = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : id;
    return { id, displayName: name };
  }

  private async myUserId(): Promise<string> {
    return this._myUserId ?? (await this.readMe()).id;
  }

  private toTask(wire: WireTask, me: string, projectId: string): { task: TaskDTO; state: string } {
    const id = requireString(wire.id, 'a task had no id', this.providerId);
    const status = typeof wire.status === 'string' && TASK_STATUSES.has(wire.status) ? (wire.status as TaskDTO['status']) : null;
    if (!status) {
      throw new ProviderRequestError(this.providerId, 'protocol', `Reading task ${id} failed: status ${String(wire.status)} is not todo, in_progress or done`);
    }
    if (wire.assignee === undefined) {
      // Always present, null for nobody (4.3): absent cannot be told from "nobody".
      throw new ProviderRequestError(this.providerId, 'protocol', `Reading task ${id} failed: it has no assignee field`);
    }
    const assigneeId = typeof wire.assignee?.id === 'string' ? wire.assignee.id : null;
    const ownership = ownershipOf(assigneeId, me);
    const assigneeName = ownership === TaskOwnership.OTHER && typeof wire.assignee?.displayName === 'string'
      ? wire.assignee.displayName.trim()
      : '';
    const rank = typeof wire.priorityRank === 'number' && Number.isInteger(wire.priorityRank) && wire.priorityRank >= 0 && wire.priorityRank <= 4
      ? wire.priorityRank
      : undefined;
    const description = typeof wire.description === 'string' ? clampDescription(wire.description) : undefined;
    if (typeof wire.url === 'string' && wire.url) this._taskUrls.set(id, wire.url);
    const task: TaskDTO = {
      id,
      projectId: typeof wire.projectId === 'string' && wire.projectId ? wire.projectId : projectId,
      key: typeof wire.key === 'string' && wire.key.trim() ? wire.key.trim() : id,
      title: typeof wire.title === 'string' && wire.title.trim() ? wire.title.trim() : id,
      status,
      ownership,
      ...(rank !== undefined ? { priorityRank: rank } : {}),
      ...(description ? { description } : {}),
      ...(assigneeName ? { assigneeName } : {})
    };
    return { task, state: typeof wire.state === 'string' ? wire.state : 'open' };
  }

  /**
   * Walks a collection (3.7) to its end. A page that fails fails the read,
   * and a walk that never ends is refused: a part of a list is never used.
   */
  private async readCollection(path: string, context: string): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    const separator = path.includes('?') ? '&' : '?';
    let cursor: string | null = null;
    for (let page = 0; page < MAX_COLLECTION_PAGES; page++) {
      const query: string = `${separator}limit=${COLLECTION_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body: { items?: unknown; nextCursor?: unknown } = await this.json<{ items?: unknown; nextCursor?: unknown }>('GET', `${path}${query}`, context);
      if (!Array.isArray(body.items)) {
        throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: the answer had no items`);
      }
      for (const item of body.items) {
        if (item && typeof item === 'object') items.push(item as Record<string, unknown>);
      }
      if (typeof body.nextCursor !== 'string' || !body.nextCursor) return items;
      cursor = body.nextCursor;
    }
    throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: more than ${MAX_COLLECTION_PAGES} pages`);
  }

  private async json<T>(method: string, path: string, context: string, body?: unknown, conflict?: { body?: unknown }): Promise<T> {
    const res = await this.request(method, path, context, body, conflict);
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: the answer was not JSON`, { cause: err });
    }
  }

  /**
   * One request with the contract's headers (3.2). `conflict` receives the
   * body of a 409, which `providerFetch` reads only for its message: the
   * assignment's `taken` carries who has the task.
   */
  private async request(method: string, path: string, context: string, body?: unknown, conflict?: { body?: unknown }): Promise<Response> {
    if (!this.isConfigured()) throw ProviderRequestError.notConfigured(this.providerId);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this._token}`,
      Accept: 'application/json',
      'User-Agent': this._userAgent
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    const baseFetch = this._http.fetchFn ?? globalThis.fetch;
    const fetchFn: typeof fetch = conflict
      ? async (input, init) => {
          const res = await baseFetch(input, init);
          if (res.status === 409 && typeof res.clone === 'function') {
            conflict.body = await res.clone().json().catch(() => undefined);
          }
          return res;
        }
      : baseFetch;
    return providerFetch(
      this.providerId,
      `${this._baseUrl}${path}`,
      { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
      context,
      { ...this._http, fetchFn }
    );
  }

  private validateWorklog(payload: WorklogPayload): void {
    if (!payload) throw new ArgumentException('A worklog is required.');
    if (!payload.taskId) throw new ArgumentException('A worklog needs its task.');
    if (Number.isNaN(Date.parse(payload.startedAtUtc))) throw new ArgumentException(`startedAtUtc is not a timestamp: ${payload.startedAtUtc}`);
    if (!(payload.durationSeconds > 0)) throw new ArgumentException('A worklog needs a positive duration.');
  }
}

/** Whole seconds, with `Z` (3.4). */
function wholeSecondsUtc(iso: string): string {
  return new Date(Math.floor(Date.parse(iso) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function requireString(value: unknown, problem: string, providerId: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new ProviderRequestError(providerId, 'protocol', `Reading the server failed: ${problem}`);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
