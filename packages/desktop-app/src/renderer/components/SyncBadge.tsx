import React from 'react';
import { WorklogDTO } from '../../shared/dtos';
import { WorklogSyncState } from '../../shared/worklog-correction';
import { refusalReason } from '../../shared/refused-entry';
import { SYNC_STATE_WORDS } from '../../shared/sync-state-words';

/** How each send state reads on a row (`SYNC_STATE_WORDS`, shared with the agent's answers), and its colour. */
const TONE: Record<WorklogSyncState, string> = {
  local: 'text-text-secondary border-border-dark',
  pending: 'text-accent-amber border-accent-amber/40',
  sent: 'text-accent-green border-accent-green/40',
  failed: 'text-accent-red border-accent-red/40',
  refused: 'text-accent-red border-accent-red/40',
  'correction-pending': 'text-accent-amber border-accent-amber/40',
  'correction-failed': 'text-accent-red border-accent-red/40',
  'held-overlap': 'text-accent-amber border-accent-amber/40'
};

export const SYNC_BADGE: Record<WorklogSyncState, { label: string; tone: string; hint: string }> = Object.fromEntries(
  (Object.keys(SYNC_STATE_WORDS) as WorklogSyncState[]).map(state => [state, { ...SYNC_STATE_WORDS[state], tone: TONE[state] }])
) as Record<WorklogSyncState, { label: string; tone: string; hint: string }>;

/** "Waiting to send · overlaps PF-31" for an entry an overlap holds back; the state's own label otherwise. */
export function syncBadgeLabel(log: WorklogDTO): string {
  const label = SYNC_BADGE[log.syncState!].label;
  return log.syncState === 'held-overlap' && log.overlapsTaskKey ? `${label} · overlaps ${log.overlapsTaskKey}` : label;
}

/** Where an entry stands with the provider: History's rows and Today's alike. */
export const SyncBadge: React.FC<{ log: WorklogDTO }> = ({ log }) => {
  if (!log.syncState) return null;
  const badge = SYNC_BADGE[log.syncState];
  // A refusal says why: the provider's own words (P11c).
  const hint = log.syncState === 'refused' ? `Refused: ${refusalReason(log.refusal)}. Move it to another task, or keep it here.` : badge.hint;
  return (
    <span title={hint} className={`px-1.5 py-0.5 border rounded text-[10px] whitespace-nowrap ${badge.tone}`}>
      {syncBadgeLabel(log)}
    </span>
  );
};
