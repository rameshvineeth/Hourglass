import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StorageService } from './services/storage-service';
import './index.css';

// Prevent desktop app from zooming via Ctrl+wheel or Ctrl+/-
window.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  },
  { passive: false }
);

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (
    e.ctrlKey &&
    (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '_' || e.key === '0')
  ) {
    e.preventDefault();
  }
});

const root=ReactDOM.createRoot(document.getElementById('root')!);
root.render(<p className="p-8">Opening your local workspace…</p>);
StorageService.initialize().then(()=>root.render(<React.StrictMode><App /></React.StrictMode>)).catch(error=>root.render(<main className="p-8"><h1>Workspace could not be opened</h1><p role="alert">{String(error)}</p><p>Your existing data has not been cleared. Reopen the Windows companion or restore access to browser storage, then reload.</p><button onClick={()=>location.reload()}>Retry</button></main>));
