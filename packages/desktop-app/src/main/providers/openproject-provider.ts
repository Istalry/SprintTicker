import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO, OpStatusDTO, ArgumentException } from '../../shared/dtos';
import { ProviderEventDTO, ProviderEventKind } from '../../shared/provider-events';
import { priorityRankFromName } from './task-priority';
import { clampDescription, markdownToPlainText } from './task-description';
import { ProviderRequestError } from './provider-errors';
import { fetchOpenProjectCollection } from './openproject-collection';
import { providerFetch, ProviderFetchOptions } from './provider-http';
import { isOpenProjectConfigured } from '../../shared/provider-settings';
import { TaskScope, TaskScopeValue, parseTaskScope } from '../../shared/task-scope';
import { TaskOwnership, keptByDefaultScope, ownershipOf } from '../../shared/task-ownership';
import { localDateKey } from '../../shared/local-date';
import { WORKLOG_SEARCH_MARGIN_MS } from './provider-constants';
import { TaskClaim, UNNAMED_ASSIGNEE } from '../../shared/task-claim';
import { isOpenableTaskPage } from '../../shared/task-page';

/** A user's href; a group's or a placeholder user's has another path. */
const USER_HREF = /^\/api\/v3\/users\/(\d+)$/;

/**
 * OpenProject's notification reasons, as provider event kinds.
 * `responsible` is the accountable person, which reads as an assignment.
 * `processed` is OpenProject's name for a status change.
 */
const OPENPROJECT_REASON_KINDS: Record<string, ProviderEventKind | undefined> = {
  assigned: 'assigned',
  responsible: 'assigned',
  mentioned: 'mentioned',
  commented: 'commented',
  processed: 'status_changed',
  dateAlert: 'date_alert'
};

/**
 * Concrete task provider adapter for OpenProject API v3.
 */
export class OpenProjectProvider implements ITaskProvider {
  public readonly providerId: string = 'openproject';
  public readonly providerName: string = 'OpenProject';
  /** OpenProject takes an ISO 8601 duration and records whatever it is given. */
  public readonly minimumLoggableSeconds: number = 1;

  private _domain: string = '';
  private _apiKey: string = '';
  
  // Status Mappings (populated from settings)
  private _statusIdInProgress: string = '';
  private _statusIdToTest: string = '';
  private _statusIdToReview: string = '';
  private _defaultCompletionAction: string = 'to_test';
  private _taskScope: TaskScopeValue = TaskScope.ASSIGNED_TO_ME;
  private _taskQuery: string = '';
  /** The user's id (`/api/v3/users/me`): undefined until read. */
  private _myUserId: string | undefined = undefined;

  /**
   * How this provider reaches the network.
   *
   * Injected rather than reached for, because the ambient `fetch` is a
   * singleton in all but name and a test that has to stub a global cannot run
   * beside one that does not. The default is the real client, so production
   * callers construct it with no arguments.
   */
  private readonly _http: ProviderFetchOptions;

  constructor(http: ProviderFetchOptions = {}) {
    this._http = http;
  }

  /// <summary>
  /// Configures OpenProject domain, API credentials, and status ID mappings.
  /// </summary>
  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this._domain = credentials.domain || credentials.opDomain || '';
    this._apiKey = credentials.apiToken || credentials.apiKey || credentials.opApiKey || '';
    this._statusIdInProgress = credentials.opStatusInProgress || '';
    this._statusIdToTest = credentials.opStatusToTest || '';
    this._statusIdToReview = credentials.opStatusToReview || '';
    this._defaultCompletionAction = credentials.opCompletionAction || 'to_test';
    this._taskScope = parseTaskScope(credentials.opTaskScope);
    this._taskQuery = credentials.opTaskQuery || '';
    // Another instance, or another API key, is another user.
    this._myUserId = undefined;
    return true;
  }

  public static sanitizeDomain(domain: string): string {
    let clean = domain.trim().replace(/\/api\/v3\/?$/, '').replace(/\/$/, '');
    if (clean && !clean.startsWith('http://') && !clean.startsWith('https://')) {
      // Assume TLS for a bare host. The old default was `http://`, which sent
      // an API key -- a permanent credential, in a Basic header -- in clear
      // text to any instance whose scheme the user had not spelled out. A
      // self-hosted instance on plain HTTP still works; it just has to say so.
      clean = 'https://' + clean;
    }
    return clean;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`apikey:${this._apiKey.trim()}`).toString('base64')}`;
  }

  private getBaseUrl(): string {
    return OpenProjectProvider.sanitizeDomain(this._domain);
  }

  /**
   * Walks a collection on the configured instance.
   *
   * See {@link fetchOpenProjectCollection} for why this throws rather than
   * returning a partial list.
   */
  private fetchCollection(
    path: string,
    context: string,
    params: Record<string, string> = {}
  ): Promise<Array<Record<string, unknown>>> {
    return fetchOpenProjectCollection(
      this.providerId,
      this.getBaseUrl(),
      this.getAuthHeader(),
      path,
      context,
      params,
      this._http
    );
  }

  /// <summary>
  /// Converts duration in seconds to ISO 8601 duration format (e.g. PT1H30M, PT15M, PT45S).
  /// </summary>
  private formatIsoDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remSec = seconds % 60;

    let duration = 'PT';
    if (hours > 0) duration += `${hours}H`;
    if (minutes > 0) duration += `${minutes}M`;
    if (remSec > 0 || (hours === 0 && minutes === 0)) duration += `${remSec}S`;
    return duration;
  }

  /// <summary>
  /// Fetches accessible projects via OpenProject API v3 (/api/v3/projects).
  /// </summary>
  public async getProjects(): Promise<ProjectDTO[]> {
    if (!isOpenProjectConfigured(this._domain, this._apiKey)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }

    const elements = await this.fetchCollection('/api/v3/projects', 'Fetching projects');

    return elements
      .filter(p => p.templated !== true && !((p.name as string) || '').toLowerCase().includes('template'))
      .map(p => ({
        id: (p.id as number | string).toString(),
        key: (p.identifier as string) || `proj_${p.id}`,
        name: (p.name as string) || 'Untitled Project',
        // Without it the row took the column's default, 'local', and nothing
        // could tell an OpenProject project from one made in SprintTicker.
        providerId: this.providerId
      }));
  }

  /// <summary>
  /// Fetches active work packages for a project via OpenProject API v3 (/api/v3/work_packages).
  /// </summary>
  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    if (!isOpenProjectConfigured(this._domain, this._apiKey)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }

    // Built first: a custom query that does not parse throws before anything
    // is asked of the network.
    const filterSets = this.buildTaskFilters(projectId);
    const me = await this.myUserId();
    // One request per filter set, merged by id: a work package can answer two
    // of them, and the second answer is the same package.
    const byId = new Map<string, Record<string, unknown>>();
    for (const filters of filterSets) {
      const elements = await this.fetchCollection(
        '/api/v3/work_packages',
        `Fetching tasks for project ${projectId}`,
        { filters }
      );
      for (const element of elements) byId.set(String(element.id), element);
    }

    return [...byId.values()]
      .map(t => {
          const links = (t._links || {}) as Record<string, { href?: string | null; title?: string }>;
          const opStatusId = links.status?.href?.split('/').pop();
          const typeName = (links.type?.title as string) || '';

          let localStatus: 'todo' | 'in_progress' | 'done' = 'todo';

          if (opStatusId === this._statusIdInProgress) {
            localStatus = 'in_progress';
          } else if (opStatusId === this._statusIdToTest || opStatusId === this._statusIdToReview) {
            localStatus = 'done';
          }

          const rawId = (t.id as number | string).toString();
          const priorityRank = priorityRankFromName(links.priority?.title);
          // Already in every collection element, so this costs no request.
          const description = clampDescription(
            markdownToPlainText((t.description as { raw?: string } | undefined)?.raw)
          );
          // A user's href ends in their id; a group or a placeholder user is
          // assigned through its own path, and is never the user.
          const assigneeHref = links.assignee?.href ?? null;
          const assigneeId = assigneeHref ? (USER_HREF.exec(assigneeHref)?.[1] ?? assigneeHref) : null;
          const ownership = ownershipOf(assigneeId, me);
          const assigneeName = ownership === TaskOwnership.OTHER ? links.assignee?.title : undefined;
          return {
            id: rawId,
            projectId,
            key: `OP-${rawId}`,
            title: (t.subject as string) || 'Untitled Work Package',
            status: localStatus,
            ...(priorityRank !== undefined ? { priorityRank } : {}),
            ...(description ? { description } : {}),
            ...(ownership !== TaskOwnership.MINE ? { ownership } : {}),
            ...(assigneeName ? { assigneeName } : {}),
            _opType: typeName // Temporary prop for filtering
          };
      })
      .filter(t => t._opType.toLowerCase() !== 'epic' && t._opType.toLowerCase() !== 'milestone')
      .filter(t => this._taskScope !== TaskScope.ASSIGNED_TO_ME || keptByDefaultScope(t))
      .map(({ _opType, ...task }): TaskDTO => task);
  }

  /**
   * The user's id, from `/api/v3/users/me`, read once per configuration: a
   * work package names its assignee by href, and only the id says whether
   * that is the user. Throws when it cannot be read -- without it every task
   * would be filed under the wrong owner.
   */
  private async myUserId(): Promise<string> {
    if (this._myUserId) return this._myUserId;
    const context = 'Reading the OpenProject user';
    const res = await providerFetch(
      this.providerId,
      `${this.getBaseUrl()}/api/v3/users/me`,
      { headers: { Authorization: this.getAuthHeader(), Accept: 'application/json' } },
      context,
      this._http
    );
    const body = (await res.json()) as { id?: number | string };
    if (body.id === undefined || body.id === null || String(body.id) === '') {
      throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: response had no id`);
    }
    this._myUserId = String(body.id);
    return this._myUserId;
  }

  /**
   * Turns the configured task scope into OpenProject v3 `filters` arrays,
   * one request each.
   *
   * Built as data and serialised, rather than interpolated into a JSON string
   * literal as it used to be: a project identifier containing a quote produced
   * a filter that was not JSON, and OpenProject answers that with a 400 whose
   * body does not mention which filter was wrong.
   *
   * The project clause is not negotiable, nor is leaving closed work out -- a
   * scope decides *whose* work to show, not which project or whether to
   * include closed tickets, and dropping either would hand the sync worker a
   * task list from the wrong project.
   *
   * The default scope is three requests because v3 filters only AND: the
   * user's open work, open work nobody is assigned (`!*`, assignee IS NULL),
   * and a teammate's work in the configured In Progress status. With no such
   * status configured there is no way to ask for "in progress", and a
   * teammate's work is left out rather than all of it fetched.
   */
  private buildTaskFilters(projectId: string): string[] {
    if (this._taskScope === TaskScope.CUSTOM) {
      return [this.parseCustomTaskQuery()];
    }

    type Filter = Record<string, { operator: string; values: string[] }>;
    const project: Filter = { project: { operator: '=', values: [projectId] } };
    const open: Filter = { status: { operator: 'o', values: [] } };
    if (this._taskScope !== TaskScope.ASSIGNED_TO_ME) {
      return [JSON.stringify([project, open])];
    }

    const sets: Filter[][] = [
      [project, open, { assignee: { operator: '=', values: ['me'] } }],
      [project, open, { assignee: { operator: '!*', values: [] } }]
    ];
    if (/^\d+$/.test(this._statusIdInProgress)) {
      // `!` lets unassigned work through as well; its ownership is read from
      // the package itself, so that costs nothing but a duplicate.
      sets.push([
        project,
        { status: { operator: '=', values: [this._statusIdInProgress] } },
        { assignee: { operator: '!', values: ['me'] } }
      ]);
    }
    return sets.map(set => JSON.stringify(set));
  }

  /**
   * Validates the user's raw filter before it is sent.
   *
   * Throwing here is the whole point. A malformed filter makes OpenProject
   * return a 400, and an adapter that swallowed that and returned `[]` would
   * hand the sync worker an empty task list it treats as authoritative --
   * deleting every cached task for the project. That is audit F-01, and a
   * free-text field is the easiest way back into it.
   */
  private parseCustomTaskQuery(): string {
    const raw = this._taskQuery.trim();
    if (!raw) {
      throw new ProviderRequestError(
        this.providerId,
        'not_configured',
        'The OpenProject task scope is set to a custom query, but no query has been entered. ' +
          'Add one in Settings, or choose a different scope.'
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        'The custom OpenProject task query is not valid JSON. It must be a filter array, ' +
          'for example [{"assignee":{"operator":"=","values":["me"]}}].',
        { cause: err }
      );
    }

    if (!Array.isArray(parsed)) {
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        'The custom OpenProject task query must be a JSON array of filters, ' +
          `not ${typeof parsed}.`
      );
    }

    return JSON.stringify(parsed);
  }

  /**
   * Unread notifications created after `sinceUtc`, as provider events.
   *
   * Unread only: the API offers no filter or sort on time, and one the user has
   * already read in OpenProject is not news. Reasons that are not about the
   * user's attention -- `watched`, `subscribed`, `created`, `prioritized`,
   * `scheduled` -- are dropped here rather than offered as kinds nobody asked
   * for.
   *
   * Throws when the instance cannot be read; see ITaskProvider.
   */
  public async getEventsSince(sinceUtc: string): Promise<ProviderEventDTO[]> {
    if (!isOpenProjectConfigured(this._domain, this._apiKey)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }
    const since = Date.parse(sinceUtc);
    if (Number.isNaN(since)) {
      throw new ArgumentException(`sinceUtc is not a timestamp: ${sinceUtc}`);
    }

    const elements = await this.fetchCollection(
      '/api/v3/notifications',
      'Fetching notifications',
      { filters: JSON.stringify([{ readIAN: { operator: '=', values: ['f'] } }]) }
    );

    const base = this.getBaseUrl();
    const events: ProviderEventDTO[] = [];
    for (const n of elements) {
      const kind = OPENPROJECT_REASON_KINDS[(n.reason as string) || ''];
      const occurredAt = Date.parse((n.createdAt as string) || '');
      if (!kind || Number.isNaN(occurredAt) || occurredAt <= since) continue;

      const links = (n._links || {}) as Record<string, { href?: string | null; title?: string } | null>;
      const workPackageId = /\/api\/v3\/work_packages\/(\d+)$/.exec(links.resource?.href ?? '')?.[1];
      events.push({
        id: `openproject:${String(n.id)}`,
        providerId: this.providerId,
        kind,
        taskKey: workPackageId ? `OP-${workPackageId}` : '',
        taskTitle: links.resource?.title || (n.subject as string) || 'Work package',
        ...(links.actor?.title ? { actorName: links.actor.title } : {}),
        ...(workPackageId ? { url: `${base}/work_packages/${workPackageId}` } : {}),
        occurredAtUtc: new Date(occurredAt).toISOString()
      });
    }
    return events;
  }

  public getEventsInboxUrl(): string | null {
    return isOpenProjectConfigured(this._domain, this._apiKey) ? `${this.getBaseUrl()}/notifications` : null;
  }

  /// <summary>
  /// Reconciles remote time tracking metrics (total time logged today by the user).
  /// Answers `null` rather than a number whenever it could not find out.
  /// </summary>
  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number | null }> {
    if (!this._domain || !this._apiKey) return { remoteLoggedTimeToday: null };

    try {
      // The user's day, not UTC's: this filter is compared against spentOn
      // values written below, and the two must agree on which day it is.
      const today = localDateKey();
      const filter = `[{"spentOn":{"operator":"=","values":["${today}"]}},{"user":{"operator":"=","values":["me"]}}]`;
      const elements = await this.fetchCollection(
        '/api/v3/time_entries',
        'Reconciling remote time entries',
        { filters: filter }
      );

      let totalSeconds = 0;
      for (const entry of elements) {
        totalSeconds += OpenProjectProvider.parseIsoDurationSeconds(entry.hours as string);
      }
      return { remoteLoggedTimeToday: totalSeconds };
    } catch (err) {
      // `null`, not `0`: a caller cannot tell a zero it was told from a zero
      // invented after a failed fetch, and would render the second as "you
      // logged nothing today". The local worklog table remains the source of
      // truth either way.
      console.error('[OpenProjectProvider] Failed to reconcile remote state:', err);
      return { remoteLoggedTimeToday: null };
    }
  }

  /// <summary>
  /// Parses an ISO 8601 duration of the shape OpenProject returns (PTnHnMnS).
  /// </summary>
  private static parseIsoDurationSeconds(isoDuration: string): number {
    if (!isoDuration || !isoDuration.startsWith('PT')) return 0;
    const hours = /(\d+)H/.exec(isoDuration);
    const minutes = /(\d+)M/.exec(isoDuration);
    const seconds = /(\d+)S/.exec(isoDuration);
    return (
      (hours ? parseInt(hours[1], 10) : 0) * 3600 +
      (minutes ? parseInt(minutes[1], 10) : 0) * 60 +
      (seconds ? parseInt(seconds[1], 10) : 0)
    );
  }

  /// <summary>
  /// Synchronizes time tracking with OpenProject by creating a time entry on the target work package (POST /api/v3/time_entries).
  /// </summary>
  /**
   * Reports failure by throwing, like every other method here.
   *
   * It used to log and return `{ success: false }`, which reached the sync
   * queue as the string "Provider reported failure" -- the same row whether the
   * API key had been revoked or the wifi had dropped. The queue then retried a
   * revoked key on an exponential backoff until it exhausted the attempt budget
   * and parked the worklog, and nothing anywhere said why.
   *
   * The queue still decides what to do about a failure; it can now tell which
   * failure it is, because `ProviderRequestError` carries `isPermanent`.
   */
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    this.requireConfigured();
    OpenProjectProvider.validateWorklog(payload);

    const cleanTaskId = OpenProjectProvider.workPackageId(payload.taskId);
    // Deliberately not retried. `/api/v3/time_entries` has no idempotency
    // key, so a retry after a response that was sent but never received
    // bills the same session twice -- and an over-reported day is harder to
    // notice, and worse, than a missing entry the queue will resend.
    const res = await providerFetch(
      this.providerId,
      `${this.getBaseUrl()}/api/v3/time_entries`,
      {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({
          _links: {
            workPackage: { href: `/api/v3/work_packages/${cleanTaskId}` }
          },
          ...this.timeEntryFields(payload)
        })
      },
      `Logging time on WP #${cleanTaskId}`,
      this._http
    );

    const json = await res.json() as { id?: number };
    // No id is reported as none, not made up: see JiraProvider.logTime.
    const remoteWorklogId = json.id ? json.id.toString() : undefined;
    console.log(`[OpenProjectProvider] Successfully logged ${this.formatIsoDuration(payload.durationSeconds)} on WP #${cleanTaskId} (Entry ID: ${remoteWorklogId ?? 'none given'})`);
    return { success: true, remoteWorklogId };
  }

  /**
   * Finds the time entry whose comment carries `marker`, among the work
   * package's entries spent from the day before `startedAtUtc` to the day
   * after. `spentOn` is a day in this machine's timezone (see
   * {@link timeEntryFields}), and an edit may have moved it. Throws when the
   * entries cannot all be read: null means "not there".
   */
  public async findWorklog(taskId: string, startedAtUtc: string, marker: string): Promise<string | null> {
    this.requireConfigured();
    if (!taskId) throw new ArgumentException('taskId is required to find a time entry.');
    if (!marker) throw new ArgumentException('marker is required to find a time entry.');
    const start = Date.parse(startedAtUtc);
    if (Number.isNaN(start)) throw new ArgumentException(`startedAtUtc is not a timestamp: ${startedAtUtc}`);

    const workPackage = OpenProjectProvider.workPackageId(taskId);
    const spentOn = {
      spent_on: {
        operator: '<>d',
        values: [
          localDateKey(new Date(start - WORKLOG_SEARCH_MARGIN_MS)),
          localDateKey(new Date(start + WORKLOG_SEARCH_MARGIN_MS))
        ]
      }
    };
    const search = (byWorkPackage: object[]): Promise<Record<string, unknown>[]> =>
      this.fetchCollection('/api/v3/time_entries', `Looking for time entry ${marker} on ${taskId}`, {
        filters: JSON.stringify([...byWorkPackage, spentOn])
      });
    let entries: Record<string, unknown>[];
    try {
      // Since time can be logged on a meeting, an entry belongs to an
      // entity, and 17.9 knows no `work_package` filter: a real 17.9
      // instance answered it 400, so every resend's search failed there
      // (2026-10-16).
      entries = await search([
        { entity_type: { operator: '=', values: ['WorkPackage'] } },
        { entity_id: { operator: '=', values: [workPackage] } }
      ]);
    } catch (err) {
      // An instance from before entities knows `work_package` only, and
      // refuses an unknown filter with the same 400. Its message is in the
      // user's language, so the status is all there is to go on; a 400 for
      // any other reason fails the second search too, and that is thrown.
      if (!(err instanceof ProviderRequestError && err.status === 400)) throw err;
      entries = await search([{ work_package: { operator: '=', values: [workPackage] } }]);
    }
    const found = entries.find(entry => {
      const comment = entry.comment as { raw?: unknown } | undefined;
      return typeof comment?.raw === 'string' && comment.raw.includes(marker);
    });
    return found?.id !== undefined && found.id !== null ? String(found.id) : null;
  }

  /**
   * Rewrites a time entry's hours, day and comment. The work package is not
   * sent: an entry is not moved, only corrected. A PATCH of the same fields
   * changes nothing when repeated, so the queue may retry it.
   *
   * Sent without a `lockVersion`, which time entries do not need: measured
   * on a real OpenProject 17.9 instance (2026-10-16), which accepted it.
   */
  public async updateWorklog(taskId: string, remoteWorklogId: string, payload: WorklogPayload): Promise<void> {
    this.requireConfigured();
    if (!remoteWorklogId) throw new ArgumentException('remoteWorklogId is required to update a time entry.');
    OpenProjectProvider.validateWorklog({ ...payload, taskId });

    await providerFetch(
      this.providerId,
      this.timeEntryUrl(remoteWorklogId),
      { method: 'PATCH', headers: this.jsonHeaders(), body: JSON.stringify(this.timeEntryFields(payload)) },
      `Correcting time entry ${remoteWorklogId} on ${taskId}`,
      this._http
    );
  }

  /** Deletes a time entry. One already deleted answers 404, which is the outcome asked for. */
  public async deleteWorklog(taskId: string, remoteWorklogId: string): Promise<void> {
    this.requireConfigured();
    if (!taskId) throw new ArgumentException('taskId is required to delete a time entry.');
    if (!remoteWorklogId) throw new ArgumentException('remoteWorklogId is required to delete a time entry.');

    try {
      await providerFetch(
        this.providerId,
        this.timeEntryUrl(remoteWorklogId),
        { method: 'DELETE', headers: { Authorization: this.getAuthHeader(), Accept: 'application/json' } },
        `Deleting time entry ${remoteWorklogId} on ${taskId}`,
        this._http
      );
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 404) return;
      throw err;
    }
  }

  /**
   * The instance's one-off days off -- holidays -- in an inclusive range.
   * `/api/v3/days/non_working` lists no weekends (those are `/api/v3/days/week`,
   * and the user's own working days decide them here); unfiltered it answers
   * the current year only, which a week across New Year would miss.
   */
  public async getNonWorkingDays(fromKey: string, toKey: string): Promise<string[]> {
    this.requireConfigured();
    if (!fromKey || !toKey) throw new ArgumentException('A range of days is required.');
    const days = await this.fetchCollection('/api/v3/days/non_working', 'Reading the days off', {
      filters: JSON.stringify([{ date: { operator: '<>d', values: [fromKey, toKey] } }])
    });
    return days.map(day => day.date).filter((date): date is string => typeof date === 'string');
  }

  /** Where a work package stands: closed when its status says `isClosed`. */
  public async getTaskStanding(taskId: string): Promise<'open' | 'closed' | 'gone'> {
    this.requireConfigured();
    if (!taskId) throw new ArgumentException('taskId is required to read where a task stands.');

    const id = OpenProjectProvider.workPackageId(taskId);
    try {
      const res = await providerFetch(
        this.providerId,
        `${this.getBaseUrl()}/api/v3/work_packages/${encodeURIComponent(id)}`,
        { headers: { Authorization: this.getAuthHeader(), Accept: 'application/json' } },
        `Reading the status of work package ${id}`,
        this._http
      );
      const wp = (await res.json()) as { _embedded?: { status?: { isClosed?: boolean } } };
      // `isClosed` is set per status by the instance's administrator, so it
      // is the instance's own answer -- the name is not.
      return wp._embedded?.status?.isClosed === true ? 'closed' : 'open';
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 404) return 'gone';
      throw err;
    }
  }

  /** `<site>/work_packages/<id>`: the numeric id, which is what OpenProject's own links use. */
  public getTaskPageUrl(task: Pick<TaskDTO, 'id' | 'key'>): string | null {
    if (!this._domain || !this._apiKey || !task?.id) return null;
    const base = this.getBaseUrl();
    const url = `${base}/work_packages/${encodeURIComponent(OpenProjectProvider.workPackageId(task.id))}`;
    return isOpenableTaskPage(url, base) ? url : null;
  }

  /**
   * Assigns a work package nobody owns to the user, under its `lockVersion`:
   * OpenProject refuses (409) a write over an edit made since the read, so
   * an assignee set in between is never overwritten. On that refusal the
   * work package is read once more and decided again -- someone may have
   * taken it, or only changed something else. Measured on a real
   * OpenProject 17.9 instance (2026-10-16) with an edit played between the
   * read and the write:
   * the stale PATCH answered 409, and the second read found the new assignee.
   */
  public async assignToMe(taskId: string): Promise<TaskClaim> {
    this.requireConfigured();
    if (!taskId) throw new ArgumentException('taskId is required to assign a task.');

    const me = await this.myUserId();
    const id = OpenProjectProvider.workPackageId(taskId);
    const url = `${this.getBaseUrl()}/api/v3/work_packages/${encodeURIComponent(id)}`;
    const attempt = async (): Promise<TaskClaim> => {
      const res = await providerFetch(
        this.providerId,
        url,
        { headers: { Authorization: this.getAuthHeader(), Accept: 'application/json' } },
        `Reading the assignee of work package ${id}`,
        this._http
      );
      const wp = (await res.json()) as { lockVersion?: number; _links?: { assignee?: { href?: string | null; title?: string } } };
      const href = wp._links?.assignee?.href;
      if (href) {
        const assigneeId = USER_HREF.exec(href)?.[1] ?? href;
        return assigneeId === me
          ? { outcome: 'already_mine' }
          : { outcome: 'taken', assigneeName: wp._links?.assignee?.title?.trim() || UNNAMED_ASSIGNEE };
      }
      await providerFetch(
        this.providerId,
        url,
        {
          method: 'PATCH',
          headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ lockVersion: wp.lockVersion, _links: { assignee: { href: `/api/v3/users/${me}` } } })
        },
        `Assigning work package ${id} to the user`,
        this._http
      );
      return { outcome: 'assigned' };
    };

    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof ProviderRequestError && err.status === 409)) throw err;
      return attempt();
    }
  }

  private requireConfigured(): void {
    if (!isOpenProjectConfigured(this._domain, this._apiKey)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }
  }

  private jsonHeaders(): Record<string, string> {
    return {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  private timeEntryUrl(remoteWorklogId: string): string {
    return `${this.getBaseUrl()}/api/v3/time_entries/${encodeURIComponent(remoteWorklogId)}`;
  }

  /**
   * The fields a time entry is written with, on a POST and a PATCH alike.
   *
   * spentOn is a calendar day of work, so it is the local day the session
   * started -- taking the UTC prefix billed an evening session west of UTC
   * to tomorrow, and one started after local midnight east of UTC to
   * yesterday.
   */
  private timeEntryFields(payload: WorklogPayload): Record<string, unknown> {
    return {
      hours: this.formatIsoDuration(payload.durationSeconds),
      spentOn: payload.startedAtUtc ? localDateKey(new Date(payload.startedAtUtc)) : localDateKey(),
      comment: { raw: payload.comment || 'Logged via SprintTicker' }
    };
  }

  private static validateWorklog(payload: WorklogPayload): void {
    if (!payload.taskId) throw new ArgumentException('payload.taskId is required to log time.');
    if (payload.durationSeconds <= 0) {
      throw new ArgumentException(
        `payload.durationSeconds must be greater than zero (received ${payload.durationSeconds}).`
      );
    }
  }

  /** `OP-101` is the key shown; the API names work package 101. */
  private static workPackageId(taskId: string): string {
    return taskId.replace(/^OP-/, '');
  }

  /// <summary>
  /// Updates target work package status on OpenProject via PATCH /api/v3/work_packages/{id}.
  /// </summary>
  public async updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    if (!this._domain || !this._apiKey) return false;

    let targetStatusId = '';
    if (status === 'in_progress') {
      targetStatusId = this._statusIdInProgress;
    } else if (status === 'to_test') {
      targetStatusId = this._statusIdToTest;
    } else if (status === 'to_review') {
      targetStatusId = this._statusIdToReview;
    } else if (status === 'done') {
      targetStatusId = this._defaultCompletionAction === 'to_review' ? this._statusIdToReview : this._statusIdToTest;
    }

    // OpenProject identifies statuses numerically. This setting used to be
    // seeded with status *names* ('In progress'), and those rows still exist
    // in every database created before that default was removed. A name
    // reaches /api/v3/statuses/In%20progress and 404s, so the shape is checked
    // here in order to report what is actually wrong rather than a failed
    // request. An empty value fails the same test, which is the intended
    // "never configured" case.
    if (!/^\d+$/.test(targetStatusId)) {
      console.warn(
        `[OpenProjectProvider] No usable status ID for '${status}' (found ${JSON.stringify(targetStatusId)}). ` +
          'Choose the statuses in Settings -- OpenProject needs their numeric IDs, not their names.'
      );
      return false;
    }

    {
      const cleanTaskId = taskId.replace(/^OP-/, '');
      const getUrl = `${this.getBaseUrl()}/api/v3/work_packages/${cleanTaskId}`;
      const getRes = await providerFetch(
        this.providerId,
        getUrl,
        { headers: { 'Authorization': this.getAuthHeader(), 'Accept': 'application/json' } },
        `Reading WP #${cleanTaskId} for status update`,
        this._http
      );
      const wp = await getRes.json() as { lockVersion?: number };

      const patchUrl = `${this.getBaseUrl()}/api/v3/work_packages/${cleanTaskId}`;
      // Not retried either, though for the opposite reason to the worklog
      // POST: `lockVersion` is consumed by the write, so a second attempt
      // carries a stale one and OpenProject answers 409. Re-reading it here
      // would defeat the optimistic lock, which exists to stop this app
      // overwriting an edit somebody made in the browser meanwhile.
      await providerFetch(
        this.providerId,
        patchUrl,
        {
          method: 'PATCH',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            lockVersion: wp.lockVersion,
            _links: {
              status: { href: `/api/v3/statuses/${targetStatusId}` }
            }
          })
        },
        `Setting status of WP #${cleanTaskId}`,
        this._http
      );

      return true;
    }
  }

  /// <summary>
  /// Fetches available statuses statically from the given OpenProject domain using the provided API key.
  /// </summary>
  public static async fetchStatuses(
    domain: string,
    apiKey: string,
    http: ProviderFetchOptions = {}
  ): Promise<{ success: boolean; data?: OpStatusDTO[]; error?: string }> {
    if (!domain || !apiKey) return { success: false, error: 'Domain or API key is missing.' };

    try {
      const baseUrl = OpenProjectProvider.sanitizeDomain(domain);
      const authHeader = `Basic ${Buffer.from(`apikey:${apiKey.trim()}`).toString('base64')}`;
      const elements = await fetchOpenProjectCollection(
        'openproject',
        baseUrl,
        authHeader,
        '/api/v3/statuses',
        'Fetching statuses',
        {},
        http
      );

      return {
        success: true,
        data: elements.map(s => ({
          id: (s.id as number | string).toString(),
          name: (s.name as string) || 'Unknown',
          isClosed: !!s.isClosed
        }))
      };
    } catch (err) {
      // Reports the failure to the settings UI rather than rethrowing: this is
      // the credential probe, so "why did that not work" is exactly what the
      // user is waiting to be told.
      console.error('[OpenProjectProvider] Failed to fetch statuses statically:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown network error' };
    }
  }
}
