import { describe, it, expect, vi } from 'vitest';
import { AppIconResolver, buildNameTokens, splitAumid } from '../src/main/services/app-icon-resolver';

/**
 * Icon resolution has to cover two different worlds. Packaged apps -- Slack
 * ships as MSIX -- declare a logo in their manifest. Unpackaged Win32 apps such
 * as Discord only reach us as an AUMID that has to be traced back through a
 * Start-Menu shortcut to an executable.
 *
 * The audit assumed both were Win32 and that `Get-AppxPackage` could not see
 * them. It could: Slack resolved correctly all along. Checking that assumption
 * turned up a different defect -- a package declaring several `<Application>`
 * nodes made `Applications.Application.VisualElements.Square44x44Logo` return an
 * array, and every string operation after it failed silently.
 */
describe('AppIconResolver', () => {
  const AUMID_SLACK = 'com.tinyspeck.slackdesktop_8yrtsj140pw4g!com.tinyspeck.slackdesktop';

  it('SplitAumid_PackagedIdentifier_SeparatesFamilyAndApplication', () => {
    expect(splitAumid(AUMID_SLACK)).toEqual([
      'com.tinyspeck.slackdesktop_8yrtsj140pw4g',
      'com.tinyspeck.slackdesktop'
    ]);
  });

  it('SplitAumid_Win32Identifier_ReportsNoPackageFamily', () => {
    // No `!` means unpackaged, which is what selects the shortcut strategy.
    expect(splitAumid('com.squirrel.Discord.Discord')).toEqual(['', null]);
  });

  it('BuildNameTokens_SquirrelAumid_YieldsTheAppName', () => {
    expect(buildNameTokens('com.squirrel.Discord.Discord', 'Discord')).toEqual(['Discord']);
  });

  it('BuildNameTokens_GenericSegments_AreDropped', () => {
    // Matching a shortcut on `com` would return whatever sorted first.
    const tokens = buildNameTokens('com.microsoft.windows.thing', 'Thing');

    expect(tokens).not.toContain('com');
    expect(tokens).not.toContain('microsoft');
    expect(tokens).toContain('Thing');
  });

  it('Resolve_PackagedApp_QueriesTheManifestAndSkipsTheShortcutScan', async () => {
    const runner = vi.fn().mockResolvedValue('C:\\Apps\\Slack\\Assets\\SlackAppList.targetsize-48.png');
    const resolver = new AppIconResolver(runner, async () => null);

    const result = await resolver.resolve(AUMID_SLACK, 'Slack');

    expect(result).toBe('C:\\Apps\\Slack\\Assets\\SlackAppList.targetsize-48.png');
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toContain('Get-AppxPackage');
  });

  it('Resolve_PackagedApp_SelectsTheApplicationNamedByTheAumid', () => {
    // A package may declare several; picking none was the bug.
    const runner = vi.fn().mockResolvedValue('');
    const resolver = new AppIconResolver(runner, async () => null);

    void resolver.resolve('MSTeams_8wekyb3d8bbwe!MSTeams', 'Microsoft Teams');

    const script = runner.mock.calls[0][0] as string;
    expect(script).toContain('$_.Id -eq $applicationId');
    expect(script).toContain("'MSTeams'");
  });

  it('Resolve_UnpackagedApp_FallsThroughToTheShortcutStrategy', async () => {
    const exe = 'C:\\Users\\x\\AppData\\Local\\Discord\\app-1.0.9256\\Discord.exe';
    const runner = vi.fn().mockResolvedValue(exe);
    const readIcon = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
    const resolver = new AppIconResolver(runner, readIcon);

    const result = await resolver.resolve('com.squirrel.Discord.Discord', 'Discord');

    expect(result).toBe('data:image/png;base64,AAAA');
    expect(readIcon).toHaveBeenCalledWith(exe);
    // An identifier with no `!` is not a package, so the manifest query is
    // skipped entirely rather than run and discarded.
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toContain('Start Menu');
  });

  it('Resolve_SquirrelStub_IsDereferencedToTheRealBinary', async () => {
    // A Squirrel shortcut points at Update.exe, whose icon is a generic film
    // strip rather than the app's own.
    const runner = vi.fn().mockResolvedValue('');
    const resolver = new AppIconResolver(runner, async () => null);

    await resolver.resolve('com.squirrel.Discord.Discord', 'Discord');

    const scripts = runner.mock.calls.map(call => call[0] as string).join('\n');
    expect(scripts).toContain("-ieq 'Update.exe'");
    expect(scripts).toContain("-Filter 'app-*'");
  });

  it('Resolve_NothingFound_CachesTheMissAndDoesNotRescan', async () => {
    const runner = vi.fn().mockResolvedValue('');
    const resolver = new AppIconResolver(runner, async () => null);

    expect(await resolver.resolve('unknown.app', 'Unknown')).toBeNull();
    const callsAfterFirst = runner.mock.calls.length;
    expect(await resolver.resolve('unknown.app', 'Unknown')).toBeNull();

    // A machine that simply has no icon for an app must not be re-scanned on
    // every notification it sends.
    expect(runner.mock.calls.length).toBe(callsAfterFirst);
  });

  it('Resolve_ConcurrentCalls_ShareOneAttempt', async () => {
    const runner = vi.fn().mockResolvedValue('C:\\icon.png');
    const resolver = new AppIconResolver(runner, async () => null);

    const [a, b] = await Promise.all([resolver.resolve(AUMID_SLACK), resolver.resolve(AUMID_SLACK)]);

    expect(a).toBe('C:\\icon.png');
    expect(b).toBe('C:\\icon.png');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('Resolve_RunnerThrows_ReturnsNullRatherThanRejecting', async () => {
    // This runs from a notification handler; a rejection here would be an
    // unhandled rejection, which terminates the main process on Node 15+.
    const resolver = new AppIconResolver(
      async () => {
        throw new Error('powershell missing');
      },
      async () => null
    );

    await expect(resolver.resolve('some.app')).resolves.toBeNull();
  });

  it('GetCachedIconPath_BeforeResolution_ReturnsUndefinedWithoutBlocking', () => {
    const resolver = new AppIconResolver(
      async () => 'C:\\icon.png',
      async () => null
    );

    expect(resolver.getCachedIconPath(AUMID_SLACK)).toBeUndefined();
    expect(resolver.hasResolved(AUMID_SLACK)).toBe(false);
  });

  it('GetCachedIconPath_AfterResolution_ServesTheResultSynchronously', async () => {
    const resolver = new AppIconResolver(
      async () => 'C:\\icon.png',
      async () => null
    );

    await resolver.resolve(AUMID_SLACK);

    expect(resolver.getCachedIconPath(AUMID_SLACK)).toBe('C:\\icon.png');
    expect(resolver.hasResolved(AUMID_SLACK)).toBe(true);
  });

  it('Resolve_EmptyAppId_ThrowsArgumentNullException', async () => {
    const resolver = new AppIconResolver(async () => '', async () => null);

    await expect(resolver.resolve('')).rejects.toThrow('Argument cannot be null or undefined: appId');
  });

  it('ClearCache_AfterResolution_ForcesAFreshScan', async () => {
    const runner = vi.fn().mockResolvedValue('C:\\icon.png');
    const resolver = new AppIconResolver(runner, async () => null);

    await resolver.resolve(AUMID_SLACK);
    resolver.clearCache();
    await resolver.resolve(AUMID_SLACK);

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('Resolve_AppIdContainingQuote_DoesNotBreakOutOfThePowerShellLiteral', async () => {
    const runner = vi.fn().mockResolvedValue('');
    const resolver = new AppIconResolver(runner, async () => null);

    await resolver.resolve("weird'; Remove-Item C:\\ -Recurse; '!inner", 'Weird');

    // Every quote is doubled, so the payload stays inside the string literal
    // instead of closing it and starting a new statement.
    const script = runner.mock.calls[0][0] as string;
    expect(script).toContain("'weird''; Remove-Item");
  });
});
