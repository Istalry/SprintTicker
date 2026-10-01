import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setRegionalLocale } from './utils/formatters';
import './index.css';

const render = () =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

// Read before the first render, so no time is ever drawn in the wrong format
// and redrawn. One IPC round trip, answered from memory in main.
window.electronAPI
  .getSystemLocale()
  .then(setRegionalLocale, err => console.warn('[Renderer] Regional format unavailable; using the default:', err))
  .finally(render);
