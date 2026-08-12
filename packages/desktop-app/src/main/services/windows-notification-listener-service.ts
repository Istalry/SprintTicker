import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { PriorityPreemptionEngine } from './priority-preemption-engine';
import { DisplayRenderer } from '../hardware/display-renderer';
import {
  WindowsNotificationSettingsDTO,
  WindowsNotificationEventDTO,
  NotificationSourceRule,
  NotificationLogEntryDTO,
  NotificationLogLevel,
  NotificationListenerStatusDTO,
  BitmapIconId,
  ArgumentNullException
} from '../../shared/dtos';
import { AppIconBitmapProcessor } from '../hardware/app-icon-bitmap-processor';

/**
 * Service that captures Windows Action Center / System notifications,
 * evaluates per-source priority rules (DONT_SHOW, DEFAULT, HIGH_PRIORITY),
 * and renders formatted notification banners on the BUSY Bar LED display.
 *
 * Uses a dual-strategy approach:
 * 1. Primary: Polls the Windows Notification Database (wpndatabase.db) for real-time notifications
 * 2. Fallback: Battery monitoring via WMI CIM queries
 */
export class WindowsNotificationListenerService {
  private static readonly DB_SETTINGS_KEY = 'windows_notification_settings';
  private static readonly DEFAULT_POLLING_INTERVAL_SECONDS = 2;
  private static readonly MAX_LOG_ENTRIES = 200;

  private readonly _settingsRepo: SettingsRepository;
  private readonly _priorityEngine: PriorityPreemptionEngine;
  private readonly _renderer?: DisplayRenderer;

  private _psProcess: ChildProcess | null = null;
  private _readlineInterface: readline.Interface | null = null;
  private _isListening: boolean = false;

  private _logEntries: NotificationLogEntryDTO[] = [];
  private _logSubscribers: ((entry: NotificationLogEntryDTO) => void)[] = [];
  private _totalCaptured = 0;
  private _totalSuppressed = 0;
  private _strategy: 'DB_POLLING' | 'WINRT' | 'NONE' = 'NONE';
  private _hasSqlite3 = false;
  private _hasNotifDb = false;
  private _lastPollTimestamp?: string;
  private _errorMessage?: string;

  constructor(
    settingsRepo: SettingsRepository,
    priorityEngine: PriorityPreemptionEngine,
    renderer?: DisplayRenderer
  ) {
    if (!settingsRepo) throw new ArgumentNullException('settingsRepo');
    if (!priorityEngine) throw new ArgumentNullException('priorityEngine');

    this._settingsRepo = settingsRepo;
    this._priorityEngine = priorityEngine;
    this._renderer = renderer;
  }

  /**
   * Retrieves configured Windows notification settings and per-source priority rules.
   */
  public getSettings(): WindowsNotificationSettingsDTO {
    return this._settingsRepo.getSetting<WindowsNotificationSettingsDTO>(
      WindowsNotificationListenerService.DB_SETTINGS_KEY,
      {
        enableListener: true,
        notificationTimeoutSeconds: 10,
        pollingIntervalSeconds: WindowsNotificationListenerService.DEFAULT_POLLING_INTERVAL_SECONDS,
        sourceRules: [
          { appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DEFAULT' },
          { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY' },
          { appId: 'antigravity', appName: 'Antigravity', iconId: 'antigravity', priorityMode: 'DEFAULT' },
          { appId: 'gmail', appName: 'Gmail / Outlook', iconId: 'gmail', priorityMode: 'DEFAULT' },
          { appId: 'battery', appName: 'System Battery', iconId: 'battery', priorityMode: 'HIGH_PRIORITY' },
          { appId: 'windows', appName: 'Windows System', iconId: 'windows', priorityMode: 'DEFAULT' }
        ]
      }
    );
  }

  /**
   * Persists partial or full Windows notification settings to SQLite database.
   */
  public saveSettings(settings: Partial<WindowsNotificationSettingsDTO>): void {
    if (!settings) throw new ArgumentNullException('settings');
    const current = this.getSettings();
    const merged: WindowsNotificationSettingsDTO = {
      ...current,
      ...settings,
      sourceRules: settings.sourceRules ?? current.sourceRules
    };
    this._settingsRepo.setSetting(WindowsNotificationListenerService.DB_SETTINGS_KEY, merged);
  }

  /**
   * Subscribes to real-time log events emitted by the notification listener.
   */
  public onLog(callback: (entry: NotificationLogEntryDTO) => void): () => void {
    this._logSubscribers.push(callback);
    return () => {
      this._logSubscribers = this._logSubscribers.filter(cb => cb !== callback);
    };
  }

  /**
   * Returns buffered log entries for initial hydration of the debug console.
   */
  public getLogEntries(): NotificationLogEntryDTO[] {
    return [...this._logEntries];
  }

  /**
   * Returns current listener status for the UI status indicator.
   */
  public getListenerStatus(): NotificationListenerStatusDTO {
    return {
      isListening: this._isListening,
      strategy: this._strategy,
      hasSqlite3: this._hasSqlite3,
      hasNotifDb: this._hasNotifDb,
      lastPollTimestamp: this._lastPollTimestamp,
      totalCaptured: this._totalCaptured,
      totalSuppressed: this._totalSuppressed,
      errorMessage: this._errorMessage
    };
  }

  /**
   * Starts active OS-level listening for Windows notifications via dual-strategy:
   * 1. Primary: Polls Windows Notification Database (wpndatabase.db) — works for all apps
   * 2. Battery: WMI battery status monitoring
   */
  public startListening(): void {
    if (this._isListening) return;
    this._isListening = true;

    if (process.platform !== 'win32') {
      this.emitLog('warn', 'Non-Windows OS platform detected. OS listener suspended.');
      return;
    }

    const settings = this.getSettings();
    if (!settings.enableListener) {
      this.emitLog('info', 'Notification listener is disabled in settings.');
      return;
    }

    const pollingIntervalMs = (settings.pollingIntervalSeconds || WindowsNotificationListenerService.DEFAULT_POLLING_INTERVAL_SECONDS) * 1000;

    try {
      const rawScript = this.buildPowerShellScript(pollingIntervalMs);

      // Convert script to Base64 (UTF-16LE) to prevent parsing/quoting issues across OS shells
      const encodedScript = Buffer.from(rawScript, 'utf16le').toString('base64');

      this._psProcess = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodedScript
      ], {
        windowsHide: true
      });

      // Use readline to process stdout line-by-line safely regardless of buffer chunk sizes
      if (this._psProcess.stdout) {
        this._readlineInterface = readline.createInterface({
          input: this._psProcess.stdout,
          terminal: false
        });

        this._readlineInterface.on('line', (line: string) => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('{')) return;

          try {
            const data = JSON.parse(trimmed);

            if (data.type === 'status') {
              this.emitLog('info', data.message);

              // Track capabilities reported by PowerShell
              if (data.message?.includes('DB polling active')) {
                this._strategy = 'DB_POLLING';
                this._hasSqlite3 = true;
                this._hasNotifDb = true;
              }
              if (data.message?.includes('Watermark initialized')) {
                this._lastPollTimestamp = new Date().toISOString();
              }
              return;
            }

            if (data.type === 'error') {
              this.emitLog('error', `${data.code}: ${data.message}`);
              this._errorMessage = `${data.code}: ${data.message}`;

              if (data.code === 'NO_SQLITE3') {
                this._hasSqlite3 = false;
              }
              if (data.code === 'NO_WPNDB') {
                this._hasNotifDb = false;
              }
              return;
            }

            // Notification event from PowerShell
            this._lastPollTimestamp = new Date().toISOString();
            const handled = this.handleNotification({
              id: data.id || `win_${Date.now()}`,
              appId: data.appId,
              appName: data.appName,
              title: data.title,
              body: data.body,
              iconPath: data.iconPath,
              timestampUtc: data.timestampUtc || new Date().toISOString()
            });

            if (handled) {
              this._totalCaptured++;
              this.emitLog('notification', `[${data.appName}][${data.id}] ${data.title || ''}${data.body ? ': ' + data.body : ''}`.trim());
            } else {
              this._totalSuppressed++;
              this.emitLog('info', `Suppressed: [${data.appName}][${data.id}] ${data.title || ''}`);
            }
          } catch {
            // Non-JSON output line safely ignored
          }
        });
      }

      this._psProcess.stderr?.on('data', (errData: Buffer) => {
        const msg = errData.toString('utf8').trim();
        if (msg) {
          this.emitLog('warn', `PS stderr: ${msg}`);
        }
      });

      this._psProcess.on('exit', (code) => {
        this.emitLog('warn', `PowerShell process exited with code ${code}`);
        this._isListening = false;
        this._psProcess = null;
        this._readlineInterface = null;
        this._strategy = 'NONE';
      });

      this.emitLog('info', `Listener started (polling interval: ${pollingIntervalMs}ms).`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.emitLog('error', `Failed to launch PowerShell notification listener: ${errMsg}`);
      this._errorMessage = errMsg;
      this._isListening = false;
    }
  }

  /**
   * Stops the active Windows notification listener process cleanly.
   */
  public stopListening(): void {
    if (this._readlineInterface) {
      this._readlineInterface.close();
      this._readlineInterface = null;
    }
    if (this._psProcess) {
      this._psProcess.kill();
      this._psProcess = null;
    }
    this._isListening = false;
    this._strategy = 'NONE';
    this.emitLog('info', 'Listener stopped.');
  }

  /**
   * Processes incoming Windows notification events, applying per-source priority rules.
   *
   * @param event Notification details including app ID, title, and body
   * @returns True if notification was displayed, false if suppressed
   */
  public handleNotification(event: WindowsNotificationEventDTO): boolean {
    if (!event || (!event.appId && !event.appName)) return false;

    const settings = this.getSettings();
    if (!settings.enableListener) return false;

    const matchedRule = this.findSourceRule(settings.sourceRules, event.appId, event.appName);
    const priorityMode = matchedRule?.priorityMode ?? 'DEFAULT';

    if (priorityMode === 'DONT_SHOW') {
      return false;
    }

    const eventName = priorityMode === 'HIGH_PRIORITY' ? 'highNotificationPriority' : 'messagingPriority';
    const evalResult = this._priorityEngine.evaluateRequest(eventName);
    if (!evalResult.shouldRender) {
      return false;
    }
    const priorityScore = evalResult.evaluatedPriority;

    const iconId: BitmapIconId = event.iconId ?? matchedRule?.iconId ?? this.inferIconId(event.appId || event.appName);
    let channelLabel = event.appName || matchedRule?.appName || 'ALERT';
    const lowerLabel = channelLabel.toLowerCase();
    if (lowerLabel.includes('discord') || lowerLabel.includes('slack')) {
      channelLabel = 'Message';
    }
    const textBody = `${event.title ? event.title + ': ' : ''}${event.body || ''}`.trim();

    const timeoutMs = (settings.notificationTimeoutSeconds || 10) * 1000;

    let rawIconData = event.rawIconData;
    console.log(`[NotificationListener] handleNotification START | AppId: ${event.appId} | Title: ${event.title} | Priority: ${priorityScore}`);
    console.log(`[NotificationListener] -> Provided iconPath: ${event.iconPath || 'None'}, rawIconData: ${!!rawIconData}`);
    
    if (!rawIconData && (event.iconPath || event.iconBase64)) {
      const customInput = event.iconPath || event.iconBase64;
      if (customInput) {
        console.log(`[NotificationListener] -> Initiating custom icon processing via AppIconBitmapProcessor...`);
        rawIconData = AppIconBitmapProcessor.processAppIcon(customInput, event.appId);
        console.log(`[NotificationListener] -> Custom icon processing completed. Success: ${!!rawIconData}`);
      }
    } else if (!rawIconData) {
       console.log(`[NotificationListener] -> No custom icon provided, falling back to iconId: ${iconId}`);
    }

    if (this._renderer) {
      this._renderer.renderNotificationBanner(
        textBody || 'New Notification',
        channelLabel,
        priorityScore,
        iconId,
        rawIconData,
        timeoutMs
      );
    }

    return true;
  }

  /**
   * Dispatches a simulated notification event for testing and diagnostics.
   */
  public simulateNotification(
    appId: string,
    appName: string,
    title: string,
    body: string,
    iconId?: BitmapIconId,
    iconPath?: string
  ): WindowsNotificationEventDTO {
    const event: WindowsNotificationEventDTO = {
      id: `sim_${Date.now()}`,
      appId,
      appName,
      title,
      body,
      iconId: iconId ?? this.inferIconId(appId || appName),
      iconPath,
      timestampUtc: new Date().toISOString()
    };

    this.handleNotification(event);
    this.emitLog('notification', `[SIMULATED] [${appName}] ${title}: ${body}`);
    this._totalCaptured++;
    return event;
  }

  /**
   * Emits a log entry to all subscribers and buffers it for initial UI hydration.
   */
  private emitLog(level: NotificationLogLevel, message: string): void {
    const entry: NotificationLogEntryDTO = {
      timestamp: new Date().toISOString(),
      level,
      message
    };

    this._logEntries.push(entry);
    if (this._logEntries.length > WindowsNotificationListenerService.MAX_LOG_ENTRIES) {
      this._logEntries = this._logEntries.slice(-WindowsNotificationListenerService.MAX_LOG_ENTRIES);
    }

    // Forward to console
    if (level === 'error') {
      console.error(`[WindowsNotificationListener] ${message}`);
    } else if (level === 'warn') {
      console.warn(`[WindowsNotificationListener] ${message}`);
    } else {
      console.log(`[WindowsNotificationListener] ${message}`);
    }

    // Notify subscribers (IPC broadcast)
    this._logSubscribers.forEach(cb => cb(entry));
  }

  /**
   * Builds the PowerShell script that polls Windows Notification Database and monitors battery status.
   * Uses wpndatabase.db as primary source (works without MSIX package identity) and WMI for battery.
   */
  private buildPowerShellScript(pollingIntervalMs: number): string {
    const notifDbPath = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
    const escapedDbPath = notifDbPath.replace(/\\/g, '\\\\');

    return `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

# ---- Configuration ----
$notifDbPath = "${escapedDbPath}"
$pollingMs = ${pollingIntervalMs}
$lastArrivalTime = 0
$seenPayloadHashes = @{}

# ---- Helpers ----
function Write-Status($msg) {
  $obj = @{ type = 'status'; message = $msg } | ConvertTo-Json -Compress
  Write-Output $obj
}

function Write-Error-Evt($code, $msg) {
  $obj = @{ type = 'error'; code = $code; message = $msg } | ConvertTo-Json -Compress
  Write-Output $obj
}

function Get-AppIconPath($aId) {
  if (-not $aId) { return $null }
  try {
    $pkgName = ($aId -split '_')[0]
    $pkg = Get-AppxPackage -Name "*$pkgName*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pkg -and $pkg.InstallLocation -and (Test-Path $pkg.InstallLocation)) {
      $manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
      if (Test-Path $manifestPath) {
        [xml]$xml = Get-Content $manifestPath -ErrorAction SilentlyContinue
        $logoRel = $xml.Package.Applications.Application.VisualElements.Square44x44Logo
        if (-not $logoRel) { $logoRel = $xml.Package.Applications.Application.VisualElements.Square150x150Logo }
        if ($logoRel) {
          $baseName = [System.IO.Path]::GetFileNameWithoutExtension($logoRel)
          $parentDir = Join-Path $pkg.InstallLocation (Split-Path $logoRel -Parent)
          $logoFile = Get-ChildItem $parentDir -Filter "$baseName*.png" -ErrorAction SilentlyContinue | Select-Object -First 1
          if ($logoFile -and (Test-Path $logoFile.FullName)) {
            return $logoFile.FullName
          }
        }
      }
    }
  } catch {}
  return $null
}

function Write-Notification($id, $appId, $appName, $title, $body, $iconPath = $null) {
  if (-not $iconPath) { $iconPath = Get-AppIconPath $appId }
  $obj = @{
    id = $id
    appId = $appId
    appName = $appName
    title = $title
    body = $body
    iconPath = $iconPath
    timestampUtc = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Compress
  Write-Output $obj
}

# ---- 1. WinRT UserNotificationListener Check ----
$winRtActive = $false
$listener = $null
try {
  [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  if ($listener) {
    $accessStatus = $listener.RequestAccessAsync().GetResults()
    if ($accessStatus -eq [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]::Allowed) {
      $winRtActive = $true
      Write-Status "WinRT UserNotificationListener active & permitted"
    } else {
      Write-Error-Evt "WINRT_ACCESS_DENIED" "WinRT access status: $accessStatus. Open Windows Settings to grant access."
    }
  }
} catch {
  Write-Status "WinRT listener check deferred to database parser."
}

# ---- 2. Detect sqlite3 CLI availability ----
$sqlite3Cmd = $null
try {
  $found = Get-Command sqlite3 -ErrorAction SilentlyContinue
  if ($found) { $sqlite3Cmd = $found.Source }
} catch {}

if (-not $sqlite3Cmd) {
  $candidates = @(
    "$env:ProgramFiles\\SQLite\\sqlite3.exe",
    "$env:LOCALAPPDATA\\Programs\\sqlite\\sqlite3.exe",
    "$env:ChocolateyInstall\\bin\\sqlite3.exe",
    "$env:SCOOP\\shims\\sqlite3.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $sqlite3Cmd = $c; break }
  }
}

$hasDbPolling = $false
$hasNativeDbParser = $false

if ($sqlite3Cmd -and (Test-Path $notifDbPath)) {
  $hasDbPolling = $true
  Write-Status "DB polling active (sqlite3=$sqlite3Cmd, db=$notifDbPath)"

  try {
    $tempDb = "$env:TEMP\\busybar_wpndb_init.db"
    Copy-Item $notifDbPath $tempDb -Force 2>$null
    if (Test-Path "$notifDbPath-wal") { Copy-Item "$notifDbPath-wal" "$tempDb-wal" -Force 2>$null }
    if (Test-Path "$notifDbPath-shm") { Copy-Item "$notifDbPath-shm" "$tempDb-shm" -Force 2>$null }
    $maxTime = & $sqlite3Cmd $tempDb "SELECT MAX(ArrivalTime) FROM Notification;" 2>$null
    if ($maxTime -and $maxTime -match '^\\d+$') {
      $lastArrivalTime = [long]$maxTime
    }
    Remove-Item "$tempDb*" -Force -ErrorAction SilentlyContinue
    Write-Status "Watermark initialized at ArrivalTime=$lastArrivalTime"
  } catch {
    Write-Error-Evt "DB_INIT_WARN" "Could not initialize watermark: $($_.Exception.Message)"
  }
} elseif (Test-Path $notifDbPath) {
  $hasNativeDbParser = $true
  Write-Status "DB polling active via native string parser (standalone mode)"
} else {
  Write-Error-Evt "NO_WPNDB" "Windows notification database not found at: $notifDbPath"
}

# ---- Battery state tracking ----
$lastBatteryStatus = $null

# ---- Self-identification: skip our own app's notifications ----
$selfAppIds = @('com.busybar.desktop')

# ---- Main Polling Loop ----
Write-Status "Entering main polling loop (interval=${pollingIntervalMs}ms)"

while ($true) {
  # ---- A. Native WinRT Polling ----
  if ($winRtActive -and $listener) {
    try {
      $notifs = $listener.GetNotificationsAsync([Windows.UI.Notifications.KnownNotificationTypes]::Toast).GetResults()
      foreach ($n in $notifs) {
        $nId = $n.Id
        if ($seenPayloadHashes.ContainsKey("winrt_$nId")) { continue }
        $seenPayloadHashes["winrt_$nId"] = $true

        $appInfo = $n.AppInfo
        $aId = if ($appInfo) { $appInfo.AppUserModelId } else { "System" }
        $aName = if ($appInfo -and $appInfo.DisplayInfo) { $appInfo.DisplayInfo.Title } else { $aId }

        $binding = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationTemplateTypes]::ToastGeneric)
        if ($binding) {
          $elems = $binding.GetTextElements()
          $title = if ($elems.Count -gt 0) { $elems[0].Text } else { "" }
          $body = if ($elems.Count -gt 1) { $elems[1].Text } else { "" }

          if ($title -or $body) {
            Write-Notification "winrt_$nId" $aId $aName $title $body
          }
        }
      }
    } catch {}
  }

  # ---- B. Poll Windows Notification Database via sqlite3 CLI ----
  if ($hasDbPolling) {
    try {
      $tempDb = "$env:TEMP\\busybar_wpndb_poll.db"
      Copy-Item $notifDbPath $tempDb -Force 2>$null
      if (Test-Path "$notifDbPath-wal") { Copy-Item "$notifDbPath-wal" "$tempDb-wal" -Force 2>$null }
      if (Test-Path "$notifDbPath-shm") { Copy-Item "$notifDbPath-shm" "$tempDb-shm" -Force 2>$null }

      if (Test-Path $tempDb) {
        $query = "SELECT n.Id, n.ArrivalTime, h.PrimaryId, replace(replace(cast(n.Payload as text), char(10), ' '), char(13), ' ') FROM Notification n LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId WHERE n.ArrivalTime > $lastArrivalTime AND n.Type = 'toast' ORDER BY n.ArrivalTime ASC LIMIT 20;"
        $rows = & $sqlite3Cmd -separator '|BUSYSEP|' $tempDb $query 2>$null

        foreach ($row in $rows) {
          if (-not $row -or $row.Length -lt 5) { continue }

          $parts = $row -split '\\|BUSYSEP\\|', 4
          if ($parts.Count -lt 4) { continue }

          $notifId = $parts[0]
          $arrivalTime = $parts[1]
          $primaryId = $parts[2]
          $payload = $parts[3]

          $isSelf = $false
          foreach ($selfId in $selfAppIds) {
            if ($primaryId -eq $selfId) { $isSelf = $true; break }
          }
          if ($isSelf) {
            if ($arrivalTime -match '^\\d+$' -and [long]$arrivalTime -gt $lastArrivalTime) {
              $lastArrivalTime = [long]$arrivalTime
            }
            continue
          }

          $title = ''
          $body = ''
          try {
            if ($payload -match '<text[^>]*>([^<]*)</text>') {
              $allMatches = [regex]::Matches($payload, '<text[^>]*>([^<]*)</text>')
              if ($allMatches.Count -gt 0) { $title = $allMatches[0].Groups[1].Value }
              if ($allMatches.Count -gt 1) { $body = $allMatches[1].Groups[1].Value }
            }
          } catch {}

          $appName = $primaryId
          $appId = $primaryId
          if ($primaryId -match '^([^_!]+)') {
            $appName = $Matches[1]
          }
          $appName = $appName -replace '^com\\.tinyspeck\\.', ''
          $appName = $appName -replace '^com\\.', ''
          $appName = $appName -replace '^Microsoft\\.', ''
          $appName = $appName -replace 'desktop$', ''
          $appName = $appName -replace 'Windows\\.SystemToast\\.', ''

          if ($title -or $body) {
            Write-Notification "wpn_$notifId" $appId $appName $title $body
          }

          if ($arrivalTime -match '^\\d+$' -and [long]$arrivalTime -gt $lastArrivalTime) {
            $lastArrivalTime = [long]$arrivalTime
          }
        }

        Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Error-Evt "DB_POLL_ERROR" "Database polling error: $($_.Exception.Message)"
    }
  } elseif ($hasNativeDbParser) {
    # ---- C. Native Direct String Extraction Fallback (No sqlite3.exe) ----
    try {
      $tempDb = "$env:TEMP\\busybar_wpndb_raw.db"
      Copy-Item $notifDbPath $tempDb -Force 2>$null

      if (Test-Path $tempDb) {
        $rawBytes = [System.IO.File]::ReadAllBytes($tempDb)
        $rawText = [System.Text.Encoding]::UTF8.GetString($rawBytes)

        $matches = [regex]::Matches($rawText, '<toast[^>]*>(.*?)</toast>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        foreach ($m in $matches) {
          $toastXml = $m.Value
          $hash = $toastXml.GetHashCode().ToString()
          if ($seenPayloadHashes.ContainsKey($hash)) { continue }
          $seenPayloadHashes[$hash] = $true

          # Limit cache size
          if ($seenPayloadHashes.Count -gt 500) { $seenPayloadHashes.Clear() }

          $title = ""
          $body = ""
          $textMatches = [regex]::Matches($toastXml, '<text[^>]*>([^<]+)</text>')
          if ($textMatches.Count -gt 0) { $title = $textMatches[0].Groups[1].Value }
          if ($textMatches.Count -gt 1) { $body = $textMatches[1].Groups[1].Value }

          if ($title -or $body) {
            Write-Notification "raw_$hash" "system" "Windows Notification" $title $body
          }
        }

        Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }

  # ---- 2. Battery & Power System Monitor via WMI ----
  try {
    $bat = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue
    if ($bat) {
      $curStatus = "$($bat.BatteryStatus)_$($bat.EstimatedChargeRemaining)"
      if ($lastBatteryStatus -and $lastBatteryStatus -ne $curStatus) {
        $msg = switch ($bat.BatteryStatus) {
          1 { "Discharging ($($bat.EstimatedChargeRemaining)% remaining)" }
          2 { "Connected to AC ($($bat.EstimatedChargeRemaining)%)" }
          3 { "Fully Charged (100%)" }
          4 { "Low Battery ($($bat.EstimatedChargeRemaining)%)" }
          5 { "Critical Battery ($($bat.EstimatedChargeRemaining)%)" }
          6 { "Charging ($($bat.EstimatedChargeRemaining)%)" }
          default { "Battery status updated ($($bat.EstimatedChargeRemaining)%)" }
        }
        Write-Notification "bat_$(Get-Date -UFormat %s)" "battery" "System Battery" "Battery Alert" $msg
      }
      $lastBatteryStatus = $curStatus
    }
  } catch {}

  Start-Sleep -Milliseconds $pollingMs
}
`;
  }

  private findSourceRule(
    rules: NotificationSourceRule[],
    appId?: string,
    appName?: string
  ): NotificationSourceRule | undefined {
    const searchId = (appId || '').toLowerCase();
    const searchName = (appName || '').toLowerCase();

    return rules.find(
      r =>
        (r.appId && r.appId.toLowerCase() === searchId) ||
        (r.appName && r.appName.toLowerCase() === searchName) ||
        searchId.includes(r.appId.toLowerCase()) ||
        searchName.includes(r.appName.toLowerCase())
    );
  }

  private inferIconId(identifier: string): BitmapIconId {
    const id = identifier.toLowerCase();
    if (id.includes('discord')) return 'discord';
    if (id.includes('slack')) return 'slack';
    if (id.includes('gmail') || id.includes('mail') || id.includes('outlook')) return 'gmail';
    if (id.includes('antigravity')) return 'antigravity';
    if (id.includes('battery') || id.includes('power')) return 'battery';
    if (id.includes('windows') || id.includes('system')) return 'windows';
    return 'bell';
  }
}