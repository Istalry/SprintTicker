import React, { useState, useEffect } from 'react';
import {
  Clock,
  Sliders,
  Gamepad2,
  Calendar,
  MessageSquare,
  Zap,
  Monitor,
  Wifi,
  Settings,
  Moon,
  Sparkles
} from 'lucide-react';
import { useSession } from './hooks/useSession';
import { useDeviceStatus } from './hooks/useDeviceStatus';
import { useTasks } from './hooks/useTasks';
import { useWorklogs } from './hooks/useWorklogs';
import { ActiveTaskHeroCard } from './components/ActiveTaskHeroCard';
import { TaskSelectionModal } from './components/TaskSelectionModal';
import { SettingsView } from './views/Settings/SettingsView';
import { HardwareRebindsView } from './views/Hardware/HardwareRebindsView';
import { UnityEngineView } from './views/Unity/UnityEngineView';
import { CeremoniesView } from './views/Ceremonies/CeremoniesView';
import { MessagingView } from './views/Messaging/MessagingView';
import { PriorityRulesView } from './views/Priority/PriorityRulesView';
import { DeviceDiagnosticsView } from './views/Device/DeviceDiagnosticsView';
import { EodWrapUpModal } from './views/EOD/EodWrapUpModal';
import { OnboardingWizardModal } from './components/OnboardingWizardModal';
import { HardwareDisplayEmulator } from './components/HardwareDisplayEmulator';
import { ToastNotification, ToastMessage } from './components/ToastNotification';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('session');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState<boolean>(false);
  const [isEodModalOpen, setIsEodModalOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Custom Hooks
  const { session, pause, resume, complete, startTask } = useSession();
  const deviceStatus = useDeviceStatus();
  const { projects, tasks } = useTasks('PROJ');
  const { worklogs } = useWorklogs();

  // Auto-open TaskSelectionModal on physical hardware wheel click IPC event
  useEffect(() => {
    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onHardwareInputEvent(event => {
        if (event.actionAssigned === 'TRIGGER_TASK_SELECTOR_MODAL') {
          setIsTaskModalOpen(true);
        }
      });
      return () => unsubscribe();
    }
    return undefined;
  }, []);

  const formatSeconds = (totalSec: number): string => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  };

  const navItems = [
    { id: 'session', label: 'Active Session', icon: Clock },
    { id: 'settings', label: 'Modular Settings', icon: Settings },
    { id: 'hardware', label: 'Hardware Rebinds', icon: Sliders },
    { id: 'unity', label: 'Unity Engine', icon: Gamepad2 },
    { id: 'ceremonies', label: 'Ceremonies', icon: Calendar },
    { id: 'messaging', label: 'Messaging', icon: MessageSquare },
    { id: 'priority', label: 'Priority Rules', icon: Zap },
    { id: 'device', label: 'Device Diagnostics', icon: Monitor }
  ];

  const renderActiveView = () => {
    switch (activeTab) {
      case 'session':
        return (
          <div className="space-y-6">
            <ActiveTaskHeroCard
              session={session}
              onPause={pause}
              onResume={resume}
              onComplete={() => complete()}
              onOpenTaskModal={() => setIsTaskModalOpen(true)}
            />

            <section className="bg-dark-800 rounded-xl border border-border-dark p-6 space-y-4 shadow-xl">
              <h3 className="text-md font-bold text-white font-mono tracking-tight flex items-center justify-between">
                <span>TODAY&apos;S WORKLOG QUEUE</span>
                <span className="text-xs text-text-secondary font-normal">Active session syncing</span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-dark-700 text-text-secondary text-xs uppercase font-mono border-b border-border-dark">
                    <tr>
                      <th className="py-3 px-4">Task ID</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Provider Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-dark text-text-primary">
                    {session && (
                      <tr className="hover:bg-dark-700/50 transition-colors bg-dark-700/30">
                        <td className="py-3 px-4 font-mono text-accent-amber font-medium">{session.taskKey}</td>
                        <td className="py-3 px-4">{session.taskTitle} (Active Session)</td>
                        <td className="py-3 px-4 font-mono">{formatSeconds(session.elapsedSeconds)}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-amber/10 text-accent-amber">
                            {session.status}
                          </span>
                        </td>
                      </tr>
                    )}
                    {worklogs.map(log => (
                      <tr key={log.id} className="hover:bg-dark-700/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-accent-blue font-medium">{log.taskKey || log.taskId}</td>
                        <td className="py-3 px-4">{log.taskTitle || log.comment || 'Completed session'}</td>
                        <td className="py-3 px-4 font-mono">{formatSeconds(log.durationSeconds)}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-green/10 text-accent-green">
                            {log.syncStatus || 'Synced'} ({log.providerId || 'Jira'})
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!session && worklogs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-xs text-text-secondary font-mono">
                          No worklogs recorded today yet. Select a task above to start tracking time!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        );
      case 'hardware':
        return <HardwareRebindsView />;
      case 'unity':
        return <UnityEngineView />;
      case 'ceremonies':
        return <CeremoniesView />;
      case 'messaging':
        return <MessagingView />;
      case 'priority':
        return <PriorityRulesView />;
      case 'device':
        return <DeviceDiagnosticsView />;
      case 'settings':
      default:
        return <SettingsView initialTab="providers" />;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-dark-900 text-text-primary">
      {/* Top Navigation Bar with Hardware Display Live Emulator */}
      <header className="flex items-center justify-between px-6 py-2.5 bg-dark-800 border-b border-border-dark select-none">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${deviceStatus.connected ? 'bg-accent-green animate-pulse' : 'bg-accent-red'}`} />
          <h1 className="text-lg font-bold tracking-tight text-white font-mono">
            ANTIGRAVITY <span className="text-accent-blue font-sans">BUSY Bar</span>
          </h1>
        </div>

        {/* Live Hardware Canvas Emulator */}
        <HardwareDisplayEmulator />

        <div className="flex items-center space-x-4 text-sm font-mono">
          <button
            onClick={() => setIsOnboardingOpen(true)}
            className="flex items-center space-x-1.5 bg-dark-700 hover:bg-dark-700/80 text-accent-blue px-3 py-1.5 rounded-md border border-border-dark font-semibold text-xs transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Setup Wizard</span>
          </button>

          <div className="flex items-center space-x-2 bg-dark-700 px-3 py-1.5 rounded-md border border-border-dark">
            <Wifi className="w-4 h-4 text-accent-green" />
            <span className="text-text-primary">
              {deviceStatus.connected ? `Connected (${deviceStatus.ipAddress})` : 'Disconnected'}
            </span>
          </div>

          <div className="flex items-center space-x-2 text-text-secondary">
            <span>Ping:</span>
            <span className={`font-semibold ${deviceStatus.connected ? 'text-accent-green' : 'text-text-secondary'}`}>
              {deviceStatus.connected ? `${deviceStatus.webSocketPingMs}ms` : '--'}
            </span>
          </div>

          <button
            onClick={() => setIsEodModalOpen(true)}
            className="flex items-center space-x-2 bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple px-3 py-1.5 rounded-md border border-accent-purple/30 font-semibold transition-colors"
          >
            <Moon className="w-4 h-4" />
            <span>EOD Wrap-Up</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-dark-800 border-r border-border-dark flex flex-col p-4 space-y-1">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-3 py-2">
            Modules (&quot;1 Bar per Function&quot;)
          </div>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/20'
                    : 'text-text-secondary hover:bg-dark-700 hover:text-text-primary'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-accent-blue' : 'text-text-secondary'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Workspace Container */}
        <main className="flex-1 overflow-y-auto p-6 bg-dark-900">
          {renderActiveView()}
        </main>
      </div>

      {/* 2-Step Task Selection Modal */}
      <TaskSelectionModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        projects={projects}
        tasks={tasks}
        onSelectTask={(taskId, isAdHoc, title) => {
          startTask(taskId, isAdHoc, title);
        }}
      />

      {/* End-of-Day Wrap-up Modal */}
      <EodWrapUpModal
        isOpen={isEodModalOpen}
        onClose={() => setIsEodModalOpen(false)}
        onConfirmEod={async () => {
          await complete('Finalized during End-of-Day Wrap-Up');
        }}
      />

      {/* Onboarding Setup Wizard Modal */}
      <OnboardingWizardModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
      />

      {/* Desktop Toast Notifications */}
      <ToastNotification
        toasts={toasts}
        onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))}
      />
    </div>
  );
};

export default App;
