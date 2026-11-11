import React from 'react';
import { WorklogDTO } from '../../shared/dtos';
import { WorklogSyncState } from '../../shared/worklog-correction';

/** How each send state reads on a row, and what its tooltip adds. */
export const SYNC_BADGE: Record<WorklogSyncState, { label: string; tone: string; hint: string }> = {
  local: { label: 'Local only', tone: 'text-text-secondary border-border-dark', hint: 'Kept in SprintTicker; never sent to a provider.' },
  pending: { label: 'Sending', tone: 'text-accent-amber border-accent-amber/40', hint: 'Queued for the provider.' },
  sent: { label: 'Sent', tone: 'text-accent-green border-accent-green/40', hint: 'At the provider.' },
  failed: { label: 'Not sent', tone: 'text-accent-red border-accent-red/40', hint: 'Parked: see Entries waiting to send, in Settings, Account.' },
  'correction-pending': { label: 'Correction pending', tone: 'text-accent-amber border-accent-amber/40', hint: 'A correction is on its way to the provider.' },
  'correction-failed': { label: 'Correction failed', tone: 'text-accent-red border-accent-red/40', hint: 'Parked: see Entries waiting to send, in Settings, Account.' },
  'held-overlap': { label: 'Waiting', tone: 'text-accent-amber border-accent-amber/40', hint: 'It overlaps an earlier entry, and is not sent until one of them is corrected.' }
};

/** "Waiting · overlaps PF-31" for an entry an overlap holds back; the state's own label otherwise. */
export function syncBadgeLabel(log: WorklogDTO): string {
  const label = SYNC_BADGE[log.syncState!].label;
  return log.syncState === 'held-overlap' && log.overlapsTaskKey ? `${label} · overlaps ${log.overlapsTaskKey}` : label;
}

/** Where an entry stands with the provider: History's rows and Today's alike. */
export const SyncBadge: React.FC<{ log: WorklogDTO }> = ({ log }) => {
  if (!log.syncState) return null;
  const badge = SYNC_BADGE[log.syncState];
  return (
    <span title={badge.hint} className={`px-1.5 py-0.5 border rounded text-[10px] whitespace-nowrap ${badge.tone}`}>
      {syncBadgeLabel(log)}
    </span>
  );
};
