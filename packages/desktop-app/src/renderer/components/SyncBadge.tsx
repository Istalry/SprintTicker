import React from 'react';
import { WorklogDTO } from '../../shared/dtos';
import { WorklogSyncState } from '../../shared/worklog-correction';
import { refusalReason } from '../../shared/refused-entry';
import { StateWord } from '../../shared/words';

/** How each send state reads on a row, and what its tooltip adds. */
export const SYNC_BADGE: Record<WorklogSyncState, { label: string; tone: string; hint: string }> = {
  local: { label: `${StateWord.LOGGED} here`, tone: 'text-text-secondary border-border-dark', hint: 'Kept on this computer; never sent.' },
  pending: { label: StateWord.WAITING, tone: 'text-accent-amber border-accent-amber/40', hint: 'Sent once the 10 s to undo have passed and your provider answers.' },
  sent: { label: StateWord.SENT, tone: 'text-accent-green border-accent-green/40', hint: 'Your provider has it.' },
  failed: { label: 'Not sent', tone: 'text-accent-red border-accent-red/40', hint: 'Not sent yet: see Settings › Account › Entries waiting to send.' },
  refused: { label: 'Refused', tone: 'text-accent-red border-accent-red/40', hint: 'Refused. Move it to another task, or keep it here.' },
  'correction-pending': { label: 'Correction pending', tone: 'text-accent-amber border-accent-amber/40', hint: 'A correction waits to send.' },
  'correction-failed': { label: 'Correction failed', tone: 'text-accent-red border-accent-red/40', hint: 'Not sent yet: see Settings › Account › Entries waiting to send.' },
  'held-overlap': { label: StateWord.WAITING, tone: 'text-accent-amber border-accent-amber/40', hint: 'It overlaps an earlier entry, and is not sent until one of them is corrected.' }
};

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
