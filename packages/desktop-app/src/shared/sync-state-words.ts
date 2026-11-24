import type { WorklogSyncState } from './worklog-correction';
import { StateWord } from './words';

/**
 * How each send state of an entry reads, and what its tooltip adds: the
 * window's rows and the agent's answers alike (AGENT-INTERFACE.md §4). Kept
 * here, not in the renderer, so an agent never words a state otherwise.
 */
export const SYNC_STATE_WORDS: Record<WorklogSyncState, { label: string; hint: string }> = {
  local: { label: `${StateWord.LOGGED} here`, hint: 'Kept on this computer; never sent.' },
  pending: { label: StateWord.WAITING, hint: 'Sent once the 10 s to undo have passed and your provider answers.' },
  sent: { label: StateWord.SENT, hint: 'Your provider has it.' },
  failed: { label: 'Not sent', hint: 'Not sent yet: see Settings › Account › Entries waiting to send.' },
  refused: { label: 'Refused', hint: 'Refused. Move it to another task, or keep it here.' },
  'correction-pending': { label: 'Correction pending', hint: 'A correction waits to send.' },
  'correction-failed': { label: 'Correction failed', hint: 'Not sent yet: see Settings › Account › Entries waiting to send.' },
  'held-overlap': { label: StateWord.WAITING, hint: 'It overlaps an earlier entry, and is not sent until one of them is corrected.' }
};
