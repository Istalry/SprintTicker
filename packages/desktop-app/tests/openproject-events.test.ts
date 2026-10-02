import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { isProviderRequestError } from '../src/main/providers/provider-errors';
import { ArgumentException } from '../src/shared/dtos';
import { PROVIDERS_WITH_EVENTS } from '../src/shared/provider-events';
import { AdHocProvider } from '../src/main/providers/adhoc-provider';
import { JiraProvider } from '../src/main/providers/jira-provider';

const BASE = 'https://op.test';
const SINCE = '2026-10-01T10:00:00.000Z';

/** One OpenProject notification, as /api/v3/notifications returns it. */
function notification(
  id: number,
  reason: string,
  createdAt: string,
  overrides: { actor?: string | null; workPackage?: number | null; title?: string } = {}
): Record<string, unknown> {
  const workPackage = overrides.workPackage === undefined ? 142 : overrides.workPackage;
  return {
    _type: 'Notification',
    id,
    reason,
    readIAN: false,
    subject: 'Notification subject',
    createdAt,
    _links: {
      actor: overrides.actor === null ? { href: null } : { href: '/api/v3/users/5', title: overrides.actor ?? 'Alice Martin' },
      resource: workPackage === null
        ? { href: null }
        : { href: `/api/v3/work_packages/${workPackage}`, title: overrides.title ?? 'Rework the pause menu' }
    }
  };
}

function collection(elements: Array<Record<string, unknown>>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ _embedded: { elements }, _links: {} })
  } as unknown as Response;
}

describe('OpenProject events', () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let provider: OpenProjectProvider;

  beforeEach(async () => {
    fetchFn = vi.fn();
    provider = new OpenProjectProvider({ fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined });
    await provider.initialize({ domain: BASE, apiKey: 'test-key' });
  });

  it('GetEventsSince_EachReason_MapsToItsKindAndDropsTheRest', async () => {
    const at = '2026-10-01T10:05:00.000Z';
    fetchFn.mockResolvedValue(collection([
      notification(1, 'assigned', at),
      notification(2, 'responsible', at),
      notification(3, 'mentioned', at),
      notification(4, 'commented', at),
      notification(5, 'processed', at),
      notification(6, 'dateAlert', at, { actor: null }),
      // Not about the user's attention: dropped.
      notification(7, 'watched', at),
      notification(8, 'subscribed', at),
      notification(9, 'created', at),
      notification(10, 'prioritized', at),
      notification(11, 'scheduled', at)
    ]));

    const events = await provider.getEventsSince(SINCE);

    expect(events.map(e => [e.id, e.kind])).toEqual([
      ['openproject:1', 'assigned'],
      ['openproject:2', 'assigned'],
      ['openproject:3', 'mentioned'],
      ['openproject:4', 'commented'],
      ['openproject:5', 'status_changed'],
      ['openproject:6', 'date_alert']
    ]);
  });

  it('GetEventsSince_WorkPackageNotification_CarriesTheTaskTheActorAndALink', async () => {
    fetchFn.mockResolvedValue(collection([notification(1, 'mentioned', '2026-10-01T10:05:00Z')]));

    const [event] = await provider.getEventsSince(SINCE);

    expect(event).toEqual({
      id: 'openproject:1',
      providerId: 'openproject',
      kind: 'mentioned',
      // The key the app gives OpenProject tasks everywhere else.
      taskKey: 'OP-142',
      taskTitle: 'Rework the pause menu',
      actorName: 'Alice Martin',
      url: `${BASE}/work_packages/142`,
      occurredAtUtc: '2026-10-01T10:05:00.000Z'
    });
  });

  it('GetEventsSince_NoActorOrResource_LeavesThemOutRatherThanInventing', async () => {
    fetchFn.mockResolvedValue(collection([
      notification(1, 'dateAlert', '2026-10-01T10:05:00Z', { actor: null, workPackage: null })
    ]));

    const [event] = await provider.getEventsSince(SINCE);

    expect(event.actorName).toBeUndefined();
    expect(event.url).toBeUndefined();
    expect(event.taskKey).toBe('');
    expect(event.taskTitle).toBe('Notification subject');
  });

  it('GetEventsSince_AtOrBeforeTheCursor_IsNotReturned', async () => {
    fetchFn.mockResolvedValue(collection([
      notification(1, 'mentioned', '2026-10-01T09:59:59Z'),
      notification(2, 'mentioned', SINCE),
      notification(3, 'mentioned', '2026-10-01T10:00:01Z'),
      notification(4, 'mentioned', 'not a date')
    ]));

    const events = await provider.getEventsSince(SINCE);

    expect(events.map(e => e.id)).toEqual(['openproject:3']);
  });

  it('GetEventsSince_AsksForUnreadNotificationsOnly', async () => {
    fetchFn.mockResolvedValue(collection([]));

    await provider.getEventsSince(SINCE);

    const url = new URL(fetchFn.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/api/v3/notifications');
    expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([{ readIAN: { operator: '=', values: ['f'] } }]);
  });

  it('GetEventsSince_Unauthorised_Throws', async () => {
    // Throwing is the contract: an empty answer would read as "nothing
    // happened", and the poll would move its cursor past what it missed.
    fetchFn.mockResolvedValue({ ok: false, status: 401, text: async () => 'no', json: async () => ({}) });

    const error = await provider.getEventsSince(SINCE).catch(err => err);

    expect(isProviderRequestError(error) && error.kind).toBe('auth');
  });

  it('GetEventsSince_ServerUnreachable_Throws', async () => {
    fetchFn.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(provider.getEventsSince(SINCE)).rejects.toThrow();
  });

  it('GetEventsSince_NotConfigured_ThrowsWithoutARequest', async () => {
    const bare = new OpenProjectProvider({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(bare.getEventsSince(SINCE)).rejects.toSatisfy(err => isProviderRequestError(err) && err.kind === 'not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('GetEventsSince_CursorNotATimestamp_Throws', async () => {
    await expect(provider.getEventsSince('yesterday')).rejects.toBeInstanceOf(ArgumentException);
  });

  it('GetEventsInboxUrl_PointsAtTheNotificationCenter', async () => {
    expect(provider.getEventsInboxUrl()).toBe(`${BASE}/notifications`);
    expect(new OpenProjectProvider().getEventsInboxUrl()).toBeNull();
  });

  it('ProvidersWithEvents_MatchTheAdaptersThatImplementThem', () => {
    // The settings panel offers notifications for the listed providers; an
    // entry without the method would offer settings that do nothing.
    const adapters = [new OpenProjectProvider(), new JiraProvider(), new AdHocProvider()];
    const implementing = adapters.filter(p => typeof p.getEventsSince === 'function').map(p => p.providerId);

    expect([...PROVIDERS_WITH_EVENTS].sort()).toEqual(implementing.sort());
  });
});
