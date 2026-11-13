import React, { useId } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { NotificationPriorityMode, NotificationSourceRule } from '../../shared/dtos';
import { NotificationSettingsStore } from '../hooks/useNotificationSettings';

const MODES: ReadonlyArray<{ mode: NotificationPriorityMode; label: string; on: string }> = [
  { mode: 'DONT_SHOW', label: "Don't show", on: 'border-accent-red/40 bg-accent-red/15 text-accent-red' },
  { mode: 'DEFAULT', label: 'Default', on: 'border-focus/40 bg-select text-text-primary' },
  { mode: 'HIGH_PRIORITY', label: 'High priority', on: 'border-accent-amber/40 bg-accent-amber/15 text-accent-amber' }
];

/**
 * Which apps' Windows notifications reach the bar (S22's "Choose apps…"):
 * one line per app known, its choice, whether its message text shows, and
 * an icon of the user's own. Edits go into the page's store, saved whole.
 */
export const NotificationAppRules: React.FC<{ store: NotificationSettingsStore }> = ({ store }) => {
  const { settings, setSettings, levels } = store;

  const update = (appId: string, change: Partial<NotificationSourceRule>) => {
    setSettings(prev => ({
      ...prev,
      sourceRules: prev.sourceRules.map(r => (r.appId === appId ? { ...r, ...change } : r))
    }));
  };
  const remove = (appId: string) => {
    setSettings(prev => ({ ...prev, sourceRules: prev.sourceRules.filter(r => r.appId !== appId) }));
  };
  const test = (rule: NotificationSourceRule) => {
    window.electronAPI?.simulateNotification?.({
      appId: rule.appId,
      appName: rule.appName,
      title: `${rule.appName} test`,
      body: `A test notification from ${rule.appName}.`,
      iconId: rule.iconId
    })?.catch(err => console.error('[NotificationAppRules] The test notification failed:', err));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">
        <strong className="text-text-primary">Default</strong> takes the bar at level {levels.defaultScore},{' '}
        <strong className="text-accent-amber">High priority</strong> at level {levels.highScore}; what wins is set in{' '}
        <em>What the bar shows first</em>.
      </p>
      {settings.sourceRules.length === 0 && (
        <p className="text-xs text-text-muted">No app known yet. An app appears here once it has notified you.</p>
      )}
      <ul className="divide-y divide-border-dark rounded-lg border border-border-dark bg-dark-900">
        {settings.sourceRules.map(rule => (
          <AppRule key={rule.appId} rule={rule} onChange={change => update(rule.appId, change)} onTest={() => test(rule)} onRemove={() => remove(rule.appId)} />
        ))}
      </ul>
    </div>
  );
};

const AppRule: React.FC<{
  rule: NotificationSourceRule;
  onChange: (change: Partial<NotificationSourceRule>) => void;
  onTest: () => void;
  onRemove: () => void;
}> = ({ rule, onChange, onTest, onRemove }) => {
  const nameId = useId();
  return (
    <li role="group" aria-labelledby={nameId} className="space-y-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div id={nameId} className="truncate text-xs font-semibold text-text-primary">{rule.appName}</div>
          <div className="truncate font-mono text-[10px] text-text-muted">{rule.appId}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {MODES.map(({ mode, label, on }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={rule.priorityMode === mode}
              onClick={() => onChange({ priorityMode: mode })}
              className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                rule.priorityMode === mode ? on : 'border-border-dark bg-dark-800 text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
          <button type="button" title="Send a test notification" aria-label={`Test ${rule.appName}`} onClick={onTest}
            className="rounded border border-border-dark bg-dark-800 p-1.5 text-text-secondary hover:text-text-primary">
            <Send className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Forget this app" aria-label={`Forget ${rule.appName}`} onClick={onRemove}
            className="rounded border border-border-dark bg-dark-800 p-1.5 text-text-secondary hover:text-accent-red">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-text-secondary">
          <input type="checkbox" checked={rule.hideMessageBody === true} onChange={e => onChange({ hideMessageBody: e.target.checked })}
            className="accent-primary" />
          Hide the message text (the sender and &quot;New message&quot; only)
        </label>
        <label className="flex min-w-[16rem] flex-1 items-center gap-2 text-[11px] text-text-secondary">
          Icon of my own
          <input
            type="text"
            value={rule.iconImagePath ?? ''}
            // The listener honours this ahead of the icon it resolves, which
            // can pick the wrong executable for a Win32 app.
            onChange={e => onChange({ iconImagePath: e.target.value === '' ? undefined : e.target.value })}
            placeholder="a 16×16 PNG, instead of the app's"
            className="min-w-0 flex-1 rounded border border-border-dark bg-dark-800 px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:border-focus focus:outline-none"
          />
        </label>
      </div>
    </li>
  );
};
