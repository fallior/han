import React from 'react';
import { useStore } from '../store';
import './StatusBar.css';

/**
 * Format relative time (e.g. "2 min ago", "1 hour ago")
 * Matches the pattern from admin.ts:445
 */
function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return 'Never';

  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
}

export default function StatusBar() {
  const wsConnected = useStore((state) => state.wsConnected);
  const lastCycleAt = useStore((state) => state.lastCycleAt);

  // Re-render every minute to update relative time
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="status-bar">
      <span id="statusConnection">
        <span className={`status-dot ${wsConnected ? 'connected' : 'disconnected'}`}></span>
        {wsConnected ? 'Connected' : 'Reconnecting...'}
      </span>
      <span id="statusInfo">
        Last cycle: {formatRelativeTime(lastCycleAt)}
      </span>
    </footer>
  );
}
