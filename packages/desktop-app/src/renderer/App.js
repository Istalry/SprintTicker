import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Clock, Sliders, Gamepad2, Calendar, MessageSquare, Zap, Monitor, Wifi, Settings, Moon, Sparkles } from 'lucide-react';
import { useSession } from './hooks/useSession';
import { useDeviceStatus } from './hooks/useDeviceStatus';
import { useTasks } from './hooks/useTasks';
import { ActiveTaskHeroCard } from './components/ActiveTaskHeroCard';
import { TaskSelectionModal } from './components/TaskSelectionModal';
import { SettingsView } from './views/Settings/SettingsView';
import { EodWrapUpModal } from './views/EOD/EodWrapUpModal';
import { OnboardingWizardModal } from './components/OnboardingWizardModal';
import { ToastNotification } from './components/ToastNotification';
export const App = () => {
    const [activeTab, setActiveTab] = useState('session');
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [isEodModalOpen, setIsEodModalOpen] = useState(false);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [toasts, setToasts] = useState([]);
    // Custom Hooks
    const { session, pause, resume, complete, startTask } = useSession();
    const deviceStatus = useDeviceStatus();
    const { projects, tasks } = useTasks('PROJ');
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
    const formatSeconds = (totalSec) => {
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
    return (_jsxs("div", { className: "flex flex-col h-screen bg-dark-900 text-text-primary", children: [_jsxs("header", { className: "flex items-center justify-between px-6 py-3 bg-dark-800 border-b border-border-dark select-none", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: `w-3 h-3 rounded-full ${deviceStatus.connected ? 'bg-accent-green animate-pulse' : 'bg-accent-red'}` }), _jsxs("h1", { className: "text-lg font-bold tracking-tight text-white font-mono", children: ["ANTIGRAVITY ", _jsx("span", { className: "text-accent-blue font-sans", children: "BUSY Bar" })] })] }), _jsxs("div", { className: "flex items-center space-x-4 text-sm font-mono", children: [_jsxs("button", { onClick: () => setIsOnboardingOpen(true), className: "flex items-center space-x-1.5 bg-dark-700 hover:bg-dark-700/80 text-accent-blue px-3 py-1.5 rounded-md border border-border-dark font-semibold text-xs transition-colors", children: [_jsx(Sparkles, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "Setup Wizard" })] }), _jsxs("div", { className: "flex items-center space-x-2 bg-dark-700 px-3 py-1.5 rounded-md border border-border-dark", children: [_jsx(Wifi, { className: "w-4 h-4 text-accent-green" }), _jsx("span", { className: "text-text-primary", children: deviceStatus.connected ? `Connected (${deviceStatus.ipAddress})` : 'Disconnected' })] }), _jsxs("div", { className: "flex items-center space-x-2 text-text-secondary", children: [_jsx("span", { children: "Ping:" }), _jsxs("span", { className: "text-accent-green font-semibold", children: [deviceStatus.webSocketPingMs, "ms"] })] }), _jsxs("button", { onClick: () => setIsEodModalOpen(true), className: "flex items-center space-x-2 bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple px-3 py-1.5 rounded-md border border-accent-purple/30 font-semibold transition-colors", children: [_jsx(Moon, { className: "w-4 h-4" }), _jsx("span", { children: "EOD Wrap-Up" })] })] })] }), _jsxs("div", { className: "flex flex-1 overflow-hidden", children: [_jsxs("aside", { className: "w-64 bg-dark-800 border-r border-border-dark flex flex-col p-4 space-y-1", children: [_jsx("div", { className: "text-xs font-semibold text-text-secondary uppercase tracking-wider px-3 py-2", children: "Modules (\"1 Bar per Function\")" }), navItems.map(item => {
                                const Icon = item.icon;
                                const isActive = activeTab === item.id;
                                return (_jsxs("button", { onClick: () => setActiveTab(item.id), className: `flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive
                                        ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/20'
                                        : 'text-text-secondary hover:bg-dark-700 hover:text-text-primary'}`, children: [_jsx(Icon, { className: `w-4 h-4 ${isActive ? 'text-accent-blue' : 'text-text-secondary'}` }), _jsx("span", { children: item.label })] }, item.id));
                            })] }), _jsx("main", { className: "flex-1 overflow-y-auto p-6 bg-dark-900", children: activeTab === 'session' ? (_jsxs("div", { className: "space-y-6", children: [_jsx(ActiveTaskHeroCard, { session: session, onPause: pause, onResume: resume, onComplete: () => complete(), onOpenTaskModal: () => setIsTaskModalOpen(true) }), _jsxs("section", { className: "bg-dark-800 rounded-xl border border-border-dark p-6 space-y-4 shadow-xl", children: [_jsxs("h3", { className: "text-md font-bold text-white font-mono tracking-tight flex items-center justify-between", children: [_jsx("span", { children: "TODAY'S WORKLOG QUEUE" }), _jsx("span", { className: "text-xs text-text-secondary font-normal", children: "Active session syncing" })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-left text-sm", children: [_jsx("thead", { className: "bg-dark-700 text-text-secondary text-xs uppercase font-mono border-b border-border-dark", children: _jsxs("tr", { children: [_jsx("th", { className: "py-3 px-4", children: "Task ID" }), _jsx("th", { className: "py-3 px-4", children: "Description" }), _jsx("th", { className: "py-3 px-4", children: "Duration" }), _jsx("th", { className: "py-3 px-4", children: "Provider Status" })] }) }), _jsxs("tbody", { className: "divide-y divide-border-dark text-text-primary", children: [_jsxs("tr", { className: "hover:bg-dark-700/50 transition-colors", children: [_jsx("td", { className: "py-3 px-4 font-mono text-accent-blue font-medium", children: "PROJ-140" }), _jsx("td", { className: "py-3 px-4", children: "Fix Enemy Spawner Memory Leak" }), _jsx("td", { className: "py-3 px-4 font-mono", children: "02h 15m" }), _jsx("td", { className: "py-3 px-4", children: _jsx("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-green/10 text-accent-green", children: "Synced (Jira)" }) })] }), session && (_jsxs("tr", { className: "hover:bg-dark-700/50 transition-colors bg-dark-700/30", children: [_jsx("td", { className: "py-3 px-4 font-mono text-accent-amber font-medium", children: session.taskKey }), _jsxs("td", { className: "py-3 px-4", children: [session.taskTitle, " (Active)"] }), _jsx("td", { className: "py-3 px-4 font-mono", children: formatSeconds(session.elapsedSeconds) }), _jsx("td", { className: "py-3 px-4", children: _jsx("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-amber/10 text-accent-amber", children: session.status }) })] }))] })] }) })] })] })) : (_jsx(SettingsView, {})) })] }), _jsx(TaskSelectionModal, { isOpen: isTaskModalOpen, onClose: () => setIsTaskModalOpen(false), projects: projects, tasks: tasks, onSelectTask: (taskId, isAdHoc, title) => {
                    startTask(taskId, isAdHoc, title);
                } }), _jsx(EodWrapUpModal, { isOpen: isEodModalOpen, onClose: () => setIsEodModalOpen(false), onConfirmEod: async () => {
                    await complete('Finalized during End-of-Day Wrap-Up');
                } }), _jsx(OnboardingWizardModal, { isOpen: isOnboardingOpen, onClose: () => setIsOnboardingOpen(false) }), _jsx(ToastNotification, { toasts: toasts, onDismiss: id => setToasts(prev => prev.filter(t => t.id !== id)) })] }));
};
export default App;
//# sourceMappingURL=App.js.map