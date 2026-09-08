import { describe, it, expect, vi } from 'vitest';
import { providerFetch } from '../src/main/providers/provider-http';
import { ProviderRequestError } from '../src/main/providers/provider-errors';
import { PROVIDER_MAX_RETRIES, PROVIDER_RETRY_MAX_MS } from '../src/main/providers/provider-constants';

/**
 * The shared provider HTTP client.
 *
 * Its reason to exist is that every provider request used to call `fetch`
 * directly: no timeout, no rate-limit handling, and status classification
 * copy-pasted per call site. The tests that matter most here are the ones about
 * what is *not* retried -- a client that repeats a worklog POST bills the same
 * hour twice, and that is not a bug a user notices before payroll does.
 */
describe('providerFetch', () => {
  const PROVIDER = 'openproject';
  const URL_UNDER_TEST = 'http://op.test/api/v3/projects';
  /** Backoff must never cost real time in the suite. */
  const noSleep = vi.fn().mockResolvedValue(undefined);

  /** A minimal Response; `headers` is present because retryDelayFor reads it. */
  function response(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => {
        if (body === undefined) throw new Error('not json');
        return body;
      }
    } as unknown as Response;
  }

  describe('what it refuses to repeat', () => {
    it('ProviderFetch_PostReturns503_DoesNotRetryIt', async () => {
      // POST /time_entries is the request this rule exists for: OpenProject
      // offers no idempotency key, so a repeat after a lost response logs the
      // session twice.
      const fetchFn = vi.fn().mockResolvedValue(response(503, { message: 'busy' }));

      await expect(
        providerFetch(PROVIDER, URL_UNDER_TEST, { method: 'POST' }, 'Logging time', {
          fetchFn,
          sleepFn: noSleep
        })
      ).rejects.toThrow(ProviderRequestError);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('ProviderFetch_PostTimesOut_DoesNotRetryEither', async () => {
      // The dangerous case: a request that reached the server and was applied,
      // whose response never came back. It is indistinguishable here from one
      // that never arrived, so it must be treated as the expensive one.
      const fetchFn = vi.fn().mockRejectedValue(new Error('The operation was aborted'));

      await expect(
        providerFetch(PROVIDER, URL_UNDER_TEST, { method: 'POST' }, 'Logging time', {
          fetchFn,
          sleepFn: noSleep
        })
      ).rejects.toThrow(ProviderRequestError);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('ProviderFetch_PatchReturns429_DoesNotRetryIt', async () => {
      const fetchFn = vi.fn().mockResolvedValue(response(429));

      await expect(
        providerFetch(PROVIDER, URL_UNDER_TEST, { method: 'PATCH' }, 'Setting status', {
          fetchFn,
          sleepFn: noSleep
        })
      ).rejects.toThrow(ProviderRequestError);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('ProviderFetch_UnsafeMethodWithExplicitOptIn_IsRetried', async () => {
      // The escape hatch, for a route the remote genuinely treats as idempotent.
      const fetchFn = vi.fn().mockResolvedValue(response(503));

      await expect(
        providerFetch(PROVIDER, URL_UNDER_TEST, { method: 'POST' }, 'Probing', {
          fetchFn,
          sleepFn: noSleep,
          retryUnsafeMethod: true
        })
      ).rejects.toThrow(ProviderRequestError);

      expect(fetchFn).toHaveBeenCalledTimes(PROVIDER_MAX_RETRIES + 1);
    });

    it('ProviderFetch_GetReturns404_DoesNotRetryAPermanentAnswer', async () => {
      // "Not found" is an answer, not a deferral. Retrying it spends the sync
      // budget confirming what the server already said.
      const fetchFn = vi.fn().mockResolvedValue(response(404, { message: 'gone' }));

      await expect(
        providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
          fetchFn,
          sleepFn: noSleep
        })
      ).rejects.toThrow(ProviderRequestError);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('what it does repeat', () => {
    it('ProviderFetch_GetReturns503ThenSucceeds_ReturnsTheSuccessfulResponse', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(response(503))
        .mockResolvedValueOnce(response(200, { ok: true }));

      const res = await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      });

      expect(res.status).toBe(200);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('ProviderFetch_GetKeepsFailing_GivesUpAfterTheAttemptBudget', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const err = (await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      }).catch(e => e as unknown)) as ProviderRequestError;

      expect(err.kind).toBe('transport');
      expect(fetchFn).toHaveBeenCalledTimes(PROVIDER_MAX_RETRIES + 1);
    });

    it('ProviderFetch_MethodOmitted_IsTreatedAsAGet', async () => {
      // `fetch` defaults to GET, and a client that assumed otherwise would
      // silently stop retrying every collection page.
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(response(502))
        .mockResolvedValueOnce(response(200, {}));

      await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      });

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('ProviderFetch_LowercaseMethod_IsStillRecognised', async () => {
      const fetchFn = vi.fn().mockResolvedValue(response(503));

      await expect(
        providerFetch(PROVIDER, URL_UNDER_TEST, { method: 'post' }, 'Logging time', {
          fetchFn,
          sleepFn: noSleep
        })
      ).rejects.toThrow(ProviderRequestError);

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limiting', () => {
    it('ProviderFetch_RetryAfterInSeconds_WaitsThatLong', async () => {
      // Ignoring the header a server just sent is how a client earns a longer
      // ban than the one it was given.
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(response(429, undefined, { 'retry-after': '2' }))
        .mockResolvedValueOnce(response(200, {}));

      await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', { fetchFn, sleepFn });

      expect(sleepFn).toHaveBeenCalledWith(2000);
    });

    it('ProviderFetch_ExtravagantRetryAfter_IsCappedRatherThanObeyed', async () => {
      // Jira Cloud can answer a burst with minutes. Blocking the sync worker
      // that long is worse than failing the pass and retrying next interval.
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(response(429, undefined, { 'retry-after': '600' }))
        .mockResolvedValueOnce(response(200, {}));

      await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', { fetchFn, sleepFn });

      expect(sleepFn).toHaveBeenCalledWith(PROVIDER_RETRY_MAX_MS);
    });

    it('ProviderFetch_NoRetryAfterHeader_StillBacksOff', async () => {
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(response(429))
        .mockResolvedValueOnce(response(200, {}));

      await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', { fetchFn, sleepFn });

      expect(sleepFn).toHaveBeenCalledTimes(1);
      const waited = sleepFn.mock.calls[0][0] as number;
      expect(waited).toBeGreaterThan(0);
      expect(waited).toBeLessThanOrEqual(PROVIDER_RETRY_MAX_MS);
    });
  });

  describe('classification', () => {
    it('ProviderFetch_Unauthorised_ThrowsAuthCarryingTheServerExplanation', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(response(401, { message: 'You did not provide the correct credentials.' }));

      const err = (await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      }).catch(e => e as unknown)) as ProviderRequestError;

      expect(err.kind).toBe('auth');
      expect(err.isPermanent).toBe(true);
      expect(err.message).toContain('You did not provide the correct credentials.');
    });

    describe('a 4xx is permanent, because the retry sends identical bytes', () => {
      /**
       * Found in a real run against Jira, not by reading the code. A worklog
       * for an issue that had since been deleted answered `404 - Le ticket
       * n'existe pas`, and one Jira refused outright answered `400`. Both were
       * retried on the ordinary backoff, and every retry was a byte-identical
       * request to a byte-identical URL.
       *
       * The device driver already had this rule -- its `413` is documented as
       * permanent for exactly this reason -- and the provider side had only
       * ever applied it to 401/403.
       */
      async function statusFrom(status: number): Promise<ProviderRequestError> {
        const fetchFn = vi.fn().mockResolvedValue(response(status, {}));
        return (await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Logging time', {
          fetchFn,
          sleepFn: noSleep
        }).catch(e => e as unknown)) as ProviderRequestError;
      }

      it('IsPermanent_IssueDeletedSoTheWorklogIs404_DoesNotKeepRetrying', async () => {
        const err = await statusFrom(404);

        expect(err.kind).toBe('protocol');
        expect(err.isPermanent).toBe(true);
      });

      it('IsPermanent_PayloadRefusedWith400_DoesNotKeepRetrying', async () => {
        expect((await statusFrom(400)).isPermanent).toBe(true);
      });

      it('IsPermanent_ServerFault_StaysRetryable', async () => {
        // The request was fine and the server was not, so waiting can help.
        expect((await statusFrom(500)).isPermanent).toBe(false);
      });

      it('IsPermanent_TimeoutOrRateLimit_StayRetryableDespiteBeing4xx', async () => {
        // The two 4xx that describe a moment rather than a request.
        expect((await statusFrom(408)).isPermanent).toBe(false);
        expect((await statusFrom(429)).isPermanent).toBe(false);
      });

      it('IsPermanent_TransportFailure_StaysRetryable', async () => {
        // No status at all: the wifi dropped, or DNS blinked. Retrying is the
        // whole point of the queue.
        const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed'));
        const err = (await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Logging time', {
          fetchFn,
          sleepFn: noSleep
        }).catch(e => e as unknown)) as ProviderRequestError;

        expect(err.kind).toBe('transport');
        expect(err.isPermanent).toBe(false);
      });
    });

    it('ProviderFetch_JiraStyleErrorMessages_AreReadToo', async () => {
      // Jira Cloud returns an `errorMessages` array where OpenProject returns
      // `message`. Both are the only actionable half of the response.
      const fetchFn = vi.fn().mockResolvedValue(response(400, { errorMessages: ['Field is required'] }));

      const err = (await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching issues', {
        fetchFn,
        sleepFn: noSleep
      }).catch(e => e as unknown)) as ProviderRequestError;

      expect(err.message).toContain('Field is required');
    });

    it('ProviderFetch_NonJsonErrorBody_StillThrowsWithTheStatus', async () => {
      const fetchFn = vi.fn().mockResolvedValue(response(500));

      const err = (await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      }).catch(e => e as unknown)) as ProviderRequestError;

      expect(err.status).toBe(500);
      expect(err.message).toContain('500');
    });

    it('ProviderFetch_Success_DoesNotConsumeTheBody', async () => {
      // Reading the body to classify a 2xx would leave the caller with a
      // drained stream and no way to parse its own payload.
      const fetchFn = vi.fn().mockResolvedValue(response(200, { elements: [1, 2] }));

      const res = await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      });

      await expect(res.json()).resolves.toEqual({ elements: [1, 2] });
    });
  });

  describe('the timeout every provider call was missing', () => {
    it('ProviderFetch_AnyRequest_AttachesAnAbortSignal', async () => {
      const fetchFn = vi.fn().mockResolvedValue(response(200, {}));

      await providerFetch(PROVIDER, URL_UNDER_TEST, { method: 'GET' }, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      });

      const init = fetchFn.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('ProviderFetch_ARetriedRequest_GetsAFreshSignalNotTheExpiredOne', async () => {
      // Reusing the first attempt's signal aborts the retry the instant it
      // starts, which looks exactly like a server that failed twice.
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(response(503))
        .mockResolvedValueOnce(response(200, {}));

      await providerFetch(PROVIDER, URL_UNDER_TEST, {}, 'Fetching projects', {
        fetchFn,
        sleepFn: noSleep
      });

      const first = (fetchFn.mock.calls[0][1] as RequestInit).signal;
      const second = (fetchFn.mock.calls[1][1] as RequestInit).signal;
      expect(second).not.toBe(first);
    });

    it('ProviderFetch_CallerHeaders_SurviveTheSignalBeingAdded', async () => {
      const fetchFn = vi.fn().mockResolvedValue(response(200, {}));

      await providerFetch(
        PROVIDER,
        URL_UNDER_TEST,
        { headers: { Authorization: 'Basic abc' } },
        'Fetching projects',
        { fetchFn, sleepFn: noSleep }
      );

      const init = fetchFn.mock.calls[0][1] as RequestInit;
      expect(init.headers).toEqual({ Authorization: 'Basic abc' });
    });
  });

  describe('argument validation', () => {
    it('ProviderFetch_NoProviderId_ThrowsImmediately', async () => {
      await expect(providerFetch('', URL_UNDER_TEST, {}, 'ctx')).rejects.toThrow(/providerId/);
    });

    it('ProviderFetch_NoUrl_ThrowsImmediately', async () => {
      await expect(providerFetch(PROVIDER, '', {}, 'ctx')).rejects.toThrow(/url/);
    });
  });
});
