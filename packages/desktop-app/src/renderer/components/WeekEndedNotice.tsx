import React, { useEffect, useState } from 'react';
import { CalendarCheck, X } from 'lucide-react';
import { WeekEndedDTO } from '../../shared/dtos';
import { formatDay, formatHoursAndMinutes } from '../utils/formatters';

interface WeekEndedNoticeProps {
  /** Opens Check my week (P9d) on the week, in History. */
  onCheckWeek: (monday: string) => void;
}

const dayLabel = formatDay;

/**
 * The week just over: its days and the time logged in it, a reminder to
 * check it is all in before it is due. Main closes the week -- at the
 * wrap-up of its last working day, or the next working day when that was
 * missed -- and keeps the notice until it is dismissed, so a window opened
 * later, or after a restart, still shows it.
 */
export const WeekEndedNotice: React.FC<WeekEndedNoticeProps> = ({ onCheckWeek }) => {
  const [week, setWeek] = useState<WeekEndedDTO | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onWeekEnded) return undefined;
    api.getWeekEnded()
      .then(setWeek)
      .catch(err => console.warn('[WeekEndedNotice] Could not read the week:', err));
    return api.onWeekEnded(setWeek);
  }, []);

  if (!week) return null;

  const dismiss = () => {
    setWeek(null);
    window.electronAPI.dismissWeekEnded()
      .catch(err => console.warn('[WeekEndedNotice] Could not dismiss the week:', err));
  };

  return (
    <div role="status" className="fixed bottom-4 right-4 z-40 w-80 bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-white font-bold text-sm">
          <CalendarCheck className="w-4 h-4 text-text-primary" />
          <span>Week over</span>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="p-1 text-text-secondary hover:text-white rounded-md">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">
        {dayLabel(week.weekStart)} to {dayLabel(week.weekEnd)}:{' '}
        <span className="font-mono text-white font-bold">{formatHoursAndMinutes(week.loggedSeconds)}</span> logged. Check it is all
        in before your timesheet is due.
      </p>
      <button
        onClick={() => {
          onCheckWeek(week.weekStart);
          dismiss();
        }}
        className="text-xs font-semibold text-text-primary hover:underline"
      >
        Check my week
      </button>
    </div>
  );
};
