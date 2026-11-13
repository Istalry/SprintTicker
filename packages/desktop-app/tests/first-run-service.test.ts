import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { FirstRunDeps, FirstRunService } from '../src/main/services/first-run-service';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { DeviceStatusDTO } from '../src/shared/dtos';
import { ArgumentException } from '../src/shared/dtos';
import { connectionFailureText, FIRST_RUN_DONE_KEY, TOKEN_PAGE } from '../src/shared/first-run';

const SITE = 'https://studio.atlassian.net';
const JIRA = { providerId: 'jira' as const, site: SITE, email: 'alex@studio.com', token: 't0ken' };

/** A Jira that answers `/myself` and one page of projects, or fails as told. */
const jiraAnswering = (myself: () => Promise<Response>) =>
  vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
    const href = String(url);
    if (href.includes('/myself')) return myself();
    if (href.includes('/project/search')) {
      return new Response(JSON.stringify({ values: [{ id: '1', key: 'MG', name: 'Moonlight Garden' }, { id: '2', key: 'PF', name: 'Pixel Forge' }], isLast: true }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

/** The error Node's fetch throws when DNS or the socket fails. */
const fetchFailed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

/** The first run's main side (S1–S3, P11a). */
describe('FirstRunService', () => {
  let db: DatabaseConnection;
  let settings: SettingsRepository;
  let deps: FirstRunDeps;
  let fetchFn: ReturnType<typeof jiraAnswering>;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(db);
    fetchFn = jiraAnswering(async () => new Response(JSON.stringify({ accountId: 'a1', displayName: 'Alex Moreau' }), { status: 200 }));
    deps = {
      settings,
      isProviderConfigured: () => false,
      hasHistory: () => false,
      makeProvider: id => {
        const http = { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined };
        return id === 'jira' ? new JiraProvider(http) : id === 'openproject' ? new OpenProjectProvider(http) : null;
      },
      deviceStatus: () => ({ connected: true, ipAddress: '10.0.4.20', connectionType: 'usb' }) as DeviceStatusDTO,
      deckInstalled: () => false,
      decksConnected: () => 0,
      pluginPath: () => 'C:/app/resources/StreamDeck/SprintTicker.streamDeckPlugin',
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    };
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('when it opens', () => {
    it('ShouldShow_FreshInstall_OnceUntilFinished', () => {
      const service = new FirstRunService(deps);

      expect(service.shouldShow()).toBe(true);
      service.finish();

      expect(service.shouldShow()).toBe(false);
    });

    it.each([
      ['a provider already set up', { isProviderConfigured: () => true }],
      ['time already logged', { hasHistory: () => true }]
    ])('ShouldShow_InstallFromBefore_%s_NeverAndMarkedDone', (_label, over) => {
      const service = new FirstRunService({ ...deps, ...over });

      expect(service.shouldShow()).toBe(false);
      expect(settings.getSetting(FIRST_RUN_DONE_KEY, false)).toBe(true);
    });
  });

  describe('Test connection', () => {
    it('Jira_Answers_WhoAndHowManyProjects', async () => {
      const result = await new FirstRunService(deps).testConnection(JIRA);

      expect(result).toEqual({ ok: true, userName: 'Alex Moreau', projectCount: 2 });
    });

    it('Jira_RefusedToken_IsRefused', async () => {
      fetchFn = jiraAnswering(async () => new Response('{"errorMessages":["Unauthorized"]}', { status: 401 }));

      const result = await new FirstRunService(deps).testConnection(JIRA);

      expect(result).toMatchObject({ ok: false, reason: 'refused' });
      if (!result.ok) expect(connectionFailureText(result, 'Jira').headline).toBe('Jira refused this token');
    });

    it('Jira_AddressNotFound_NamesTheHost', async () => {
      fetchFn = vi.fn(async () => { throw fetchFailed('ENOTFOUND'); });

      const result = await new FirstRunService(deps).testConnection({ ...JIRA, site: 'studio.atlasian.net' });

      expect(result).toMatchObject({ ok: false, reason: 'not-found', host: 'studio.atlasian.net' });
      if (!result.ok) {
        expect(connectionFailureText(result, 'Jira')).toEqual({
          headline: 'studio.atlasian.net was not found',
          hint: 'Check the address: it is the one in your browser when you open Jira.'
        });
      }
    });

    it('Jira_NoNetwork_IsANetworkError', async () => {
      fetchFn = vi.fn(async () => { throw fetchFailed('ECONNRESET'); });

      const result = await new FirstRunService(deps).testConnection(JIRA);

      expect(result).toMatchObject({ ok: false, reason: 'network', host: 'studio.atlassian.net' });
    });

    it('Jira_NotJiraAtThatAddress_IsNotFound', async () => {
      fetchFn = jiraAnswering(async () => new Response('Not here', { status: 404 }));

      const result = await new FirstRunService(deps).testConnection(JIRA);

      expect(result).toMatchObject({ ok: false, reason: 'not-found' });
    });

    it('Jira_EmptyField_IsIncomplete_AndNothingIsAsked', async () => {
      const result = await new FirstRunService(deps).testConnection({ ...JIRA, token: '' });

      expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('OpenProject_Answers_ItsUserName', async () => {
      fetchFn = vi.fn(async (url: RequestInfo | URL) => String(url).includes('/users/me')
        ? new Response(JSON.stringify({ id: 7, name: 'Alex Moreau' }), { status: 200 })
        : new Response(JSON.stringify({ _embedded: { elements: [{ id: 1, identifier: 'mg', name: 'Moonlight Garden' }] }, total: 1, count: 1 }), { status: 200 }));

      const result = await new FirstRunService(deps).testConnection({ providerId: 'openproject', site: 'op.studio.com', token: 'k' });

      expect(result).toEqual({ ok: true, userName: 'Alex Moreau', projectCount: 1 });
    });

    it('UnknownProvider_Throws', async () => {
      await expect(new FirstRunService(deps).testConnection({ ...JIRA, providerId: 'adhoc' as never })).rejects.toThrow(ArgumentException);
    });
  });

  describe('the desk', () => {
    it('DetectDesk_BarOnUsb_DeckConnected', () => {
      const desk = new FirstRunService({ ...deps, deckInstalled: () => true, decksConnected: () => 1 }).detectDesk();

      expect(desk).toEqual({
        bar: { found: true, address: '10.0.4.20', connectionType: 'usb' },
        deck: { installed: true, connected: true, count: 1 }
      });
    });

    it('DetectDesk_NoBar_NothingFound', () => {
      const desk = new FirstRunService({ ...deps, deviceStatus: () => ({ connected: false, ipAddress: '10.0.4.20', connectionType: 'usb' }) as DeviceStatusDTO }).detectDesk();

      expect(desk.bar).toEqual({ found: false, address: '10.0.4.20', connectionType: null });
    });

    it('InstallDeckPlugin_OpensThePackTheAppShips', async () => {
      await expect(new FirstRunService(deps).installDeckPlugin()).resolves.toBe(true);

      expect(deps.openPath).toHaveBeenCalledWith('C:/app/resources/StreamDeck/SprintTicker.streamDeckPlugin');
    });

    it('InstallDeckPlugin_NoPackInThisBuild_False', async () => {
      await expect(new FirstRunService({ ...deps, pluginPath: () => null }).installDeckPlugin()).resolves.toBe(false);
    });

    it('InstallDeckPlugin_WindowsWouldNotOpenIt_False', async () => {
      await expect(new FirstRunService({ ...deps, openPath: async () => 'No application is associated' }).installDeckPlugin()).resolves.toBe(false);
    });
  });

  describe('make one ↗', () => {
    it('Jira_OpensAtlassiansTokenPage', async () => {
      await new FirstRunService(deps).openTokenPage('jira', 'anything');

      expect(deps.openExternal).toHaveBeenCalledWith(TOKEN_PAGE.jira);
    });

    it('OpenProject_OpensTheTokenPageOnTheServerTyped', async () => {
      await new FirstRunService(deps).openTokenPage('openproject', 'http://op.studio.com/projects');

      expect(deps.openExternal).toHaveBeenCalledWith('https://op.studio.com/my/access_tokens');
    });

    it.each([['openproject', 'not an address at all'], ['adhoc', SITE]])('NoPageToBuild_%s_OpensNothing', async (provider, site) => {
      await expect(new FirstRunService(deps).openTokenPage(provider, site)).resolves.toBe(false);

      expect(deps.openExternal).not.toHaveBeenCalled();
    });
  });
});
