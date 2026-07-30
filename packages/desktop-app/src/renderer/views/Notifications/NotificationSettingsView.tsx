import React, { useState, useEffect } from 'react';
import { Bell, Save, Plus, Trash2, Send, Check, Shield } from 'lucide-react';
import {
  WindowsNotificationSettingsDTO,
  NotificationSourceRule,
  NotificationPriorityMode,
  BitmapIconId
} from '../../../shared/dtos';

export const NotificationSettingsView: React.FC = () => {
  const [settings, setSettings] = useState<WindowsNotificationSettingsDTO>({
    enableListener: true,
    notificationTimeoutSeconds: 10,
    sourceRules: [
      { appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'HIGH_PRIORITY' },
      { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT' },
      { appId: 'antigravity', appName: 'Antigravity', iconId: 'antigravity', priorityMode: 'HIGH_PRIORITY' },
      { appId: 'gmail', appName: 'Gmail / Outlook', iconId: 'gmail', priorityMode: 'DEFAULT' },
      { appId: 'battery', appName: 'System Battery', iconId: 'battery', priorityMode: 'HIGH_PRIORITY' },
      { appId: 'windows', appName: 'Windows System', iconId: 'windows', priorityMode: 'DEFAULT' }
    ]
  });

  const [saved, setSaved] = useState<boolean>(false);
  const [newAppId, setNewAppId] = useState<string>('');
  const [newAppName, setNewAppName] = useState<string>('');
  const [newIconId, setNewIconId] = useState<BitmapIconId>('bell');
  const [newPriorityMode, setNewPriorityMode] = useState<NotificationPriorityMode>('DEFAULT');

  const [defaultScore, setDefaultScore] = useState<number>(40);
  const [highScore, setHighScore] = useState<number>(95);

  useEffect(() => {
    if (window.electronAPI?.getNotificationSettings) {
      window.electronAPI
        .getNotificationSettings()
        .then(res => {
          if (res && Array.isArray(res.sourceRules)) {
            setSettings(res);
          }
        })
        .catch(err => console.error('[NotificationSettingsView] Error fetching settings:', err));
    }

    if (window.electronAPI?.getPriorityRules) {
      window.electronAPI.getPriorityRules().then(res => {
        const obj = res as unknown as { rules?: Array<{ eventName: string; priority: number }> } & Record<string, number>;
        const list = Array.isArray(res) ? res : Array.isArray(obj?.rules) ? obj.rules : [];
        const msgRule = list.find(r => r.eventName === 'messagingPriority');
        const highRule = list.find(r => r.eventName === 'highNotificationPriority');
        if (msgRule && typeof msgRule.priority === 'number') setDefaultScore(msgRule.priority);
        if (highRule && typeof highRule.priority === 'number') setHighScore(highRule.priority);
      }).catch(() => {});
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI?.saveNotificationSettings) {
      await window.electronAPI.saveNotificationSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const updateRuleMode = (appId: string, mode: NotificationPriorityMode) => {
    setSettings(prev => ({
      ...prev,
      sourceRules: prev.sourceRules.map(r => (r.appId === appId ? { ...r, priorityMode: mode } : r))
    }));
  };

  const removeRule = (appId: string) => {
    setSettings(prev => ({
      ...prev,
      sourceRules: prev.sourceRules.filter(r => r.appId !== appId)
    }));
  };

  const addRule = () => {
    if (!newAppId.trim()) return;
    const rule: NotificationSourceRule = {
      appId: newAppId.trim().toLowerCase(),
      appName: newAppName.trim() || newAppId.trim(),
      iconId: newIconId,
      priorityMode: newPriorityMode
    };
    setSettings(prev => ({
      ...prev,
      sourceRules: [...prev.sourceRules.filter(r => r.appId !== rule.appId), rule]
    }));
    setNewAppId('');
    setNewAppName('');
  };

  const handleTestNotification = async (rule: NotificationSourceRule) => {
    if (window.electronAPI?.simulateNotification) {
      await window.electronAPI.simulateNotification({
        appId: rule.appId,
        appName: rule.appName,
        title: `${rule.appName} Alert`,
        body: `Test notification event for ${rule.appName}!`,
        iconId: rule.iconId
      });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl font-mono">
      {/* Title Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold font-mono text-white tracking-tight flex items-center space-x-2">
            <Bell className="w-6 h-6 text-accent-purple" />
            <span>WINDOWS NOTIFICATION LISTENER</span>
          </h2>
          <p className="text-xs text-text-secondary mt-1">
            Capture Windows system &amp; application alerts, centered left-icon matrix formatting, and 3-level per-source priority management.
          </p>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center space-x-2 px-4 py-2 bg-accent-purple hover:bg-purple-600 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-accent-purple/20"
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{saved ? 'SETTINGS SAVED!' : 'SAVE CONFIGURATION'}</span>
        </button>
      </div>

      {/* Main Listener & Duration Settings Card */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Shield className="w-5 h-5 text-accent-purple" />
            <div>
              <h3 className="text-sm font-bold text-white">Enable Windows User Notification Listener</h3>
              <p className="text-xs text-text-secondary">Capture Action Center notifications and render formatted 72x16 matrix banners.</p>
            </div>
          </div>
          <button
            onClick={() => setSettings(prev => ({ ...prev, enableListener: !prev.enableListener }))}
            className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
              settings.enableListener
                ? 'bg-accent-emerald/20 border-accent-emerald/40 text-accent-emerald'
                : 'bg-dark-700 border-border-dark text-text-secondary'
            }`}
          >
            {settings.enableListener ? 'LISTENER ACTIVE' : 'LISTENER DISABLED'}
          </button>
        </div>

        <div className="pt-4 border-t border-border-dark flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Notification Display Duration</h4>
            <p className="text-xs text-text-secondary">Time in seconds notification banners remain locked on the physical display before auto-dismissing.</p>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="number"
              min={3}
              max={60}
              value={settings.notificationTimeoutSeconds || 10}
              onChange={e => setSettings(prev => ({ ...prev, notificationTimeoutSeconds: Math.max(3, Math.min(60, Number(e.target.value))) }))}
              className="w-20 bg-dark-900 text-white font-mono font-bold text-xs px-3 py-1.5 rounded-lg border border-border-dark focus:outline-none focus:border-accent-purple text-center"
            />
            <span className="text-xs text-text-secondary font-mono">Seconds</span>
          </div>
        </div>
      </div>

      {/* Per-Source Notification Rules */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Per-Source Notification Priority Rules</h3>
        <p className="text-xs text-text-secondary">
          Assign priority levels for each application source: <strong className="text-accent-red">Don&apos;t Show</strong> (suppress), <strong className="text-accent-blue">Default</strong> (level {defaultScore}), or <strong className="text-accent-purple">High Priority</strong> (level {highScore}).
        </p>

        <div className="space-y-3">
          {settings.sourceRules.map(rule => (
            <div
              key={rule.appId}
              className="flex items-center justify-between p-3 bg-dark-900 border border-border-dark rounded-lg"
            >
              <div className="flex items-center space-x-3">
                <span className="text-lg">
                  {rule.iconId === 'discord'
                    ? '💬'
                    : rule.iconId === 'slack'
                    ? '#'
                    : rule.iconId === 'antigravity'
                    ? '🌀'
                    : rule.iconId === 'gmail'
                    ? '✉️'
                    : rule.iconId === 'battery'
                    ? '🔋'
                    : rule.iconId === 'windows'
                    ? '🪟'
                    : '🔔'}
                </span>
                <div>
                  <div className="text-xs font-bold text-white">{rule.appName}</div>
                  <div className="text-[10px] text-text-secondary font-mono">{rule.appId}</div>
                </div>
              </div>

              {/* Priority Mode Selector Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => updateRuleMode(rule.appId, 'DONT_SHOW')}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${
                    rule.priorityMode === 'DONT_SHOW'
                      ? 'bg-accent-red/20 border border-accent-red/40 text-accent-red'
                      : 'bg-dark-800 text-text-secondary hover:text-white border border-border-dark'
                  }`}
                >
                  Don&apos;t Show
                </button>
                <button
                  onClick={() => updateRuleMode(rule.appId, 'DEFAULT')}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${
                    rule.priorityMode === 'DEFAULT'
                      ? 'bg-accent-blue/20 border border-accent-blue/40 text-accent-blue'
                      : 'bg-dark-800 text-text-secondary hover:text-white border border-border-dark'
                  }`}
                >
                  Default ({defaultScore})
                </button>
                <button
                  onClick={() => updateRuleMode(rule.appId, 'HIGH_PRIORITY')}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${
                    rule.priorityMode === 'HIGH_PRIORITY'
                      ? 'bg-accent-purple/20 border border-accent-purple/40 text-accent-purple'
                      : 'bg-dark-800 text-text-secondary hover:text-white border border-border-dark'
                  }`}
                >
                  High Priority ({highScore})
                </button>

                <button
                  onClick={() => handleTestNotification(rule)}
                  title="Send Test Notification"
                  className="p-1.5 bg-dark-800 hover:bg-dark-700 text-accent-purple rounded border border-border-dark transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => removeRule(rule.appId)}
                  title="Remove Rule"
                  className="p-1.5 bg-dark-800 hover:bg-accent-red/20 text-text-secondary hover:text-accent-red rounded border border-border-dark transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add New Source Rule */}
        <div className="pt-4 border-t border-border-dark">
          <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase tracking-wider">Add Custom Notification Source</h4>
          <div className="flex items-center space-x-3">
            <input
              type="text"
              placeholder="App ID (e.g. chrome, outlook)"
              value={newAppId}
              onChange={e => setNewAppId(e.target.value)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-accent-purple flex-1 font-mono"
            />
            <input
              type="text"
              placeholder="Display Name (e.g. Google Chrome)"
              value={newAppName}
              onChange={e => setNewAppName(e.target.value)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-accent-purple flex-1 font-mono"
            />
            <select
              value={newIconId}
              onChange={e => setNewIconId(e.target.value as BitmapIconId)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-accent-purple font-mono"
            >
              <option value="bell">Icon: Bell</option>
              <option value="discord">Icon: Discord</option>
              <option value="slack">Icon: Slack</option>
              <option value="gmail">Icon: Gmail</option>
              <option value="antigravity">Icon: Antigravity</option>
              <option value="battery">Icon: Battery</option>
              <option value="windows">Icon: Windows</option>
            </select>
            <select
              value={newPriorityMode}
              onChange={e => setNewPriorityMode(e.target.value as NotificationPriorityMode)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-accent-purple font-mono"
            >
              <option value="DONT_SHOW">Mode: Suppress (Don&apos;t Show)</option>
              <option value="DEFAULT">Mode: Default ({defaultScore})</option>
              <option value="HIGH_PRIORITY">Mode: High Priority ({highScore})</option>
            </select>
            <button
              onClick={addRule}
              className="flex items-center space-x-1.5 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white text-xs font-bold rounded-lg border border-border-dark transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add Source</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationSettingsView;
