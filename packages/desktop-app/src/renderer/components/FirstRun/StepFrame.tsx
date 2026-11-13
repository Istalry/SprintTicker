import React, { useEffect, useRef } from 'react';
import { useModal } from '../../hooks/useModal';

export const FIRST_RUN_STEPS = 3;

/** The buttons every step shares. */
export const primaryButton =
  'px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-40 text-dark-900 text-xs font-semibold rounded-lg transition-all';
export const secondaryButton =
  'px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all';
export const quietButton =
  'px-3 py-2 text-text-secondary hover:text-white hover:bg-dark-700 text-xs font-semibold rounded-lg transition-all';
export const fieldClass =
  'w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-focus';

/** A choice drawn as a card with its radio or checkbox, as S1 and S2 list them. */
export const choiceCard = (on: boolean) =>
  `block rounded-lg border px-4 py-3 cursor-pointer transition-all ${on ? 'border-focus bg-select' : 'border-border-dark hover:border-text-secondary/40'}`;

/**
 * One step of the first run (S1–S3): "Set up · 1 of 3", its question, why
 * it is asked, the step itself, and its buttons.
 */
export const StepFrame: React.FC<{
  step: number;
  title: string;
  intro: React.ReactNode;
  footer: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}> = ({ step, title, intro, footer, error, children }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModal(panelRef);
  // A new step replaces the button that had the focus: its title takes it,
  // so the next Tab starts in the step, not at the top of the window.
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    titleRef.current?.focus();
  }, [step]);
  return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="w-full max-w-xl max-h-[92vh] bg-dark-800 border border-border-dark rounded-xl shadow-2xl flex flex-col"
    >
      <div className="px-6 pt-5 pb-4 border-b border-border-dark">
        <div className="text-[11px] font-semibold text-text-secondary">
          Set up · {step} of {FIRST_RUN_STEPS}
        </div>
        <h2 ref={titleRef} tabIndex={-1} className="mt-1 text-lg font-bold text-white outline-none">{title}</h2>
        <p className="mt-1 text-xs text-text-secondary leading-relaxed">{intro}</p>
      </div>
      <div className="px-6 py-5 space-y-3 overflow-y-auto">{children}</div>
      {error && (
        <p role="alert" className="mx-6 mb-3 text-xs text-accent-red">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2 px-6 py-4 border-t border-border-dark">{footer}</div>
    </div>
  </div>
);
};
