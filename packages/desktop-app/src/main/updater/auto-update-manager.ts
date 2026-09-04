import { BrowserWindow } from 'electron';

export type UpdateChannel = 'stable' | 'beta';

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  version?: string;
  progressPercent?: number;
  downloaded: boolean;
  error?: string;
}

/**
 * Service managing background software update checks, channel selection,
 * non-intrusive downloads, and IPC status broadcasts to the desktop dashboard UI.
 */
export class AutoUpdateManager {
  private channel: UpdateChannel = 'stable';
  private status: UpdateStatus = {
    checking: false,
    available: false,
    downloaded: false
  };
  private windowGetter: () => BrowserWindow | null;
  private checkIntervalTimer: NodeJS.Timeout | null = null;

  constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  public initialize(channel: UpdateChannel = 'stable'): void {
    this.channel = channel;
    console.log(`[AutoUpdateManager] Initialized auto-updater on '${this.channel}' release channel.`);

    // Schedule 12-hour periodic background update checks
    this.checkIntervalTimer = setInterval(() => {
      void this.checkForUpdates()
        .catch(err => console.error('[AutoUpdateManager] checkForUpdates failed:', err));
    }, 12 * 60 * 60 * 1000);
  }

  public setChannel(channel: UpdateChannel): void {
    this.channel = channel;
    console.log(`[AutoUpdateManager] Switch release channel to '${this.channel}'`);
    void this.checkForUpdates()
      .catch(err => console.error('[AutoUpdateManager] checkForUpdates failed:', err));
  }

  public async checkForUpdates(): Promise<UpdateStatus> {
    this.status = {
      checking: true,
      available: false,
      downloaded: false
    };
    this.broadcastStatus();

    // Simulate update check against remote release manifest
    return new Promise(resolve => {
      setTimeout(() => {
        this.status = {
          checking: false,
          available: false,
          downloaded: false
        };
        this.broadcastStatus();
        resolve(this.status);
      }, 500);
    });
  }

  public getStatus(): UpdateStatus {
    return { ...this.status };
  }

  private broadcastStatus(): void {
    const win = this.windowGetter();
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:status-changed', this.status);
    }
  }

  public destroy(): void {
    if (this.checkIntervalTimer) {
      clearInterval(this.checkIntervalTimer);
      this.checkIntervalTimer = null;
    }
  }
}
