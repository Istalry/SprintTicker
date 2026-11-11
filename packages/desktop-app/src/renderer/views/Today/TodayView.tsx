import React from 'react';
import { ActiveSessionDTO, TaskDTO, WorklogDTO } from '../../../shared/dtos';
import { ActiveTaskHeroCard } from '../../components/ActiveTaskHeroCard';
import { formatClockTime, formatHoursAndMinutes as formatSeconds } from '../../utils/formatters';
import { PickerMode } from '../../hooks/useModals';

interface TodayViewProps {
  session: ActiveSessionDTO | null;
  worklogs: WorklogDTO[];
  onPause: () => void;
  onResume: () => void;
  onComplete: (comment?: string, markDone?: boolean) => void;
  onDiscard: () => void;
  onInterrupt: () => void;
  onBack?: () => void;
  onStopInterruption?: () => void;
  onOpenPicker: (mode: PickerMode) => void;
  /** Switches back to the task before, in one press. */
  onPrevious?: (task: TaskDTO) => void;
}

/**
 * Today (S4, S5): the task running and today's entries. Moved out of `App`
 * as it was; the cards of the redesign arrive with the flows they belong to.
 */
export const TodayView: React.FC<TodayViewProps> = ({
  session,
  worklogs,
  onPause,
  onResume,
  onComplete,
  onDiscard,
  onInterrupt,
  onBack,
  onStopInterruption,
  onOpenPicker,
  onPrevious
}) => (
  <div className="space-y-6">
    <ActiveTaskHeroCard
      session={session}
      onPause={onPause}
      onResume={onResume}
      onComplete={onComplete}
      onDiscard={onDiscard}
      onOpenTaskModal={() => onOpenPicker('start')}
      onAssign={() => onOpenPicker('assign')}
      onInterrupt={onInterrupt}
      onBack={onBack}
      onStopInterruption={onStopInterruption}
      onPrevious={onPrevious}
    />

    <section className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
      <h3 className="text-md font-bold text-white flex items-center justify-between">
        <span>Today&apos;s work</span>
        <span className="text-xs text-text-secondary font-normal">
          Total: <span className="font-mono">{formatSeconds(worklogs.reduce((acc, curr) => acc + curr.durationSeconds, 0))}</span>
        </span>
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-dark text-text-secondary text-xs">
              <th className="py-3 px-4 font-semibold">Task Key</th>
              <th className="py-3 px-4 font-semibold">Comment / Description</th>
              <th className="py-3 px-4 font-semibold">Logged Duration</th>
              <th className="py-3 px-4 font-semibold">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-dark text-sm">
            {session && (
              <tr className="bg-select">
                <td className="py-3 px-4 font-mono font-bold text-text-primary flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
                  <span className="font-mono">{session.taskKey}</span>
                </td>
                <td className="py-3 px-4 text-white font-medium">
                  {session.taskTitle} <span className="text-xs text-text-primary">(Active Session)</span>
                </td>
                <td className="py-3 px-4 font-bold text-accent-green">Tracking...</td>
                <td className="py-3 px-4 text-xs text-text-secondary">Real-time</td>
              </tr>
            )}
            {worklogs.map(log => (
              <tr key={log.id} className="hover:bg-dark-700/50 transition-colors">
                <td className="py-3 px-4 font-mono font-bold text-text-primary">{log.taskKey ?? log.taskId}</td>
                <td className="py-3 px-4 text-text-primary">{log.comment || 'No comment'}</td>
                <td className="py-3 px-4 font-mono text-text-primary font-bold">{formatSeconds(log.durationSeconds)}</td>
                <td className="py-3 px-4 text-xs text-text-secondary font-mono">{formatClockTime(new Date(log.startedAtUtc))}</td>
              </tr>
            ))}
            {!session && worklogs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-xs text-text-secondary">
                  No worklogs recorded today yet. Select a task above to start tracking time!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  </div>
);
