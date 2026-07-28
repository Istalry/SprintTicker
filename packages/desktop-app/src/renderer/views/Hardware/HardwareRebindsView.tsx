import React, { useState, useEffect } from 'react';
import { Sliders, Save, Check, RotateCcw, Activity } from 'lucide-react';
import { HardwareBindingConfig } from '../../../shared/dtos';

export const HardwareRebindsView: React.FC = () => {
  const [bindings, setBindings] = useState<HardwareBindingConfig>({
    startButtonPress: 'TOGGLE_TRACK_PAUSE',
    wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
    wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
    wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
    backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
    backButtonLongPress: 'COMPLETE_AND_LOG_ACTIVE_TASK'
  });

  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [lastInputEvent, setLastInputEvent] = useState<{ inputKey: string; actionAssigned: string; time: string } | null>(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getInputBindings().then(b => {
        if (b) setBindings(b);
      }).catch(err => console.error('[HardwareRebindsView] Error loading bindings:', err));

      const unsubscribe = window.electronAPI.onHardwareInputEvent(evt => {
        setLastInputEvent({
          inputKey: evt.inputKey,
          actionAssigned: evt.actionAssigned,
          time: new Date().toLocaleTimeString()
        });
      });

      return () => unsubscribe();
    }
    return undefined;
  }, []);

  const handleSave = async () => {
    if (window.electronAPI) {
      await window.electronAPI.saveInputBindings(bindings);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleResetDefaults = async () => {
    const defaults: HardwareBindingConfig = {
      startButtonPress: 'TOGGLE_TRACK_PAUSE',
      wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
      wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
      wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
      backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
      backButtonLongPress: 'COMPLETE_AND_LOG_ACTIVE_TASK'
    };
    setBindings(defaults);
    if (window.electronAPI) {
      await window.electronAPI.saveInputBindings(defaults);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const inputRows = [
    { label: 'Start / Pause Button Press', key: 'startButtonPress', desc: 'Single press of physical top start/pause button' },
    { label: 'Scroll Wheel Rotate Left', key: 'wheelRotateLeft', desc: 'Counter-clockwise rotation of rotary encoder wheel' },
    { label: 'Scroll Wheel Rotate Right', key: 'wheelRotateRight', desc: 'Clockwise rotation of rotary encoder wheel' },
    { label: 'Scroll Wheel Click (OK)', key: 'wheelClick', desc: 'Center click on rotary wheel encoder' },
    { label: 'Back Button Short Press', key: 'backButtonShortPress', desc: 'Short press of back button (< 1.5s)' },
    { label: 'Back Button Long Press (1.5s)', key: 'backButtonLongPress', desc: 'Press and hold back button for > 1.5 seconds' }
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold font-mono text-white tracking-tight flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-accent-blue" />
            <span>PHYSICAL HARDWARE INPUT REBINDING</span>
          </h2>
          <p className="text-xs text-text-secondary">Rebind BUSY Bar physical wheel and button triggers to internal companion app actions.</p>
        </div>

        <div className="flex items-center space-x-3 font-mono text-xs">
          <button
            onClick={handleResetDefaults}
            className="flex items-center space-x-1.5 px-3 py-2 bg-dark-800 hover:bg-dark-700 text-text-secondary hover:text-white border border-border-dark rounded-lg transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>

          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-5 py-2 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold rounded-lg shadow-md transition-all font-mono"
          >
            {savedSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{savedSuccess ? 'Bindings Saved!' : 'Save Keybindings'}</span>
          </button>
        </div>
      </div>

      {/* Live Input Event Test Bench */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-5 shadow-xl space-y-3 font-mono">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <Activity className="w-4 h-4 text-accent-green animate-pulse" />
            <span>Live Hardware Event Monitor</span>
          </h3>
          <span className="text-[11px] text-text-secondary">Listen or test physical inputs</span>
        </div>

        <div className="bg-dark-900 p-3 rounded-lg border border-border-dark flex items-center justify-between text-xs">
          <span className="text-text-secondary">Last Triggered Event:</span>
          {lastInputEvent ? (
            <span className="flex items-center space-x-2">
              <span className="px-2 py-0.5 bg-accent-blue/20 text-accent-blue rounded border border-accent-blue/30 font-bold">
                Key: {lastInputEvent.inputKey}
              </span>
              <span className="text-white font-bold">→ {lastInputEvent.actionAssigned}</span>
              <span className="text-text-secondary text-[10px]">({lastInputEvent.time})</span>
            </span>
          ) : (
            <span className="text-text-secondary italic">No hardware events detected yet. Press a button on your BUSY Bar to test.</span>
          )}
        </div>
      </div>

      {/* Input Mapping Matrix */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <div className="divide-y divide-border-dark font-mono">
          {inputRows.map(item => (
            <div key={item.key} className="py-3.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-white">{item.label}</div>
                <div className="text-xs text-text-secondary">{item.desc}</div>
              </div>

              <select
                value={(bindings as any)[item.key]}
                onChange={e => setBindings({ ...bindings, [item.key]: e.target.value })}
                className="bg-dark-900 border border-border-dark rounded-lg px-3 py-2 text-xs text-accent-blue font-bold focus:outline-none focus:border-accent-blue"
              >
                <option value="TOGGLE_TRACK_PAUSE">Toggle Start / Pause Tracking</option>
                <option value="TRIGGER_TASK_SELECTOR_MODAL">Trigger 2-Step Task Selection Modal</option>
                <option value="NAVIGATE_QUEUE_PREV">Previous Task / Queue Item</option>
                <option value="NAVIGATE_QUEUE_NEXT">Next Task / Queue Item</option>
                <option value="DISMISS_NOTIFICATION_ALERT">Dismiss Alert / Notification</option>
                <option value="COMPLETE_AND_LOG_ACTIVE_TASK">Complete & Log Active Task</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HardwareRebindsView;
