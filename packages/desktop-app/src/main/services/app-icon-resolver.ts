import { execFile } from 'child_process';
import { ArgumentNullException } from '../../shared/dtos';

/**
 * Runs a PowerShell script and returns its trimmed stdout.
 *
 * Injected so the resolver can be tested without a Windows shell.
 */
export type PowerShellRunner = (script: string) => Promise<string>;

/**
 * Extracts an executable's icon as a `data:image/png;base64,...` URL.
 *
 * Separate from the PowerShell runner because this is Electron's job:
 * `nativeImage.createFromPath` cannot read icon resources out of a `.exe`,
 * whereas `app.getFileIcon` asks the shell and can.
 */
export type FileIconReader = (executablePath: string) => Promise<string | null>;

/** How long a resolution attempt may run before it is abandoned. */
const RESOLVE_TIMEOUT_MS = 10_000;

/**
 * Preference order for MSIX logo variants.
 *
 * The icon is downscaled to 15x15 with filtering, so a mid-sized source beats
 * both a 16px one (nothing to filter) and a 400% one (detail averaged away).
 * Picking deliberately also avoids the previous behaviour of taking whichever
 * file sorted first, which was always `scale-100`.
 */
const LOGO_VARIANT_PREFERENCE = [
  '.targetsize-48.png',
  '.targetsize-32.png',
  '.scale-200.png',
  '.targetsize-24.png',
  '.scale-100.png'
];

/**
 * Resolves a Windows notification's app identifier to a real icon image.
 *
 * Two identifier shapes reach us, and they need different treatment:
 *
 * - **MSIX / packaged apps** report `PackageFamilyName!ApplicationId`, e.g.
 *   `com.tinyspeck.slackdesktop_8yrtsj140pw4g!com.tinyspeck.slackdesktop`. The
 *   package manifest names a logo asset. Slack ships this way.
 * - **Win32 apps** report a bare AUMID that maps to a Start-Menu shortcut, e.g.
 *   Discord. The shortcut's target executable holds the icon.
 *
 * Everything here runs off the notification path. Resolution costs hundreds of
 * milliseconds -- longer than the poller's own two-second interval -- so a
 * notification never waits on it: the first alert from an app draws the
 * hand-drawn fallback and subsequent ones draw the real icon.
 */
export class AppIconResolver {
  private readonly _cache = new Map<string, string | null>();
  private readonly _inFlight = new Map<string, Promise<string | null>>();
  private readonly _runPowerShell: PowerShellRunner;
  private readonly _readFileIcon: FileIconReader;

  constructor(runPowerShell?: PowerShellRunner, readFileIcon?: FileIconReader) {
    this._runPowerShell = runPowerShell ?? defaultPowerShellRunner;
    this._readFileIcon = readFileIcon ?? defaultFileIconReader;
  }

  /**
   * Returns an already-resolved icon source, or undefined if none is available.
   *
   * Never blocks and never starts work. Undefined covers both "not looked up
   * yet" and "looked up, nothing found"; callers that want the lookup to happen
   * call {@link resolve}, which is cheap to call repeatedly.
   */
  public getCachedIconPath(appId: string): string | undefined {
    return this._cache.get(appId) ?? undefined;
  }

  /** Whether this app id has been through a resolution attempt already. */
  public hasResolved(appId: string): boolean {
    return this._cache.has(appId);
  }

  /**
   * Resolves and caches the icon source for an app id.
   *
   * Idempotent: a completed lookup is served from cache, and concurrent lookups
   * for the same app id share one attempt. A failed lookup is cached as a miss
   * so a machine that simply has no icon for an app is not re-scanned on every
   * notification it sends.
   */
  public async resolve(appId: string, appName?: string): Promise<string | null> {
    if (!appId) throw new ArgumentNullException('appId');

    const cached = this._cache.get(appId);
    if (cached !== undefined) return cached;

    const existing = this._inFlight.get(appId);
    if (existing) return existing;

    const attempt = this.performResolve(appId, appName)
      .catch(err => {
        console.warn(`[AppIconResolver] Resolution failed for ${appId}:`, err);
        return null;
      })
      .then(result => {
        this._cache.set(appId, result);
        this._inFlight.delete(appId);
        return result;
      });

    this._inFlight.set(appId, attempt);
    return attempt;
  }

  /** Drops every cached result, so the next resolve re-scans. */
  public clearCache(): void {
    this._cache.clear();
  }

  private async performResolve(appId: string, appName?: string): Promise<string | null> {
    const packaged = await this.resolvePackagedLogo(appId);
    if (packaged) return packaged;

    const executable = await this.resolveExecutablePath(appId, appName);
    if (!executable) return null;

    return this._readFileIcon(executable);
  }

  /**
   * Finds the logo asset declared by a packaged app's manifest.
   *
   * The AUMID's suffix after `!` names which `<Application>` inside the package
   * sent the notification, and it matters: a package may declare several. The
   * previous implementation read
   * `$xml.Package.Applications.Application.VisualElements.Square44x44Logo`
   * without selecting one, so on any such package that expression produced an
   * array and every downstream string operation failed silently under
   * `SilentlyContinue` -- no logo, no error, a hand-drawn fallback.
   *
   * Found by checking the assumption that Slack, Discord and Teams all failed
   * because `Get-AppxPackage` could not see them. Slack resolved correctly
   * already; the multi-application case was a separate defect, reproduced
   * against the MSTeams package Windows registers whether or not anyone uses it.
   */
  private async resolvePackagedLogo(appId: string): Promise<string | null> {
    const [familyName, applicationId] = splitAumid(appId);
    if (!familyName) return null;

    const script = `
$ErrorActionPreference = 'Stop'
$familyName = ${psLiteral(familyName)}
$applicationId = ${psLiteral(applicationId ?? '')}
$preferred = @(${LOGO_VARIANT_PREFERENCE.map(psLiteral).join(',')})

$pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $familyName } | Select-Object -First 1
if (-not $pkg) {
  $pkg = Get-AppxPackage -Name ($familyName -split '_')[0] | Select-Object -First 1
}
if (-not $pkg -or -not $pkg.InstallLocation) { return }

$manifest = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
if (-not (Test-Path $manifest)) { return }
[xml]$xml = Get-Content -LiteralPath $manifest

# Select the application that actually raised the notification; a package may
# declare several, in which case the unselected expression yields an array.
$apps = @($xml.Package.Applications.Application)
$app = $apps | Where-Object { $_.Id -eq $applicationId } | Select-Object -First 1
if (-not $app) { $app = $apps | Select-Object -First 1 }
if (-not $app) { return }

$logoRel = $app.VisualElements.Square44x44Logo
if (-not $logoRel) { $logoRel = $app.VisualElements.Square150x150Logo }
if (-not $logoRel -or $logoRel -isnot [string]) { return }

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($logoRel)
$parentDir = Join-Path $pkg.InstallLocation (Split-Path $logoRel -Parent)
if (-not (Test-Path $parentDir)) { return }

foreach ($suffix in $preferred) {
  $candidate = Join-Path $parentDir ($baseName + $suffix)
  if (Test-Path -LiteralPath $candidate) { Write-Output $candidate; return }
}

# No preferred variant: the unqualified file, then anything matching.
$plain = Join-Path $parentDir ($baseName + '.png')
if (Test-Path -LiteralPath $plain) { Write-Output $plain; return }
$any = Get-ChildItem -LiteralPath $parentDir -Filter ($baseName + '*.png') | Select-Object -First 1
if ($any) { Write-Output $any.FullName }
`;

    const output = await this._runPowerShell(script);
    return output ? output.split(/\r?\n/)[0].trim() || null : null;
  }

  /**
   * Maps a Win32 app to the executable behind its Start-Menu shortcut.
   *
   * Windows derives an unpackaged app's AUMID from the shortcut that launched
   * it, so the shortcut is the way back to the binary. The authoritative link is
   * the shortcut's `System.AppUserModel.ID` property, but reading a property
   * store from PowerShell needs native interop, and the shell's own detail
   * columns do not expose it. Matching the shortcut's file name against tokens
   * taken from the AUMID gets there for the apps that matter -- Discord reports
   * `com.squirrel.Discord.Discord` and ships `Discord.lnk` -- at a fraction of
   * the cost, since only a matching shortcut is opened.
   *
   * Wrong matches are possible in principle. They degrade to a plausible icon
   * for a similarly named app rather than to anything harmful, and a per-rule
   * icon override exists for the cases where they are not good enough.
   */
  private async resolveExecutablePath(appId: string, appName?: string): Promise<string | null> {
    const tokens = buildNameTokens(appId, appName);
    if (tokens.length === 0) return null;

    const script = `
$ErrorActionPreference = 'Stop'
$tokens = @(${tokens.map(psLiteral).join(',')})
$roots = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if ($roots.Count -eq 0) { return }

# Collect first, open second: reading a shortcut needs COM, so only candidates
# whose name already matched are opened.
$candidates = @()
foreach ($root in $roots) {
  foreach ($lnk in Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($lnk.Name)
    foreach ($token in $tokens) {
      if ($stem -eq $token) { $candidates += ,@(0, $lnk.FullName); break }
      if ($stem -like ('*' + $token + '*')) { $candidates += ,@(1, $lnk.FullName); break }
    }
  }
}
if ($candidates.Count -eq 0) { return }

$shell = New-Object -ComObject WScript.Shell
foreach ($candidate in ($candidates | Sort-Object { $_[0] })) {
  try {
    $target = $shell.CreateShortcut($candidate[1]).TargetPath
  } catch { continue }
  if (-not $target -or -not (Test-Path -LiteralPath $target) -or $target -notlike '*.exe') { continue }

  # Squirrel-packaged apps point their shortcut at the updater stub, which
  # carries a generic media icon rather than the app's own -- Discord's
  # Update.exe is a film strip. The real binary lives in the newest app-<ver>
  # folder beside it.
  if ([System.IO.Path]::GetFileName($target) -ieq 'Update.exe') {
    $stubDir = Split-Path $target -Parent
    $appDir = Get-ChildItem -LiteralPath $stubDir -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($appDir) {
      $inner = Get-ChildItem -LiteralPath $appDir.FullName -Filter '*.exe' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne 'Update.exe' }
      $named = $inner | Where-Object { $tokens -contains [System.IO.Path]::GetFileNameWithoutExtension($_.Name) } |
        Select-Object -First 1
      if (-not $named) { $named = $inner | Sort-Object Length -Descending | Select-Object -First 1 }
      if ($named) { $target = $named.FullName }
    }
  }

  Write-Output $target
  return
}
`;

    const output = await this._runPowerShell(script);
    return output ? output.split(/\r?\n/)[0].trim() || null : null;
  }
}

/**
 * Turns a Windows app identifier into something worth putting on a 72px display.
 *
 * The PowerShell poller derives its `appName` by stripping a few known
 * prefixes off the AUMID, which handles Slack and the Microsoft toasts and
 * leaves Squirrel-packaged apps looking like `squirrel.Discord.Discord` --
 * `com.` is removed, `squirrel.` is not. That was invisible for as long as the
 * banner rewrote every chat app's label to the literal "Message"; removing
 * that rewrite put the raw identifier on screen.
 *
 * A name the user would recognise beats a faithful one here, so an identifier
 * is reduced to its most specific token. A name with no separators in it is
 * already a name and is left alone.
 */
export function deriveAppDisplayName(appId?: string, appName?: string): string {
  const raw = (appName ?? '').trim();
  if (raw && !/[._!/]/.test(raw)) return raw;

  // Tokens come from the id, never from `raw`: passing a dotted name in would
  // see it kept whole as the first candidate, which is the thing being fixed.
  //
  // The first token, not the last. `buildNameTokens` orders them most-specific
  // first, and the tail of a real AUMID is publisher noise --
  // `Microsoft.ScreenSketch_8wekyb3d8bbwe!App` ends in the package hash.
  const tokens = buildNameTokens(appId || raw);
  return tokens.length > 0 ? tokens[0] : raw;
}

/**
 * Derives plausible shortcut names from an app identifier.
 *
 * `com.squirrel.Discord.Discord` yields `Discord`; `Slack` yields `Slack`.
 * Segments shorter than three characters and the generic vendor prefixes that
 * appear in every Squirrel-packaged AUMID are dropped, because matching a
 * shortcut on `com` would return whatever sorted first.
 */
export function buildNameTokens(appId: string, appName?: string): string[] {
  const noise = new Set(['com', 'org', 'net', 'exe', 'app', 'squirrel', 'microsoft', 'windows']);
  const raw = [
    ...(appName ? [appName] : []),
    ...appId.split(/[.!_\\/-]/)
  ];

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const candidate of raw) {
    const trimmed = candidate.trim();
    if (trimmed.length < 3) continue;
    const key = trimmed.toLowerCase();
    if (noise.has(key) || seen.has(key)) continue;
    seen.add(key);
    tokens.push(trimmed);
  }
  return tokens;
}

/**
 * Splits `PackageFamilyName!ApplicationId` into its two halves.
 *
 * Returns an empty family name for anything without a `!`, which is how an
 * unpackaged Win32 AUMID is told apart from a packaged one.
 */
export function splitAumid(appId: string): [string, string | null] {
  const separator = appId.indexOf('!');
  if (separator <= 0) return ['', null];
  return [appId.slice(0, separator), appId.slice(separator + 1) || null];
}

/** Quotes a value for safe interpolation into a PowerShell single-quoted string. */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const defaultPowerShellRunner: PowerShellRunner = script =>
  new Promise<string>(resolvePromise => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: RESOLVE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        // A non-zero exit means "no icon found here", not a fault worth throwing:
        // the caller has a fallback and the next strategy should still run.
        if (err && !stdout) {
          resolvePromise('');
          return;
        }
        resolvePromise((stdout || '').trim());
      }
    );
  });

const defaultFileIconReader: FileIconReader = async executablePath => {
  // Required lazily so importing this module outside Electron -- in a unit test,
  // for instance -- does not pull in the whole runtime.
  const { app } = await import('electron');
  const image = await app.getFileIcon(executablePath, { size: 'large' });
  if (!image || image.isEmpty()) return null;
  return image.toDataURL();
};
