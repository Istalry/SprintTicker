import { SyncQueueSnapshotDTO, UpdateStatusDTO } from '../../shared/dtos';

/** How bad a status row is, worst last. The header's word follows the worst. */
export type StatusSeverity = 'ok' | 'info' | 'waiting' | 'problem';

const RANK: Record<StatusSeverity, number> = { ok: 0, info: 1, waiting: 2, problem: 3 };
/** Between two rows as bad: time not reaching the provider is worse than a bar. */
const TIE: Record<StatusRow['id'], number> = { update: 0, bar: 1, sending: 2 };

/** One row of the status panel (S27). */
export interface StatusRow {
  id: 'bar' | 'sending' | 'update';
  severity: StatusSeverity;
  /** The row's first line: what is the case. */
  title: string;
  /** What it means, and where to fix it. */
  detail: string;
  /** The word the header shows when this row is the worst. */
  headerWord: string;
}

/** What the panel reads, each from an existing source. */
export interface StatusInputs {
  /** `null` when the user has no bar (no-bar mode): no row at all. */
  bar: { connected: boolean; address: string; pingMs: number } | null;
  queue: SyncQueueSnapshotDTO | null;
  update: UpdateStatusDTO | null;
  providerName: string;
}

const ALL_GOOD = 'All good';

/** The rows the panel shows, in the panel's order. */
export function statusRows(inputs: StatusInputs): StatusRow[] {
  const rows: StatusRow[] = [];

  if (inputs.bar) {
    rows.push(
      inputs.bar.connected
        ? {
            id: 'bar',
            severity: 'ok',
            title: 'BUSY Bar connected',
            detail: `${inputs.bar.address} · answers in ${inputs.bar.pingMs} ms`,
            headerWord: ALL_GOOD
          }
        : {
            id: 'bar',
            severity: 'problem',
            title: 'BUSY Bar not answering',
            detail: `Nothing from ${inputs.bar.address}. Your time is kept; check the cable, or the address in Settings, Desk devices.`,
            headerWord: 'Bar offline'
          }
    );
  }

  const queue = inputs.queue;
  if (queue) {
    const waiting = queue.counts.pending + queue.counts.syncing;
    if (queue.counts.failed > 0) {
      rows.push({
        id: 'sending',
        severity: 'problem',
        title: `${entries(queue.counts.failed)} could not be sent`,
        detail: `${inputs.providerName} did not take them yet — no answer, or the sign-in was refused. They are kept here and sent again once it works: Settings › Account › Entries waiting to send.`,
        headerWord: 'Sending stopped'
      });
    } else if (waiting > 0) {
      rows.push({
        id: 'sending',
        severity: 'waiting',
        title: `${entries(waiting)} waiting to send`,
        detail: `They go to ${inputs.providerName} as soon as it answers.`,
        headerWord: `${waiting} waiting`
      });
    } else {
      rows.push({
        id: 'sending',
        severity: 'ok',
        title: 'Everything sent',
        detail: `${inputs.providerName} has all your time.`,
        headerWord: ALL_GOOD
      });
    }
  }

  if (inputs.update?.status === 'update-available') {
    rows.push({
      id: 'update',
      severity: 'info',
      title: `Version ${inputs.update.latestVersion} is out`,
      detail: `You have ${inputs.update.currentVersion}.`,
      headerWord: 'Update'
    });
  }

  return rows;
}

/** The worst row, or none when every row is fine. */
export function worstRow(rows: readonly StatusRow[]): StatusRow | null {
  let worst: StatusRow | null = null;
  for (const row of rows) {
    if (row.severity === 'ok') continue;
    if (
      !worst ||
      RANK[row.severity] > RANK[worst.severity] ||
      (RANK[row.severity] === RANK[worst.severity] && TIE[row.id] > TIE[worst.id])
    ) {
      worst = row;
    }
  }
  return worst;
}

/** The header's word: the worst row's, or "All good". */
export function statusHeaderWord(rows: readonly StatusRow[]): string {
  return worstRow(rows)?.headerWord ?? ALL_GOOD;
}

function entries(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`;
}
