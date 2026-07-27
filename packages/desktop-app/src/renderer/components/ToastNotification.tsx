import React, { useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'info';
  title: string;
  message: string;
}

interface ToastNotificationProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({ toasts, onDismiss }) => {
  useEffect(() => {
    if (toasts.length > 0) {
      const timer = setTimeout(() => {
        onDismiss(toasts[0].id);
      }, 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 max-w-sm w-full select-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start justify-between p-4 rounded-xl shadow-2xl border backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 ${
            t.type === 'success'
              ? 'bg-dark-800/90 border-accent-green/40 text-white'
              : t.type === 'warning'
              ? 'bg-dark-800/90 border-accent-amber/40 text-white'
              : 'bg-dark-800/90 border-accent-blue/40 text-white'
          }`}
        >
          <div className="flex items-start space-x-3">
            {t.type === 'success' && <CheckCircle className="w-5 h-5 text-accent-green shrink-0 mt-0.5" />}
            {t.type === 'warning' && <AlertTriangle className="w-5 h-5 text-accent-amber shrink-0 mt-0.5" />}
            {t.type === 'info' && <Info className="w-5 h-5 text-accent-blue shrink-0 mt-0.5" />}

            <div>
              <h5 className="text-xs font-bold font-mono">{t.title}</h5>
              <p className="text-xs text-text-secondary mt-0.5">{t.message}</p>
            </div>
          </div>

          <button
            onClick={() => onDismiss(t.id)}
            className="p-1 text-text-secondary hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
