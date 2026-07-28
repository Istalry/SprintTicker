import React, { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { WorklogDTO } from '../../../shared/dtos';

export const WorklogHistoryView: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [worklogs, setWorklogs] = useState<WorklogDTO[]>([]);
  const [summary, setSummary] = useState<{
    totalSeconds: number;
    tasksCount: number;
    items: Array<{ taskId: string; key: string; title: string; durationSeconds: number; comment: string }>;
  }>({ totalSeconds: 0, tasksCount: 0, items: [] });
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch worklogs and summary for selectedDate
  const fetchWorklogsForDate = async (dateStr: string) => {
    setLoading(true);
    if (window.electronAPI?.getWorklogsByDate) {
      const logs = await window.electronAPI.getWorklogsByDate(dateStr);
      setWorklogs(logs);
    }
    if (window.electronAPI?.getDailyWorklogSummary) {
      const sum = await window.electronAPI.getDailyWorklogSummary(dateStr);
      setSummary(sum);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWorklogsForDate(selectedDate);
  }, [selectedDate]);

  // Date Navigation Helpers
  const changeDateByDays = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // Format seconds into HH:MM:SS
  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    }
    return `${m}m ${s}s`;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 select-none font-mono">
      {/* Header & Date Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border-dark pb-6">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Work History & Reports</h2>
          <p className="text-xs text-text-secondary mt-1">
            Historical day-by-day log of tracked tasks, work sessions, and total duration summaries.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-dark-800 border border-border-dark rounded-lg p-1.5 shadow-sm">
          <button
            onClick={() => changeDateByDays(-1)}
            className="p-1.5 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-2 px-2">
            <Calendar className="w-4 h-4 text-accent-blue" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={() => changeDateByDays(1)}
            className="p-1.5 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-text-secondary text-xs">
            <span>Total Logged Time</span>
            <Clock className="w-4 h-4 text-accent-blue" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {formatDuration(summary.totalSeconds)}
          </div>
          <div className="text-[10px] text-text-secondary">Tracked on {selectedDate}</div>
        </div>

        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-text-text-secondary text-xs">
            <span>Tasks Worked On</span>
            <CheckCircle2 className="w-4 h-4 text-accent-green" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {summary.tasksCount} Task(s)
          </div>
          <div className="text-[10px] text-text-secondary">Itemized task logs</div>
        </div>

        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-text-secondary text-xs">
            <span>Logged Sessions</span>
            <FileText className="w-4 h-4 text-accent-purple" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {worklogs.length} Session(s)
          </div>
          <div className="text-[10px] text-text-secondary">Completed tracking sessions</div>
        </div>
      </div>

      {/* Task Summary Breakdown Section */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Task Duration Breakdown
        </h3>

        {summary.items.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.items.map(item => (
              <div
                key={item.taskId}
                className="p-4 bg-dark-900/60 border border-border-dark rounded-lg flex items-center justify-between"
              >
                <div className="space-y-1">
                  <span className="px-2 py-0.5 bg-dark-700 text-accent-blue text-[10px] font-bold rounded">
                    {item.key}
                  </span>
                  <div className="text-xs font-bold text-white">{item.title}</div>
                </div>

                <div className="text-xs font-bold text-accent-green bg-accent-green/10 border border-accent-green/30 px-2.5 py-1 rounded">
                  {formatDuration(item.durationSeconds)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-text-secondary">
            No work logged on {selectedDate}.
          </div>
        )}
      </div>

      {/* Detailed Chronological Worklog List */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Chronological Session Log ({worklogs.length})
        </h3>

        {loading ? (
          <div className="text-xs text-text-secondary py-4">Loading session history...</div>
        ) : worklogs.length > 0 ? (
          <div className="space-y-2">
            {worklogs.map(log => (
              <div
                key={log.id}
                className="flex items-center justify-between p-3.5 bg-dark-900/60 border border-border-dark rounded-lg text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{log.taskId}</span>
                    <span className="text-text-secondary">• {new Date(log.startedAtUtc).toLocaleTimeString()}</span>
                  </div>
                  {log.comment && (
                    <div className="text-text-secondary italic text-[11px]">&quot;{log.comment}&quot;</div>
                  )}
                </div>

                <div className="font-mono font-bold text-accent-blue">
                  {formatDuration(log.durationSeconds)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-xs text-text-secondary">
            No session records found for {selectedDate}.
          </div>
        )}
      </div>
    </div>
  );
};
