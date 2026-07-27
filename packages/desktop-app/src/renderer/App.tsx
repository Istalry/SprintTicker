import React, { useState, useEffect } from 'react';
import {
  Clock,
  Plug,
  Sliders,
  Gamepad2,
  Calendar,
  MessageSquare,
  Zap,
  Monitor,
  Play,
  Pause,
  CheckCircle2,
  RefreshCw,
  Wifi,
  Settings,
  ShieldAlert
} from 'lucide-react';
import { ActiveSessionDTO, DeviceStatusDTO } from '../shared/dtos';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('session');
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusDTO>({
    connected: true,
    ipAddress: '10.0.4.20',
    connectionType: 'usb',
    frontBrightness: 80,
    backBrightness: 100,
    batteryPercent: 98,
    firmwareVersion: '1.4.2',
    webSocketPingMs: 4
  });

  const [session, setSession] = useState<ActiveSessionDTO | null>({
    sessionId: 'sess_101',
    projectId: 'PROJ',
    taskId: 'PROJ-142',
    taskKey: 'PROJ-142',
    taskTitle: 'Implement Player Character Dash Mechanics',
    isAdHoc: false,
    status: 'TRACKING',
    startTimeUtc: new Date(Date.now() - 5078000).toISOString(),
    totalPausedSeconds: 0,
    elapsedSeconds: 5078
  });

  // Timer interval for local stopwatch counter UI update
  useEffect(() => {
    const timer = setInterval(() => {
      setSession(prev => {
        if (!prev || prev.status !== 'TRACKING') return prev;
        return {
          ...prev,
          elapsedSeconds: prev.elapsedSeconds + 1
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatSeconds = (totalSec: number): string => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePauseToggle = async () => {
    if (!session) return;
    if (session.status === 'TRACKING') {
      setSession({ ...session, status: 'PAUSED' });
    } else {
      setSession({ ...session, status: 'TRACKING' });
    }
  };

  const navItems = [
    { id: 'session', label: 'Active Session', icon: Clock },
    { id: 'provider', label: 'Task Provider', icon: Plug },
    { id: 'hardware', label: 'Hardware Inputs', icon: Sliders },
    { id: 'unity', label: 'Unity Engine', icon: Gamepad2 },
    { id: 'ceremonies', label: 'Ceremonies', icon: Calendar },
    { id: 'messaging', label: 'Messaging', icon: MessageSquare },
    { id: 'priority', label: 'Priority Rules', icon: Zap },
    { id: 'device', label: 'Device Hardware', icon: Monitor }
  ];

  return (
    <div className="flex flex-col h-screen bg-dark-900 text-text-primary">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between px-6 py-3 bg-dark-800 border-b border-border-dark select-none">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-accent-green animate-pulse" />
          <h1 className="text-lg font-bold tracking-tight text-white font-mono">
            ANTIGRAVITY <span className="text-accent-blue font-sans">BUSY Bar</span>
          </h1>
        </div>

        <div className="flex items-center space-x-6 text-sm font-mono">
          <div className="flex items-center space-x-2 bg-dark-700 px-3 py-1.5 rounded-md border border-border-dark">
            <Wifi className="w-4 h-4 text-accent-green" />
            <span className="text-text-primary">
              Connected ({deviceStatus.ipAddress})
            </span>
          </div>

          <div className="flex items-center space-x-2 text-text-secondary">
            <span>Sync:</span>
            <span className="text-accent-green font-semibold">Synced</span>
          </div>

          <button className="p-2 hover:bg-dark-700 rounded-md transition-colors text-text-secondary hover:text-white">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-dark-800 border-r border-border-dark flex flex-col p-4 space-y-1">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-3 py-2">
            Modules ("1 Bar per Function")
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
        <main className="flex-1 overflow-y-auto p-6 space-y-6 bg-dark-900">
          {/* Active Task Hero Card */}
          <section className="bg-dark-800 rounded-xl border border-border-dark p-6 space-y-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="bg-accent-blue/20 text-accent-blue px-3 py-1 rounded-md text-xs font-mono font-bold">
                  CURRENT SESSION
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold font-mono ${
                    session?.status === 'TRACKING'
                      ? 'bg-accent-green/20 text-accent-green border border-accent-green/30'
                      : 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30'
                  }`}
                >
                  ● {session?.status || 'IDLE'}
                </span>
              </div>
              <span className="text-xs font-mono text-text-secondary">UTC Absolute Timestamp Engine</span>
            </div>

            <div>
              <div className="text-xs font-mono text-text-secondary mb-1">{session?.taskKey || 'NO TASK'}</div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {session?.taskTitle || 'No Active Task Selected'}
              </h2>
            </div>

            <div className="flex items-baseline space-x-4 bg-dark-900 p-4 rounded-lg border border-border-dark">
              <span className="text-xs font-mono text-text-secondary uppercase">Elapsed Time:</span>
              <span className="text-4xl font-extrabold font-mono text-white tracking-widest">
                {formatSeconds(session?.elapsedSeconds || 0)}
              </span>
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={handlePauseToggle}
                className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                  session?.status === 'TRACKING'
                    ? 'bg-accent-amber hover:bg-amber-600 text-dark-900'
                    : 'bg-accent-green hover:bg-emerald-600 text-dark-900'
                }`}
              >
                {session?.status === 'TRACKING' ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Resume</span>
                  </>
                )}
              </button>

              <button className="flex items-center space-x-2 px-5 py-2.5 bg-dark-700 hover:bg-dark-700/80 text-white rounded-lg font-semibold text-sm border border-border-dark transition-all">
                <CheckCircle2 className="w-4 h-4 text-accent-green" />
                <span>Finish & Log Hours</span>
              </button>

              <button className="flex items-center space-x-2 px-5 py-2.5 bg-dark-700 hover:bg-dark-700/80 text-white rounded-lg font-semibold text-sm border border-border-dark transition-all">
                <RefreshCw className="w-4 h-4 text-accent-blue" />
                <span>Switch / New Task</span>
              </button>
            </div>
          </section>

          {/* Today's Worklog Queue */}
          <section className="bg-dark-800 rounded-xl border border-border-dark p-6 space-y-4 shadow-xl">
            <h3 className="text-md font-bold text-white font-mono tracking-tight flex items-center justify-between">
              <span>TODAY'S WORKLOG QUEUE</span>
              <span className="text-xs text-text-secondary font-normal">3 entries logged</span>
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
                  <tr className="hover:bg-dark-700/50 transition-colors">
                    <td className="py-3 px-4 font-mono text-accent-blue font-medium">PROJ-140</td>
                    <td className="py-3 px-4">Fix Enemy Spawner Memory Leak</td>
                    <td className="py-3 px-4 font-mono">02h 15m</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-green/10 text-accent-green">
                        Synced (Jira)
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-dark-700/50 transition-colors">
                    <td className="py-3 px-4 font-mono text-accent-purple font-medium">ADHOC-01</td>
                    <td className="py-3 px-4">Sprint Planning & Stand-up</td>
                    <td className="py-3 px-4 font-mono">00h 45m</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-green/10 text-accent-green">
                        Synced (Misc)
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-dark-700/50 transition-colors bg-dark-700/30">
                    <td className="py-3 px-4 font-mono text-accent-amber font-medium">PROJ-142</td>
                    <td className="py-3 px-4">Implement Dash Mechanics (Active)</td>
                    <td className="py-3 px-4 font-mono">{formatSeconds(session?.elapsedSeconds || 0)}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-amber/10 text-accent-amber">
                        In Progress
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;
