import { describe, it, expect, afterEach, vi } from 'vitest';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { ProviderRequestError, isProviderRequestError } from '../src/main/providers/provider-errors';
import { TaskScope, parseTaskScope } from '../src/shared/task-scope';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey } from '../src/shared/provider-settings';

/**
 * Which tasks a provider fetches is now the user's choice (audit F-12).
 *
 * `getTasks` hardcoded "assigned to me", so unassigned tickets and a
 * teammate's work were invisible with nothing in the UI to say why.
 *
 * The filter is also the most dangerous string in the provider layer: it is
 * what the sync worker's prune is measured against, so a filter that quietly
 * matches nothing deletes every cached task for the project. That is why the
 * custom-query tests below are about throwing, not about returning an empty
 * list.
 */
describe('OpenProject task scope', () => {
  const BASE = 'https://op.test';
  const originalFetch = global.fetch;
  const noBackoff = { sleepFn: async (): Promise<void> => undefined };

  /** Captures the `filters` query parameter of the request that was issued. */
  function captureFilter(): { calls: string[] } {
    const calls: string[] = [];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      calls.push(new URL(url).searchParams.get('filters') ?? '');
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ _embedded: { elements: [] }, _links: {} })
      } as unknown as Response);
    });
    return { calls };
  }

  async function providerWith(scope: string, query = ''): Promise<OpenProjectProvider> {
    const provider = new OpenProjectProvider(noBackoff);
    await provider.initialize({
      domain: BASE,
      apiToken: 'token',
      opTaskScope: scope,
      opTaskQuery: query
    });
    return provider;
  }

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('the shipped default is unchanged behaviour', () => {
    it('ProviderSettingDefaults_TaskScope_IsAssignedToMe', () => {
      // An existing install must see exactly the list it saw before this was a
      // choice, without being asked to configure anything.
      expect(PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.OP_TASK_SCOPE]).toBe(
        TaskScope.ASSIGNED_TO_ME
      );
    });

    it('GetTasks_ScopeNeverConfigured_StillFiltersToTheCurrentUser', async () => {
      const { calls } = captureFilter();
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: BASE, apiToken: 'token' });

      await provider.getTasks('P1');

      expect(calls[0]).toContain('assignee');
    });
  });

  describe('scope selection changes the filter', () => {
    it('GetTasks_AssignedToMe_SendsAnAssigneeClause', async () => {
      const { calls } = captureFilter();

      await (await providerWith(TaskScope.ASSIGNED_TO_ME)).getTasks('P1');

      const filters = JSON.parse(calls[0]) as Array<Record<string, unknown>>;
      expect(filters.some(f => 'assignee' in f)).toBe(true);
    });

    it('GetTasks_AllOpen_DropsTheAssigneeClauseOnly', async () => {
      // Unassigned and teammates' tickets become visible; the project and
      // open-status clauses must survive, or the list is from everywhere.
      const { calls } = captureFilter();

      await (await providerWith(TaskScope.ALL_OPEN)).getTasks('P1');

      const filters = JSON.parse(calls[0]) as Array<Record<string, unknown>>;
      expect(filters.some(f => 'assignee' in f)).toBe(false);
      expect(filters.some(f => 'project' in f)).toBe(true);
      expect(filters.some(f => 'status' in f)).toBe(true);
    });

    it('GetTasks_AnyBuiltInScope_AlwaysScopesToTheRequestedProject', async () => {
      // Losing this clause hands the sync worker another project's tasks, and
      // the prune then deletes the ones that were actually asked for.
      const { calls } = captureFilter();

      for (const scope of [TaskScope.ASSIGNED_TO_ME, TaskScope.ALL_OPEN]) {
        await (await providerWith(scope)).getTasks('P-42');
      }

      for (const call of calls) {
        expect(call).toContain('P-42');
      }
    });

    it('GetTasks_ProjectIdContainingAQuote_StillProducesValidJson', async () => {
      // The filter used to be interpolated into a JSON string literal, so a
      // quote in the identifier produced something that was not JSON at all --
      // and OpenProject answers that with a 400 that names no filter.
      const { calls } = captureFilter();

      await (await providerWith(TaskScope.ALL_OPEN)).getTasks('we"ird');

      expect(() => JSON.parse(calls[0])).not.toThrow();
      const filters = JSON.parse(calls[0]) as Array<Record<string, { values: string[] }>>;
      expect(filters[0].project.values[0]).toBe('we"ird');
    });
  });

  describe('a custom query must fail loudly, never quietly', () => {
    it('GetTasks_CustomQueryIsNotJson_ThrowsRatherThanFetchingNothing', async () => {
      // The F-01 trap. Returning `[]` here would let the prune delete every
      // cached task for the project because of a typo in a text field.
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;
      const provider = await providerWith(TaskScope.CUSTOM, 'assignee = me');

      const err = await provider.getTasks('P1').catch((e: unknown) => e);

      expect(isProviderRequestError(err)).toBe(true);
      expect((err as ProviderRequestError).kind).toBe('protocol');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('GetTasks_CustomQueryIsAJsonObjectNotAnArray_Throws', async () => {
      // OpenProject wants an array of filters. An object is valid JSON and
      // would reach the API as a 400 with an unhelpful body.
      const provider = await providerWith(TaskScope.CUSTOM, '{"assignee":"me"}');

      await expect(provider.getTasks('P1')).rejects.toMatchObject({ kind: 'protocol' });
    });

    it('GetTasks_CustomScopeWithAnEmptyQuery_ReportsNotConfigured', async () => {
      // Choosing "custom" and saving without typing anything is an ordinary
      // mistake, and `not_configured` is the kind the sync worker already
      // treats as "nothing to do" rather than as an outage.
      const provider = await providerWith(TaskScope.CUSTOM, '   ');

      const err = await provider.getTasks('P1').catch((e: unknown) => e);

      expect((err as ProviderRequestError).kind).toBe('not_configured');
      expect((err as ProviderRequestError).message).toContain('Settings');
    });

    it('GetTasks_ValidCustomQuery_IsSentVerbatim', async () => {
      const { calls } = captureFilter();
      const query = '[{"assignee":{"operator":"!","values":["me"]}}]';

      await (await providerWith(TaskScope.CUSTOM, query)).getTasks('P1');

      expect(JSON.parse(calls[0])).toEqual(JSON.parse(query));
    });

    it('GetTasks_ValidCustomQuery_ReplacesTheProjectClauseToo', async () => {
      // Documented in the UI, and worth pinning: a custom filter is the whole
      // filter, so it is the user's job to scope it to a project.
      const { calls } = captureFilter();

      await (await providerWith(TaskScope.CUSTOM, '[{"status":{"operator":"o","values":[]}}]')).getTasks(
        'P1'
      );

      expect(calls[0]).not.toContain('project');
    });
  });

  describe('parseTaskScope', () => {
    it('ParseTaskScope_KnownValue_IsReturnedUnchanged', () => {
      expect(parseTaskScope(TaskScope.ALL_OPEN)).toBe(TaskScope.ALL_OPEN);
    });

    it('ParseTaskScope_UnknownValue_FallsBackToAssignedToMe', () => {
      // A row written by an older build, or edited by hand. Refusing to list
      // tasks at all over a malformed preference would be worse.
      expect(parseTaskScope('everything_everywhere')).toBe(TaskScope.ASSIGNED_TO_ME);
    });

    it('ParseTaskScope_Missing_FallsBackToAssignedToMe', () => {
      expect(parseTaskScope(undefined)).toBe(TaskScope.ASSIGNED_TO_ME);
      expect(parseTaskScope(null)).toBe(TaskScope.ASSIGNED_TO_ME);
    });
  });
});
