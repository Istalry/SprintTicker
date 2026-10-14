import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmPanelProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for what cannot be undone: the confirm button turns red. */
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A yes-or-no question shown in place of a dialog's content.
 *
 * In place rather than as a second overlay, so the question reads as the next
 * step of what the user just clicked, and Cancel lands back where they were.
 * Not `window.confirm`: that blocks the renderer, and cannot say which button
 * does what.
 */
export const ConfirmPanel: React.FC<ConfirmPanelProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel
}) => (
  <div role="alertdialog" aria-label={title} className="space-y-4">
    <div className="flex items-center space-x-2">
      <AlertTriangle className={`w-4 h-4 ${tone === 'danger' ? 'text-accent-red' : 'text-accent-amber'}`} />
      <h4 className="text-sm font-bold text-white">{title}</h4>
    </div>
    <div className="text-xs text-text-secondary leading-relaxed">{message}</div>
    <div className="flex justify-end space-x-3 pt-1">
      <button
        onClick={onCancel}
        className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark transition-all"
      >
        {cancelLabel}
      </button>
      <button
        onClick={onConfirm}
        className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
          tone === 'danger'
            ? 'bg-accent-red/90 hover:bg-accent-red text-white'
            : 'bg-accent-blue hover:bg-blue-600 text-white'
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
);
