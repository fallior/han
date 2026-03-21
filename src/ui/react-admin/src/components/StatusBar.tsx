import { useState } from 'react';
import './StatusBar.css';

export default function StatusBar() {
  const [connected] = useState(false);
  const [statusInfo] = useState('');

  return (
    <footer className="status-bar">
      <span id="statusConnection">
        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
        {connected ? 'Connected' : 'Connecting...'}
      </span>
      <span id="statusInfo">{statusInfo}</span>
    </footer>
  );
}
