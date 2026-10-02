import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { ProjectDTO, TaskDTO, ArgumentException } from '../../shared/dtos';
import { ProviderEventDTO, PROVIDER_EVENT_SUMMARY_MAX_CHARS } from '../../shared/provider-events';
import { priorityRankFromName } from './task-priority';
import { adfMentionsAccount, adfToPlainText, clampDescription } from './task-description';
import { ProviderRequestError } from './provider-errors';
import { providerFetch, ProviderFetchOptions } from './provider-http';
import {
  COLLECTION_PAGE_SIZE,
  JIRA_AUTH_CHECK_TTL_MS,
  JIRA_EVENT_WINDOW_MARGIN_MINUTES,
  MAX_COLLECTION_PAGES
} from './provider-constants';
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
      /** Atlassian Document Format; null when the issue has none. */
      description?: unknown;
      project?: { id?: string | number };
      status?: { name?: string; statusCategory?: { key?: string } };
      priority?: { name?: string } | null;
    };
  }>;
  nextPageToken?: string;
  isLast?: boolean;
}

/** A Jira user, as far as events care. */
interface JiraUser {
  accountId?: string;
  displayName?: string;
}

/** One changelog entry: who changed which fields, and when. */
interface JiraHistory {
  id?: string;
  author?: JiraUser;
  created?: string;
  /** Read through {@link historyItemField}; see there why. */
  items?: Array<Record<string, unknown>>;
}

interface JiraComment {
  id?: string;
  author?: JiraUser;
  created?: string;
  /** Atlassian Document Format. */
  body?: unknown;
}

/** `/search/jql` with `expand=changelog` and the fields events read. */
interface JiraEventIssuePage {
  issues?: Array<{
    id?: string | number;
    key?: string;
    fields?: {
      summary?: string;
      created?: string;
      creator?: JiraUser | null;
      reporter?: JiraUser | null;
      assignee?: JiraUser | null;
      comment?: { comments?: JiraComment[]; total?: number };
    };
    changelog?: { histories?: JiraHistory[]; total?: number };
  }>;
  nextPageToken?: string;
  isLast?: boolean;
}

type JiraEventIssue = NonNullable<JiraEventIssuePage['issues']>[number];

/**
 * A string field of a changelog item.
 *
 * Never `item.toString`: an item carries a `toString` field -- the new value's
 * display text -- and on an item without one that expression is
 * Object.prototype's function, which would land in a toast as source code.
 */
function historyItemField(item: Record<string, unknown>, name: string): string | undefined {
  const value = Object.prototype.hasOwnProperty.call(item, name) ? item[name] : undefined;
  return typeof value === 'string' && value ? value : undefined;
}

function actorOf(user: JiraUser | null | undefined): { actorName?: string } {
  return user?.displayName ? { actorName: user.displayName } : {};
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
  /**
   * Jira's time tracking is minute-granular; anything shorter rounds to zero
   * and is refused.
   *
   * **Measured, not inferred** (2026-09-09, `pnpm probe:jira-worklog` against a
   * live Cloud site): 1s, 5s, 30s and 59s were all refused and 60s, 61s and
   * 120s all accepted. The boundary is exactly 60, so no time a user worked is
   * being discarded by this floor. It was previously a guess from Jira's
   * documented granularity plus one observed failure, which is why the probe
   * exists.
   *
   * Do not read the server's own message as a clue if this ever changes:
   * a sub-minute worklog comes back as "the worklog must not be Null /
   * timeLogged: you must indicate the time spent", which names neither the
   * duration nor a minimum and cost real time to diagnose the first time.
   */
  public readonly minimumLoggableSeconds: number = 60;

  private _site: string = '';
  private _email: string = '';
  private _apiToken: string = '';
  private _taskScope: TaskScopeValue = TaskScope.ASSIGNED_TO_ME;
  private _taskQuery: string = '';
  private _transitionInProgress: string = '';
  private _transitionToTest: string = '';
  private _transitionToReview: string = '';
  private _defaultCompletionAction: string = 'to_test';
  /** Whose changes are the user's own, from the last credential check. */
  private _accountId: string | null = null;
  /** When `/myself` last accepted the credentials; see JIRA_AUTH_CHECK_TTL_MS. */
  private _accountCheckedAt: number = 0;

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
    // New credentials may be another account, or no account at all.
    this._accountId = null;
    this._accountCheckedAt = 0;
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
    await this.authenticatedAccountId();

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
    await this.authenticatedAccountId();
    const collected: TaskDTO[] = [];
    let pageToken: string | undefined;

    for (let page = 1; page <= MAX_COLLECTION_PAGES; page++) {
      const url = new URL(`${this.getBaseUrl()}/rest/api/3/search/jql`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('maxResults', String(COLLECTION_PAGE_SIZE));
      // Only the fields that become a TaskDTO. The default is every field on
      // every issue, which for a busy project is megabytes of changelog and
      // custom fields that this then discards. The description is the one
      // heavy field asked for, and only its start is kept -- see
      // TASK_DESCRIPTION_MAX_CHARS.
      url.searchParams.set('fields', 'summary,status,project,priority,description');
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
        const task: TaskDTO = {
          id: String(issue.id),
          projectId,
          key: issue.key || String(issue.id),
          title: issue.fields?.summary || 'Untitled issue',
          status: this.mapIssueStatus(
            issue.fields?.status?.name,
            issue.fields?.status?.statusCategory?.key
          )
        };
        const priorityRank = priorityRankFromName(issue.fields?.priority?.name);
        if (priorityRank !== undefined) task.priorityRank = priorityRank;
        const description = clampDescription(adfToPlainText(issue.fields?.description));
        if (description) task.description = description;
        collected.push(task);
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
   * Maps an issue's status onto the three states this app tracks, honouring the
   * transitions the user configured.
   *
   * The category alone is not enough, and the round trip is where it shows.
   * Marking a task done here does not close the issue -- it fires the
   * configured completion transition, because you send your own work for review
   * rather than closing it. In a default Jira workflow that lands the issue in
   * "To Review", whose category is `indeterminate`. Mapping on category alone
   * therefore read that back as `in_progress` and the next sync overwrote the
   * local row -- `saveTask` does `status = excluded.status` -- so the badge
   * flipped from DONE to IN PROGRESS on its own, which reads as the app
   * forgetting what you just did.
   *
   * So a status named by one of the completion transitions counts as done
   * locally, which is the same answer `OpenProjectProvider` gives for its
   * configured To Test / To Review status ids. The category remains the
   * fallback, so an unconfigured install still needs no setup at all.
   *
   * The comparison is against the transition name, which is usually also the
   * name of the status it leads to but is not guaranteed to be. When they
   * differ the fallback applies, and the remedy is to enter the status name.
   */
  private mapIssueStatus(statusName?: string, categoryKey?: string): TaskDTO['status'] {
    const name = (statusName ?? '').trim().toLowerCase();
    if (name) {
      const completions = [this._transitionToTest, this._transitionToReview]
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
      if (completions.includes(name)) return 'done';
    }
    return JiraProvider.mapStatusCategory(categoryKey);
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
    if (payload.durationSeconds < this.minimumLoggableSeconds) {
      // Reported as permanent rather than as an ArgumentException, because a
      // row queued by an older build is a real thing sitting in a real queue
      // and the queue has to be able to park it. An ArgumentException carries
      // no classification, so it took the full retry budget instead -- which
      // is how this arrived as eight identical 400s rather than one message.
      throw new ProviderRequestError(
        this.providerId,
        'protocol',
        `Jira records time to the minute, so it cannot store ${payload.durationSeconds}s ` +
          `on ${payload.taskId}. The session is kept in local history.`,
        { status: 400 }
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
   * issue, which is an N+1 walk. Nothing calls this today, so building that
   * walk would be speculative.
   *
   * It returns `null`, not `0`. The earlier zero was indistinguishable from a
   * measured "you logged nothing today", so any UI reading it would have shown
   * a Jira user a confident and wrong figure. `null` is the contract's way of
   * saying this provider cannot answer -- see `ITaskProvider`.
   */
  public async reconcileRemoteState(): Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number | null }> {
    return { remoteLoggedTimeToday: null };
  }

  /**
   * What happened on the user's issues after `sinceUtc`, as provider events.
   *
   * Jira Cloud has no public notifications API, so this is an approximation
   * built from a search: the issues the user is assignee, reporter or watcher
   * of that changed in the window, read with their changelog and comments.
   * From those:
   * - the assignee changed to the user, or an issue created already assigned
   *   to them -> `assigned`;
   * - a status change -> `status_changed`;
   * - a new comment -> `mentioned` when it mentions the user, `commented`
   *   otherwise.
   *
   * Anything the user did themselves is dropped, or every status this app
   * moves for them would come back as a notification. What it cannot see, and
   * the user guide says so: a mention on an issue they are not involved in, a
   * mention in a description, and date reminders, which Jira does not have.
   *
   * Throws when the site cannot be read; see ITaskProvider.
   */
  public async getEventsSince(sinceUtc: string): Promise<ProviderEventDTO[]> {
    this.requireConfigured();
    const since = Date.parse(sinceUtc);
    if (Number.isNaN(since)) {
      throw new ArgumentException(`sinceUtc is not a timestamp: ${sinceUtc}`);
    }

    const me = await this.authenticatedAccountId();
    const events: ProviderEventDTO[] = [];
    for (const issue of await this.searchRecentlyUpdated(since)) {
      events.push(...(await this.eventsOfIssue(issue, since, me)));
    }
    return events;
  }

  /** Jira's "Your work" page: the closest thing it has to an inbox. */
  public getEventsInboxUrl(): string | null {
    return isJiraConfigured(this._site, this._email, this._apiToken)
      ? `${this.getBaseUrl()}/jira/your-work`
      : null;
  }

  /**
   * The account the credentials belong to, confirming that Jira accepts them.
   *
   * **This is what makes a rejected token a failure.** Jira Cloud treats a
   * revoked or expired token as an anonymous caller: `/project/search` and
   * `/search/jql` answer 200 with nothing in them. Measured on 2026-10-02
   * against a real site, with no credentials and with wrong ones alike. The
   * sync worker prunes against what it receives, so a token that expired
   * emptied the local project list on every pass, with nothing in the log.
   * `/myself` needs a user and answers 401, which providerFetch classifies as
   * a permanent `auth` failure. Every read the prune or the event cursor
   * depends on calls this first; the answer is trusted for
   * JIRA_AUTH_CHECK_TTL_MS so a sync pass does not ask once per project.
   */
  private async authenticatedAccountId(): Promise<string> {
    if (this._accountId && Date.now() - this._accountCheckedAt < JIRA_AUTH_CHECK_TTL_MS) {
      return this._accountId;
    }

    const context = 'Checking the Jira credentials';
    const res = await providerFetch(
      this.providerId,
      `${this.getBaseUrl()}/rest/api/3/myself`,
      { headers: this.headers() },
      context,
      this._http
    );
    const body = await this.readJson<JiraUser>(res, context);
    if (!body.accountId) {
      // Without it nothing can tell the user's own changes from anyone
      // else's, and every one of them would become a notification.
      throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: response had no accountId`);
    }
    this._accountId = body.accountId;
    this._accountCheckedAt = Date.now();
    return body.accountId;
  }

  /**
   * The issues the user is involved in that changed since `since`.
   *
   * Relative JQL rather than a date: JQL reads `"2026-10-01 10:05"` in the
   * timezone of the user's Jira profile, which is neither this machine's nor
   * UTC, so an absolute bound would shift the window by the difference. The
   * window is therefore whole minutes plus a margin, wider than needed, and
   * {@link eventsOfIssue} cuts it exactly on Jira's own timestamps.
   */
  private async searchRecentlyUpdated(since: number): Promise<JiraEventIssue[]> {
    const minutes = Math.max(0, Math.ceil((Date.now() - since) / 60_000)) + JIRA_EVENT_WINDOW_MARGIN_MINUTES;
    const jql =
      '(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser())' +
      ` AND updated >= -${minutes}m ORDER BY updated DESC`;
    const context = 'Fetching recent Jira activity';
    const collected: JiraEventIssue[] = [];
    let pageToken: string | undefined;

    for (let page = 1; page <= MAX_COLLECTION_PAGES; page++) {
      const url = new URL(`${this.getBaseUrl()}/rest/api/3/search/jql`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('maxResults', String(COLLECTION_PAGE_SIZE));
      url.searchParams.set('fields', 'summary,created,creator,reporter,assignee,comment');
      url.searchParams.set('expand', 'changelog');
      if (pageToken) url.searchParams.set('nextPageToken', pageToken);

      const res = await providerFetch(this.providerId, url.toString(), { headers: this.headers() }, context, this._http);
      const body = await this.readJson<JiraEventIssuePage>(res, context);
      const issues = body.issues;
      if (!Array.isArray(issues)) {
        throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: response had no \`issues\` array`);
      }
      collected.push(...issues);

      pageToken = body.nextPageToken;
      if (body.isLast === true || !pageToken || issues.length === 0) return collected;
    }

    throw new ProviderRequestError(
      this.providerId,
      'protocol',
      `${context} failed: did not finish within ${MAX_COLLECTION_PAGES} pages`
    );
  }

  /** One issue's events after `since`, by anyone but `me`. */
  private async eventsOfIssue(issue: JiraEventIssue, since: number, me: string): Promise<ProviderEventDTO[]> {
    if (issue.id === undefined || issue.id === null) return [];
    const issueId = String(issue.id);
    const key = issue.key || issueId;
    const fields = issue.fields;
    const browse = `${this.getBaseUrl()}/browse/${encodeURIComponent(key)}`;
    const base = { providerId: this.providerId, taskKey: key, taskTitle: fields?.summary || 'Untitled issue' };
    const after = (stamp: string | undefined): number | null => {
      const at = Date.parse(stamp ?? '');
      return Number.isNaN(at) || at <= since ? null : at;
    };
    const events: ProviderEventDTO[] = [];

    // An assignee set when the issue is created leaves no changelog entry, so
    // an issue someone else created for the user is read off its fields.
    const createdAt = after(fields?.created);
    const creator = fields?.creator ?? fields?.reporter;
    if (createdAt !== null && fields?.assignee?.accountId === me && creator?.accountId !== me) {
      events.push({
        ...base,
        id: `jira:${issueId}:created`,
        kind: 'assigned',
        ...actorOf(creator),
        url: browse,
        occurredAtUtc: new Date(createdAt).toISOString()
      });
    }

    for (const history of await this.recentHistories(issue, issueId)) {
      const at = after(history.created);
      if (at === null || !history.id || history.author?.accountId === me) continue;
      const common = { ...base, ...actorOf(history.author), url: browse, occurredAtUtc: new Date(at).toISOString() };
      for (const item of history.items ?? []) {
        const field = historyItemField(item, 'fieldId') ?? historyItemField(item, 'field');
        if (field === 'assignee' && historyItemField(item, 'to') === me) {
          events.push({ ...common, id: `jira:${issueId}:history:${history.id}:assignee`, kind: 'assigned' });
        } else if (field === 'status') {
          const from = historyItemField(item, 'fromString');
          const to = historyItemField(item, 'toString');
          events.push({
            ...common,
            id: `jira:${issueId}:history:${history.id}:status`,
            kind: 'status_changed',
            ...(to ? { summary: from ? `${from} → ${to}` : to } : {})
          });
        }
      }
    }

    for (const comment of await this.recentComments(issue, issueId)) {
      const at = after(comment.created);
      if (at === null || !comment.id || comment.author?.accountId === me) continue;
      const summary = clampDescription(adfToPlainText(comment.body), PROVIDER_EVENT_SUMMARY_MAX_CHARS);
      events.push({
        ...base,
        id: `jira:comment:${comment.id}`,
        kind: adfMentionsAccount(comment.body, me) ? 'mentioned' : 'commented',
        ...actorOf(comment.author),
        ...(summary ? { summary } : {}),
        url: `${browse}?focusedCommentId=${encodeURIComponent(comment.id)}`,
        occurredAtUtc: new Date(at).toISOString()
      });
    }

    return events;
  }

  /**
   * The issue's changelog, complete at its recent end.
   *
   * The search embeds a page of it at most, and for an issue with a long
   * history the entries left out would be exactly the ones that matter. The
   * changelog endpoint lists oldest first, so its last page is what is read.
   */
  private async recentHistories(issue: JiraEventIssue, issueId: string): Promise<JiraHistory[]> {
    const embedded = issue.changelog?.histories ?? [];
    const total = issue.changelog?.total ?? embedded.length;
    if (total <= embedded.length) return embedded;

    const url = new URL(`${this.getBaseUrl()}/rest/api/3/issue/${encodeURIComponent(issueId)}/changelog`);
    url.searchParams.set('startAt', String(Math.max(0, total - COLLECTION_PAGE_SIZE)));
    url.searchParams.set('maxResults', String(COLLECTION_PAGE_SIZE));
    const context = `Fetching the changelog of ${issue.key || issueId}`;
    const res = await providerFetch(this.providerId, url.toString(), { headers: this.headers() }, context, this._http);
    const body = await this.readJson<{ values?: JiraHistory[] }>(res, context);
    if (!Array.isArray(body.values)) {
      throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: response had no \`values\` array`);
    }
    return body.values;
  }

  /** The issue's comments; the newest page when the search embedded fewer than all. */
  private async recentComments(issue: JiraEventIssue, issueId: string): Promise<JiraComment[]> {
    const embedded = issue.fields?.comment?.comments ?? [];
    const total = issue.fields?.comment?.total ?? embedded.length;
    if (total <= embedded.length) return embedded;

    const url = new URL(`${this.getBaseUrl()}/rest/api/3/issue/${encodeURIComponent(issueId)}/comment`);
    url.searchParams.set('orderBy', '-created');
    url.searchParams.set('maxResults', String(COLLECTION_PAGE_SIZE));
    const context = `Fetching the comments of ${issue.key || issueId}`;
    const res = await providerFetch(this.providerId, url.toString(), { headers: this.headers() }, context, this._http);
    const body = await this.readJson<{ comments?: JiraComment[] }>(res, context);
    if (!Array.isArray(body.comments)) {
      throw new ProviderRequestError(this.providerId, 'protocol', `${context} failed: response had no \`comments\` array`);
    }
    return body.comments;
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
