import React, { useState } from 'react';
import { DEFAULT_USB_IP } from '../../shared/device-constants';
import { X, Wifi, Plug, Gamepad2, ArrowRight, ArrowLeft, Check, Sparkles } from 'lucide-react';

interface OnboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Not editable state. The bar answers on a fixed address over the USB
  // Ethernet link; the field that used to accept a different one was never read
  // by anything, so typing in it changed nothing but implied otherwise.
  const deviceAddress = DEFAULT_USB_IP;
  const [pingSuccess, setPingSuccess] = useState<boolean | null>(null);
  const [pingDetails, setPingDetails] = useState<string>('');
  const [isTestingPing, setIsTestingPing] = useState<boolean>(false);
  const [providerId, setProviderId] = useState<string>('openproject');
  const [fallbackKey, setFallbackKey] = useState<string>('MISC-1');
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleTestPing = async () => {
    setPingSuccess(null);
    setIsTestingPing(true);
    try {
      const status = await window.electronAPI?.getDeviceStatus?.();
      if (!status) {
        // No bridge means no way to ask the device. Previously this branch
        // waited 600ms and then reported success, so the wizard congratulated
        // the user on a connection it had not attempted.
        setPingSuccess(false);
        setPingDetails('Cannot reach the main process to test the connection.');
        return;
      }

      if (!status.connected) {
        setPingSuccess(false);
        setPingDetails(`No response from the BUSY Bar at ${deviceAddress}.`);
        return;
      }

      setPingSuccess(true);
      const isMock = status.firmwareVersion?.includes('mock');
      const modeLabel = isMock
        ? 'mock hardware'
        : `${status.connectionType?.toUpperCase() || 'USB'} connection`;
      const details = [
        `Connected over ${modeLabel}`,
        status.webSocketPingMs !== undefined ? `latency ${status.webSocketPingMs}ms` : null,
        status.batteryPercent !== undefined ? `battery ${status.batteryPercent}%` : null,
        status.firmwareVersion ? `firmware v${status.firmwareVersion}` : null
      ]
        .filter(Boolean)
        .join(' - ');
      setPingDetails(details);
    } catch {
      setPingSuccess(false);
      setPingDetails(`Connection Failed: Unable to reach ${deviceAddress}`);
    } finally {
      setIsTestingPing(false);
    }
  };

  const handleCopyPackagePath = () => {
    navigator.clipboard.writeText('file:./packages/unity-plugin');
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none animate-in fade-in">
      <div className="w-full max-w-xl bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-dark bg-dark-700/50">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-accent-blue" />
            <h3 className="text-md font-bold text-white font-mono">First-Time Setup & Onboarding</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-dark-700 rounded-md text-text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex border-b border-border-dark bg-dark-900/40 text-xs font-mono">
          {[
            { num: 1, title: 'Hardware Setup', icon: Wifi },
            { num: 2, title: 'Task Provider', icon: Plug },
            { num: 3, title: 'Unity Plugin', icon: Gamepad2 }
          ].map(s => {
            const Icon = s.icon;
            const active = step === s.num;
            return (
              <div
                key={s.num}
                className={`flex-1 flex items-center justify-center space-x-2 py-3 border-b-2 transition-all ${
                  active
                    ? 'border-accent-blue text-accent-blue bg-accent-blue/5 font-bold'
                    : 'border-transparent text-text-secondary'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>Step {s.num}: {s.title}</span>
              </div>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 flex-1">
          {step === 1 && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold font-mono text-white">1. Physical BUSY Bar Hardware Connection</h4>
              <p className="text-xs text-text-secondary">
                Connect your BUSY Bar over USB. It presents a virtual Ethernet adapter and always answers on the
                address below, so there is nothing to configure -- use Test Ping to confirm the link is up.
              </p>

              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Device Address</label>
                <div className="flex space-x-2">
                  <div className="flex-1 bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white font-mono">
                    {deviceAddress}
                  </div>
                  <button
                    onClick={handleTestPing}
                    disabled={isTestingPing}
                    className="px-4 py-2 bg-dark-700 hover:bg-dark-700/80 disabled:opacity-50 text-text-primary text-xs font-semibold rounded-lg border border-border-dark transition-all"
                  >
                    {isTestingPing ? 'Pinging...' : 'Test Ping'}
                  </button>
                </div>
              </div>

              {pingSuccess !== null && (
                <div
                  className={`p-3 rounded-lg border text-xs font-mono flex items-center space-x-2 ${
                    pingSuccess
                      ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
                      : 'bg-accent-red/10 border-accent-red/30 text-accent-red'
                  }`}
                >
                  <Check className="w-4 h-4 flex-shrink-0" />
                  <span>{pingDetails || (pingSuccess ? 'Connection Verified!' : 'Connection Failed')}</span>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold font-mono text-white">2. Task Provider & Fallback Configuration</h4>
              <p className="text-xs text-text-secondary">
                Choose your primary task provider and configure the fallback ticket ID for non-sprint ad-hoc tasks:
              </p>

              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Primary Provider</label>
                <select
                  value={providerId}
                  onChange={e => setProviderId(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white font-mono focus:outline-none focus:border-accent-blue"
                >
                  <option value="openproject">OpenProject (REST API v3)</option>
                  <option value="adhoc">Ad-Hoc / Custom Local Fallback</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Fallback Overhead Ticket ID</label>
                <input
                  type="text"
                  value={fallbackKey}
                  onChange={e => setFallbackKey(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white font-mono focus:outline-none focus:border-accent-blue"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold font-mono text-white">
                3. Unity Editor Plugin Setup (<code>com.antigravity.busybar</code>)
              </h4>
              <p className="text-xs text-text-secondary">
                Import the Unity C# Package into your game project to send automatic compilation & playmode webhooks to the BUSY Bar:
              </p>

              <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-2 text-xs font-mono text-text-primary">
                <div>1. Open Unity Package Manager (Window &gt; Package Manager).</div>
                <div>2. Click &quot;+&quot; &gt; &quot;Add package from disk...&quot;.</div>
                <div>3. Select <code>packages/unity-plugin/package.json</code>.</div>
              </div>

              <button
                onClick={handleCopyPackagePath}
                className="w-full py-2.5 bg-dark-700 hover:bg-dark-700/80 text-white text-xs font-semibold rounded-lg border border-border-dark transition-all flex items-center justify-center space-x-2"
              >
                {copySuccess ? <Check className="w-4 h-4 text-accent-green" /> : <Gamepad2 className="w-4 h-4" />}
                <span>{copySuccess ? 'Package Path Copied!' : 'Copy Unity Package Manifest Path'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-dark bg-dark-700/30">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
              className="flex items-center space-x-1.5 px-4 py-2 bg-dark-700 hover:bg-dark-700/80 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
          ) : (
            <div />
          )}

          {step < 3 ? (
            <button
              onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)}
              className="flex items-center space-x-1.5 px-5 py-2 bg-accent-blue hover:bg-blue-600 text-white text-xs font-semibold rounded-lg shadow-md transition-all"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-5 py-2 bg-accent-green hover:bg-emerald-600 text-dark-900 text-xs font-semibold rounded-lg shadow-md transition-all"
            >
              Complete Setup & Open Dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
