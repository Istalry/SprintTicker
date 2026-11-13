import React, { useState } from 'react';
import { TaskPicker } from './TaskPicker';
import { useStandupTask } from './StandupTaskSetting';
import { SETTING_SELECT_CLASS, SettingButton, SettingRow } from './SettingRow';

interface StandupSettingProps {
  providerName: string;
  /** The stand-up's time, kept with the rest of the schedule by the page. */
  time: string;
  onTimeChange: (time: string) => void;
  /** Shows the reminder now; the timer is not touched unless Join is pressed. */
  onShowMe: () => void;
}

/**
 * The stand-up's row (S21): its time, the task it is timed on (D3, redesign
 * P8c2) and Show me. No task keeps it on the local "Daily Standup", never
 * sent; a task chosen gets the stand-up's time like any entry.
 */
export const StandupSetting: React.FC<StandupSettingProps> = ({ providerName, time, onTimeChange, onShowMe }) => {
  const { task, choose } = useStandupTask();
  const [picking, setPicking] = useState(false);

  const provider = providerName.trim() || 'your provider';
  return (
    <SettingRow
      title="Stand-up"
      description={
        task
          ? `A reminder. Join times it on ${task.taskKey} ${task.title}, sent to ${provider} like any entry, then goes back to your task.`
          : 'A reminder. Join times it on Daily Standup, kept on this computer and never sent, then goes back to your task.'
      }
      control={
        <>
          <input
            type="time"
            aria-label="Stand-up time"
            value={time}
            onChange={e => onTimeChange(e.target.value)}
            className={`${SETTING_SELECT_CLASS} font-mono`}
          />
          <SettingButton aria-label="Choose the stand-up's task" onClick={() => setPicking(true)}>
            on {task ? task.taskKey : 'Daily Standup'} ▾
          </SettingButton>
          {task && <SettingButton tone="ghost" onClick={() => choose(null)}>Keep it here</SettingButton>}
          <SettingButton tone="ghost" title="Shows the reminder now. Your timer is not touched unless you press Join." onClick={onShowMe}>
            Show me
          </SettingButton>
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
        </>
      }
    />
  );
};
