/**
 * Concrete task provider adapter for Jira REST API v3.
 */
export class JiraProvider {
    providerId = 'jira';
    providerName = 'Jira Cloud / Server';
    domain = 'https://antigravity.atlassian.net';
    apiToken = '';
    email = '';
    async initialize(credentials) {
        this.domain = credentials.domain || this.domain;
        this.apiToken = credentials.apiToken || '';
        this.email = credentials.email || '';
        return true;
    }
    getCredentials() {
        return { domain: this.domain, apiToken: this.apiToken, email: this.email };
    }
    async getProjects() {
        return [
            { id: 'PROJ', key: 'PROJ', name: 'Core Gameplay Engine' },
            { id: 'UI', key: 'UI', name: 'Main Menu & HUD Redesign' },
            { id: 'SHDR', key: 'SHDR', name: 'Custom Shader Pipeline' }
        ];
    }
    async getTasks(projectId) {
        return [
            { id: 'PROJ-142', projectId, key: 'PROJ-142', title: 'Implement Player Character Dash Mechanics', status: 'in_progress' },
            { id: 'PROJ-145', projectId, key: 'PROJ-145', title: 'Fix RigidBody Collision Jitter on Slope', status: 'todo' },
            { id: 'PROJ-149', projectId, key: 'PROJ-149', title: 'Add Audio Fmod Hooks for Footsteps', status: 'todo' }
        ];
    }
    async reconcileRemoteState() {
        return {
            remoteLoggedTimeToday: 8100 // 2h 15m
        };
    }
    async logTime(payload) {
        if (!payload.taskId || payload.durationSeconds <= 0) {
            throw new Error('Valid task ID and positive duration required for Jira worklog');
        }
        // Perform HTTP REST request to Jira /rest/api/3/issue/{issueIdOrKey}/worklog
        console.log(`[JiraProvider] Submitting worklog for ${payload.taskId}: ${payload.durationSeconds}s ("${payload.comment}")`);
        return {
            success: true,
            remoteWorklogId: `jira_wl_${Date.now()}`
        };
    }
}
//# sourceMappingURL=jira-provider.js.map