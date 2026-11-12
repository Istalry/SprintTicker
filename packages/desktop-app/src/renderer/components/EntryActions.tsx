import React, { useEffect, useState } from 'react';
import { WorklogDTO } from '../../shared/dtos';
import { closedWeekWarning, isInClosedWeek } from '../../shared/closed-week';
import { formatClockTime, ipcErrorMessage } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { EditWorklogModal } from './EditWorklogModal';
import { SplitWorklogDialog } from './SplitWorklogDialog';
import { TaskPicker } from './TaskPicker';
import { ConfirmPanel } from './ConfirmPanel';
import { RowMenu } from './RowMenu';
import { keepOffLabel, Verb } from '../../shared/words';

export type EntryAction = 'edit' | 'move' | 'delete' | 'keep-off';

interface Moving {
  worklogIds: string[];
  label: string;
}

/**
 * Correct (and from it Split in two), Move and Delete on an entry, with their dialogs: History's rows
 * and Today's (P8e) share this, so the closed-week warning and the move's
 * one-after-another rule live once.
 *
 * `sameDay` is the day's entries, which a correction checks for overlaps;
 * `onChanged` runs after anything changed, to read the day again.
 */
export function useEntryActions(sameDay: WorklogDTO[], onChanged: () => void) {
  const [editing, setEditing] = useState<{ worklog: WorklogDTO; mode: 'edit' | 'delete' } | null>(null);
  // Split in two (S16c), opened from Correct.
  const [splitting, setSplitting] = useState<WorklogDTO | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  // A move of closed-week time, waiting for the user to say go on.
  const [askingMove, setAskingMove] = useState<Moving | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [lastWeekClosed, setLastWeekClosed] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const { providerName } = useProviderCapabilities();

  useEffect(() => {
    let current = true;
    const read = window.electronAPI?.getLastWeekClosed;
    if (!read) return undefined;
    read().then(
      monday => { if (current) setLastWeekClosed(monday); },
      err => console.error('[EntryActions] Failed to read the last week closed:', err)
    );
    return () => { current = false; };
  }, [revision]);

  const changed = () => {
    setRevision(r => r + 1);
    onChanged();
  };

  /** Opens the picker for these entries -- after asking, when any is closed-week time. */
  const startMove = (logs: WorklogDTO[], label: string) => {
    const request = { worklogIds: logs.map(log => log.id), label };
    if (logs.some(log => isInClosedWeek(log.startedAtUtc, lastWeekClosed))) setAskingMove(request);
    else setMoving(request);
  };

  /**
   * Moves the entries to the task picked, one after the other: each is its
   * own deletion and send. A refusal stops there and is shown; the ones
   * moved before it stay moved.
   */
  const moveTo = async (worklogIds: string[], taskId: string) => {
    setMoving(null);
    setMoveError(null);
    try {
      for (const id of worklogIds) await window.electronAPI.moveWorklog(id, taskId);
    } catch (err) {
      setMoveError(ipcErrorMessage(err));
    } finally {
      changed();
    }
  };

  /** Keeps a refused entry off its provider (P11c): local time on its task, undoable. */
  const keepOff = (log: WorklogDTO) => {
    setMoveError(null);
    window.electronAPI.keepWorklogOff(log.id).then(
      () => changed(),
      err => setMoveError(ipcErrorMessage(err))
    );
  };

  const run = (log: WorklogDTO, action: EntryAction) => {
    if (action === 'move') startMove([log], log.taskTitle ?? log.taskKey ?? log.taskId);
    else if (action === 'keep-off') keepOff(log);
    else setEditing({ worklog: log, mode: action });
  };

  const dialogs = (
    <>
      {askingMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
          <div className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
            <ConfirmPanel
              title="Move time from a closed week?"
              message={<><strong className="text-white">{askingMove.label}</strong>. {closedWeekWarning(providerName)}</>}
              confirmLabel="Choose a task"
              cancelLabel="Back"
              onConfirm={() => { setMoving(askingMove); setAskingMove(null); }}
              onCancel={() => setAskingMove(null)}
            />
          </div>
        </div>
      )}

      <TaskPicker
        isOpen={moving !== null}
        mode="move"
        subtitle={moving ? `${moving.label}: its time goes to the task you pick` : undefined}
        onClose={() => setMoving(null)}
        onPick={picked => { if (moving && picked.task) void moveTo(moving.worklogIds, picked.task.id); }}
      />

      {editing && (
        <EditWorklogModal
          key={`${editing.worklog.id}-${editing.mode}`}
          worklog={editing.worklog}
          mode={editing.mode}
          sameDay={sameDay}
          lastWeekClosed={lastWeekClosed}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            changed();
          }}
          onSplit={() => {
            setSplitting(editing.worklog);
            setEditing(null);
          }}
        />
      )}

      {splitting && (
        <SplitWorklogDialog
          key={splitting.id}
          worklog={splitting}
          lastWeekClosed={lastWeekClosed}
          onClose={() => setSplitting(null)}
          onDone={() => {
            setSplitting(null);
            changed();
          }}
        />
      )}
    </>
  );

  return { run, startMove, dialogs, moveError, providerName };
}

/** ⋯ on an entry (S5): Correct, ↳ Move, Delete -- and Keep off, on one its provider refused (P11c). */
export const EntryMenu: React.FC<{ log: WorklogDTO; onAction: (action: EntryAction) => void; providerName?: string }> = ({
  log,
  onAction,
  providerName = ''
}) => {
  const name = `${log.taskKey ?? log.taskId} at ${formatClockTime(new Date(log.startedAtUtc))}`;
  return (
    <RowMenu
      name={name}
      menuName={`Entry ${name}`}
      items={[
        { label: 'Correct…', run: () => onAction('edit') },
        { label: `↳ ${Verb.MOVE}…`, run: () => onAction('move') },
        ...(log.syncState === 'refused' ? [{ label: keepOffLabel(providerName), run: () => onAction('keep-off') }] : []),
        { label: 'Delete…', run: () => onAction('delete'), danger: true }
      ]}
    />
  );
};
