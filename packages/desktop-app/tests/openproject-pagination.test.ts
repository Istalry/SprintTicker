import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchOpenProjectCollection } from '../src/main/providers/openproject-collection';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { ProviderRequestError, isProviderRequestError } from '../src/main/providers/provider-errors';
import { MAX_COLLECTION_PAGES } from '../src/main/providers/provider-constants';

/**
 * Regression coverage for audit F-12.
 *
 * OpenProject v3 paginates every collection at 20 elements by default. Each
 * call site fetched a bare collection URL and read `_embedded.elements` once,
 * so a user with 25 projects saw 20 of them and nothing said otherwise.
 *
 * The truncation was worse than cosmetic: the sync worker prunes local rows
 * absent from what a provider returns, so page one of two was a licence to
 * delete the other half of the cache.
 */
describe('OpenProject collection pagination', () => {
  const BASE = 'http://op.test';
  const AUTH = 'Basic dGVzdA==';
  const originalFetch = global.fetch;

  /** A successful collection page, optionally advertising a next one. */
  function page(elements: Array<Record<string, unknown>>, nextHref?: string): Response {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: { elements },
        _links: nextHref ? { nextByOffset: { href: nextHref } } : {}
      })
    } as unknown as Response;
  }

  /** Numbered filler elements, so a test can tell pages apart. */
  function elements(from: number, count: number): Array<Record<string, unknown>> {
    return Array.from({ length: count }, (_, i) => ({ id: from + i }));
  }

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchOpenProjectCollection', () => {
    it('FetchCollection_SinglePage_ReturnsEveryElement', async () => {
      global.fetch = vi.fn().mockResolvedValue(page(elements(1, 3)));

      const result = await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/projects',
        'Fetching projects'
      );

      expect(result).toHaveLength(3);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('FetchCollection_ThreePages_FollowsNextByOffsetAndConcatenatesAll', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(page(elements(1, 100), '/api/v3/projects?offset=2&pageSize=100'))
        .mockResolvedValueOnce(page(elements(101, 100), '/api/v3/projects?offset=3&pageSize=100'))
        .mockResolvedValueOnce(page(elements(201, 7)));
      global.fetch = fetchMock;

      const result = await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/projects',
        'Fetching projects'
      );

      expect(result).toHaveLength(207);
      expect(result[0].id).toBe(1);
      expect(result[206].id).toBe(207);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('FetchCollection_FirstRequest_AsksForMoreThanTheDefaultTwentyPerPage', async () => {
      const fetchMock = vi.fn().mockResolvedValue(page([]));
      global.fetch = fetchMock;

      await fetchOpenProjectCollection('openproject', BASE, AUTH, '/api/v3/projects', 'Fetching projects');

      const requested = new URL(fetchMock.mock.calls[0][0] as string);
      expect(Number(requested.searchParams.get('pageSize'))).toBeGreaterThan(20);
    });

    it('FetchCollection_RelativeNextLink_ResolvesAgainstTheConfiguredHost', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(page(elements(1, 1), '/api/v3/projects?offset=2&pageSize=100'))
        .mockResolvedValueOnce(page([]));
      global.fetch = fetchMock;

      await fetchOpenProjectCollection('openproject', BASE, AUTH, '/api/v3/projects', 'Fetching projects');

      expect(fetchMock.mock.calls[1][0]).toBe('http://op.test/api/v3/projects?offset=2&pageSize=100');
    });

    it('FetchCollection_QueryParams_AreEncodedIntoTheRequest', async () => {
      const fetchMock = vi.fn().mockResolvedValue(page([]));
      global.fetch = fetchMock;
      const filter = '[{"status":{"operator":"o","values":[]}}]';

      await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/work_packages',
        'Fetching tasks',
        { filters: filter }
      );

      const requested = new URL(fetchMock.mock.calls[0][0] as string);
      expect(requested.searchParams.get('filters')).toBe(filter);
      expect(requested.pathname).toBe('/api/v3/work_packages');
    });

    it('FetchCollection_EmptyPageStillAdvertisingANextLink_StopsWalking', async () => {
      // A server that miscounts must not be able to spin the walk to its cap.
      const fetchMock = vi.fn().mockResolvedValue(page([], '/api/v3/projects?offset=99&pageSize=100'));
      global.fetch = fetchMock;

      const result = await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/projects',
        'Fetching projects'
      );

      expect(result).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('FetchCollection_MorePagesThanTheCap_ThrowsRatherThanReturningWhatItHas', async () => {
      // Returning a partial collection is the F-01 prune hazard, so the
      // runaway guard must fail the request instead of truncating it.
      global.fetch = vi
        .fn()
        .mockResolvedValue(page(elements(1, 100), '/api/v3/projects?offset=2&pageSize=100'));

      await expect(
        fetchOpenProjectCollection('openproject', BASE, AUTH, '/api/v3/projects', 'Fetching projects')
      ).rejects.toThrow(ProviderRequestError);
      expect(global.fetch).toHaveBeenCalledTimes(MAX_COLLECTION_PAGES);
    });

    it('FetchCollection_MissingElementsCollection_ThrowsProtocolRatherThanReportingEmpty', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ _embedded: {} })
      } as unknown as Response);

      const err = await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/projects',
        'Fetching projects'
      ).catch(e => e as unknown);

      expect(isProviderRequestError(err)).toBe(true);
      expect((err as ProviderRequestError).kind).toBe('protocol');
    });

    it('FetchCollection_Unauthorised_ThrowsAuthCarryingTheServerExplanation', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'You did not provide the correct credentials.' })
      } as unknown as Response);

      const err = (await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/statuses',
        'Fetching statuses'
      ).catch(e => e as unknown)) as ProviderRequestError;

      expect(err.kind).toBe('auth');
      expect(err.isPermanent).toBe(true);
      expect(err.message).toContain('You did not provide the correct credentials.');
    });

    it('FetchCollection_NonJsonErrorBody_StillThrowsWithTheStatus', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        }
      } as unknown as Response);

      const err = (await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/projects',
        'Fetching projects'
      ).catch(e => e as unknown)) as ProviderRequestError;

      expect(err.status).toBe(502);
      expect(err.message).toContain('502');
    });

    it('FetchCollection_NetworkUnreachable_ThrowsTransport', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const err = (await fetchOpenProjectCollection(
        'openproject',
        BASE,
        AUTH,
        '/api/v3/projects',
        'Fetching projects'
      ).catch(e => e as unknown)) as ProviderRequestError;

      expect(err.kind).toBe('transport');
      expect(err.isPermanent).toBe(false);
    });
  });

  describe('Provider methods walk their collections', () => {
    let provider: OpenProjectProvider;

    beforeEach(async () => {
      provider = new OpenProjectProvider();
      await provider.initialize({ domain: BASE, apiKey: 'test-key' });
    });

    it('GetProjects_TwoPages_ReturnsProjectsFromBothPages', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          page(
            [
              { id: 1, identifier: 'alpha', name: 'Alpha' },
              { id: 2, identifier: 'beta', name: 'Beta' }
            ],
            '/api/v3/projects?offset=2&pageSize=100'
          )
        )
        .mockResolvedValueOnce(page([{ id: 3, identifier: 'gamma', name: 'Gamma' }]));

      const projects = await provider.getProjects();

      expect(projects.map(p => p.key)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('GetTasks_TwoPages_ReturnsWorkPackagesFromBothPages', async () => {
      const wp = (id: number) => ({
        id,
        subject: `Task ${id}`,
        _links: { status: { href: '/api/v3/statuses/7' }, type: { title: 'Task' } }
      });
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(page([wp(11), wp(12)], '/api/v3/work_packages?offset=2&pageSize=100'))
        .mockResolvedValueOnce(page([wp(13)]));

      const tasks = await provider.getTasks('1');

      expect(tasks.map(t => t.key)).toEqual(['OP-11', 'OP-12', 'OP-13']);
    });

    it('FetchStatuses_TwoPages_ReturnsEveryStatusSoTheSettingsListIsComplete', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          page([{ id: 1, name: 'New', isClosed: false }], '/api/v3/statuses?offset=2&pageSize=100')
        )
        .mockResolvedValueOnce(page([{ id: 14, name: 'Closed', isClosed: true }]));

      const result = await OpenProjectProvider.fetchStatuses(BASE, 'test-key');

      expect(result.success).toBe(true);
      expect(result.data?.map(s => s.name)).toEqual(['New', 'Closed']);
    });

    it('ReconcileRemoteState_TwoPagesOfTimeEntries_SumsEveryPage', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(page([{ hours: 'PT1H30M' }], '/api/v3/time_entries?offset=2&pageSize=100'))
        .mockResolvedValueOnce(page([{ hours: 'PT45M' }, { hours: 'PT30S' }]));

      const state = await provider.reconcileRemoteState();

      expect(state.remoteLoggedTimeToday).toBe(5400 + 2700 + 30);
    });

    it('FetchUnreadNotifications_RequestFails_ReturnsEmptyWithoutThrowing', async () => {
      // Notifications are not a prune input, so this one degrades rather than
      // failing its caller -- unlike getProjects/getTasks.
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(provider.fetchUnreadNotifications()).resolves.toEqual([]);
    });
  });
});
