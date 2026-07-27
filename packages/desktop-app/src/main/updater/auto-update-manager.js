/**
 * Service managing background software update checks, channel selection,
 * non-intrusive downloads, and IPC status broadcasts to the desktop dashboard UI.
 */
export class AutoUpdateManager {
    channel = 'stable';
    status = {
        checking: false,
        available: false,
        downloaded: false
    };
    windowGetter;
    checkIntervalTimer = null;
    constructor(windowGetter) {
        this.windowGetter = windowGetter;
    }
    initialize(channel = 'stable') {
        this.channel = channel;
        console.log(`[AutoUpdateManager] Initialized auto-updater on '${this.channel}' release channel.`);
        // Schedule 12-hour periodic background update checks
        this.checkIntervalTimer = setInterval(() => {
            this.checkForUpdates();
        }, 12 * 60 * 60 * 1000);
    }
    setChannel(channel) {
        this.channel = channel;
        console.log(`[AutoUpdateManager] Switch release channel to '${this.channel}'`);
        this.checkForUpdates();
    }
    async checkForUpdates() {
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
    getStatus() {
        return { ...this.status };
    }
    broadcastStatus() {
        const win = this.windowGetter();
        if (win && !win.isDestroyed()) {
            win.webContents.send('updater:status-changed', this.status);
        }
    }
    destroy() {
        if (this.checkIntervalTimer) {
            clearInterval(this.checkIntervalTimer);
            this.checkIntervalTimer = null;
        }
    }
}
//# sourceMappingURL=auto-update-manager.js.map