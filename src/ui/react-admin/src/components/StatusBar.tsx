import { useStore } from '../store';
import './StatusBar.css';

export default function StatusBar() {
  const wsConnected = useStore((state) => state.wsConnected);

  return (
    <footer className="status-bar">
      <span id="statusConnection">
        <span className={`status-dot ${wsConnected ? 'connected' : 'disconnected'}`}></span>
        {wsConnected ? 'Connected' : 'Connecting...'}
      </span>
      <span id="statusInfo"></span>
    </footer>
  );
}
