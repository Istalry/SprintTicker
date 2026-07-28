import React, { useState, useEffect } from 'react';
import { Zap, Save, Check, ShieldAlert, ChevronUp, ChevronDown } from 'lucide-react';

interface PriorityItemDef {
  key: string;
  label: string;
  desc: string;
}

export const PriorityRulesView: React.FC = () => {
  const [config, setConfig] = useState<Record<string, number>>({
    unityBuildFailurePriority: 100,
    unityCompilingPriority: 80,
    standupPromptPriority: 70,
    messagingPriority: 40,
    activeTrackerPriority: 20
  });

  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    if (window.electronAPI?.getPriorityRules) {
      window.electronAPI.getPriorityRules().then(rules => {
        if (rules && typeof rules === 'object') {
          setConfig(prev => ({ ...prev, ...(rules as any) }));
        }
      }).catch(err => console.error('[PriorityRulesView] Error fetching rules:', err));
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI?.savePriorityRules) {
      await window.electronAPI.savePriorityRules(config as any);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const baseItems: PriorityItemDef[] = [
    { key: 'unityBuildFailurePriority', label: 'Unity Build Failure / Exception Alert', desc: 'High-priority critical alert; overrides active tracking display' },
    { key: 'unityCompilingPriority', label: 'Unity Compiling / Building Status', desc: 'Shows live compile progress over chat alerts' },
    { key: 'standupPromptPriority', label: 'Daily Stand-Up Ceremonies Prompt', desc: 'Interactive dialog for daily stand-up tracking' },
    { key: 'messagingPriority', label: 'Discord / Slack / Gmail Messages', desc: 'Third-party chat notifications; auto-suppressed during Lunch or Away' },
    { key: 'activeTrackerPriority', label: 'Active Session Time Tracker / Idle', desc: 'Base UI tracker state' }
  ];

  // Sort items descending by priority score
  const sortedItems = [...baseItems].sort((a, b) => {
    const valA = config[a.key] ?? 0;
    const valB = config[b.key] ?? 0;
    return valB - valA;
  });

  const handleMoveUp = (key: string) => {
    const currentScore = config[key] ?? 50;
    setConfig({ ...config, [key]: Math.min(100, currentScore + 10) });
  };

  const handleMoveDown = (key: string) => {
    const currentScore = config[key] ?? 50;
    setConfig({ ...config, [key]: Math.max(1, currentScore - 10) });
  };

  return (
    <div className="space-y-6 max-w-4xl font-mono">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Zap className="w-5 h-5 text-accent-amber" />
            <span>NOTIFICATION & PREEMPTION PRIORITY MATRIX</span>
          </h2>
          <p className="text-xs text-text-secondary">Dictate which notifications take visual precedence. Drag/re-order priority levels descending.</p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-sm rounded-lg shadow-md transition-all"
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{saved ? 'Rules Saved!' : 'Save Priority Rules'}</span>
        </button>
      </div>

      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <div className="p-4 bg-dark-900 border border-border-dark rounded-lg flex items-center space-x-3 text-xs text-text-secondary">
          <ShieldAlert className="w-5 h-5 text-accent-blue flex-shrink-0" />
          <span>Higher numeric values (Priority 100 = highest) automatically preempt lower priority notifications. Items are automatically sorted descending by priority score.</span>
        </div>

        <div className="divide-y divide-border-dark">
          {sortedItems.map((item, index) => (
            <div key={item.key} className="py-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex flex-col space-y-1">
                  <button
                    onClick={() => handleMoveUp(item.key)}
                    className="p-1 bg-dark-900 hover:bg-dark-700 text-text-secondary hover:text-white rounded border border-border-dark transition-all"
                    title="Increase Priority"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleMoveDown(item.key)}
                    className="p-1 bg-dark-900 hover:bg-dark-700 text-text-secondary hover:text-white rounded border border-border-dark transition-all"
                    title="Decrease Priority"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-0.5">
                  <div className="text-sm font-bold text-white flex items-center space-x-2">
                    <span className="text-xs text-accent-amber font-bold">#{index + 1}</span>
                    <span>{item.label}</span>
                  </div>
                  <div className="text-xs text-text-secondary">{item.desc}</div>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={config[item.key] ?? 50}
                  onChange={e => setConfig({ ...config, [item.key]: Number(e.target.value) })}
                  className="w-20 bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-sm text-accent-blue font-mono font-bold text-center focus:outline-none focus:border-accent-blue"
                />
                <span className="text-xs font-mono text-text-secondary">Level</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PriorityRulesView;
