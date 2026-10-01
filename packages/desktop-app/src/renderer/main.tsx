import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MiniBar } from './components/MiniBar';
import { setRegionalLocale } from './utils/formatters';
import { MINI_WINDOW_HASH } from '../shared/mini-window';
import './index.css';

// One bundle, two windows: main loads the mini timer at this hash.
const isMiniWindow = window.location.hash === `#${MINI_WINDOW_HASH}`;

const render = () =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      {isMiniWindow ? <MiniBar /> : <App />}
    </React.StrictMode>
  );

// Read before the first render, so no time is ever drawn in the wrong format
// and redrawn. One IPC round trip, answered from memory in main.
window.electronAPI
  .getSystemLocale()
  .then(setRegionalLocale, err => console.warn('[Renderer] Regional format unavailable; using the default:', err))
  .finally(render);
