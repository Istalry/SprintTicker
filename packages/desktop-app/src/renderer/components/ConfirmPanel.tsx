import React, { useEffect, useRef } from 'react';
import { useModal } from '../hooks/useModal';
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
  /**
   * Gives the focus to Cancel when the question appears in place of the
   * button that asked it (Stop's Discard…), which would otherwise leave the
   * focus nowhere (REVIEW-2026-11 A4). Never on a prompt main put up: a
   * prompt never takes the focus (CLAUDE.md §5).
   */
  takeFocus?: boolean;
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
  onCancel,
  takeFocus = false
}) => {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (takeFocus) cancelRef.current?.focus();
  }, [takeFocus]);
  return (
  <div role="alertdialog" aria-label={title} className="space-y-4">
    <div className="flex items-center space-x-2">
      <AlertTriangle className={`w-4 h-4 ${tone === 'danger' ? 'text-accent-red' : 'text-accent-amber'}`} />
      <h3 className="text-sm font-bold text-white">{title}</h3>
    </div>
    <div className="text-xs text-text-secondary leading-relaxed">{message}</div>
    <div className="flex justify-end space-x-3 pt-1">
      <button
        ref={cancelRef}
        type="button"
        data-autofocus
        onClick={onCancel}
        className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark transition-all"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
          tone === 'danger'
            ? 'bg-accent-red-fill hover:bg-accent-red-fill-hover text-white'
            : 'bg-primary hover:bg-primary/90 text-dark-900'
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
);
};

/**
 * A question over the window: the closed-week warnings. A modal like every
 * other (`useModal`): Cancel has the focus, Escape is Cancel.
 */
export const ConfirmDialog: React.FC<ConfirmPanelProps> = props => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModal(panelRef, props.onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div ref={panelRef} aria-modal="true" className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
        <ConfirmPanel {...props} />
      </div>
    </div>
  );
};
