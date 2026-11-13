import React from 'react';
import { X } from 'lucide-react';
import { MorningDTO } from '../../shared/dtos';
import { localDateKey } from '../../shared/local-date';
import { Verb } from '../../shared/words';
import { formatClockTime, formatHoursAndMinutes, formatLongDay } from '../utils/formatters';
import { useInterruptionsToPlace } from './InterruptionsToPlace';

const warn = (what: string) => (err: unknown) => console.warn(`[MorningCard] ${what} failed:`, err);

/** Minutes from now to "09:30" today; the stand-up line says how long is left. */
export function minutesUntil(at: string, now: Date): number {
  const [h, m] = at.split(':').map(Number);
  return h * 60 + m - (now.getHours() * 60 + now.getMinutes());
}

/** Brings the interruptions card into view: the morning card's lines point at it rather than copy it. */
function showInterruptions(): void {
  document.querySelector('section[aria-label="Interruptions to place"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

interface MorningCardProps {
  morning: MorningDTO;
  onOpenPicker: () => void;
  onPutAway: () => void;
  /** When the card was read: the stand-up line counts from it. */
  now: Date;
}

/**
 * The morning card (S4b): what yesterday left, the first time Today opens
 * on a working day. Each line is one press, and the card goes once anything
 * starts (`useMorning`) or when put away.
 */
export const MorningCard: React.FC<MorningCardProps> = ({ morning, onOpenPicker, onPutAway, now }) => {
  const api = window.electronAPI;
  const start = (taskId: string, key: string) => {
    api.startTask(taskId).catch(warn(`Starting ${key}`));
  };
  const today = localDateKey(now);
  const earlier = useInterruptionsToPlace().filter(item => localDateKey(new Date(item.startedAtUtc)) < today);
  const minutes = morning.standupAt ? minutesUntil(morning.standupAt, now) : 0;

  const line = 'flex items-center justify-between gap-3 rounded-lg bg-dark-900/60 border border-border-dark px-3 py-2';
  const small = 'shrink-0 px-3 py-1.5 border border-border-dark rounded-lg text-xs text-text-secondary hover:text-white hover:border-focus';
  return (
    <section aria-label="Good morning" className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-3 select-none">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Good morning · {formatLongDay(morning.dateKey)}</span>
        <button type="button" aria-label="Put the morning card away" title={Verb.NOT_NOW} onClick={onPutAway}
          className="p-1 rounded text-text-secondary hover:text-white hover:bg-dark-700">
          <X className="w-4 h-4" />
        </button>
      </div>

      {morning.lastTask && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">Carry on with <span className="font-mono">{morning.lastTask.key}</span>?</div>
            <div className="text-xs text-text-secondary truncate">
              {morning.lastTask.title} · you stopped it at <span className="font-mono">{formatClockTime(new Date(morning.lastTask.stoppedAtUtc))}</span>, still open
            </div>
          </div>
          <button type="button" onClick={() => start(morning.lastTask!.id, morning.lastTask!.key)}
            className="shrink-0 px-4 py-2 bg-accent-green hover:bg-accent-green/90 text-dark-900 text-xs font-semibold rounded-lg">
            ▶ Continue <span className="font-mono">{morning.lastTask.key}</span>
          </button>
        </div>
      )}

      {earlier.length > 0 && (
        <div className={line}>
          <div className="min-w-0 text-xs">
            <div className="font-bold text-white"><span aria-hidden="true">⚡</span> {earlier.length === 1 ? '1 interruption' : `${earlier.length} interruptions`} from before today to place</div>
            <div className="text-text-secondary truncate">
              {earlier.map(item => `${item.title} (${formatHoursAndMinutes(item.durationSeconds)})`).join(' · ')}
            </div>
          </div>
          <button type="button" className={small} onClick={showInterruptions}>{Verb.PLACE} them…</button>
        </div>
      )}

      {morning.standupAt && (
        <div className={line}>
          <div className="text-xs">
            <div className="font-bold text-white">Stand-up at <span className="font-mono">{morning.standupAt}</span></div>
            <div className="text-text-secondary">
              {minutes > 0 ? `In ${minutes < 60 ? `${minutes} min` : formatHoursAndMinutes(minutes * 60)}. ` : ''}The reminder comes then.
            </div>
          </div>
        </div>
      )}

      <div className={line}>
        <div className="min-w-0 text-xs space-y-1">
          <div className="font-bold text-white">
            {morning.inProgress.length === 0
              ? (morning.lastTask ? 'No other task in progress' : 'No task in progress')
              : morning.inProgress.length === 1 ? 'Your task in progress' : `Your ${morning.inProgress.length} tasks in progress`}
          </div>
          {morning.inProgress.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {morning.inProgress.map(task => (
                <button key={task.id} type="button" title={`${Verb.START} ${task.key}`} onClick={() => start(task.id, task.key)}
                  className="px-2 py-0.5 rounded border border-border-dark text-text-secondary hover:text-white hover:border-focus">
                  <span className="font-mono">{task.key}</span> {task.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className={small} onClick={onOpenPicker}>Pick another…</button>
      </div>
    </section>
  );
};
