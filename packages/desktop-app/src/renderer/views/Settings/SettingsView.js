import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Sliders, Plug, Calendar, Server, Save, Check, Box, Folder, Loader2, CheckCircle, AlertTriangle, Trash2, RefreshCw } from 'lucide-react';
export const SettingsView = () => {
    const [activeTab, setActiveTab] = useState('providers');
    const [savedSuccess, setSavedSuccess] = useState(false);
    // Settings State
    const [fallbackTicketKey, setFallbackTicketKey] = useState('MISC-1');
    const [providerId, setProviderId] = useState('jira');
    const [jiraDomain, setJiraDomain] = useState('https://antigravity.atlassian.net');
    const [bindings, setBindings] = useState({
        startButtonPress: 'TOGGLE_TRACK_PAUSE',
        wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
        wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
        wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
        backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
        backButtonLongPress: 'COMPLETE_AND_LOG_ACTIVE_TASK'
    });
    const [standupTime, setStandupTime] = useState('10:00');
    const [lunchStart, setLunchStart] = useState('12:30');
    const [lunchEnd, setLunchEnd] = useState('13:30');
    const [timeoutSeconds, setTimeoutSeconds] = useState(0); // 0 = Indefinite wait
    // Unity Injector & Gitignore State
    const [isGitignoreConfigured, setIsGitignoreConfigured] = useState(null);
    const [gitignorePath, setGitignorePath] = useState('');
    const [isSettingUpGitignore, setIsSettingUpGitignore] = useState(false);
    const [gitignoreMessage, setGitignoreMessage] = useState(null);
    const [scanFolder, setScanFolder] = useState('C:\\Users\\jbgeron\\Documents');
    const [isScanning, setIsScanning] = useState(false);
    const [scanResults, setScanResults] = useState([]);
    const [scanError, setScanError] = useState(null);
    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.getInputBindings().then(b => {
                if (b)
                    setBindings(b);
            }).catch(err => console.error('[SettingsView] Error loading bindings:', err));
            if (window.electronAPI.unityInjector) {
                window.electronAPI.unityInjector.checkGitignore().then(res => {
                    setIsGitignoreConfigured(res.configured);
                    if (res.path)
                        setGitignorePath(res.path);
                }).catch(err => console.error('[SettingsView] Error checking gitignore:', err));
            }
        }
    }, []);
    const handleSave = async () => {
        if (window.electronAPI) {
            await window.electronAPI.saveInputBindings(bindings);
        }
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
    };
    const handleConfigureGitignore = async () => {
        if (!window.electronAPI?.unityInjector)
            return;
        setIsSettingUpGitignore(true);
        setGitignoreMessage(null);
        try {
            const res = await window.electronAPI.unityInjector.setupGitignore();
            if (res.success) {
                setIsGitignoreConfigured(true);
                if (res.path)
                    setGitignorePath(res.path);
                setGitignoreMessage(res.message);
            }
            else {
                setGitignoreMessage(res.message);
            }
        }
        catch (err) {
            setGitignoreMessage(`Error: ${err?.message || err}`);
        }
        finally {
            setIsSettingUpGitignore(false);
            setTimeout(() => setGitignoreMessage(null), 4000);
        }
    };
    const handleBrowseFolder = async () => {
        if (!window.electronAPI?.unityInjector)
            return;
        try {
            const selected = await window.electronAPI.unityInjector.openFolderPicker();
            if (selected) {
                setScanFolder(selected);
            }
        }
        catch (err) {
            console.error('[SettingsView] Error browsing folder:', err);
        }
    };
    const handleScanAndInject = async () => {
        if (!window.electronAPI?.unityInjector)
            return;
        if (!scanFolder)
            return;
        setIsScanning(true);
        setScanError(null);
        try {
            const results = await window.electronAPI.unityInjector.scanAndInject(scanFolder);
            setScanResults(results);
        }
        catch (err) {
            setScanError(err?.message || 'Failed to scan and inject Unity projects.');
        }
        finally {
            setIsScanning(false);
        }
    };
    const handleRemoveInjection = async (projectPath) => {
        if (!window.electronAPI?.unityInjector)
            return;
        try {
            const success = await window.electronAPI.unityInjector.removeInjection(projectPath);
            if (success) {
                setScanResults(prev => prev.map(r => r.projectPath === projectPath ? { ...r, status: 'failed', error: 'Removed injection junction' } : r));
            }
        }
        catch (err) {
            console.error('[SettingsView] Error removing injection:', err);
        }
    };
    const handleReInject = async (projectPath) => {
        if (!window.electronAPI?.unityInjector)
            return;
        try {
            const results = await window.electronAPI.unityInjector.scanAndInject(projectPath);
            if (results && results.length > 0) {
                const updated = results[0];
                setScanResults(prev => prev.map(r => r.projectPath === projectPath ? updated : r));
            }
        }
        catch (err) {
            console.error('[SettingsView] Error re-injecting project:', err);
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold font-mono text-white tracking-tight", children: "SETTINGS & MODULE CONFIGURATION" }), _jsx("p", { className: "text-xs text-text-secondary", children: "Configure task providers, hardware rebindings, ceremonies, and webhook endpoints." })] }), _jsxs("button", { onClick: handleSave, className: "flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-sm rounded-lg shadow-md transition-all", children: [savedSuccess ? _jsx(Check, { className: "w-4 h-4" }) : _jsx(Save, { className: "w-4 h-4" }), _jsx("span", { children: savedSuccess ? 'Settings Saved!' : 'Save Settings' })] })] }), _jsx("div", { className: "flex space-x-2 border-b border-border-dark font-mono text-sm", children: [
                    { id: 'providers', label: '🔌 Task Providers', icon: Plug },
                    { id: 'hardware', label: '🎛️ Hardware Inputs', icon: Sliders },
                    { id: 'ceremonies', label: '📅 Ceremonies & Dialogs', icon: Calendar },
                    { id: 'integrations', label: '⚡ Integrations & Server', icon: Server },
                    { id: 'unity', label: '🎮 Unity Plugin Injector', icon: Box }
                ].map(t => (_jsx("button", { onClick: () => setActiveTab(t.id), className: `px-4 py-2.5 font-medium border-b-2 transition-all ${activeTab === t.id
                        ? 'border-accent-blue text-accent-blue font-bold'
                        : 'border-transparent text-text-secondary hover:text-white'}`, children: t.label }, t.id))) }), _jsxs("div", { className: "bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl", children: [activeTab === 'providers' && (_jsxs("div", { className: "space-y-6 max-w-xl", children: [_jsx("h3", { className: "text-md font-bold text-white font-mono", children: "Task Provider & Ad-Hoc Mapping" }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Active Task Provider" }), _jsxs("select", { value: providerId, onChange: e => setProviderId(e.target.value), className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono", children: [_jsx("option", { value: "jira", children: "Jira Cloud / Server Integration" }), _jsx("option", { value: "sheets", children: "Google Sheets Sync" }), _jsx("option", { value: "notion", children: "Notion Database" }), _jsx("option", { value: "adhoc", children: "Ad-Hoc / Custom REST Fallback" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Jira Domain URL" }), _jsx("input", { type: "text", value: jiraDomain, onChange: e => setJiraDomain(e.target.value), className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Ad-Hoc Fallback Ticket Key" }), _jsx("input", { type: "text", value: fallbackTicketKey, onChange: e => setFallbackTicketKey(e.target.value), placeholder: "e.g. MISC-1 or ADMIN-1", className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" }), _jsx("p", { className: "text-xs text-text-secondary mt-1", children: "Non-sprint ad-hoc tasks will log hours against this issue key." })] })] })), activeTab === 'hardware' && (_jsxs("div", { className: "space-y-6", children: [_jsx("h3", { className: "text-md font-bold text-white font-mono", children: "Physical Hardware Input Rebinding" }), _jsx("p", { className: "text-xs text-text-secondary", children: "Rebind BUSY Bar physical wheel and button triggers to internal companion app actions:" }), _jsx("div", { className: "divide-y divide-border-dark", children: [
                                    { label: 'Start / Pause Button Press', key: 'startButtonPress' },
                                    { label: 'Scroll Wheel Rotate Left', key: 'wheelRotateLeft' },
                                    { label: 'Scroll Wheel Rotate Right', key: 'wheelRotateRight' },
                                    { label: 'Scroll Wheel Click (OK)', key: 'wheelClick' },
                                    { label: 'Back Button Short Press', key: 'backButtonShortPress' },
                                    { label: 'Back Button Long Press (1.5s)', key: 'backButtonLongPress' }
                                ].map(item => (_jsxs("div", { className: "py-3 flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-medium text-white", children: item.label }), _jsxs("select", { value: bindings[item.key], onChange: e => setBindings({ ...bindings, [item.key]: e.target.value }), className: "bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-xs text-accent-blue font-mono focus:outline-none focus:border-accent-blue", children: [_jsx("option", { value: "TOGGLE_TRACK_PAUSE", children: "Toggle Start / Pause Tracking" }), _jsx("option", { value: "TRIGGER_TASK_SELECTOR_MODAL", children: "Trigger 2-Step Task Selection Modal" }), _jsx("option", { value: "NAVIGATE_QUEUE_PREV", children: "Previous Task / Queue Item" }), _jsx("option", { value: "NAVIGATE_QUEUE_NEXT", children: "Next Task / Queue Item" }), _jsx("option", { value: "DISMISS_NOTIFICATION_ALERT", children: "Dismiss Alert / Notification" }), _jsx("option", { value: "COMPLETE_AND_LOG_ACTIVE_TASK", children: "Complete & Log Active Task" })] })] }, item.key))) })] })), activeTab === 'ceremonies' && (_jsxs("div", { className: "space-y-6 max-w-xl", children: [_jsx("h3", { className: "text-md font-bold text-white font-mono", children: "Agile Ceremonies & Schedule" }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Daily Stand-up Time" }), _jsx("input", { type: "time", value: standupTime, onChange: e => setStandupTime(e.target.value), className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Dialog Timeout Limit" }), _jsxs("select", { value: timeoutSeconds, onChange: e => setTimeoutSeconds(Number(e.target.value)), className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono", children: [_jsx("option", { value: 0, children: "Wait Indefinitely (Default)" }), _jsx("option", { value: 60, children: "Auto-Dismiss after 60s" }), _jsx("option", { value: 120, children: "Auto-Execute after 120s" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Lunch Start Time" }), _jsx("input", { type: "time", value: lunchStart, onChange: e => setLunchStart(e.target.value), className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Lunch End Time" }), _jsx("input", { type: "time", value: lunchEnd, onChange: e => setLunchEnd(e.target.value), className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" })] })] })] })), activeTab === 'integrations' && (_jsxs("div", { className: "space-y-6 max-w-xl", children: [_jsx("h3", { className: "text-md font-bold text-white font-mono", children: "Local Webhook Server Status" }), _jsxs("div", { className: "bg-dark-900 p-4 rounded-lg border border-border-dark space-y-2 font-mono text-xs", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-text-secondary", children: "Fastify HTTP Webhook Server:" }), _jsx("span", { className: "text-accent-green font-bold", children: "\uD83D\uDFE2 Listening (127.0.0.1:39123)" })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-text-secondary", children: "Legacy Port Fallback:" }), _jsx("span", { className: "text-accent-blue font-bold", children: "\uD83D\uDFE2 Active (127.0.0.1:8080)" })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-text-secondary", children: "Unity Editor C# Plugin Status:" }), _jsx("span", { className: "text-accent-green font-bold", children: "\uD83D\uDFE2 Connected (MyFantasyGame)" })] })] })] })), activeTab === 'unity' && (_jsxs("div", { className: "space-y-6 max-w-3xl", children: [_jsxs("div", { className: "bg-dark-900 p-5 rounded-xl border border-border-dark space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(Box, { className: "w-5 h-5 text-accent-blue" }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold text-white font-mono", children: "Global Gitignore Manager" }), _jsx("p", { className: "text-xs text-text-secondary", children: "Globally ignore com.antigravity.busybar in Git to prevent local companion files from polluting project repositories." })] })] }), isGitignoreConfigured === true ? (_jsxs("span", { className: "flex items-center space-x-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-mono font-semibold", children: [_jsx(CheckCircle, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "Gitignore Configured" })] })) : (_jsxs("span", { className: "flex items-center space-x-1.5 px-3 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full text-xs font-mono font-semibold", children: [_jsx(AlertTriangle, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "Not Configured" })] }))] }), gitignorePath && (_jsxs("div", { className: "text-xs font-mono text-text-secondary bg-dark-800 p-2.5 rounded-lg border border-border-dark", children: ["Target File: ", _jsx("span", { className: "text-white", children: gitignorePath })] })), _jsxs("div", { className: "flex items-center justify-between pt-2", children: [_jsxs("button", { onClick: handleConfigureGitignore, disabled: isSettingUpGitignore, className: "flex items-center space-x-2 px-4 py-2 bg-accent-blue hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-mono font-semibold rounded-lg shadow transition-all", children: [isSettingUpGitignore ? _jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" }) : _jsx(CheckCircle, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "Configure Global Gitignore" })] }), gitignoreMessage && (_jsx("span", { className: "text-xs font-mono text-accent-green", children: gitignoreMessage }))] })] }), _jsxs("div", { className: "bg-dark-900 p-5 rounded-xl border border-border-dark space-y-4", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold text-white font-mono", children: "Unity Projects Auto-Scan & Injector" }), _jsx("p", { className: "text-xs text-text-secondary mb-3", children: "Scan local directories and inject the BUSY Bar C# plugin into target projects via Directory Junctions without modifying Packages/manifest.json." })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary", children: "Root Unity Workspace Directory" }), _jsxs("div", { className: "flex space-x-2", children: [_jsx("input", { type: "text", value: scanFolder, onChange: e => setScanFolder(e.target.value), placeholder: "e.g. C:\\Users\\username\\UnityProjects", className: "flex-1 bg-dark-800 border border-border-dark rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-accent-blue font-mono" }), _jsxs("button", { onClick: handleBrowseFolder, className: "flex items-center space-x-1.5 px-3 py-2 bg-dark-800 hover:bg-dark-700 text-text-secondary hover:text-white border border-border-dark text-xs font-mono font-medium rounded-lg transition-all", children: [_jsx(Folder, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "Browse Folder..." })] })] })] }), _jsx("div", { className: "pt-2", children: _jsxs("button", { onClick: handleScanAndInject, disabled: isScanning || !scanFolder, className: "flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 disabled:opacity-50 text-dark-900 font-semibold text-xs font-mono rounded-lg shadow-md transition-all", children: [isScanning ? _jsx(Loader2, { className: "w-4 h-4 animate-spin" }) : _jsx(RefreshCw, { className: "w-4 h-4" }), _jsx("span", { children: isScanning ? 'Scanning & Injecting...' : 'Scan & Inject All Projects' })] }) }), scanError && (_jsx("div", { className: "p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs font-mono text-red-400", children: scanError })), scanResults.length > 0 && (_jsxs("div", { className: "space-y-2 pt-2", children: [_jsxs("h4", { className: "text-xs font-bold text-white font-mono uppercase tracking-wider", children: ["Detected Unity Projects (", scanResults.length, ")"] }), _jsx("div", { className: "bg-dark-800 rounded-lg border border-border-dark overflow-hidden", children: _jsxs("table", { className: "w-full text-left font-mono text-xs", children: [_jsx("thead", { className: "bg-dark-900 text-text-secondary border-b border-border-dark", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-2.5", children: "Project Name" }), _jsx("th", { className: "px-4 py-2.5", children: "Path" }), _jsx("th", { className: "px-4 py-2.5", children: "Status" }), _jsx("th", { className: "px-4 py-2.5 text-right", children: "Actions" })] }) }), _jsx("tbody", { className: "divide-y divide-border-dark text-white", children: scanResults.map((item, idx) => (_jsxs("tr", { className: "hover:bg-dark-700/50 transition-all", children: [_jsx("td", { className: "px-4 py-2.5 font-bold text-accent-blue", children: item.projectName }), _jsx("td", { className: "px-4 py-2.5 text-text-secondary truncate max-w-xs", title: item.projectPath, children: item.projectPath }), _jsxs("td", { className: "px-4 py-2.5", children: [item.status === 'injected' && (_jsx("span", { className: "px-2.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold", children: "Injected" })), item.status === 'already_exists' && (_jsx("span", { className: "px-2.5 py-0.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-[10px] font-bold", children: "Already Linked" })), item.status === 'failed' && (_jsx("span", { className: "px-2.5 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold", title: item.error, children: "Failed" }))] }), _jsx("td", { className: "px-4 py-2.5 text-right", children: item.status === 'injected' || item.status === 'already_exists' ? (_jsxs("button", { onClick: () => handleRemoveInjection(item.projectPath), className: "flex items-center space-x-1 ml-auto px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-semibold rounded transition-all", children: [_jsx(Trash2, { className: "w-3 h-3" }), _jsx("span", { children: "Remove Injection" })] })) : (_jsxs("button", { onClick: () => handleReInject(item.projectPath), className: "flex items-center space-x-1 ml-auto px-2.5 py-1 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 text-[10px] font-semibold rounded transition-all", children: [_jsx(RefreshCw, { className: "w-3 h-3" }), _jsx("span", { children: "Re-Inject" })] })) })] }, idx))) })] }) })] }))] })] }))] })] }));
};
//# sourceMappingURL=SettingsView.js.map