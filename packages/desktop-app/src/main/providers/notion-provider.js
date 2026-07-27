/**
 * Notion Database / Generic REST task provider adapter.
 */
export class NotionProvider {
    providerId = 'notion';
    providerName = 'Notion Database';
    async initialize(_credentials) {
        return true;
    }
    async getProjects() {
        return [{ id: 'NOTION-1', key: 'NOTION', name: 'Game Roadmap Database' }];
    }
    async getTasks(projectId) {
        return [
            { id: 'NOTION-101', projectId, key: 'NOTION-101', title: 'Refactor UI State Store', status: 'todo' }
        ];
    }
    async reconcileRemoteState() {
        return { remoteLoggedTimeToday: 0 };
    }
    async logTime(payload) {
        console.log(`[NotionProvider] Submitting Notion worklog for ${payload.taskId}: ${payload.durationSeconds}s`);
        return {
            success: true,
            remoteWorklogId: `notion_wl_${Date.now()}`
        };
    }
}
//# sourceMappingURL=notion-provider.js.map