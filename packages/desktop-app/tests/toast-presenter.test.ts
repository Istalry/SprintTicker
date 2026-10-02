import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ElectronToastPresenter, MAX_LIVE_TOASTS, NotificationLike, isSafeExternalUrl } from '../src/main/services/toast-presenter';
import { APP_USER_MODEL_ID, OWN_APP_USER_MODEL_IDS } from '../src/main/app-identity';

/** A Notification that records its handlers so a test can click it. */
class FakeNotification implements NotificationLike {
  public shown = false;
  public readonly handlers = new Map<string, (...args: unknown[]) => void>();
  constructor(public readonly options: { title: string; body: string }) {}
  show(): void { this.shown = true; }
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.handlers.set(event, listener);
    return this;
  }
  fire(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }
}

describe('ElectronToastPresenter', () => {
  let created: FakeNotification[];
  let openExternal: ReturnType<typeof vi.fn>;
  let supported: boolean;
  let presenter: ElectronToastPresenter;

  beforeEach(() => {
    created = [];
    supported = true;
    openExternal = vi.fn().mockResolvedValue(undefined);
    presenter = new ElectronToastPresenter({
      isSupported: () => supported,
      create: options => {
        const n = new FakeNotification(options);
        created.push(n);
        return n;
      },
      openExternal
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('Show_Supported_ShowsTitleAndBody', () => {
    expect(presenter.show({ title: 'Alice mentioned you on OP-1', body: 'Task 1' })).toBe(true);

    expect(created[0].options).toEqual({ title: 'Alice mentioned you on OP-1', body: 'Task 1' });
    expect(created[0].shown).toBe(true);
  });

  it('Click_WebLink_OpensIt', () => {
    presenter.show({ title: 't', body: 'b', url: 'https://op.test/work_packages/1' });

    created[0].fire('click');

    expect(openExternal).toHaveBeenCalledWith('https://op.test/work_packages/1');
  });

  it('Click_NonWebLink_IsRefused', () => {
    // The link comes from a remote server; the shell would run a file: URL.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    presenter.show({ title: 't', body: 'b', url: 'file:///C:/Windows/System32/calc.exe' });

    created[0].fire('click');

    expect(openExternal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('Click_NoLink_OpensNothing', () => {
    presenter.show({ title: 't', body: 'b' });

    created[0].fire('click');

    expect(openExternal).not.toHaveBeenCalled();
  });

  it('Click_ShellRefuses_IsLoggedNotThrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openExternal.mockRejectedValue(new Error('no handler'));
    presenter.show({ title: 't', body: 'b', url: 'https://op.test' });

    created[0].fire('click');
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith('[Toasts] Could not open the notification link:', expect.any(Error));
  });

  it('Failed_WindowsRefusedTheToast_IsLogged', () => {
    // The symptom of an AppUserModelID Windows cannot place is a toast that
    // never appears; this is the only trace of it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    presenter.show({ title: 't', body: 'b' });

    created[0].fire('failed', {}, 'HRESULT 0x80070490');

    expect(warn).toHaveBeenCalledWith('[Toasts] Windows did not show a notification:', 'HRESULT 0x80070490');
  });

  it('Show_Unsupported_ShowsNothingAndWarnsOnce', () => {
    supported = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(presenter.show({ title: 't', body: 'b' })).toBe(false);
    presenter.show({ title: 't', body: 'b' });

    expect(created).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('Show_ManyNeverClosed_KeepsABoundedNumberAlive', () => {
    for (let i = 0; i < MAX_LIVE_TOASTS + 5; i++) presenter.show({ title: `t${i}`, body: 'b' });
    created[0].fire('close');
    created[created.length - 1].fire('close');

    const live = (presenter as unknown as { live: unknown[] }).live;
    expect(live.length).toBe(MAX_LIVE_TOASTS - 1);
  });
});

describe('isSafeExternalUrl', () => {
  it('AcceptsHttpAndHttpsOnly', () => {
    expect(isSafeExternalUrl('https://op.test/x')).toBe(true);
    expect(isSafeExternalUrl('http://op.local/x')).toBe(true);
    expect(isSafeExternalUrl('file:///C:/x')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('ms-settings:privacy')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});

describe('app identity', () => {
  it('AppUserModelId_EqualsTheInstallersAppId', () => {
    // Windows shows a toast only for the ID on the Start-menu shortcut, which
    // the installer writes from appId. They differed once, and an installed
    // copy could post toasts that never appeared.
    const builder = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'electron-builder.json'), 'utf8')) as { appId: string };

    expect(APP_USER_MODEL_ID).toBe(builder.appId);
    expect(OWN_APP_USER_MODEL_IDS).toContain(APP_USER_MODEL_ID);
  });
});
