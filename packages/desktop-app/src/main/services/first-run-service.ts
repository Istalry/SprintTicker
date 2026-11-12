import { SettingsRepository } from '../db/repositories/settings-repository';
import type { ITaskProvider } from '../providers/task-provider-interface';
import { isProviderRequestError } from '../providers/provider-errors';
import { ArgumentException, ArgumentNullException, DeviceStatusDTO } from '../../shared/dtos';
import {
  ConnectionTestDTO,
  ConnectionTestRequestDTO,
  DeskDetectionDTO,
  FIRST_RUN_DONE_KEY,
  hostOf,
  openProjectTokenPage,
  TOKEN_PAGE
} from '../../shared/first-run';

/** DNS answering that the name does not exist: the address is mistyped. */
const NOT_FOUND_CODES = new Set(['ENOTFOUND']);

export interface FirstRunDeps {
  settings: SettingsRepository;
  /** Jira or OpenProject has credentials already: an install from before the first run. */
  isProviderConfigured: () => boolean;
  /** Time was logged here before: an existing user, whatever their provider. */
  hasHistory: () => boolean;
  /** A fresh adapter, configured with nothing: Test connection never touches the saved one. */
  makeProvider: (providerId: string) => ITaskProvider | null;
  deviceStatus: () => DeviceStatusDTO | null;
  deckInstalled: () => boolean;
  decksConnected: () => number;
  /** The `.streamDeckPlugin` the app ships; null when it is not there (a dev build never packed it). */
  pluginPath: () => string | null;
  /** `shell.openPath`: answers an error message, or '' when it opened. */
  openPath: (path: string) => Promise<string>;
  /** `shell.openExternal`, for the token page main builds itself. */
  openExternal: (url: string) => Promise<void>;
}

/**
 * The first run (S1–S3, redesign P11a). It opens on its own once, at the
 * first launch -- never for an install that was set up before it existed --
 * and from Settings after that.
 *
 * Test connection builds its own adapter from what the user typed, so trying
 * a wrong token never replaces the saved one: Continue is what saves.
 */
export class FirstRunService {
  constructor(private readonly deps: FirstRunDeps) {
    if (!deps?.settings) throw new ArgumentNullException('settings');
  }

  /** True once, until it is finished or put off. An install set up before it is marked done here. */
  public shouldShow(): boolean {
    if (this.deps.settings.getSetting<boolean>(FIRST_RUN_DONE_KEY, false) === true) return false;
    if (this.deps.isProviderConfigured() || this.deps.hasHistory()) {
      this.finish();
      return false;
    }
    return true;
  }

  /** Start my first task, or Set up later: either way it does not open on its own again. */
  public finish(): void {
    this.deps.settings.setSetting(FIRST_RUN_DONE_KEY, true);
  }

  /**
   * Who the credentials belong to and how many projects they see -- or why
   * not, as one of the failures S1 writes out. Never throws for a failure of
   * the remote: that is the answer.
   */
  public async testConnection(request: ConnectionTestRequestDTO): Promise<ConnectionTestDTO> {
    if (!request || (request.providerId !== 'jira' && request.providerId !== 'openproject')) {
      throw new ArgumentException(`Cannot test provider: ${String(request?.providerId)}.`, 'providerId');
    }
    const host = hostOf(request.site ?? '');
    const provider = this.deps.makeProvider(request.providerId);
    if (!provider?.getUserName) {
      return { ok: false, reason: 'failed', host, detail: 'This provider cannot be tested.' };
    }
    const credentials: Record<string, string> =
      request.providerId === 'jira'
        ? { domain: request.site ?? '', jiraEmail: request.email ?? '', apiToken: request.token ?? '' }
        : { domain: request.site ?? '', apiToken: request.token ?? '' };
    try {
      await provider.initialize(credentials);
      const userName = await provider.getUserName();
      const projects = await provider.getProjects();
      return { ok: true, userName, projectCount: projects.length };
    } catch (err) {
      return { ok: false, ...FirstRunService.classify(err), host };
    }
  }

  /** What is on the desk now: S2 ticks only what it finds. */
  public detectDesk(): DeskDetectionDTO {
    const status = this.deps.deviceStatus();
    return {
      bar: {
        found: status?.connected === true,
        address: status?.ipAddress ?? '',
        connectionType: status?.connected ? (status.connectionType ?? null) : null
      },
      deck: { installed: this.deps.deckInstalled(), connected: this.deps.decksConnected() > 0 }
    };
  }

  /**
   * Opens the `.streamDeckPlugin` the app ships, so Stream Deck asks to
   * install it. False when there is none to open, or Windows would not.
   */
  public async installDeckPlugin(): Promise<boolean> {
    const path = this.deps.pluginPath();
    if (!path) return false;
    const error = await this.deps.openPath(path);
    if (error) {
      console.warn(`[FirstRunService] Could not open the Stream Deck plugin: ${error}`);
      return false;
    }
    return true;
  }

  /**
   * "make one ↗": Atlassian's token page, or the access tokens page of the
   * OpenProject server typed in S1. Built here from the host alone, since
   * `shell.openExternal` launches whatever it is handed. False when there is
   * no address to build it from.
   */
  public async openTokenPage(providerId: string, site: string): Promise<boolean> {
    const url = providerId === 'jira' ? TOKEN_PAGE.jira : providerId === 'openproject' ? openProjectTokenPage(site ?? '') : null;
    if (!url) return false;
    await this.deps.openExternal(url);
    return true;
  }

  private static classify(err: unknown): Omit<Extract<ConnectionTestDTO, { ok: false }>, 'ok' | 'host'> {
    const detail = err instanceof Error ? err.message : String(err);
    if (!isProviderRequestError(err)) return { reason: 'failed', detail };
    switch (err.kind) {
      case 'not_configured':
        return { reason: 'incomplete', detail };
      case 'auth':
        return { reason: 'refused', detail };
      case 'transport':
        return { reason: NOT_FOUND_CODES.has(FirstRunService.codeOf(err.cause) ?? '') ? 'not-found' : 'network', detail };
      case 'protocol':
        // A 404 on the account itself: the server is there, but it is not
        // Jira (or OpenProject) at that address.
        return { reason: err.status === 404 ? 'not-found' : 'failed', detail };
    }
  }

  /** The system error code, wherever fetch nested it (`TypeError: fetch failed` → cause → code). */
  private static codeOf(cause: unknown): string | null {
    let current: unknown = cause;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') return code;
      current = (current as { cause?: unknown }).cause;
    }
    return null;
  }
}
