import { vi } from 'vitest';
import { WorklogPayload } from '../../src/main/providers/task-provider-interface';
import { ProviderRequestError } from '../../src/main/providers/provider-errors';

/**
 * A provider that keeps its entries the way Jira does: an id per entry, the
 * comment as sent, a marker search, a 404 for an entry it no longer has.
 */
export function fakeRemote(providerId = 'jira', providerName = 'Jira', minimumLoggableSeconds = 60) {
  const entries = new Map<string, WorklogPayload>();
  let nextId = 100;
  const provider = {
    providerId,
    providerName,
    minimumLoggableSeconds,
    initialize: async () => true,
    getProjects: async () => [],
    getTasks: async () => [],
    reconcileRemoteState: async () => ({ remoteLoggedTimeToday: null }),
    updateTaskStatus: async () => true,
    logTime: vi.fn(async (payload: WorklogPayload) => {
      const id = String(nextId++);
      entries.set(id, payload);
      return { success: true, remoteWorklogId: id };
    }),
    findWorklog: vi.fn(async (_taskId: string, _start: string, marker: string) => {
      for (const [id, entry] of entries) if (entry.comment.includes(marker)) return id;
      return null;
    }),
    updateWorklog: vi.fn(async (_taskId: string, id: string, payload: WorklogPayload) => {
      if (!entries.has(id)) throw new ProviderRequestError(providerId, 'protocol', 'Gone', { status: 404 });
      entries.set(id, payload);
    }),
    deleteWorklog: vi.fn(async (_taskId: string, id: string) => {
      entries.delete(id);
    })
  };
  return { provider, entries };
}
