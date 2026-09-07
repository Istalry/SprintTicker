import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey } from '../src/shared/provider-settings';

/**
 * Regression coverage for the status-id half of audit F-11.
 *
 * The three status settings shipped with the status *names* as their defaults
 * (`In progress`, `In testing`, `Developed`), but the value is interpolated
 * into `/api/v3/statuses/{id}`, which takes a numeric id. A fresh install that
 * entered credentials without opening the status dropdown therefore PATCHed
 * `/api/v3/statuses/In%20progress`, got a 404, and reported the transition as
 * simply failed.
 *
 * Databases created before the default changed still hold those names, so the
 * shape is validated at the call site rather than only at the default.
 */
describe('OpenProject status transitions', () => {
  const BASE = 'http://op.test';
  const originalFetch = global.fetch;
  let provider: OpenProjectProvider;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    provider = new OpenProjectProvider();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('ProviderSettingDefaults_StatusIds_AreEmptyRatherThanStatusNames', () => {
    // A name-shaped default is worse than none: it looks configured and
    // cannot work.
    expect(PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.OP_STATUS_IN_PROGRESS]).toBe('');
    expect(PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.OP_STATUS_TO_TEST]).toBe('');
    expect(PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.OP_STATUS_TO_REVIEW]).toBe('');
  });

  it('UpdateTaskStatus_SettingHoldsAStatusName_RefusesWithoutIssuingAnyRequest', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    await provider.initialize({ domain: BASE, apiKey: 'k', opStatusInProgress: 'In progress' });

    const ok = await provider.updateTaskStatus('OP-42', 'in_progress');

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('numeric IDs');
  });

  it('UpdateTaskStatus_SettingNeverConfigured_RefusesWithoutIssuingAnyRequest', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    await provider.initialize({ domain: BASE, apiKey: 'k' });

    const ok = await provider.updateTaskStatus('OP-42', 'in_progress');

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('UpdateTaskStatus_NumericStatusId_PatchesTheWorkPackageWithItsLockVersion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ lockVersion: 7 }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    global.fetch = fetchMock;
    await provider.initialize({ domain: BASE, apiKey: 'k', opStatusInProgress: '13' });

    const ok = await provider.updateTaskStatus('OP-42', 'in_progress');

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('http://op.test/api/v3/work_packages/42');
    const body = JSON.parse(init.body as string) as {
      lockVersion: number;
      _links: { status: { href: string } };
    };
    expect(body.lockVersion).toBe(7);
    expect(body._links.status.href).toBe('/api/v3/statuses/13');
  });

  it('UpdateTaskStatus_DoneWithCompletionActionToReview_UsesTheReviewStatusId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ lockVersion: 1 }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    global.fetch = fetchMock;
    await provider.initialize({
      domain: BASE,
      apiKey: 'k',
      opStatusToReview: '21',
      opStatusToTest: '22',
      opCompletionAction: 'to_review'
    });

    await provider.updateTaskStatus('OP-9', 'done');

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { _links: { status: { href: string } } };
    expect(body._links.status.href).toBe('/api/v3/statuses/21');
  });
});
