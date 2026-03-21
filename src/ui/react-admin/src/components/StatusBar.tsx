import { useState, useEffect } from 'react';
import './StatusBar.css';

export default function StatusBar() {
  const [connected, _setConnected] = useState(false);
  const [statusInfo, _setStatusInfo] = useState('');

  useEffect(() => {
    // Connection status check logic will be added later
    // For now, just show "Connecting..."
  }, []);

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
