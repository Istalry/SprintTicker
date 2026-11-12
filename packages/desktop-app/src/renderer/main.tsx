import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MiniBar } from './components/MiniBar';
import { setRegionalLocale } from './utils/formatters';
import { MINI_WINDOW_HASH } from '../shared/mini-window';
import { readPickerWindowHash, readPickerWindowIds } from '../shared/picker-window';
import { PickerWindow } from './components/PickerWindow';
import './index.css';

// One bundle, three windows: main loads the mini timer and the picker
// window at their hashes.
const isMiniWindow = window.location.hash === `#${MINI_WINDOW_HASH}`;
const pickerMode = readPickerWindowHash(window.location.hash);

const root = (): React.ReactElement => {
  if (isMiniWindow) return <MiniBar />;
  if (pickerMode) return <PickerWindow mode={pickerMode} ids={readPickerWindowIds(window.location.hash)} />;
  return <App />;
};

const render = () =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      {root()}
    </React.StrictMode>
  );

// Read before the first render, so no time is ever drawn in the wrong format
// and redrawn. One IPC round trip, answered from memory in main.
window.electronAPI
  .getSystemLocale()
  .then(setRegionalLocale, err => console.warn('[Renderer] Regional format unavailable; using the default:', err))
  .finally(render);
