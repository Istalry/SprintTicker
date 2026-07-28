import React, { useState, useEffect } from 'react';
import { Zap, Save, Check, ShieldAlert, ChevronUp, ChevronDown, User, Coffee, Moon } from 'lucide-react';
import { PriorityRule, UserMode, PriorityAction } from '../../../shared/dtos';

interface PriorityItemDef {
  key: string;
  label: string;
  desc: string;
}

export const PriorityRulesView: React.FC = () => {
  const [userMode, setUserMode] = useState<UserMode>('WORK');
  const [rules, setRules] = useState<PriorityRule[]>([
    { id: 'unity_exception', eventName: 'unityBuildFailurePriority', priority: 100, actionOnWork: 'DISPLAY', actionOnLunch: 'DISPLAY', actionOnAway: 'DISPLAY' },
    { id: 'unity_compiling', eventName: 'unityCompilingPriority', priority: 80, actionOnWork: 'DISPLAY', actionOnLunch: 'SUPPRESS', actionOnAway: 'SUPPRESS' },
    { id: 'standup_prompt', eventName: 'standupPromptPriority', priority: 70, actionOnWork: 'DISPLAY', actionOnLunch: 'QUEUE', actionOnAway: 'QUEUE' },
    { id: 'messaging_alert', eventName: 'messagingPriority', priority: 40, actionOnWork: 'DISPLAY', actionOnLunch: 'SUPPRESS', actionOnAway: 'SUPPRESS' },
    { id: 'active_tracker', eventName: 'activeTrackerPriority', priority: 20, actionOnWork: 'DISPLAY', actionOnLunch: 'DISPLAY', actionOnAway: 'DISPLAY' }
  ]);

  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    if (window.electronAPI?.getPriorityRules) {
      window.electronAPI.getPriorityRules().then(res => {
        const obj = res as unknown as { rules?: PriorityRule[] } & Record<string, number>;
        if (Array.isArray(res)) {
          setRules(res);
        } else if (obj && typeof obj === 'object' && Array.isArray(obj.rules)) {
          setRules(obj.rules);
        } else if (obj && typeof obj === 'object') {
          // Legacy numeric fallback
          setRules(prev => prev.map(r => ({
            ...r,
            priority: typeof obj[r.eventName] === 'number' ? obj[r.eventName] : r.priority
          })));
        }
      }).catch(err => console.error('[PriorityRulesView] Error fetching rules:', err));
    }

    const api = window.electronAPI as unknown as Record<string, () => Promise<UserMode>>;
    if (api?.getUserMode) {
      api.getUserMode().then((m: UserMode) => {
        if (m) setUserMode(m);
      }).catch(() => {});
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI?.savePriorityRules) {
      await window.electronAPI.savePriorityRules(rules);
    }
    const api = window.electronAPI as unknown as Record<string, (m: UserMode) => Promise<boolean>>;
    if (api?.setUserMode) {
      await api.setUserMode(userMode);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleModeChange = async (newMode: UserMode) => {
    setUserMode(newMode);
    const api = window.electronAPI as unknown as Record<string, (m: UserMode) => Promise<boolean>>;
    if (api?.setUserMode) {
      await api.setUserMode(newMode);
    }
  };

  const baseItems: PriorityItemDef[] = [
    { key: 'unityBuildFailurePriority', label: 'Unity Build Failure / Exception Alert', desc: 'High-priority critical alert; overrides active tracking display' },
    { key: 'unityCompilingPriority', label: 'Unity Compiling / Building Status', desc: 'Shows live compile progress over chat alerts' },
    { key: 'standupPromptPriority', label: 'Daily Stand-Up Ceremonies Prompt', desc: 'Interactive dialog for daily stand-up tracking' },
    { key: 'messagingPriority', label: 'Discord / Slack / Gmail Messages', desc: 'Third-party chat notifications; auto-suppressed during Lunch or Away' },
    { key: 'activeTrackerPriority', label: 'Active Session Time Tracker / Idle', desc: 'Base UI tracker state' }
  ];

  // Sort items descending by priority score
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  const updateRuleScore = (key: string, newScore: number) => {
    setRules(prev => prev.map(r => r.eventName === key ? { ...r, priority: Math.max(1, Math.min(100, newScore)) } : r));
  };

  const updateRuleAction = (key: string, mode: UserMode, action: PriorityAction) => {
    setRules(prev => prev.map(r => {
      if (r.eventName !== key) return r;
      if (mode === 'LUNCH') return { ...r, actionOnLunch: action };
      if (mode === 'AWAY') return { ...r, actionOnAway: action };
      return { ...r, actionOnWork: action };
    }));
  };

  return (
    <div className="space-y-6 max-w-4xl font-mono">
      {/* Title Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Zap className="w-5 h-5 text-accent-amber" />
            <span>NOTIFICATION & PREEMPTION PRIORITY MATRIX</span>
          </h2>
          <p className="text-xs text-text-secondary">Dictate which notifications take visual precedence and configure mode suppression (Work/Lunch/Away).</p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-sm rounded-lg shadow-md transition-all"
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{saved ? 'Rules Saved!' : 'Save Priority Rules'}</span>
        </button>
      </div>

      {/* Mode Selector Card */}
      <div className="bg-dark-800 p-5 rounded-xl border border-border-dark flex items-center justify-between shadow-xl">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-white uppercase tracking-wider">Active Context Mode</span>
          <p className="text-xs text-text-secondary">Determines active suppression rules for incoming alerts.</p>
        </div>

        <div className="flex space-x-3">
          {[
            { id: 'WORK', label: 'Work Mode', icon: User, color: 'text-accent-blue' },
            { id: 'LUNCH', label: 'Lunch Mute', icon: Coffee, color: 'text-amber-400' },
            { id: 'AWAY', label: 'Away / Stealth', icon: Moon, color: 'text-purple-400' }
          ].map(m => {
            const Icon = m.icon;
            const isActive = userMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleModeChange(m.id as UserMode)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                  isActive
                    ? 'bg-accent-blue/10 text-white border-accent-blue'
                    : 'bg-dark-900 text-text-secondary border-border-dark hover:text-white'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${m.color}`} />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rules Table Card */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <div className="p-4 bg-dark-900 border border-border-dark rounded-lg flex items-center space-x-3 text-xs text-text-secondary">
          <ShieldAlert className="w-5 h-5 text-accent-blue flex-shrink-0" />
          <span>Higher numeric values (Priority 100 = highest) automatically preempt lower priority notifications. Non-expired queued alerts replay automatically when display locks release.</span>
        </div>

        <div className="divide-y divide-border-dark">
          {sortedRules.map((rule, index) => {
            const def = baseItems.find(i => i.key === rule.eventName) || { key: rule.eventName, label: rule.eventName, desc: '' };
            return (
              <div key={rule.id || rule.eventName} className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex flex-col space-y-1">
                      <button
                        onClick={() => updateRuleScore(rule.eventName, rule.priority + 10)}
                        className="p-1 bg-dark-900 hover:bg-dark-700 text-text-secondary hover:text-white rounded border border-border-dark transition-all"
                        title="Increase Priority"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => updateRuleScore(rule.eventName, rule.priority - 10)}
                        className="p-1 bg-dark-900 hover:bg-dark-700 text-text-secondary hover:text-white rounded border border-border-dark transition-all"
                        title="Decrease Priority"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-0.5">
                      <div className="text-sm font-bold text-white flex items-center space-x-2">
                        <span className="text-xs text-accent-amber font-bold">#{index + 1}</span>
                        <span>{def.label}</span>
                      </div>
                      <div className="text-xs text-text-secondary">{def.desc}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={rule.priority}
                      onChange={e => updateRuleScore(rule.eventName, Number(e.target.value))}
                      className="w-20 bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-sm text-accent-blue font-mono font-bold text-center focus:outline-none focus:border-accent-blue"
                    />
                    <span className="text-xs font-mono text-text-secondary">Level</span>
                  </div>
                </div>

                {/* Per-Mode Action Toggles */}
                <div className="flex items-center space-x-6 pl-10 text-xs bg-dark-900/60 p-2.5 rounded-lg border border-border-dark/50">
                  <span className="text-text-secondary font-semibold">Actions per Mode:</span>

                  {(['WORK', 'LUNCH', 'AWAY'] as UserMode[]).map(m => {
                    const currentAction = m === 'LUNCH' ? rule.actionOnLunch : m === 'AWAY' ? rule.actionOnAway : rule.actionOnWork;
                    return (
                      <div key={m} className="flex items-center space-x-2">
                        <span className="text-text-secondary font-mono">{m}:</span>
                        <select
                          value={currentAction || 'DISPLAY'}
                          onChange={e => updateRuleAction(rule.eventName, m, e.target.value as PriorityAction)}
                          className="bg-dark-800 border border-border-dark rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-blue"
                        >
                          <option value="DISPLAY">DISPLAY</option>
                          <option value="QUEUE">QUEUE</option>
                          <option value="SUPPRESS">SUPPRESS</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PriorityRulesView;
