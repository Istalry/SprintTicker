import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { PriorityPreemptionEngine } from './priority-preemption-engine';
import { DisplayRenderer } from '../hardware/display-renderer';
import {
  WindowsNotificationSettingsDTO,
  WindowsNotificationEventDTO,
  NotificationSourceRule,
  BitmapIconId
} from '../../shared/dtos';

/**
 * Service that captures Windows Action Center / System notifications,
 * evaluates per-source priority rules (DONT_SHOW, DEFAULT, HIGH_PRIORITY),
 * and renders formatted notification banners on the BUSY Bar LED display.
 */
export class WindowsNotificationListenerService {
  private static readonly DB_SETTINGS_KEY = 'windows_notification_settings';

  private readonly _settingsRepo: SettingsRepository;
  private readonly _priorityEngine: PriorityPreemptionEngine;
  private readonly _renderer?: DisplayRenderer;

  private _psProcess: ChildProcess | null = null;
  private _readlineInterface: readline.Interface | null = null;
  private _isListening: boolean = false;

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
        sourceRules: [
          { appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'HIGH_PRIORITY' },
          { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT' },
          { appId: 'antigravity', appName: 'Antigravity', iconId: 'antigravity', priorityMode: 'HIGH_PRIORITY' },
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
   * Starts active OS-level listening for Windows notifications and system events via PowerShell bridge.
   */
  public startListening(): void {
    if (this._isListening) return;
    this._isListening = true;

    if (process.platform !== 'win32') {
      console.log('[WindowsNotificationListener] Non-Windows OS platform detected. OS listener suspended.');
      return;
    }

    const settings = this.getSettings();
    if (!settings.enableListener) {
      console.log('[WindowsNotificationListener] Notification listener is disabled in settings.');
      return;
    }

    try {
      // PowerShell script using WMI event watcher for system events
      // and safe WinRT invocation wrapped in error handling
      const rawScript = `
        $OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

        # Load WinRT Notification Assembly
        $hasWinRT = $false
        try {
          [void][Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType=WindowsRuntime]
          $hasWinRT = $true
        } catch {}

        $listener = $null
        if ($hasWinRT) {
          try {
            $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
            $accessTask = $listener.RequestAccessAsync()
            while (-not $accessTask.IsCompleted) { Start-Sleep -Milliseconds 50 }
            if ($accessTask.GetResults() -ne 'Allowed') {
              Write-Output '{"error":"ACCESS_DENIED"}'
              $listener = $null
            }
          } catch {
            $listener = $null
          }
        }

        $lastBatteryStatus = $null
        $knownIds = New-Object 'System.Collections.Generic.HashSet[uint32]'

        while ($true) {
          # 1. WinRT Toast Notification Listener (Requires App Package Identity)
          if ($listener) {
            try {
              $asyncOp = $listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)
              while (-not $asyncOp.IsCompleted) { Start-Sleep -Milliseconds 50 }
              $notifs = $asyncOp.GetResults()

              foreach ($n in $notifs) {
                if (-not $knownIds.Contains($n.Id)) {
                  $knownIds.Add($n.Id) | Out-Null
                  $appInfo = $n.AppInfo
                  $appName = if ($appInfo -and $appInfo.DisplayInfo) { $appInfo.DisplayInfo.Title } else { 'Windows App' }
                  $appId = if ($appInfo) { $appInfo.Id } else { 'windows' }
                  
                  $binding = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationNestedLanguageElementKinds]::Toast)
                  $title = ''
                  $body = ''
                  if ($binding) {
                    $elements = $binding.GetTextElements()
                    if ($elements.Count -gt 0) { $title = $elements[0].Text }
                    if ($elements.Count -gt 1) { $body = $elements[1].Text }
                  }
                  
                  $evt = @{
                    id = $n.Id.ToString()
                    appId = $appId
                    appName = $appName
                    title = $title
                    body = $body
                    timestampUtc = (Get-Date).ToUniversalTime().ToString("o")
                  } | ConvertTo-Json -Compress
                  
                  Write-Output $evt
                }
              }
            } catch {}
          }

          # 2. Battery & Power System Monitor via WMI (Fast CIM query)
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
                $evt = @{
                  id = "bat_$(Get-Date -UFormat %s)"
                  appId = "battery"
                  appName = "System Battery"
                  title = "Battery Alert"
                  body = $msg
                  timestampUtc = (Get-Date).ToUniversalTime().ToString("o")
                } | ConvertTo-Json -Compress
                Write-Output $evt
              }
              $lastBatteryStatus = $curStatus
            }
          } catch {}

          Start-Sleep -Milliseconds 1000
        }
      `;

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
            if (data.error === 'ACCESS_DENIED') {
              console.warn('[WindowsNotificationListener] Toast Notifications Access Denied. (Note: App requires an MSIX package identity for WinRT Toast access).');
              return;
            }
            this.handleNotification({
              id: data.id || `win_${Date.now()}`,
              appId: data.appId,
              appName: data.appName,
              title: data.title,
              body: data.body,
              timestampUtc: data.timestampUtc || new Date().toISOString()
            });
          } catch (err) {
            // Non-JSON output line safely ignored
          }
        });
      }

      this._psProcess.stderr?.on('data', (errData: Buffer) => {
        console.warn('[WindowsNotificationListener] OS Listener log:', errData.toString('utf8').trim());
      });

      this._psProcess.on('exit', () => {
        this._isListening = false;
        this._psProcess = null;
        this._readlineInterface = null;
      });
    } catch (error) {
      console.error('[WindowsNotificationListener] Failed to launch PowerShell notification listener:', error);
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
    const channelLabel = event.appName || matchedRule?.appName || 'ALERT';
    const textBody = `${event.title ? event.title + ': ' : ''}${event.body || ''}`.trim();

    if (this._renderer) {
      this._renderer.renderNotificationBanner(
        textBody || 'New Notification',
        channelLabel,
        priorityScore,
        iconId,
        event.rawIconData
      );
    }

    const timeoutMs = (settings.notificationTimeoutSeconds || 10) * 1000;
    setTimeout(() => {
      this._priorityEngine.releaseActiveLock(eventName);
    }, timeoutMs);

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
    iconId?: BitmapIconId
  ): WindowsNotificationEventDTO {
    const event: WindowsNotificationEventDTO = {
      id: `sim_${Date.now()}`,
      appId,
      appName,
      title,
      body,
      iconId: iconId ?? this.inferIconId(appId || appName),
      timestampUtc: new Date().toISOString()
    };

    this.handleNotification(event);
    return event;
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

class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}