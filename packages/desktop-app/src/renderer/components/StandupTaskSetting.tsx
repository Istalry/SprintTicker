import React, { useEffect, useState } from 'react';
import { StandupTaskDTO } from '../../shared/dtos';
import { TaskPicker } from './TaskPicker';

const warn = (what: string) => (err: unknown) => console.warn(`[StandupTaskSetting] ${what} failed:`, err);

/**
 * The stand-up's task as stored, and a choice that saves it -- shared by the
 * first run's row and Settings › My workday, so the two cannot disagree. A
 * choice the bridge refuses is taken back.
 */
export const useStandupTask = (): { task: StandupTaskDTO | null; choose: (next: StandupTaskDTO | null) => void } => {
  const [task, setTask] = useState<StandupTaskDTO | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getStandupTask) return undefined;
    let live = true;
    api.getStandupTask()
      .then(value => { if (live) setTask(value); })
      .catch(warn('Reading the stand-up task'));
    return () => { live = false; };
  }, []);

  const choose = (next: StandupTaskDTO | null) => {
    const previous = task;
    setTask(next);
    window.electronAPI.setStandupTask(next).catch(err => {
      warn('Choosing the stand-up task')(err);
      setTask(previous);
    });
  };
  return { task, choose };
};

/**
 * Which task the stand-up is timed on (D3, redesign P8c2). None keeps it on
 * the local "Daily Standup", never sent; a task chosen gets the stand-up's
 * time like any entry. The first run's form; Settings has `StandupSetting`.
 */
export const StandupTaskSetting: React.FC<{ providerName: string }> = ({ providerName }) => {
  const { task, choose } = useStandupTask();
  const [picking, setPicking] = useState(false);

  const provider = providerName.trim() || 'your provider';
  return (
    <div className="space-y-2">
      <div className="text-xs text-text-secondary">Timed on</div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs text-text-primary">
          {task ? (
            <>
              <span className="font-mono font-bold">{task.taskKey}</span> <span className="truncate">{task.title}</span>
              <span className="block text-text-secondary">Sent to {provider}, like any entry.</span>
            </>
          ) : (
            <>
              Daily Standup
              <span className="block text-text-secondary">Kept on this computer, never sent.</span>
            </>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {task && (
            <button type="button" onClick={() => choose(null)}
              className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark">
              Keep it here
            </button>
          )}
          <button type="button" onClick={() => setPicking(true)}
            className="px-3 py-1.5 bg-select hover:bg-dark-600 text-text-primary border border-focus/30 rounded-lg text-xs font-semibold">
            Choose a task…
          </button>
        </div>
      </div>
      <TaskPicker
        isOpen={picking}
        mode="place"
        title="Time the stand-up on a task"
        subtitle={`Its time is sent to ${provider} there, like any entry.`}
        onClose={() => setPicking(false)}
        onPick={picked => {
          if (picked.task) choose({ taskId: picked.task.id, taskKey: picked.task.key, title: picked.task.title });
        }}
      />
    </div>
  );
};
