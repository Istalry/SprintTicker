import React, { useState } from 'react';
import { YourTasksStep } from './YourTasksStep';
import { YourDeskStep } from './YourDeskStep';
import { YourDayStep } from './YourDayStep';

const warn = (what: string) => (err: unknown) => console.warn(`[FirstRun] ${what} failed:`, err);

interface FirstRunDialogProps {
  isOpen: boolean;
  /** Set up later: Today, with nothing started. */
  onClose: () => void;
  /** Start my first task: Today, with the picker open. */
  onStartFirstTask: () => void;
}

/**
 * The first run (S1–S3, redesign P11a), replacing the setup wizard. It opens
 * on its own at the first launch, and from Settings › General after that.
 * Each step saves when it is left forward, so Back never undoes anything and
 * a run stopped half-way keeps what was answered. Mounted only while open:
 * every opening starts on S1, clean.
 */
export const FirstRunDialog: React.FC<FirstRunDialogProps> = ({ isOpen, onClose, onStartFirstTask }) =>
  isOpen ? <FirstRunSteps onClose={onClose} onStartFirstTask={onStartFirstTask} /> : null;

const FirstRunSteps: React.FC<Omit<FirstRunDialogProps, 'isOpen'>> = ({ onClose, onStartFirstTask }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Either way out means it does not open on its own again.
  const finish = (then: () => void) => () => {
    window.electronAPI.finishFirstRun().catch(warn('Marking the first run done'));
    then();
  };
  if (step === 1) return <YourTasksStep onLater={finish(onClose)} onNext={() => setStep(2)} />;
  if (step === 2) return <YourDeskStep onBack={() => setStep(1)} onNext={() => setStep(3)} />;
  return <YourDayStep onBack={() => setStep(2)} onFinish={finish(onStartFirstTask)} />;
};
