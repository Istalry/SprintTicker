import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';
import { WebhookServer } from '../src/main/api/webhook-server';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';

describe('Full End-to-End System Simulation Test', () => {
  let dbConn: DatabaseConnection;
  let taskRepo: TaskRepository;
  let worklogRepo: WorklogRepository;
  let sessionRepo: SessionRepository;
  let settingsRepo: SettingsRepository;
  let engine: TimeTrackingEngine;
  let driver: BusyBarDriver;
  let renderer: DisplayRenderer;
  let decoder: InputDecoder;
  let webhookServer: WebhookServer;
  let provider: JiraProvider;
  let syncWorker: OfflineSyncWorker;

  beforeAll(async () => {
    // 1. Boot Companion Engine & Database
    dbConn = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
    sessionRepo = new SessionRepository(dbConn);
    settingsRepo = new SettingsRepository(dbConn);

    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo);
    driver = new BusyBarDriver('10.0.4.20', true);
    await driver.connect();

    renderer = new DisplayRenderer(driver);
    decoder = new InputDecoder(driver, engine, settingsRepo);

    provider = new JiraProvider();
    syncWorker = new OfflineSyncWorker(provider, worklogRepo, 60000);

    webhookServer = new WebhookServer(0);
    await webhookServer.start();
  });

  afterAll(async () => {
    await webhookServer.stop();
    driver.disconnect();
    dbConn.close();
  });

  it('E2E_FullLifecycle_SessionTrackingOfflineBufferingAndEodFlow', async () => {
    // Step 1: Unity Webhook Telemetry
    const compileRes = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/unity/compile',
      payload: { state: 'started', projectName: 'MyFantasyGame' }
    });
    expect(compileRes.statusCode).toBe(200);

    // Step 2: Start Session via physical button or UI
    const session = engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    expect(session.status).toBe('TRACKING');

    // Step 3: Display Payload Generated
    const displayPayload = renderer.renderActiveSession(session);
    expect(displayPayload.frontElements[0].text).toContain('PROJ-142');

    // Step 4: Physical Wheel Click pauses session
    const pauseAction = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });
    expect(pauseAction).toBe('TOGGLE_TRACK_PAUSE');
    expect(engine.getCurrentSession()?.status).toBe('PAUSED');

    // Step 5: Resume session & Simulate Offline Disconnect & Stop Session (Worklog queued in SQLite)
    syncWorker.setOnlineStatus(false);

    // Ensure active session in SQLite has positive duration and cleared pause timestamps
    const active = sessionRepo.getActiveSession();
    if (active) {
      sessionRepo.saveSession({
        ...active,
        status: 'TRACKING',
        startTimeUtc: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        totalPausedSeconds: 0,
        lastPauseStartUtc: undefined
      });
    }

    const stopResult = engine.stopSession('Completed during offline test');
    expect(stopResult.success).toBe(true);

    const pendingQueue = worklogRepo.getPendingQueueItems();
    expect(pendingQueue).toHaveLength(1);

    // Step 6: Restore Internet Network Connection & Run Sync Worker Draining Queue
    syncWorker.setOnlineStatus(true);
    const syncSummary = await syncWorker.processPendingQueue();
    expect(syncSummary.succeeded).toBe(1);
    expect(worklogRepo.getPendingQueueItems()).toHaveLength(0);
  });
});
