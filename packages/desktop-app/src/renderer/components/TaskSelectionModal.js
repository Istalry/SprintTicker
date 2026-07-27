import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { X, Search, PlusCircle, ArrowLeft, Check } from 'lucide-react';
export const TaskSelectionModal = ({ isOpen, onClose, projects, tasks, onSelectTask }) => {
    const [step, setStep] = useState(1);
    const [selectedProjectId, setSelectedProjectId] = useState('PROJ');
    const [isAdHocMode, setIsAdHocMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [customTitle, setCustomTitle] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    // Filter tasks by selected project and search query
    const filteredTasks = tasks.filter(t => {
        const matchesProject = t.projectId === selectedProjectId;
        const matchesQuery = t.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.title.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesProject && matchesQuery;
    });
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setSearchQuery('');
            setCustomTitle('');
            setIsAdHocMode(false);
            setSelectedIndex(0);
        }
    }, [isOpen]);
    // Handle keyboard events (Esc to close, Enter to confirm, Arrow keys)
    useEffect(() => {
        if (!isOpen)
            return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose();
            }
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, filteredTasks.length - 1));
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (step === 1) {
                    if (isAdHocMode) {
                        setStep(2);
                    }
                    else {
                        setStep(2);
                    }
                }
                else if (step === 2) {
                    if (isAdHocMode) {
                        if (customTitle.trim()) {
                            onSelectTask(`adhoc_${Date.now()}`, true, customTitle.trim());
                            onClose();
                        }
                    }
                    else if (filteredTasks[selectedIndex]) {
                        onSelectTask(filteredTasks[selectedIndex].id, false, filteredTasks[selectedIndex].title);
                        onClose();
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, step, isAdHocMode, customTitle, filteredTasks, selectedIndex, onClose, onSelectTask]);
    if (!isOpen)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none", children: _jsxs("div", { className: "w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col", children: [_jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-b border-border-dark bg-dark-700/50", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [step === 2 && (_jsx("button", { onClick: () => setStep(1), className: "p-1 hover:bg-dark-700 rounded-md text-text-secondary hover:text-white transition-colors", children: _jsx(ArrowLeft, { className: "w-5 h-5" }) })), _jsx("h3", { className: "text-md font-bold text-white font-mono", children: step === 1
                                        ? 'Step 1: Select Target Project or Provider'
                                        : isAdHocMode
                                            ? 'Step 2: Enter Custom Ad-Hoc Task Title'
                                            : `Step 2: Select Task under [${selectedProjectId}]` })] }), _jsx("button", { onClick: onClose, className: "p-1.5 hover:bg-dark-700 rounded-md text-text-secondary hover:text-white transition-colors", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsx("div", { className: "p-6 space-y-4 flex-1", children: step === 1 ? (_jsxs("div", { className: "space-y-3", children: [_jsx("p", { className: "text-xs text-text-secondary", children: "Choose an active project from your provider (Jira/Notion) or create custom overhead work:" }), _jsxs("div", { className: "space-y-2", children: [projects.map(proj => (_jsxs("button", { onClick: () => {
                                            setSelectedProjectId(proj.key);
                                            setIsAdHocMode(false);
                                            setStep(2);
                                        }, className: `w-full flex items-center justify-between p-3.5 rounded-lg border text-left font-medium text-sm transition-all ${selectedProjectId === proj.key && !isAdHocMode
                                            ? 'bg-accent-blue/10 border-accent-blue text-accent-blue'
                                            : 'bg-dark-700/50 border-border-dark text-text-primary hover:bg-dark-700'}`, children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono font-bold", children: proj.key }), _jsx("div", { className: "text-xs text-text-secondary", children: proj.name })] }), selectedProjectId === proj.key && !isAdHocMode && _jsx(Check, { className: "w-5 h-5" })] }, proj.id))), _jsxs("button", { onClick: () => {
                                            setIsAdHocMode(true);
                                            setStep(2);
                                        }, className: `w-full flex items-center space-x-3 p-3.5 rounded-lg border text-left font-medium text-sm transition-all ${isAdHocMode
                                            ? 'bg-accent-purple/10 border-accent-purple text-accent-purple'
                                            : 'bg-dark-700/30 border-dashed border-border-dark text-text-secondary hover:text-white hover:bg-dark-700/60'}`, children: [_jsx(PlusCircle, { className: "w-5 h-5 text-accent-purple" }), _jsxs("div", { children: [_jsx("div", { className: "font-bold text-white", children: "+ Create Custom / Ad-Hoc Task" }), _jsx("div", { className: "text-xs text-text-secondary", children: "Logged under fallback ticket MISC-1" })] })] })] })] })) : isAdHocMode ? (_jsxs("div", { className: "space-y-4", children: [_jsx("p", { className: "text-xs text-text-secondary", children: "Enter a custom description for your overhead or non-sprint work:" }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-mono text-text-secondary mb-1", children: "Custom Task Title" }), _jsx("input", { type: "text", value: customTitle, onChange: e => setCustomTitle(e.target.value), placeholder: "e.g. Code Review with Lead Architect", autoFocus: true, className: "w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent-blue font-sans" })] }), _jsxs("div", { className: "text-xs font-mono text-accent-amber bg-accent-amber/10 p-3 rounded-lg border border-accent-amber/20", children: ["\u2139\uFE0F Time will be logged under fallback ticket: ", _jsx("strong", { children: "MISC-1" })] })] })) : (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "relative", children: [_jsx(Search, { className: "w-4 h-4 absolute left-3.5 top-3 text-text-secondary" }), _jsx("input", { type: "text", value: searchQuery, onChange: e => {
                                            setSearchQuery(e.target.value);
                                            setSelectedIndex(0);
                                        }, placeholder: "Search sprint task key or title...", autoFocus: true, className: "w-full bg-dark-900 border border-border-dark rounded-lg pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent-blue font-sans" })] }), _jsx("div", { className: "max-h-60 overflow-y-auto space-y-1 pr-1", children: filteredTasks.length > 0 ? (filteredTasks.map((t, idx) => (_jsxs("button", { onClick: () => {
                                        onSelectTask(t.id, false, t.title);
                                        onClose();
                                    }, className: `w-full flex items-center justify-between p-3 rounded-lg text-left text-sm font-medium transition-all ${selectedIndex === idx
                                        ? 'bg-accent-blue/15 border border-accent-blue/40 text-white'
                                        : 'bg-dark-700/40 border border-transparent text-text-primary hover:bg-dark-700'}`, children: [_jsxs("div", { children: [_jsx("div", { className: "font-mono text-accent-blue font-bold", children: t.key }), _jsx("div", { className: "text-xs text-text-secondary", children: t.title })] }), _jsx("span", { className: "text-xs font-mono text-text-secondary capitalize", children: t.status })] }, t.id)))) : (_jsxs("div", { className: "text-center py-6 text-xs text-text-secondary font-mono", children: ["No matching sprint tasks found under [", selectedProjectId, "]."] })) })] })) }), _jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-t border-border-dark bg-dark-700/30", children: [_jsx("span", { className: "text-xs font-mono text-text-secondary", children: "Use Enter to select \u2022 Esc to dismiss" }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("button", { onClick: onClose, className: "px-4 py-2 bg-dark-700 hover:bg-dark-700/80 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all", children: "Cancel" }), step === 2 && isAdHocMode && (_jsx("button", { onClick: () => {
                                        if (customTitle.trim()) {
                                            onSelectTask(`adhoc_${Date.now()}`, true, customTitle.trim());
                                            onClose();
                                        }
                                    }, disabled: !customTitle.trim(), className: `px-4 py-2 text-xs font-semibold rounded-lg transition-all ${customTitle.trim()
                                        ? 'bg-accent-green hover:bg-emerald-600 text-dark-900'
                                        : 'bg-dark-700 text-text-secondary cursor-not-allowed'}`, children: "Start Session" }))] })] })] }) }));
};
//# sourceMappingURL=TaskSelectionModal.js.map