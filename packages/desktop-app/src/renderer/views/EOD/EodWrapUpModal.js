import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { X, Moon, CheckCircle2 } from 'lucide-react';
export const EodWrapUpModal = ({ isOpen, onClose, onConfirmEod }) => {
    const [executing, setExecuting] = useState(false);
    const [unitySaved, setUnitySaved] = useState(false);
    const [completed, setCompleted] = useState(false);
    if (!isOpen)
        return null;
    const handleExecuteEod = async () => {
        setExecuting(true);
        try {
            // 1. Issue RPC save scenes request to Unity Editor (with 2000ms timeout & error suppression)
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                const response = await fetch('http://localhost:8081/antigravity/save-scenes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.ok)
                    setUnitySaved(true);
            }
            catch {
                console.log('[EOD] Unity Editor not active or plugin uninstalled, skipping scene save.');
                setUnitySaved(false);
            }
            // 2. Stop active tracking session & finalize worklogs
            await onConfirmEod();
            setExecuting(false);
            setCompleted(true);
        }
        catch (err) {
            console.error('[EOD] Error during EOD sequence:', err);
            setExecuting(false);
        }
    };
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none", children: _jsxs("div", { className: "w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col", children: [_jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-b border-border-dark bg-dark-700/50", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(Moon, { className: "w-5 h-5 text-accent-purple" }), _jsx("h3", { className: "text-md font-bold text-white font-mono", children: "End-of-Day Wrap-Up Wizard" })] }), _jsx("button", { onClick: onClose, className: "p-1 hover:bg-dark-700 rounded-md text-text-secondary hover:text-white transition-colors", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsx("div", { className: "p-6 space-y-4", children: !completed ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-xs text-text-secondary", children: "Executing EOD wrap-up will automatically finalize your active session, log pending hours, save open Unity scenes, and prepare your workstation for shutdown." }), _jsxs("div", { className: "bg-dark-900 p-4 rounded-lg border border-border-dark space-y-2 text-xs font-mono", children: [_jsxs("div", { className: "flex items-center justify-between text-text-primary", children: [_jsx("span", { children: "1. Stop Active Session & Log Hours" }), _jsx("span", { className: "text-accent-green", children: "\u2713 Ready" })] }), _jsxs("div", { className: "flex items-center justify-between text-text-primary", children: [_jsx("span", { children: "2. RPC Save Open Unity Scenes" }), _jsx("span", { className: "text-accent-blue", children: "http://localhost:8081" })] }), _jsxs("div", { className: "flex items-center justify-between text-text-primary", children: [_jsx("span", { children: "3. Worklog Sync Queue Submission" }), _jsx("span", { className: "text-accent-green", children: "\u2713 Auto" })] })] })] })) : (_jsxs("div", { className: "text-center py-6 space-y-3", children: [_jsx(CheckCircle2, { className: "w-12 h-12 text-accent-green mx-auto animate-bounce" }), _jsx("h4", { className: "text-lg font-bold text-white font-mono", children: "Day Complete!" }), _jsx("p", { className: "text-xs text-text-secondary", children: unitySaved
                                    ? 'All active task hours logged to Jira and open Unity scenes saved.'
                                    : 'All active task hours logged. Unity scene save skipped gracefully.' })] })) }), _jsx("div", { className: "flex items-center justify-end space-x-3 px-6 py-4 border-t border-border-dark bg-dark-700/30", children: !completed ? (_jsxs(_Fragment, { children: [_jsx("button", { onClick: onClose, className: "px-4 py-2 bg-dark-700 hover:bg-dark-700/80 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all", children: "Cancel" }), _jsx("button", { onClick: handleExecuteEod, disabled: executing, className: "px-5 py-2 bg-accent-purple hover:bg-purple-600 text-white text-xs font-semibold rounded-lg shadow-md transition-all", children: executing ? 'Executing...' : 'Execute Wrap-Up Now' })] })) : (_jsx("button", { onClick: onClose, className: "px-5 py-2 bg-accent-green hover:bg-emerald-600 text-dark-900 text-xs font-semibold rounded-lg shadow-md transition-all", children: "Done" })) })] }) }));
};
//# sourceMappingURL=EodWrapUpModal.js.map