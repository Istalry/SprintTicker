import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO, ArgumentException } from '../../shared/dtos';
import { ProviderRequestError } from './provider-errors';
import { providerFetch, ProviderFetchOptions } from './provider-http';
import { COLLECTION_PAGE_SIZE, MAX_COLLECTION_PAGES } from './provider-constants';
import { TaskScope, TaskScopeValue, parseTaskScope } from '../../shared/task-scope';
import { isJiraConfigured } from '../../shared/provider-settings';

/** What Jira Cloud returns from `/rest/api/3/project/search`. */
interface JiraProjectPage {
  values?: Array<{ id?: string | number; key?: string; name?: string }>;
  isLast?: boolean;
  total?: number;
}

/** What Jira Cloud returns from `/rest/api/3/search/jql`. */
interface JiraIssuePage {
  issues?: Array<{
    id?: string | number;
    key?: string;
    fields?: {
      summary?: string;
      project?: { id?: string | number };
      status?: { statusCategory?: { key?: string } };
    };
  }>;
  nextPageToken?: string;
  isLast?: boolean;
}

/**
 * Task provider adapter for Jira Cloud (REST API v3).
 *
 * Deliberately a sibling of {@link OpenProjectProvider} rather than a subclass.
 * What the two share is already shared -- `providerFetch` for timeouts,
 * classification and backoff, `ProviderRequestError` for reporting, `TaskScope`
 * for what to fetch -- and what is left is all dialect: HAL links against
 * token pagination, a filter array against JQL, plain-text comments against a
 * document tree. A base class would have to be parameterised on every one of
 * those, which is a more complicated way of writing this twice.
 */
export class JiraProvider implements ITaskProvider {
  public readonly providerId: string = 'jira';
  public readonly providerName: string = 'Jira Cloud';

  private _site: string = '';
  private _email: string = '';
  private _apiToken: string = '';
  private _taskScope: TaskScopeValue = TaskScope.ASSIGNED_TO_ME;
  private _taskQuery: string = '';
  private _transitionInProgress: string = '';
  private _transitionToTest: string = '';
  private _transitionToReview: string = '';
  private _defaultCompletionAction: string = 'to_test';

  /** Injected, for the reasons given on OpenProjectProvider's constructor. */
  private readonly _http: ProviderFetchOptions;

  constructor(http: ProviderFetchOptions = {}) {
    this._http = http;
  }

  public async initialize(credentials: Record<string, string>): Promise<boolean> {
    this._site = credentials.domain || credentials.jiraSite || '';
    this._email = credentials.jiraEmail || '';
    this._apiToken = credentials.apiToken || credentials.jiraApiToken || '';
    this._taskScope = parseTaskScope(credentials.jiraTaskScope);
    this._taskQuery = credentials.jiraTaskQuery || '';
    this._transitionInProgress = credentials.jiraTransitionInProgress || '';
    this._transitionToTest = credentials.jiraTransitionToTest || '';
    this._transitionToReview = credentials.jiraTransitionToReview || '';
    this._defaultCompletionAction = credentials.jiraCompletionAction || 'to_test';
    return true;
  }

  /**
   * Normalises a Jira site to an origin.
   *
   * Always `https`, with no opt-out: Jira Cloud is only served over TLS, so a
   * bare host is not ambiguous the way a self-hosted OpenProject is. The email
   * and API token travel in a Basic header on every request.
   */
  public static sanitizeSite(site: string): string {
    let clean = site.trim().replace(/\/+$/, '');
    if (!clean) return '';
    clean = clean.replace(/\/rest\/api\/\d+.*$/i, '').replace(/\/+$/, '');
    clean = clean.replace(/^http:\/\//i, 'https://');
    if (!/^https:\/\//i.test(clean)) clean = `https://${clean}`;
    return clean;
  }

  private getBaseUrl(): string {
    return JiraProvider.sanitizeSite(this._site);
  }

  /** Jira Cloud authenticates an API token as the password for the account email. */
  private getAuthHeader(): string {
    const pair = `${this._email.trim()}:${this._apiToken.trim()}`;
    return `Basic ${Buffer.from(pair).toString('base64')}`;
  }

  private requireConfigured(): void {
    if (!isJiraConfigured(this._site, this._email, this._apiToken)) {
      throw ProviderRequestError.notConfigured(this.providerId);
    }
  }

  private headers(): Record<string, string> {
    return { Authorization: this.getAuthHeader(), Accept: 'application/json' };
  }

  /**
   * Lists every project the account can see.
   *
   * `/project/search` pages on `startAt` and reports completion with `isLast`.
   * Failure and a short list are the same distinction as everywhere else here:
   * the sync worker prunes against what it receives, so an incomplete walk
   * throws rather than returning what it has (audit F-01).
   */
  public async getProjects(): Promise<ProjectDTO[]> {
    this.requireConfigured();

    const collected: ProjectDTO[] = [];
    let startAt = 0;

    for (let page = 1; page <= MAX_COLLECTION_PAGES; page++) {
      const url = new URL(`${this.getBaseUrl()}/rest/api/3/project/search`);
      url.searchParams.set('startAt', String(startAt));
      url.searchParams.set('maxResults', String(COLLECTION_PAGE_SIZE));

      const res = await providerFetch(
        this.providerId,
        url.toString(),
        { headers: this.headers() },
        'Fetching Jira projects',
        this._http
      );
      const body = await this.readJson<JiraProjectPage>(res, 'Fetching Jira projects');

      const values = body.values;
      if (!Array.isArray(values)) {
        throw new ProviderRequestError(
          this.providerId,
          'protocol',
          'Fetching Jira projects failed: response had no `values` array'
        );
      }

      for (const p of values) {
        if (p.id === undefined || p.id === null) continue;
        collected.push({
          id: String(p.id),
          key: p.key || String(p.id),
          name: p.name || p.key || String(p.id),
          providerId: this.providerId
        });
      }

      // An empty page ends the walk even if `isLast` is missing or wrong, so a
      // site that miscounts cannot spin us up to the page cap.
      if (body.isLast === true || values.length === 0) return collected;
      startAt += values.length;
    }

    throw new ProviderRequestError(
      this.providerId,
      'protocol',
      `Fetching Jira projects failed: did not finish within ${MAX_COLLECTION_PAGES} pages`
    );
  }

  /**
   * Lists the issues of one project, according to the configured task scope.
   *
   * Uses `/search/jql`, which pages on an opaque `nextPageToken`. The older
   * `/rest/api/3/search` took `startAt` and is deprecated; it is not used here
   * because a provider written against a deprecated endpoint is a migration
   * waiting to happen.
   */
  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    this.requireConfigured();
    if (!projectId) throw new ArgumentException('projectId is required to fetch tasks.');

    const jql = this.buildJql(projectId);
    const collected: TaskDTO[] = [];
    let pageToken: string | undefined;

    for (let page = 1; page <= MAX_COLLECTION_PAGES; page++) {
      const url = new URL(`${this.getBaseUrl()}/rest/api/3/search/jql`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('maxResults', String(COLLECTION_PAGE_SIZE));
      // Only the three fields that become a TaskDTO. The default is every
      // field on every issue, which for a busy project is megabytes of
      // description and changelog that this then discards.
      url.searchParams.set('fields', 'summary,status,project');
      if (pageToken) url.searchParams.set('nextPageToken', pageToken);

      const context = `Fetching Jira issues for project ${projectId}`;
      const res = await providerFetch(
        this.providerId,
        url.toString(),
        { headers: this.headers() },
        context,
        this._http
      );
      const body = await this.readJson<JiraIssuePage>(res, context);

      const issues = body.issues;
      if (!Array.isArray(issues)) {
        throw new ProviderRequestError(
          this.providerId,
          'protocol',
          `${context} failed: response had no \`issues\` array`
        );
      }

      for (const issue of issues) {
        if (issue.id === undefined || issue.id === null) continue;
        collected.push({
          id: String(issue.id),
          projectId,
          key: issue.key || String(issue.id),
          title: issue.fields?.summary || 'Untitled issue',
          status: JiraProvider.mapStatusCategory(issue.fields?.status?.statusCategory?.key)
        });
      }

      pageToken = body.nextPageToken;
      if (body.isLast === true || !pageToken || issues.length === 0) return collected;
    }

    throw new ProviderRequestError(
      this.providerId,
      'protocol',
      `Fetching Jira issues for project ${projectId} failed: did not finish within ${MAX_COLLECTION_PAGES} pages`
    );
  }

  /**
   * Maps a Jira status category onto the three states this app tracks.
   *
   * Category, not status name or id. Every Jira workflow, however customised,
   * files its statuses under one of three fixed categories, so this needs no
   * configuration at all -- unlike OpenProject, where the equivalent mapping
   * is three numeric ids the user has to look up and paste into Settings.
   */
  public static mapStatusCategory(categoryKey?: string): TaskDTO['status'] {
    switch (categoryKey) {
      case 'done':
        return 'done';
      case 'indeterminate':
        return 'in_progress';
      default:
        // `new`, and anything unrecognised. Treating an unknown category as
        // outstanding is the safe direction: it keeps the issue visible.
        return 'todo';
    }
  }

  /**
   * Renders the configured scope as JQL.
   *
   * `statusCategory != Done` rather than a list of status names, for the same
   * reason {@link mapStatusCategory} reads the category: it holds on every
   * workflow without being told what that workflow's statuses are called.
   */
  private buildJql(projectId: string): string {
    if (this._taskScope === TaskScope.CUSTOM) {
      const raw = this._taskQuery.trim();
      if (!raw) {
        throw new ProviderRequestError(
          this.providerId,
          'not_configured',
          'The Jira task scope is set to a custom query, but no JQL has been entered. ' +
            'Add one in Settings, or choose a different scope.'
        );
      }
      // Unlike an OpenProject filter, JQL cannot be validated here -- only Jira
      // parses JQL. That is safe rather than lax: invalid JQL is a 400, and
      // providerFetch turns a 400 into a throw, so a broken query fails the
      // sync instead of quietly returning no issues for the prune to act on.
      return raw;
    }

    const clauses = [`project = ${JiraProvider.quoteJqlValue(projectId)}`, 'statusCategory != Done'];
    if (this._taskScope === TaskScope.ASSIGNED_TO_ME) {
      clauses.push('assignee = currentUser()');
    }
    return `${clauses.join(' AND ')} ORDER BY updated DESC`;
  }

  /**
   * Quotes a value for use in JQL.
   *
   * The identifiers reaching this come from Jira's own project list, so this is
   * defence in depth rather than a live hole -- but a project key is a string
   * from a remote server interpolated into a query language, and that is
   * exactly the shape of thing that turns out to be user-editable later.
   */
  public static quoteJqlValue(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  /**
   * Logs time against an issue.
   *
   * Two format traps live here, both of which produce a 400 rather than
   * anything descriptive:
   *
   * - **`started` needs a numeric UTC offset and milliseconds** --
   *   `yyyy-MM-dd'T'HH:mm:ss.SSSZ`, where `Z` means `+0200`, not the letter.
   *   `toISOString()` is rejected outright. This is the same class of bug as
   *   the device's real-time clock (see `toIsoWithLocalOffset` in
   *   `busybar-driver.ts`), but not the same format: that one emits `+02:00`
   *   with a colon and no milliseconds, which Jira also rejects.
   * - **v3 comments are Atlassian Document Format**, not strings. A plain
   *   string is what the v2 API took, and passing one here fails validation.
   *
   * Not retried, for the same reason as OpenProject's worklog POST: there is no
   * idempotency key, so repeating it after a lost response bills the session
   * twice.
   */
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    this.requireConfigured();
    if (!payload.taskId) throw new ArgumentException('payload.taskId is required to log time.');
    if (payload.durationSeconds <= 0) {
      throw new ArgumentException(
        `payload.durationSeconds must be greater than zero (received ${payload.durationSeconds}).`
      );
    }

    const issueKey = payload.taskId;
    const url = `${this.getBaseUrl()}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`;
    const started = JiraProvider.toJiraTimestamp(
      payload.startedAtUtc ? new Date(payload.startedAtUtc) : new Date()
    );

    const res = await providerFetch(
      this.providerId,
      url,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Jira rounds to the minute internally; sending seconds is still
          // correct and avoids this doing its own lossy arithmetic.
          timeSpentSeconds: Math.round(payload.durationSeconds),
          started,
          comment: JiraProvider.toAdf(payload.comment || 'Logged via SprintTicker')
        })
      },
      `Logging time on ${issueKey}`,
      this._http
    );

    const body = await this.readJson<{ id?: string | number }>(res, `Logging time on ${issueKey}`);
    return {
      success: true,
      remoteWorklogId: body.id !== undefined && body.id !== null ? String(body.id) : `jira_wl_${Date.now()}`
    };
  }

  /**
   * Formats an instant the way Jira's worklog API demands.
   *
   * See {@link logTime} for why this cannot reuse the driver's offset helper.
   */
  public static toJiraTimestamp(date: Date): string {
    const pad = (value: number, width = 2): string =>
      String(Math.floor(Math.abs(value))).padStart(width, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
      `.${pad(date.getMilliseconds(), 3)}` +
      `${sign}${pad(offsetMinutes / 60)}${pad(offsetMinutes % 60)}`
    );
  }

  /** Wraps plain text as the minimal Atlassian Document Format paragraph. */
  public static toAdf(text: string): Record<string, unknown> {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
    };
  }

  /**
   * Moves an issue to the status mapped to `status`.
   *
   * Jira has no writable status field: a status is reached by executing a
   * *transition*, and which transitions exist depends on the issue's current
   * status and its project's workflow. So this reads the available transitions
   * for the issue and matches the configured one against them, rather than
   * PATCHing a status id the way the OpenProject adapter can.
   *
   * Configuration is by transition **name** as well as id, because a
   * transition id is per-workflow: the id that means "Start work" in one
   * project is meaningless in another, whereas the name is usually shared.
   */
  public async updateTaskStatus(
    taskId: string,
    status: 'in_progress' | 'to_test' | 'to_review' | 'done'
  ): Promise<boolean> {
    this.requireConfigured();
    if (!taskId) throw new ArgumentException('taskId is required to update a status.');

    const wanted = this.configuredTransitionFor(status);
    if (!wanted) {
      // Not configured is not a failure: the user simply has not mapped this
      // transition. Reported as `false` -- "this provider did not move it" --
      // which is what AdHoc returns for the same reason.
      console.warn(
        `[JiraProvider] No transition configured for '${status}'. ` +
          'Set one in Settings to have SprintTicker move the issue.'
      );
      return false;
    }

    const context = `Transitioning ${taskId}`;
    const listUrl = `${this.getBaseUrl()}/rest/api/3/issue/${encodeURIComponent(taskId)}/transitions`;
    const listRes = await providerFetch(
      this.providerId,
      listUrl,
      { headers: this.headers() },
      context,
      this._http
    );
    const available = await this.readJson<{
      transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }>;
    }>(listRes, context);

    const match = (available.transitions ?? []).find(
      t =>
        t.id === wanted ||
        t.name?.toLowerCase() === wanted.toLowerCase() ||
        t.to?.name?.toLowerCase() === wanted.toLowerCase()
    );

    if (!match?.id) {
      // Legitimately unavailable rather than broken: a workflow may not permit
      // this move from the issue's current status. Throwing would make the sync
      // queue retry a transition that cannot happen.
      console.warn(
        `[JiraProvider] Transition '${wanted}' is not available on ${taskId} from its current status.`
      );
      return false;
    }

    await providerFetch(
      this.providerId,
      listUrl,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: match.id } })
      },
      context,
      this._http
    );

    return true;
  }

  private configuredTransitionFor(status: 'in_progress' | 'to_test' | 'to_review' | 'done'): string {
    switch (status) {
      case 'in_progress':
        return this._transitionInProgress.trim();
      case 'to_test':
        return this._transitionToTest.trim();
      case 'to_review':
        return this._transitionToReview.trim();
      case 'done':
        return (
          this._defaultCompletionAction === 'to_review'
            ? this._transitionToReview
            : this._transitionToTest
        ).trim();
    }
  }

  /**
   * Not implemented, and says so rather than inventing a number.
   *
   * Jira has no single endpoint for "time I logged today": it needs a JQL
   * search for issues with a matching `worklogDate`, then a worklog fetch per
   * issue, which is an N+1 walk. Nothing calls this today -- the IPC channel
   * `provider:reconcile` is declared on the preload bridge but has no handler
   * in main -- so building that walk would be speculative work behind an
   * unreachable path. Zero is what AdHoc returns, and the local worklog table
   * remains the source of truth either way.
   */
  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }> {
    return { remoteLoggedTimeToday: 0 };
  }

  /**
   * Reads a JSON body, reporting a malformed one as a protocol failure.
   *
   * Never silently degrades to an empty object: the callers above feed the sync
   * worker's prune, so "I could not read the response" must not look like "the
   * remote has nothing".
   */
  private async readJson<T>(res: Response, context: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        `${context} failed: response body was not valid JSON`,
        { cause: err }
      );
    }
  }
}
