import React, { useState, useEffect } from 'react';
import { Zap, ShieldAlert, ChevronUp, ChevronDown } from 'lucide-react';
import { useAutoSave } from '../../hooks/useAutoSave';
import { AutoSaveIndicator } from '../../components/AutoSaveIndicator';
import { PriorityRule, UserMode, PriorityAction } from '../../../shared/dtos';
import { DEFAULT_PRIORITY_RULES, isRetiredPriorityRule } from '../../../shared/priority-defaults';

interface PriorityItemDef {
  key: string;
  label: string;
  desc: string;
}

/**
 * "What the bar shows first" (S22): the levels and per-mode actions. The
 * mode switch that used to head it is the header's mode chip now.
 */
/**
 * `embedded`: shown under Desk devices' "What the bar shows first" row
 * (S22), whose title and sentence say what the view's own heading did.
 */
export const PriorityRulesView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  // Shown only until the engine's real rules arrive. This used to be a local
  // table that inverted main's hierarchy -- an editor's build failure
  // outranking Away mode -- and omitted the EOD rule, so the first paint showed an ordering
  // the device never actually used.
  const [rules, setRules] = useState<PriorityRule[]>(() => [...DEFAULT_PRIORITY_RULES]);

  // With no stored settings to read there is nothing to wait for; loaded
  // is otherwise set once the read settles.
  const [loaded, setLoaded] = useState<boolean>(() => !window.electronAPI?.getPriorityRules);

  useEffect(() => {
    if (window.electronAPI?.getPriorityRules) {
      window.electronAPI.getPriorityRules().then(res => {
        const obj = res as unknown as { rules?: PriorityRule[] } & Record<string, number>;
        let fetched: PriorityRule[] = [];
        if (Array.isArray(res)) {
          fetched = res;
        } else if (obj && typeof obj === 'object' && Array.isArray(obj.rules)) {
          fetched = obj.rules;
        } else if (obj && typeof obj === 'object') {
          setRules(prev => prev.map(r => ({
            ...r,
            priority: typeof obj[r.eventName] === 'number' ? obj[r.eventName] : r.priority
          })));
          return;
        }

        if (fetched.length > 0) {
          setRules(prev => {
            const merged = fetched.filter(r => !isRetiredPriorityRule(r));
            prev.forEach(defaultRule => {
              if (!merged.some(r => r.eventName === defaultRule.eventName || r.id === defaultRule.id)) {
                merged.push(defaultRule);
              }
            });
            return merged;
          });
        }
      }).catch(err => console.error('[PriorityRulesView] Error fetching rules:', err))
        // finally, not then: one branch above returns early. Auto-save stays
        // off until this settles so the panel cannot write DEFAULT_PRIORITY_RULES
        // over the stored matrix -- which would silently reorder the display.
        .finally(() => setLoaded(true));
    }

    return undefined;
  }, []);

  // Only the rules table: the mode is the header's, saved apart.
  const handleSave = async () => {
    if (window.electronAPI?.savePriorityRules) {
      await window.electronAPI.savePriorityRules(rules);
    }
  };

  const saveStatus = useAutoSave(handleSave, [rules], loaded);

  const baseItems: PriorityItemDef[] = [
    { key: 'highNotificationPriority', label: 'High Priority App / System Notification', desc: 'Critical notifications (e.g. Discord high alerts, low battery, urgent messages)' },
    { key: 'awayModePriority', label: 'Away Mode Screen / Windows Lock', desc: 'Away screen banner displayed when Windows session is locked or suspended' },
    { key: 'standupPromptPriority', label: 'Daily Stand-Up Ceremonies Prompt', desc: 'Interactive dialog for daily stand-up tracking' },
    { key: 'lunchModePriority', label: 'Lunch Mode Screen / Scheduled Break', desc: 'Lunch time screen displayed during configured lunch hours' },
    { key: 'messagingPriority', label: 'Default Chat / App Notifications', desc: 'Standard third-party notifications; auto-suppressed during Lunch or Away' },
    { key: 'eodWrapUpPriority', label: 'End-of-Day Wrap-Up Prompt', desc: 'Interactive end-of-day prompt for logging remaining time' },
    { key: 'menuPriority', label: 'Bar Menu', desc: 'The menu the wheel opens on the bar; above Lunch so it works during the break' },
    { key: 'nothingTimingPriority', label: 'Nothing Timing', desc: 'Asks on the bar, in working hours, when no task has been timed for a while' },
    { key: 'resumePromptPriority', label: 'Resume After Lunch Question', desc: 'Asks whether to resume a task reassigned, closed or moved over lunch' },
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
    <div className="space-y-6 max-w-4xl">
      {embedded && <div className="flex justify-end"><AutoSaveIndicator status={saveStatus} /></div>}
      {/* Title Bar */}
      {!embedded && (
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Zap className="w-5 h-5 text-accent-amber" />
            <span>What the bar shows first</span>
          </h2>
          <p className="text-xs text-text-secondary">When two things want the bar -- a call, a build, your timer -- the higher level wins. What each does depends on the mode (Work, Lunch, Away), chosen in the header.</p>
        </div>

        <AutoSaveIndicator status={saveStatus} />
      </div>
      )}

      {/* Rules Table Card */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <div className="p-4 bg-dark-900 border border-border-dark rounded-lg flex items-center space-x-3 text-xs text-text-secondary">
          <ShieldAlert className="w-5 h-5 text-text-primary flex-shrink-0" />
          <span>
            The list is the order the display goes by: a rule with a higher level takes the display from a lower
            one. The arrows move a rule&apos;s level by 10, and the list sorts itself again; type a level from 1 to
            100 to put it exactly where you want. A screen that loses the display comes back when the one above it
            ends.
          </span>
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
                        title="Raise its level by 10"
                        aria-label={`Raise ${def.label} by 10`}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => updateRuleScore(rule.eventName, rule.priority - 10)}
                        className="p-1 bg-dark-900 hover:bg-dark-700 text-text-secondary hover:text-white rounded border border-border-dark transition-all"
                        title="Lower its level by 10"
                        aria-label={`Lower ${def.label} by 10`}
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
                      aria-label={`${def.label} level`}
                      onChange={e => updateRuleScore(rule.eventName, Number(e.target.value))}
                      className="w-20 bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-sm text-text-primary font-bold text-center focus:outline-none focus:border-focus"
                    />
                    <span className="text-xs text-text-secondary">Level</span>
                  </div>
                </div>

                {/* Per-Mode Action Toggles */}
                <div className="flex items-center space-x-6 pl-10 text-xs bg-dark-900/60 p-2.5 rounded-lg border border-border-dark/50">
                  <span className="text-text-secondary font-semibold">Actions per Mode:</span>

                  {(['WORK', 'LUNCH', 'AWAY'] as UserMode[]).map(m => {
                    const currentAction = m === 'LUNCH' ? rule.actionOnLunch : m === 'AWAY' ? rule.actionOnAway : rule.actionOnWork;
                    return (
                      <div key={m} className="flex items-center space-x-2">
                        <span className="text-text-secondary">{m}:</span>
                        <select
                          value={currentAction || 'DISPLAY'}
                          onChange={e => updateRuleAction(rule.eventName, m, e.target.value as PriorityAction)}
                          className="bg-dark-800 border border-border-dark rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-focus"
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
