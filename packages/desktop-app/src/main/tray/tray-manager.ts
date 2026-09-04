import { app, Menu, Tray, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';

/**
 * System Tray Manager handling desktop tray lifecycle, status tooltip badges,
 * native context menu actions, and minimize-to-tray window behavior.
 */
export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow;
  private engine: TimeTrackingEngine;

  constructor(mainWindow: BrowserWindow, engine: TimeTrackingEngine) {
    this.mainWindow = mainWindow;
    this.engine = engine;
  }

  public initialize(): void {
    const trayIconPath = path.join(__dirname, '../../build/tray-icon.png');
    let image: Electron.NativeImage;
    if (fs.existsSync(trayIconPath)) {
      image = nativeImage.createFromPath(trayIconPath);
    } else {
      const iconData =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAuSURBVHgB7cxBDQAACAIg2v6dZg0v0gAGZpJupv7uAQgICAgICAgICAgICAgIXLg3SAE7mEomwQAAAABJRU5ErkJggg==';
      image = nativeImage.createFromDataURL(iconData);
    }

    this.tray = new Tray(image);
    this.tray.setToolTip('Antigravity BUSY Bar PC Companion (Idle)');

    this.updateContextMenu();

    // Double-click tray icon to restore and bring dashboard to front
    this.tray.on('double-click', () => {
      this.restoreWindow();
    });

    // Window close event triggers standard exit
    this.mainWindow.on('close', () => {
      (app as unknown as { isQuitting?: boolean }).isQuitting = true;
    });

    // Subscribe to engine state updates to adjust tray tooltip and context menu
    this.engine.subscribe(() => {
      this.updateStatusTooltip();
    });
  }

  public restoreWindow(): void {
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  public setAutoStart(enabled: boolean): void {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    });
  }

  private updateStatusTooltip(): void {
    if (!this.tray) return;

    const session = this.engine.getCurrentSession();
    if (session && session.status === 'TRACKING') {
      this.tray.setToolTip(`BUSY Bar: TRACKING [${session.taskKey}] - ${session.taskTitle}`);
    } else if (session && session.status === 'PAUSED') {
      this.tray.setToolTip(`BUSY Bar: PAUSED [${session.taskKey}]`);
    } else {
      this.tray.setToolTip('Antigravity BUSY Bar PC Companion (Idle)');
    }
  }

  private updateContextMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open BUSY Bar Dashboard',
        click: () => this.restoreWindow()
      },
      { type: 'separator' },
      {
        label: 'Start / Pause Active Tracking',
        click: () => {
          const session = this.engine.getCurrentSession();
          if (!session) {
            this.restoreWindow();
          } else if (session.status === 'TRACKING') {
            this.engine.pauseSession();
          } else {
            this.engine.resumeSession();
          }
        }
      },
      {
        label: 'Trigger Task Selector Modal',
        click: () => {
          this.restoreWindow();
          this.mainWindow.webContents.send('input:hardware-event', {
            actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL',
            rawKey: 'ok'
          });
        }
      },
      { type: 'separator' },
      {
        label: 'Start with Windows Startup',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: menuItem => this.setAutoStart(menuItem.checked)
      },
      { type: 'separator' },
      {
        label: 'Quit Application',
        click: () => {
          (app as unknown as { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
