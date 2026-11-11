import React from 'react';
import { WorklogDTO } from '../../shared/dtos';
import { StateWord } from '../../shared/words';
import { formatHoursMinutes, formatHoursAndMinutes } from '../utils/formatters';
import { EntryAction, EntryMenu } from './EntryActions';
import { InlineRename } from './InlineRename';
import { SyncBadge } from './SyncBadge';
import { TaskPageButton } from './TaskPageButton';

/** One cell's padding, for every entries table. */
export const ENTRY_CELL = 'py-2.5 px-3';

/** The badge of an interruption's entry still to place. */
const TO_PLACE_BADGE = 'px-1.5 py-0.5 border rounded text-[10px] text-accent-amber border-accent-amber/40';

/** Task, Note, Time, Started, the provider's name, and ⋯: Today's and History's columns. */
export const EntriesHead: React.FC<{ providerName: string }> = ({ providerName }) => (
  <thead>
    <tr className="border-b border-border-dark text-text-secondary text-xs">
      <th className={`${ENTRY_CELL} font-semibold`}>Task</th>
      <th className={`${ENTRY_CELL} font-semibold`}>Note</th>
      <th className={`${ENTRY_CELL} font-semibold`}>Time</th>
      <th className={`${ENTRY_CELL} font-semibold`}>Started</th>
      <th className={`${ENTRY_CELL} font-semibold`}>{providerName || 'Sent'}</th>
      <th className={ENTRY_CELL}><span className="sr-only">Actions</span></th>
    </tr>
  </thead>
);

/**
 * One entry (S5, S14): ⚡ for time that started as an interruption, its
 * task, the note the provider shows, where it stands there, and ⋯ for
 * Correct, ↳ Move and Delete. Ad-hoc work is named in place when
 * `onRename` is given.
 */
export const EntryRow: React.FC<{
  log: WorklogDTO;
  onAction: (action: EntryAction) => void;
  onRename?: (name: string) => Promise<void>;
}> = ({ log, onAction, onRename }) => (
  <tr className={`transition-colors ${log.fromInterruption ? 'bg-accent-amber/5 hover:bg-accent-amber/10' : 'hover:bg-dark-700/50'}`}>
    <td className={`${ENTRY_CELL} font-mono font-bold text-text-primary whitespace-nowrap`}>
      <span className="inline-flex items-center gap-1.5">
        {log.fromInterruption && <span title="Started as an interruption" className="text-accent-amber">⚡</span>}
        {log.taskKey ?? log.taskId}
        {log.hasTaskPage && <TaskPageButton taskId={log.taskId} taskKey={log.taskKey ?? log.taskId} />}
      </span>
    </td>
    <td className={`${ENTRY_CELL} text-text-primary`}>
      <span className="inline-flex flex-wrap items-center gap-2">
        {log.adHoc && onRename && log.taskTitle ? (
          <InlineRename
            title={log.taskTitle}
            ownerId={log.taskId}
            onRename={onRename}
            className="text-text-primary"
            inputClassName="bg-dark-800 border border-focus rounded px-2 py-0.5 text-white outline-none"
          />
        ) : (
          log.comment || <span className="text-text-secondary">{log.taskTitle ?? ''}</span>
        )}
        {log.unsorted && <span className={TO_PLACE_BADGE} title="An interruption not placed on a task yet.">{StateWord.TO_PLACE}</span>}
      </span>
    </td>
    <td className={`${ENTRY_CELL} font-mono text-text-primary font-bold whitespace-nowrap`}>{formatHoursAndMinutes(log.durationSeconds)}</td>
    <td className={`${ENTRY_CELL} text-xs text-text-secondary font-mono`}>{formatHoursMinutes(new Date(log.startedAtUtc))}</td>
    <td className={ENTRY_CELL}><SyncBadge log={log} /></td>
    <td className={`${ENTRY_CELL} text-right`}><EntryMenu log={log} onAction={onAction} /></td>
  </tr>
);
