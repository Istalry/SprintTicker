import { app, Menu, Tray, nativeImage } from 'electron';
/**
 * System Tray Manager handling desktop tray lifecycle, status tooltip badges,
 * native context menu actions, and minimize-to-tray window behavior.
 */
export class TrayManager {
    tray = null;
    mainWindow;
    engine;
    constructor(mainWindow, engine) {
        this.mainWindow = mainWindow;
        this.engine = engine;
    }
    initialize() {
        // Create 16x16 transparent PNG canvas data for native tray icon
        const iconData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAuSURBVHgB7cxBDQAACAIg2v6dZg0v0gAGZpJupv7uAQgICAgICAgICAgICAgIXLg3SAE7mEomwQAAAABJRU5ErkJggg==';
        const image = nativeImage.createFromDataURL(iconData);
        this.tray = new Tray(image);
        this.tray.setToolTip('Antigravity BUSY Bar PC Companion (Idle)');
        this.updateContextMenu();
        // Double-click tray icon to restore and bring dashboard to front
        this.tray.on('double-click', () => {
            this.restoreWindow();
        });
        // Intercept window close event to minimize to system tray instead of exiting
        this.mainWindow.on('close', event => {
            if (!app.isQuitting) {
                event.preventDefault();
                this.mainWindow.hide();
            }
        });
        // Subscribe to engine state updates to adjust tray tooltip and context menu
        this.engine.subscribe(() => {
            this.updateStatusTooltip();
        });
    }
    restoreWindow() {
        if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
        }
        this.mainWindow.show();
        this.mainWindow.focus();
    }
    setAutoStart(enabled) {
        app.setLoginItemSettings({
            openAtLogin: enabled,
            openAsHidden: true
        });
    }
    updateStatusTooltip() {
        if (!this.tray)
            return;
        const session = this.engine.getCurrentSession();
        if (session && session.status === 'TRACKING') {
            this.tray.setToolTip(`BUSY Bar: TRACKING [${session.taskKey}] - ${session.taskTitle}`);
        }
        else if (session && session.status === 'PAUSED') {
            this.tray.setToolTip(`BUSY Bar: PAUSED [${session.taskKey}]`);
        }
        else {
            this.tray.setToolTip('Antigravity BUSY Bar PC Companion (Idle)');
        }
    }
    updateContextMenu() {
        if (!this.tray)
            return;
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
                    }
                    else if (session.status === 'TRACKING') {
                        this.engine.pauseSession();
                    }
                    else {
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
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ]);
        this.tray.setContextMenu(contextMenu);
    }
    destroy() {
        if (this.tray) {
            this.tray.destroy();
            this.tray = null;
        }
    }
}
//# sourceMappingURL=tray-manager.js.map