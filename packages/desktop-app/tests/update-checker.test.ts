import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UpdateChecker, UpdateCheckError, compareSemver } from '../src/main/updater/update-checker';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';

describe('compareSemver', () => {
  it('CompareSemver_DifferingComponents_OrdersNumericallyNotLexically', () => {
    // '10' sorts before '9' as a string, which is the classic way this breaks.
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.0.1', '1.0.2')).toBeLessThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('CompareSemver_LeadingV_IsIgnored', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
  });

  it('CompareSemver_PreRelease_SortsBeforeItsRelease', () => {
    // Otherwise someone running 1.2.0-beta.1 is never told 1.2.0 shipped.
    expect(compareSemver('1.2.0-beta.1', '1.2.0')).toBeLessThan(0);
    expect(compareSemver('1.2.0', '1.2.0-beta.1')).toBeGreaterThan(0);
  });
});

describe('UpdateChecker', () => {
  let settingsRepo: SettingsRepository;
  let store: Map<string, unknown>;

  function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
    return vi.fn(async () => response as Response) as unknown as typeof globalThis.fetch;
  }

  function releaseResponse(tag: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: tag, html_url: `https://example.invalid/${tag}` })
    };
  }

  beforeEach(() => {
    store = new Map();
    settingsRepo = {
      getSetting: vi.fn((key: string, fallback: unknown) => store.get(key) ?? fallback),
      setSetting: vi.fn((key: string, value: unknown) => store.set(key, value))
    } as unknown as SettingsRepository;
  });

  it('Constructor_MissingVersion_ThrowsArgumentNullException', () => {
    expect(() => new UpdateChecker('', settingsRepo)).toThrowError(/currentVersion/);
  });

  it('CheckForUpdate_NewerReleasePublished_ReportsItWithTheReleaseUrl', async () => {
    const checker = new UpdateChecker('1.0.0', settingsRepo, stubFetch(releaseResponse('v1.1.0')));

    const result = await checker.checkForUpdate();

    expect(result).toEqual({
      status: 'update-available',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      releaseUrl: 'https://example.invalid/v1.1.0'
    });
  });

  it('CheckForUpdate_SameOrOlderRelease_ReportsUpToDate', async () => {
    const same = new UpdateChecker('1.2.0', settingsRepo, stubFetch(releaseResponse('v1.2.0')));
    const older = new UpdateChecker('1.3.0', settingsRepo, stubFetch(releaseResponse('v1.2.0')));

    expect((await same.checkForUpdate()).status).toBe('up-to-date');
    expect((await older.checkForUpdate()).status).toBe('up-to-date');
  });

  it('CheckForUpdate_Disabled_MakesNoRequestAtAll', async () => {
    const fetchFn = stubFetch(releaseResponse('v9.9.9'));
    const checker = new UpdateChecker('1.0.0', settingsRepo, fetchFn);
    checker.setEnabled(false);

    const result = await checker.checkForUpdate();

    expect(result.status).toBe('disabled');
    // Turning the check off has to stop the outbound request, not just hide
    // its result -- that is the entire point of the setting.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  /**
   * The service this replaces logged "checking for updates" and never checked
   * (audit F-18). Every failure below must be distinguishable from "up to
   * date", because silently claiming the user is current is exactly the lie
   * that got the old one deleted.
   */
  it('CheckForUpdate_NetworkUnreachable_ThrowsRatherThanClaimingUpToDate', async () => {
    const failing = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof globalThis.fetch;
    const checker = new UpdateChecker('1.0.0', settingsRepo, failing);

    await expect(checker.checkForUpdate()).rejects.toThrowError(UpdateCheckError);
    await expect(checker.checkForUpdate()).rejects.toThrowError(/ENOTFOUND/);
  });

  it('CheckForUpdate_NoReleasePublishedYet_ThrowsWithAReadableReason', async () => {
    const checker = new UpdateChecker('1.0.0', settingsRepo, stubFetch({ ok: false, status: 404 }));

    await expect(checker.checkForUpdate()).rejects.toThrowError(/No published release/);
  });

  it('CheckForUpdate_RateLimitedOrErrored_ThrowsWithTheStatus', async () => {
    const checker = new UpdateChecker('1.0.0', settingsRepo, stubFetch({ ok: false, status: 403 }));

    await expect(checker.checkForUpdate()).rejects.toThrowError(/403/);
  });

  it('CheckForUpdate_ResponseWithoutATag_Throws', async () => {
    const checker = new UpdateChecker(
      '1.0.0',
      settingsRepo,
      stubFetch({ ok: true, status: 200, json: async () => ({}) })
    );

    await expect(checker.checkForUpdate()).rejects.toThrowError(/no tag name/);
  });
});
