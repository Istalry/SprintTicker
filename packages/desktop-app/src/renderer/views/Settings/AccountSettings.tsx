import React, { useEffect, useId, useState } from 'react';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useSyncHealth } from '../../hooks/usePrompts';
import { useSyncQueue, waitingText } from '../../hooks/useSyncQueue';
import { OpStatusDTO, ProjectDTO } from '../../../shared/dtos';
import { TaskScope, TaskScopeValue, TASK_SCOPE_LABELS } from '../../../shared/task-scope';
import { SyncQueuePanel } from '../../components/SyncQueuePanel';
import { DoneStatePerProject } from '../../components/DoneStatePerProject';
import { ProviderEventsSection } from '../../components/ProviderEventsSection';
import { StartSideEffectsSetting } from '../../components/StartSideEffectsSetting';
import {
  SETTING_SELECT_CLASS, SettingButton, SettingProblem, SettingRow, SettingsList
} from '../../components/SettingRow';
import { PROVIDERS_WITH_EVENTS, providerEventKindsFor } from '../../../shared/provider-events';
import { ProviderId, selectableProviders, providerDisplayName } from '../../../shared/provider-names';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey } from '../../../shared/provider-settings';
import { couldNot, formatHoursMinutes } from '../../utils/formatters';

export interface AccountSettingsProps {
  /** Offers the bar as a destination for provider notifications. */
  hasBar?: boolean;
}

/** Jira's notifications are read off a search, and the search has edges. */
const PROVIDER_EVENT_NOTES: Record<string, string> = {
  jira:
    'Jira has no notification feed, so SprintTicker reads the issues you are assigned, ' +
    'reported or watch. A mention on any other issue is not seen, and your own changes never notify you.'
};

/** What each scope fetches, in a sentence for the row. */
const SCOPE_SENTENCES: Record<TaskScopeValue, string> = {
  [TaskScope.ASSIGNED_TO_ME]: 'Your open tasks, open tasks nobody has, and teammates’ tasks in progress.',
  [TaskScope.ALL_OPEN]: 'Every open task in your projects, whoever has it.',
  [TaskScope.CUSTOM]: 'Your own query, below. It replaces the whole query, the project clause included.'
};

const FIELD =
  'w-full rounded-lg border border-border-field bg-dark-900 px-3 py-1.5 text-xs text-text-primary focus:border-focus focus:outline-none';

/** The site's host for the account line: "studio.atlassian.net", or the text as typed when it is no URL. */
function hostOf(site: string): string {
  try {
    return new URL(site).host || site;
  } catch {
    // Typed without a scheme, or still being typed: shown as it is.
    return site;
  }
}

/**
 * Settings · Account (S20), a page of rows: the refused-token banner when
 * the provider turned the token down, the account line with Refresh now and
 * Change account, the tasks to fetch, what a start and a Done do at the
 * provider, its notifications, and Advanced -- the provider's state names,
 * the key for tasks of my own, the entries waiting to send.
 *
 * The provider settings save as they are edited, all through one
 * `setActiveProvider`, as the panel before it did: each save reconnects the
 * provider and starts a sync, so the fields share one debounce.
 */
export const AccountSettings: React.FC<AccountSettingsProps> = ({ hasBar = true }) => {
  const [loaded, setLoaded] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [fallbackTicketKey, setFallbackTicketKey] = useState<string>(PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.FALLBACK_TICKET_KEY]);
  const [providerId, setProviderId] = useState<string>('openproject');
  const [opDomain, setOpDomain] = useState<string>('');
  const [opApiKey, setOpApiKey] = useState<string>('');
  const [opStatusInProgress, setOpStatusInProgress] = useState<string>('');
  const [opStatusToTest, setOpStatusToTest] = useState<string>('');
  const [opStatusToReview, setOpStatusToReview] = useState<string>('');
  const [opCompletionAction, setOpCompletionAction] = useState<string>('to_test');
  const [opTaskScope, setOpTaskScope] = useState<TaskScopeValue>(TaskScope.ASSIGNED_TO_ME);
  const [opTaskQuery, setOpTaskQuery] = useState<string>('');
  const [jiraSite, setJiraSite] = useState<string>('');
  const [jiraEmail, setJiraEmail] = useState<string>('');
  const [jiraApiToken, setJiraApiToken] = useState<string>('');
  const [jiraTaskScope, setJiraTaskScope] = useState<TaskScopeValue>(TaskScope.ASSIGNED_TO_ME);
  const [jiraTaskQuery, setJiraTaskQuery] = useState<string>('');
  const [jiraTransitionInProgress, setJiraTransitionInProgress] = useState<string>('');
  const [jiraTransitionToTest, setJiraTransitionToTest] = useState<string>('');
  const [jiraTransitionToReview, setJiraTransitionToReview] = useState<string>('');
  const [jiraCompletionAction, setJiraCompletionAction] = useState<string>('to_review');

  const [availableStatuses, setAvailableStatuses] = useState<OpStatusDTO[]>([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState<boolean>(false);
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [changingAccount, setChangingAccount] = useState(false);
  const [choosingNotifications, setChoosingNotifications] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProblem, setRefreshProblem] = useState<string | null>(null);
  const health = useSyncHealth();
  const queue = useSyncQueue();

  useEffect(() => {
    // Auto-save stays disabled until the read settles. Enabling it earlier
    // would let the page persist its defaults over stored settings.
    const loads: Array<Promise<unknown>> = [];

    if (window.electronAPI?.getProviders) {
      loads.push(window.electronAPI.getProviders().then(res => {
        if (res) {
          if (res.activeProviderId) setProviderId(res.activeProviderId);
          if (res.fallbackTicketKey) setFallbackTicketKey(res.fallbackTicketKey);
          if (res.opDomain) setOpDomain(res.opDomain);
          if (res.opApiKey) setOpApiKey(res.opApiKey);
          if (res.opStatusInProgress) setOpStatusInProgress(res.opStatusInProgress);
          if (res.opStatusToTest) setOpStatusToTest(res.opStatusToTest);
          if (res.opStatusToReview) setOpStatusToReview(res.opStatusToReview);
          if (res.opCompletionAction) setOpCompletionAction(res.opCompletionAction);
          if (res.opTaskScope) setOpTaskScope(res.opTaskScope as TaskScopeValue);
          // No truthiness guard: an empty query is a real value the user can
          // set by clearing the field, and skipping it would resurrect the old
          // one on the next save.
          if (res.opTaskQuery !== undefined) setOpTaskQuery(res.opTaskQuery);
          if (res.jiraSite) setJiraSite(res.jiraSite);
          if (res.jiraEmail) setJiraEmail(res.jiraEmail);
          if (res.jiraApiToken) setJiraApiToken(res.jiraApiToken);
          if (res.jiraTaskScope) setJiraTaskScope(res.jiraTaskScope as TaskScopeValue);
          // Assigned unconditionally, like opTaskQuery.
          if (res.jiraTaskQuery !== undefined) setJiraTaskQuery(res.jiraTaskQuery);
          if (res.jiraTransitionInProgress !== undefined) setJiraTransitionInProgress(res.jiraTransitionInProgress);
          if (res.jiraTransitionToTest !== undefined) setJiraTransitionToTest(res.jiraTransitionToTest);
          if (res.jiraTransitionToReview !== undefined) setJiraTransitionToReview(res.jiraTransitionToReview);
          if (res.jiraCompletionAction) setJiraCompletionAction(res.jiraCompletionAction);
        }
      }).catch(err => console.error('[AccountSettings] Error loading providers:', err)));
    }

    void Promise.allSettled(loads).then(() => setLoaded(true));
  }, []);

  // The account line's counts: read now, and again when a sync changes the lists.
  useEffect(() => {
    const api = window.electronAPI;
    const read = (): void => {
      api?.getProjects?.().then(setProjects, (err: unknown) => console.warn('[AccountSettings] Reading the projects failed:', err));
    };
    read();
    const off = api?.onProjectsUpdated?.(() => read());
    return () => { off?.(); };
  }, []);

  const handleSave = async () => {
    await window.electronAPI?.setActiveProvider?.({
      providerId,
      fallbackTicketKey,
      opDomain,
      opApiKey,
      opStatusInProgress,
      opStatusToTest,
      opStatusToReview,
      opCompletionAction,
      opTaskScope,
      opTaskQuery,
      jiraSite,
      jiraEmail,
      jiraApiToken,
      jiraTaskScope,
      jiraTaskQuery,
      jiraTransitionInProgress,
      jiraTransitionToTest,
      jiraTransitionToReview,
      jiraCompletionAction
    });
  };

  const saveStatus = useAutoSave(
    handleSave,
    [
      providerId, fallbackTicketKey,
      opDomain, opApiKey, opStatusInProgress, opStatusToTest, opStatusToReview, opCompletionAction, opTaskScope, opTaskQuery,
      jiraSite, jiraEmail, jiraApiToken, jiraTaskScope, jiraTaskQuery,
      jiraTransitionInProgress, jiraTransitionToTest, jiraTransitionToReview, jiraCompletionAction
    ],
    loaded
  );

  const handleFetchStatuses = async () => {
    if (!opDomain || !opApiKey || !window.electronAPI?.fetchOpenProjectStatuses) return;
    setIsLoadingStatuses(true);
    setFetchError(null);
    try {
      const res = await window.electronAPI.fetchOpenProjectStatuses(opDomain, opApiKey);
      if (res.success && res.data) {
        setAvailableStatuses(res.data);
      } else {
        setAvailableStatuses([]);
        setFetchError(res.error || 'Unknown error occurred while fetching statuses.');
      }
    } catch (err) {
      console.error('[AccountSettings] Failed to fetch statuses:', err);
      setFetchError(err instanceof Error ? err.message : 'Unknown exception occurred.');
      setAvailableStatuses([]);
    }
    setIsLoadingStatuses(false);
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshProblem(null);
    try {
      const result = await window.electronAPI.syncProviderNow();
      if (result.status === 'failed' || result.status === 'not_configured') setRefreshProblem(result.reason ?? 'The provider did not answer.');
    } catch (err) {
      setRefreshProblem(couldNot('refresh', err));
    } finally {
      setRefreshing(false);
    }
  };

  const isJira = providerId === ProviderId.JIRA;
  const isOpenProject = providerId === ProviderId.OPENPROJECT;
  const remote = isJira || isOpenProject;
  const name = providerDisplayName(providerId);
  const site = isJira ? jiraSite : opDomain;
  const scope = isJira ? jiraTaskScope : opTaskScope;
  const setScope = isJira ? setJiraTaskScope : setOpTaskScope;
  const query = isJira ? jiraTaskQuery : opTaskQuery;
  const setQuery = isJira ? setJiraTaskQuery : setOpTaskQuery;
  const completion = isJira ? jiraCompletionAction : opCompletionAction;
  const setCompletion = isJira ? setJiraCompletionAction : setOpCompletionAction;
  const statusName = (id: string, fallback: string): string => availableStatuses.find(s => s.id === id)?.name || fallback;
  const toTest = isJira ? jiraTransitionToTest || 'To Test' : statusName(opStatusToTest, 'To Test');
  const toReview = isJira ? jiraTransitionToReview || 'To Review' : statusName(opStatusToReview, 'To Review');

  const own = projects?.filter(p => p.providerId === providerId) ?? [];
  const taskCount = own.reduce((sum, p) => sum + (p.openTaskCount ?? 0) + (p.openUnassignedCount ?? 0) + (p.openOthersCount ?? 0), 0);
  const refreshed = health?.lastSyncedAtUtc ? `Last refreshed at ${formatHoursMinutes(new Date(health.lastSyncedAtUtc))}.` : 'Not refreshed since SprintTicker started.';
  const accountTitle = !remote ? name : site ? `${name} · ${hostOf(site)}` : `${name} · not set up`;
  const accountLine = !remote
    ? 'Tasks of your own, kept on this computer. Nothing is sent anywhere.'
    : site
      ? `${isJira && jiraEmail ? `${jiraEmail}. ` : ''}${own.length} ${own.length === 1 ? 'project' : 'projects'}, ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}. ${refreshed}`
      : `Enter your ${name} ${isJira ? 'site and API token' : 'address and API key'} to fetch your tasks.`;

  return (
    <div className="space-y-4">
      {remote && health?.state === 'refused' && (
        <RefusedToken
          providerName={name}
          waiting={waitingText(queue, true)}
          onSave={async token => {
            await window.electronAPI.setActiveProvider(isJira ? { jiraApiToken: token } : { opApiKey: token });
            // Kept in the page too, so the next save of any field sends this token, not the refused one.
            if (isJira) setJiraApiToken(token);
            else setOpApiKey(token);
            await window.electronAPI.syncProviderNow();
          }}
        />
      )}

      <SettingsList label="Account">
        <SettingRow
          title={accountTitle}
          description={accountLine}
          control={
            <>
              {remote && site && (
                <SettingButton tone="ghost" disabled={refreshing} onClick={() => void refresh()}>
                  {refreshing ? 'Refreshing…' : 'Refresh now'}
                </SettingButton>
              )}
              <SettingButton tone="ghost" aria-expanded={changingAccount} onClick={() => setChangingAccount(open => !open)}>
                {remote && !site ? 'Set up' : 'Change account'}
              </SettingButton>
            </>
          }
        >
          {refreshProblem && <SettingProblem>Could not refresh: {refreshProblem}</SettingProblem>}
          {changingAccount && (
            <div className="grid max-w-xl gap-3 rounded-lg border border-border-dark bg-dark-900 p-4">
              <Field label="Where your tasks come from">
                <select value={providerId} onChange={e => setProviderId(e.target.value)} className={FIELD}>
                  {selectableProviders().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              {isOpenProject && (
                <>
                  <Field label="OpenProject address">
                    <input type="text" value={opDomain} onChange={e => setOpDomain(e.target.value)} placeholder="https://openproject.example.com" className={FIELD} />
                  </Field>
                  <Field label="API key">
                    <input type="password" value={opApiKey} onChange={e => setOpApiKey(e.target.value)} placeholder="From My account › Access tokens" className={FIELD} />
                  </Field>
                </>
              )}
              {isJira && (
                <>
                  <Field label="Jira site">
                    <input type="text" value={jiraSite} onChange={e => setJiraSite(e.target.value)} placeholder="https://your-team.atlassian.net" className={FIELD} />
                  </Field>
                  <Field label="Email" hint="A Jira API token is the password for an account, so it goes with the account's email.">
                    <input type="text" value={jiraEmail} onChange={e => setJiraEmail(e.target.value)} placeholder="you@your-team.com" className={FIELD} />
                  </Field>
                  <Field label="API token">
                    <input type="password" value={jiraApiToken} onChange={e => setJiraApiToken(e.target.value)} placeholder="Create one at id.atlassian.com" className={FIELD} />
                  </Field>
                </>
              )}
              <p className="text-xs text-text-muted">Saved as you type; the tasks are fetched again with it.</p>
            </div>
          )}
        </SettingRow>

        {remote && (
          <SettingRow
            title={`Tasks to fetch from ${name}`}
            description={SCOPE_SENTENCES[scope]}
            control={
              <select aria-label="Tasks to fetch" value={scope} onChange={e => setScope(e.target.value as TaskScopeValue)} className={SETTING_SELECT_CLASS}>
                {Object.values(TaskScope).map(value => <option key={value} value={value}>{TASK_SCOPE_LABELS[value]}</option>)}
              </select>
            }
          >
            {scope === TaskScope.CUSTOM && (
              <Field
                label={isJira ? 'Custom JQL' : 'Custom filter (OpenProject v3 JSON)'}
                hint={`Add a project clause yourself unless you mean every project. Only ${name} can check it, so a mistake fails the sync rather than quietly showing no tasks.`}
              >
                <textarea
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder={isJira ? 'assignee = currentUser() AND labels = urgent' : '[{"assignee":{"operator":"=","values":["me"]}},{"status":{"operator":"o","values":[]}}]'}
                  className={`${FIELD} font-mono`}
                />
              </Field>
            )}
          </SettingRow>
        )}

        <StartSideEffectsSetting />

        {remote && (
          <SettingRow
            title="When I mark a task done"
            description={`Where it goes in ${name}, per project: each workflow has its own states.`}
            control={
              <select aria-label="When I mark a task done" value={completion} onChange={e => setCompletion(e.target.value)} className={SETTING_SELECT_CLASS}>
                <option value="to_test">All projects: {toTest}</option>
                <option value="to_review">All projects: {toReview}</option>
              </select>
            }
          >
            <DoneStatePerProject providerId={providerId} statuses={isOpenProject ? availableStatuses : []} />
          </SettingRow>
        )}

        {PROVIDERS_WITH_EVENTS.includes(providerId) && (
          <SettingRow
            title={`${name} notifications`}
            description="Assigned, mentioned, comments: as a Windows notification, on the bar, or both."
            control={
              <SettingButton aria-expanded={choosingNotifications} onClick={() => setChoosingNotifications(open => !open)}>
                Choose…
              </SettingButton>
            }
          >
            {choosingNotifications && (
              <ProviderEventsSection
                providerName={name}
                hasBar={hasBar}
                kinds={providerEventKindsFor(providerId)}
                note={PROVIDER_EVENT_NOTES[providerId]}
              />
            )}
          </SettingRow>
        )}

        <details className="group py-3">
          <summary className="cursor-pointer select-none text-[13px] text-text-secondary hover:text-text-primary">
            Advanced: {remote ? `the states in ${name} · ` : ''}the key for tasks of my own · every entry waiting to send
          </summary>
          <div className="mt-3 space-y-5">
            {isJira && (
              <div className="grid max-w-xl gap-3">
                <p className="text-xs text-text-secondary">
                  Jira moves an issue by running a transition. Type the transition or target state <em>name</em>: an id means
                  something in one workflow only. Left empty, SprintTicker does not move the issue.
                </p>
                <Field label="When I start a task">
                  <input type="text" value={jiraTransitionInProgress} onChange={e => setJiraTransitionInProgress(e.target.value)} placeholder="In Progress" className={FIELD} />
                </Field>
                <Field label="To test">
                  <input type="text" value={jiraTransitionToTest} onChange={e => setJiraTransitionToTest(e.target.value)} placeholder="Ready for QA" className={FIELD} />
                </Field>
                <Field label="To review">
                  <input type="text" value={jiraTransitionToReview} onChange={e => setJiraTransitionToReview(e.target.value)} placeholder="In Review" className={FIELD} />
                </Field>
              </div>
            )}
            {isOpenProject && (
              <div className="grid max-w-xl gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-text-secondary">The OpenProject states a start and a Done move a work package to.</p>
                  <SettingButton disabled={isLoadingStatuses || !opDomain || !opApiKey} onClick={() => void handleFetchStatuses()}>
                    {isLoadingStatuses ? 'Reading…' : 'Read the states from OpenProject'}
                  </SettingButton>
                </div>
                {fetchError && <SettingProblem>Could not read them: {fetchError}</SettingProblem>}
                <StatusField label="When I start a task" value={opStatusInProgress} onChange={setOpStatusInProgress} statuses={availableStatuses} />
                <StatusField label="To test" value={opStatusToTest} onChange={setOpStatusToTest} statuses={availableStatuses} />
                <StatusField label="To review" value={opStatusToReview} onChange={setOpStatusToReview} statuses={availableStatuses} />
              </div>
            )}
            <div className="max-w-xl">
              <Field label="Key for tasks of my own" hint="The key new tasks of your own show in the lists; the bar shows their name alone. Their time stays in your History and is never sent.">
                <input type="text" value={fallbackTicketKey} onChange={e => setFallbackTicketKey(e.target.value)} placeholder="e.g. MISC-1 or ADMIN-1" className={FIELD} />
              </Field>
            </div>
            {/* The queue is the consequence of what is configured above, and
                saving credentials is what un-parks a row that failed because
                they were wrong. */}
            <div>
              <p className="mb-2 text-xs font-semibold text-text-primary">Entries waiting to send</p>
              <SyncQueuePanel />
            </div>
          </div>
        </details>
      </SettingsList>

      {saveStatus === 'error' && <SettingProblem>Could not save the account settings. Nothing changed at the provider.</SettingProblem>}
    </div>
  );
};

/**
 * A labelled field inside a fold: the label above, a hint under it, tied to
 * the control by id so the hint describes it rather than joining its name.
 */
const Field: React.FC<{ label: string; hint?: string; children: React.ReactElement<React.HTMLAttributes<HTMLElement>> }> = ({
  label,
  hint,
  children
}) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-text-secondary">{label}</label>
      {React.cloneElement(children, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) })}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
};

/** An OpenProject state: chosen from the states read, or typed as an id before they are. */
const StatusField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  statuses: readonly OpStatusDTO[];
}> = ({ label, value, onChange, statuses }) => (
  <Field label={label}>
    {statuses.length > 0 ? (
      <select value={value} onChange={e => onChange(e.target.value)} className={FIELD}>
        <option value="">Choose a state…</option>
        {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    ) : (
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="State id" className={FIELD} />
    )}
  </Field>
);

/**
 * The provider refused the saved token (S20): what is safe, and the one
 * field that fixes it. Saving puts the token in place and sends at once; the
 * worker un-parks the entries a refusal held.
 */
const RefusedToken: React.FC<{
  providerName: string;
  waiting: string | null;
  onSave: (token: string) => Promise<void>;
}> = ({ providerName, waiting, onSave }) => {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await onSave(token.trim());
      setToken('');
    } catch (err) {
      setProblem(couldNot('save it', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="space-y-2 rounded-xl border border-accent-red/50 bg-dark-800 px-5 py-4">
      <p className="text-sm text-text-primary">
        <b>{providerName} refused your token.</b>{' '}
        <span className="text-xs text-text-secondary">
          {waiting ? `Waiting: ${waiting}. Kept, and sent as soon as it works.` : 'Timing works; nothing is lost.'}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          aria-label="New API token"
          placeholder="New API token"
          value={token}
          onChange={e => setToken(e.target.value)}
          className={`${FIELD} max-w-md`}
        />
        <SettingButton tone="primary" disabled={busy || token.trim() === ''} onClick={() => void save()}>
          {busy ? 'Sending…' : 'Save and send'}
        </SettingButton>
      </div>
      {problem && <SettingProblem>Could not save it: {problem}</SettingProblem>}
    </div>
  );
};
