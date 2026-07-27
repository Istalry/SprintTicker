import { SessionRepository } from '../db/repositories/session-repository';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { TaskRepository } from '../db/repositories/task-repository';
/**
 * Core Time Tracking Engine managing finite state machine (Idle, Tracking, Paused),
 * absolute UTC timestamp delta calculations, crash/reboot resilience, and offline worklog buffering.
 */
export class TimeTrackingEngine {
    sessionRepo;
    worklogRepo;
    taskRepo;
    listeners = new Set();
    currentSession = null;
    constructor(sessionRepo, worklogRepo, taskRepo) {
        this.sessionRepo = sessionRepo || new SessionRepository();
        this.worklogRepo = worklogRepo || new WorklogRepository();
        this.taskRepo = taskRepo || new TaskRepository();
        this.reconcileStartupState();
    }
    /**
     * Reconciles unfinalized sessions on application startup to ensure reboot & crash resilience.
     */
    reconcileStartupState() {
        const active = this.sessionRepo.getActiveSession();
        if (!active) {
            this.currentSession = null;
            return null;
        }
        // If session was in TRACKING state during app crash/reboot, calculate accurate elapsed time
        this.currentSession = active;
        this.notifyListeners();
        return this.currentSession;
    }
    /**
     * Subscribes a listener callback to engine state transitions.
     */
    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    notifyListeners() {
        const sessionCopy = this.getCurrentSession();
        for (const listener of this.listeners) {
            try {
                listener(sessionCopy);
            }
            catch (err) {
                console.error('[TimeTrackingEngine] Error in session state listener:', err);
            }
        }
    }
    /**
     * Gets current active session with live calculated UTC elapsed time.
     */
    getCurrentSession() {
        if (!this.currentSession)
            return null;
        return this.sessionRepo.getActiveSession();
    }
    /**
     * Starts tracking a task session.
     */
    startTask(taskId, isAdHoc = false, customTitle, projectId = 'PROJ', taskKey) {
        if (!taskId)
            throw new Error('Task ID is required to start a session');
        // Finalize any existing active session before starting new task
        if (this.currentSession && this.currentSession.status !== 'COMPLETED') {
            this.stopSession('Auto-completed due to new task start');
        }
        let finalTitle = customTitle || 'Active Task';
        let finalKey = taskKey || taskId;
        if (isAdHoc && customTitle) {
            const adHocTask = this.taskRepo.createAdHocTask(customTitle, 'MISC-1');
            finalKey = adHocTask.key;
            finalTitle = adHocTask.title;
        }
        const startTimeUtc = new Date().toISOString();
        const sessionId = `sess_${Date.now()}`;
        const newSession = {
            sessionId,
            projectId,
            taskId,
            taskKey: finalKey,
            taskTitle: finalTitle,
            isAdHoc,
            status: 'TRACKING',
            startTimeUtc,
            totalPausedSeconds: 0
        };
        this.sessionRepo.saveSession(newSession);
        this.currentSession = this.sessionRepo.getActiveSession();
        this.notifyListeners();
        return this.currentSession;
    }
    /**
     * Pauses the current active session.
     */
    pauseSession() {
        const active = this.getCurrentSession();
        if (!active || active.status !== 'TRACKING') {
            throw new Error('No active tracking session available to pause');
        }
        const nowIso = new Date().toISOString();
        this.sessionRepo.updateStatus(active.sessionId, 'PAUSED', active.totalPausedSeconds, nowIso);
        this.sessionRepo.recordPauseInterval(active.sessionId, nowIso);
        this.currentSession = this.sessionRepo.getActiveSession();
        this.notifyListeners();
        return this.currentSession;
    }
    /**
     * Resumes a paused session.
     */
    resumeSession() {
        const active = this.getCurrentSession();
        if (!active || active.status !== 'PAUSED' || !active.lastPauseStartUtc) {
            throw new Error('No paused session available to resume');
        }
        const pauseDuration = Math.max(0, Math.floor((Date.now() - new Date(active.lastPauseStartUtc).getTime()) / 1000));
        const newTotalPaused = active.totalPausedSeconds + pauseDuration;
        this.sessionRepo.updateStatus(active.sessionId, 'TRACKING', newTotalPaused, undefined);
        this.currentSession = this.sessionRepo.getActiveSession();
        this.notifyListeners();
        return this.currentSession;
    }
    /**
     * Stops and finalizes the active session, logging elapsed time and creating offline sync queue entry.
     */
    stopSession(comment) {
        const active = this.getCurrentSession();
        if (!active)
            return { success: false, loggedSeconds: 0 };
        const loggedSeconds = active.elapsedSeconds;
        this.sessionRepo.updateStatus(active.sessionId, 'COMPLETED', active.totalPausedSeconds);
        const nowIso = new Date().toISOString();
        // 1. Save worklog to SQLite
        this.worklogRepo.saveWorklog({
            id: `wl_${Date.now()}`,
            sessionId: active.sessionId,
            taskId: active.taskId,
            durationSeconds: loggedSeconds,
            startedAtUtc: active.startTimeUtc,
            comment: comment || 'Completed session via Antigravity BUSY Bar',
            createdAtUtc: nowIso
        });
        // 2. Buffer to offline sync queue
        this.worklogRepo.enqueueSyncItem({
            id: `sync_${Date.now()}`,
            providerId: 'jira',
            taskId: active.taskId,
            durationSeconds: loggedSeconds,
            startedAtUtc: active.startTimeUtc,
            comment: comment || 'Completed session via Antigravity BUSY Bar'
        });
        this.currentSession = null;
        this.notifyListeners();
        return { success: true, loggedSeconds };
    }
}
//# sourceMappingURL=time-tracking-engine.js.map