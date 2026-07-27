import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
export const ToastNotification = ({ toasts, onDismiss }) => {
    useEffect(() => {
        if (toasts.length > 0) {
            const timer = setTimeout(() => {
                onDismiss(toasts[0].id);
            }, 4000);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [toasts, onDismiss]);
    if (toasts.length === 0)
        return null;
    return (_jsx("div", { className: "fixed bottom-5 right-5 z-50 flex flex-col space-y-2 max-w-sm w-full select-none", children: toasts.map(t => (_jsxs("div", { className: `flex items-start justify-between p-4 rounded-xl shadow-2xl border backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 ${t.type === 'success'
                ? 'bg-dark-800/90 border-accent-green/40 text-white'
                : t.type === 'warning'
                    ? 'bg-dark-800/90 border-accent-amber/40 text-white'
                    : 'bg-dark-800/90 border-accent-blue/40 text-white'}`, children: [_jsxs("div", { className: "flex items-start space-x-3", children: [t.type === 'success' && _jsx(CheckCircle, { className: "w-5 h-5 text-accent-green shrink-0 mt-0.5" }), t.type === 'warning' && _jsx(AlertTriangle, { className: "w-5 h-5 text-accent-amber shrink-0 mt-0.5" }), t.type === 'info' && _jsx(Info, { className: "w-5 h-5 text-accent-blue shrink-0 mt-0.5" }), _jsxs("div", { children: [_jsx("h5", { className: "text-xs font-bold font-mono", children: t.title }), _jsx("p", { className: "text-xs text-text-secondary mt-0.5", children: t.message })] })] }), _jsx("button", { onClick: () => onDismiss(t.id), className: "p-1 text-text-secondary hover:text-white transition-colors", children: _jsx(X, { className: "w-4 h-4" }) })] }, t.id))) }));
};
//# sourceMappingURL=ToastNotification.js.map