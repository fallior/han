import { useEffect, useState } from 'react';
import { useWorkshopStore } from '../../store/workshopStore';
import { fetchJemmaStatus, type JemmaStatus, type JemmaMessage } from '../../lib/api';

/**
 * JemmaView Component
 *
 * Special view for the Jemma persona that displays Discord message routing
 * data instead of standard conversation threads.
 *
 * Two tabs:
 * - Messages: Recent Discord messages with classification results
 * - Stats: Connection status and delivery statistics
 */
export function JemmaView() {
  const { nestedTab } = useWorkshopStore();
  const [data, setData] = useState<JemmaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch Jemma status on mount and when nested tab changes
  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      setError(null);

      try {
        const status = await fetchJemmaStatus();
        if (!cancelled) {
          setData(status);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load Jemma status');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetch();

    return () => {
      cancelled = true;
    };
  }, [nestedTab]);

  if (loading) {
    return (
      <div style={{ flex: 1, padding: '20px', textAlign: 'center', color: 'var(--color-muted-fg)', fontSize: '13px' }}>
        Loading Jemma status...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, padding: '20px', color: 'var(--red)', fontSize: '12px' }}>
        Error loading Jemma status: {error}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
      {nestedTab === 'jemma-messages' && <MessagesTab messages={data.recent_messages} />}
      {nestedTab === 'jemma-stats' && <StatsTab data={data} />}
    </div>
  );
}

// ============================================================================
// Messages Tab
// ============================================================================

interface MessagesTabProps {
  messages: JemmaMessage[];
}

function MessagesTab({ messages }: MessagesTabProps) {
  if (!messages || messages.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-muted-fg)' }}>
        No recent messages
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {messages.slice(0, 50).map((msg, idx) => (
        <MessageCard key={idx} message={msg} />
      ))}
    </div>
  );
}

interface MessageCardProps {
  message: JemmaMessage;
}

function MessageCard({ message }: MessageCardProps) {
  const confidence = Math.round(message.confidence * 100);
  const timestamp = new Date(message.timestamp).toLocaleString();
  const preview = message.message.length > 200
    ? message.message.substring(0, 200)
    : message.message;

  return (
    <div
      className="admin-card"
      style={{
        padding: '12px',
        borderLeft: '3px solid var(--amber)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '12px' }}>
        {/* Message content */}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--color-fg)' }}>
            {message.author}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-muted-fg)', marginTop: '2px' }}>
            #{message.channel}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-fg)', marginTop: '6px', lineHeight: 1.4 }}>
            {preview}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-muted-fg)', marginTop: '6px' }}>
            {timestamp}
          </div>
        </div>

        {/* Metadata badges */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
          <span
            style={{
              background: 'var(--amber)',
              color: '#000',
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              fontWeight: 600,
              textTransform: 'capitalize',
            }}
          >
            {message.recipient}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--color-muted-fg)' }}>
            {confidence}% confident
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Stats Tab
// ============================================================================

interface StatsTabProps {
  data: JemmaStatus;
}

function StatsTab({ data }: StatsTabProps) {
  const uptime = data.uptime_seconds ? Math.floor(data.uptime_seconds / 60) : 0;
  const lastReconciliation = data.last_reconciliation
    ? new Date(data.last_reconciliation).toLocaleString()
    : 'Never';
  const gatewayStatus = data.status || 'unknown';
  const stats = data.delivery_stats || {};

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {/* Connection Status */}
      <div className="admin-card" style={{ padding: '16px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--color-fg)', marginBottom: '12px' }}>
          Connection Status
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <div style={{ padding: '10px', background: 'var(--color-card)', borderRadius: '4px', borderLeft: '3px solid var(--amber)' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-muted-fg)' }}>Status</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-fg)', marginTop: '4px' }}>
              {gatewayStatus === 'connected' ? '🟢 Connected' : `🔴 ${gatewayStatus}`}
            </div>
          </div>
          <div style={{ padding: '10px', background: 'var(--color-card)', borderRadius: '4px', borderLeft: '3px solid var(--amber)' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-muted-fg)' }}>Uptime</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-fg)', marginTop: '4px' }}>
              {uptime} min
            </div>
          </div>
        </div>
      </div>

      {/* Delivery Statistics */}
      <div className="admin-card" style={{ padding: '16px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--color-fg)', marginBottom: '12px' }}>
          Delivery Statistics
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {['jim', 'leo', 'darron', 'sevn', 'six', 'ignored'].map((recipient) => {
            const count = stats[recipient] || 0;
            return (
              <div
                key={recipient}
                style={{
                  padding: '10px',
                  background: 'var(--color-card)',
                  borderRadius: '4px',
                  borderLeft: '3px solid var(--amber)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: 'var(--color-muted-fg)', textTransform: 'capitalize' }}>
                  {recipient}
                </div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-fg)', marginTop: '4px' }}>
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Last Reconciliation */}
      <div className="admin-card" style={{ padding: '16px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--color-fg)', marginBottom: '8px' }}>
          Last Reconciliation Poll
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-muted-fg)' }}>
          {lastReconciliation}
        </div>
      </div>
    </div>
  );
}
