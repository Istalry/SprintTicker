import { useEffect, useState } from 'react';

/** What the task picker is open for. */
export type PickerMode = 'start' | 'assign';

/**
 * Whether a picker request from the input stream is meant for the window.
 *
 * `TRIGGER_TASK_SELECTOR_MODAL` reaches the window twice over: from the app
 * itself (the tray, the mini timer, the deck: `inputKey` 'app'), and as the
 * echo of the bar's wheel click. With nothing running, the bar's click opens
 * the bar's own picker (`InputDecoder.startTaskSelection`), so opening the
 * window's as well showed two pickers taking the same choice. With a task
 * running, the bar only raises the window, and the window's picker is the
 * one meant.
 */
export function windowPickerWanted(inputKey: string, sessionRunning: boolean): boolean {
  return inputKey === 'app' || sessionRunning;
}

/**
 * The window's global dialogs: the picker, the end-of-day wrap-up, and the
 * first run. Main opens some of them -- a ceremony
 * prompt, a picker request from the bar, the tray or the mini timer -- so
 * their flags live here rather than in the views.
 */
export function useModals(sessionRunning: boolean) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>('start');
  const [eodOpen, setEodOpen] = useState(false);
  const [firstRunOpen, setFirstRunOpen] = useState(false);

  // The first run opens on its own once, at the first launch (P11a); main
  // decides, and marks an install set up before it existed as done.
  useEffect(() => {
    window.electronAPI?.shouldShowFirstRun?.()
      .then(show => { if (show) setFirstRunOpen(true); })
      .catch(err => console.warn('[useModals] Could not ask about the first run:', err));
  }, []);

  // The wrap-up opens where the window is, without coming forward (P8c).
  // The stand-up is a card on Today, which follows the prompt itself.
  useEffect(() => {
    if (!window.electronAPI?.onCeremonyPrompt) return undefined;
    return window.electronAPI.onCeremonyPrompt(prompt => {
      if (prompt?.type === 'EOD') setEodOpen(true);
    });
  }, []);

  // Picker requests and prompt answers arriving on the input stream.
  useEffect(() => {
    if (!window.electronAPI?.onHardwareInputEvent) return undefined;
    return window.electronAPI.onHardwareInputEvent(event => {
      const busy = eodOpen;
      if (event.actionAssigned === 'TRIGGER_TASK_SELECTOR_MODAL' && !busy && windowPickerWanted(event.inputKey, sessionRunning)) {
        setPickerMode('start');
        setPickerOpen(true);
      }
      // From the mini timer's Assign: the same picker, for the open session.
      if (event.actionAssigned === 'TRIGGER_TASK_ASSIGN_MODAL' && !busy) {
        setPickerMode('assign');
        setPickerOpen(true);
      }
    });
  }, [eodOpen, sessionRunning]);

  const openPicker = (mode: PickerMode): void => {
    setPickerMode(mode);
    setPickerOpen(true);
  };

  // The header asks main for the prompt rather than only opening the dialog,
  // so the bar shows the wrap-up too and its START confirms it. Opened here
  // alone, the bar went on showing the session, and START there paused it.
  const openEod = (): void => {
    setEodOpen(true);
    window.electronAPI?.triggerEodPrompt?.()
      .catch(err => console.warn('[useModals] Could not show the wrap-up prompt on the bar:', err));
  };

  return {
    picker: { open: pickerOpen, mode: pickerMode, show: openPicker, close: () => setPickerOpen(false) },
    eod: { open: eodOpen, show: openEod, close: () => setEodOpen(false) },
    firstRun: { open: firstRunOpen, show: () => setFirstRunOpen(true), close: () => setFirstRunOpen(false) }
  };
}
