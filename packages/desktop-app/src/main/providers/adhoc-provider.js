/**
 * Local task provider adapter mapping custom ad-hoc entries to fallback ticket ID (MISC-1).
 */
export class AdHocProvider {
    providerId = 'adhoc';
    providerName = 'Ad-Hoc / Custom Fallback';
    fallbackKey = 'MISC-1';
    async initialize(credentials) {
        this.fallbackKey = credentials.fallbackKey || 'MISC-1';
        return true;
    }
    async getProjects() {
        return [{ id: 'ADHOC', key: 'ADHOC', name: 'Custom Ad-Hoc / Misc Overhead' }];
    }
    async getTasks(projectId) {
        return [
            { id: 'ADHOC-01', projectId, key: this.fallbackKey, title: 'Sprint Planning & Stand-up', status: 'done' }
        ];
    }
    async reconcileRemoteState() {
        return { remoteLoggedTimeToday: 0 };
    }
    async logTime(payload) {
        console.log(`[AdHocProvider] Logging ad-hoc time under ${this.fallbackKey}: ${payload.durationSeconds}s ("${payload.comment}")`);
        return {
            success: true,
            remoteWorklogId: `adhoc_wl_${Date.now()}`
        };
    }
}
//# sourceMappingURL=adhoc-provider.js.map