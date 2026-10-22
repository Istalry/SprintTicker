import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasTaskPage, isOpenableTaskPage } from '../src/shared/task-page';
import { ADHOC_PROJECT_ID } from '../src/shared/adhoc-project';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';

/**
 * A task's page on its provider, opened from the window. The URL is built in
 * main from the provider's own site, and opened only if it stays there.
 */
describe('which tasks have a page', () => {
  it('HasTaskPage_ProviderProject_HasOne', () => {
    expect(hasTaskPage('10000', 'jira')).toBe(true);
    expect(hasTaskPage('3', 'openproject')).toBe(true);
  });

  it('HasTaskPage_ProviderNotKnown_MayHaveOne', () => {
    // `local` is the column's old default: the active provider is asked.
    expect(hasTaskPage('3', 'local')).toBe(true);
    expect(hasTaskPage('3', null)).toBe(true);
  });

  it('HasTaskPage_AdHocOrTheAppsOwnProject_HasNone', () => {
    expect(hasTaskPage(ADHOC_PROJECT_ID, 'adhoc')).toBe(false);
    expect(hasTaskPage(ADHOC_PROJECT_ID, undefined)).toBe(false);
    expect(hasTaskPage('OWN', 'sprintticker')).toBe(false);
    expect(hasTaskPage('X', 'adhoc')).toBe(false);
    expect(hasTaskPage(undefined, 'jira')).toBe(false);
  });

  it('IsOpenableTaskPage_OnTheSite_Opens', () => {
    expect(isOpenableTaskPage('https://acme.atlassian.net/browse/SCRUM-2', 'https://acme.atlassian.net')).toBe(true);
    expect(isOpenableTaskPage('http://op.local:8080/work_packages/12', 'http://op.local:8080')).toBe(true);
  });

  it('IsOpenableTaskPage_ElsewhereOrNotTheWeb_DoesNot', () => {
    expect(isOpenableTaskPage('https://evil.test/browse/X', 'https://acme.atlassian.net')).toBe(false);
    expect(isOpenableTaskPage('https://acme.atlassian.net.evil.test/x', 'https://acme.atlassian.net')).toBe(false);
    expect(isOpenableTaskPage('http://acme.atlassian.net/browse/X', 'https://acme.atlassian.net')).toBe(false);
    expect(isOpenableTaskPage('file:///C:/x', 'file:///C:/')).toBe(false);
    expect(isOpenableTaskPage('javascript:alert(1)', 'https://acme.atlassian.net')).toBe(false);
    expect(isOpenableTaskPage('not a url', 'https://acme.atlassian.net')).toBe(false);
  });
});

describe('the page each provider names', () => {
  it('GetTaskPageUrl_Jira_BrowsesByKey', async () => {
    const jira = new JiraProvider();
    await jira.initialize({ domain: 'https://acme.atlassian.net', jiraEmail: 'dev@acme.test', jiraApiToken: 't' });

    expect(jira.getTaskPageUrl({ id: '10001', key: 'SCRUM-2' })).toBe('https://acme.atlassian.net/browse/SCRUM-2');
  });

  it('GetTaskPageUrl_JiraKeyFromSyncedData_StaysOnTheSite', async () => {
    // A key is synced data: whatever it holds, the page stays on the site.
    const jira = new JiraProvider();
    await jira.initialize({ domain: 'https://acme.atlassian.net', jiraEmail: 'dev@acme.test', jiraApiToken: 't' });

    const url = jira.getTaskPageUrl({ id: '1', key: '//evil.test/x?y#z' })!;

    expect(new URL(url).origin).toBe('https://acme.atlassian.net');
    expect(url).toBe('https://acme.atlassian.net/browse/%2F%2Fevil.test%2Fx%3Fy%23z');
  });

  it('GetTaskPageUrl_JiraNotSetUp_HasNone', () => {
    expect(new JiraProvider().getTaskPageUrl({ id: '1', key: 'X-1' })).toBeNull();
  });

  it('GetTaskPageUrl_OpenProject_OpensTheWorkPackageById', async () => {
    const op = new OpenProjectProvider();
    await op.initialize({ domain: 'https://projects.example.test/', apiToken: 'k' });

    expect(op.getTaskPageUrl({ id: '309', key: 'OP-309' })).toBe('https://projects.example.test/work_packages/309');
    expect(op.getTaskPageUrl({ id: 'OP-309', key: 'OP-309' })).toBe('https://projects.example.test/work_packages/309');
  });

  it('GetTaskPageUrl_OpenProjectNotSetUp_HasNone', () => {
    expect(new OpenProjectProvider().getTaskPageUrl({ id: '309', key: 'OP-309' })).toBeNull();
  });
});

describe('TimeTrackingEngine.taskPageUrl', () => {
  let dbConn: DatabaseConnection;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let engine: TimeTrackingEngine;
  let taskPageUrlFor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(dbConn);
    projectRepo = new ProjectRepository(dbConn);
    taskPageUrlFor = vi.fn((_provider: string | undefined, task: { key: string }) => `https://site.test/browse/${task.key}`);
    const manager = { taskPageUrlFor } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(new SessionRepository(dbConn), new WorklogRepository(dbConn), taskRepo, manager, projectRepo);
    projectRepo.saveProject({ id: 'J', key: 'J', name: 'Jira project', providerId: 'jira' });
    projectRepo.saveProject({ id: 'L', key: 'L', name: 'Legacy project', providerId: 'local' });
    projectRepo.saveProject({ id: 'OWN', key: 'OWN', name: 'Made here', providerId: 'sprintticker' });
    taskRepo.saveTask({ id: 'J1', projectId: 'J', key: 'J-1', title: 'Remote', status: 'todo' });
    taskRepo.saveTask({ id: 'L1', projectId: 'L', key: 'L-1', title: 'Legacy', status: 'todo' });
    taskRepo.saveTask({ id: 'OWN1', projectId: 'OWN', key: 'OWN-1', title: 'Local', status: 'todo' });
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
  });

  it('TaskPageUrl_ProviderTask_AsksTheProviderItCameFrom', () => {
    expect(engine.taskPageUrl('J1')).toBe('https://site.test/browse/J-1');
    expect(taskPageUrlFor).toHaveBeenCalledWith('jira', expect.objectContaining({ id: 'J1', key: 'J-1' }));
  });

  it('TaskPageUrl_ProviderNotKnown_AsksTheActiveOne', () => {
    engine.taskPageUrl('L1');

    expect(taskPageUrlFor).toHaveBeenCalledWith(undefined, expect.objectContaining({ id: 'L1' }));
  });

  it('TaskPageUrl_AppsOwnAdHocOrUnknownTask_AsksNobody', () => {
    const adHoc = taskRepo.createAdHocTask('Code review');

    expect(engine.taskPageUrl('OWN1')).toBeNull();
    expect(engine.taskPageUrl(adHoc.id)).toBeNull();
    expect(engine.taskPageUrl('nope')).toBeNull();
    expect(engine.taskPageUrl('')).toBeNull();
    expect(taskPageUrlFor).not.toHaveBeenCalled();
  });

  it('GetWorklogs_EachTask_SaysWhetherItHasAPage', () => {
    const worklogs = new WorklogRepository(dbConn);
    const adHoc = taskRepo.createAdHocTask('Code review');
    const at = new Date().toISOString();
    for (const [i, taskId] of ['J1', 'OWN1', adHoc.id].entries()) {
      worklogs.saveWorklog({ id: `w${i}`, sessionId: `s${i}`, taskId, durationSeconds: 60, startedAtUtc: at, comment: '', createdAtUtc: at });
    }

    const flags = Object.fromEntries(worklogs.getTodaysWorklogs().map(w => [w.taskId, w.hasTaskPage]));

    expect(flags).toEqual({ J1: true, OWN1: false, [adHoc.id]: false });
  });
});
