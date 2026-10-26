import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

// The offline shell worker is registered by `useServiceWorkerUpdate` (App), only
// in production and with a controlled update: it never takes over a running tab
// on its own.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
