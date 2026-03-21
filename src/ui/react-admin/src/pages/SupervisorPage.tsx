import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { apiFetch } from '../api';
import { Chart } from 'chart.js/auto';

// ── Types ────────────────────────────────────────────────────

interface SupervisorStatus {
  enabled: boolean;
  paused: boolean;
  totalCycles: number;
  lastCycle?: {
    started_at: string;
    completed_at: string;
  };
}

interface Cycle {
  id: string;
  cycle_number: number;
  started_at: string;
  completed_at?: string;
  reasoning?: string;
  actions_taken?: string;
  observations?: string;
  cost_usd?: number;
  num_turns?: number;
  error?: string;
}

interface Proposal {
  id: string;
  title: string;
  description: string;
  category: string;
  status: 'pending' | 'approved' | 'dismissed';
  supervisor_reasoning?: string;
  project_path?: string;
  estimated_effort?: string;
  created_at: string;
  reviewed_at?: string;
}

interface HealthData {
  success: boolean;
  jim?: {
    status: 'ok' | 'stale' | 'down' | 'distressed';
    timestamp: string;
    cycle?: number;
    uptimeMinutes: number;
  };
  leo?: {
    status: 'ok' | 'stale' | 'down' | 'distressed';
    timestamp: string;
    beat?: number;
    beatType?: string;
    uptimeMinutes: number;
  };
  jemma?: {
    status: 'ok' | 'stale' | 'down' | 'distressed';
    timestamp: string;
    gatewayConnected: boolean;
    uptimeMinutes: number;
  };
  distress?: {
    jim?: { reason: string; ageMinutes: number };
    leo?: { reason: string; ageMinutes: number };
    jemma?: { reason: string; ageMinutes: number };
  };
  resurrections?: Array<{
    timestamp: string;
    resurrector: string;
    target: string;
    reason: string;
    success: boolean;
  }>;
  systemUptimeMinutes?: number;
}

// ── Utility Functions ────────────────────────────────────────

function formatDistressAge(minutes: number): string {
  if (minutes < 1) return 'Just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 1) return '1 hour ago';
  if (mins === 0) return `${hours} hours ago`;
  return `${hours}h ${mins}m ago`;
}

function getStatusColor(status: 'ok' | 'stale' | 'down' | 'distressed' | null): string {
  if (!status) return 'var(--text-dim)';
  if (status === 'ok') return 'var(--green)';
  if (status === 'distressed') return 'var(--amber)';
  if (status === 'stale') return 'var(--amber)';
  return 'var(--red)';
}

function StatusBadge({ status }: { status: 'ok' | 'stale' | 'down' | 'distressed' | null }) {
  if (!status) return <span>—</span>;
  const labels = { ok: 'Ok', stale: 'Stale', down: 'Down', distressed: 'Degraded' };
  const color = getStatusColor(status);

  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '4px',
      background: `${color}20`,
      color,
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase'
    }}>
      {labels[status]}
    </span>
  );
}

function timeSince(iso: string): string {
  if (!iso) return '—';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function categoryBadge(cat: string): string {
  return `<span class="badge badge-${cat}">${cat}</span>`;
}

// ── Components ───────────────────────────────────────────────

function HealthPanel({ health }: { health: HealthData | null }) {
  const [showHistory, setShowHistory] = useState(false);

  if (!health || !health.success || (!health.jim && !health.leo)) {
    return null;
  }

  const { jim, leo, jemma, distress, resurrections = [], systemUptimeMinutes = 0 } = health;

  return (
    <div className="admin-card" style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ margin: 0 }}>System Health</h2>
        <button
          className="admin-btn admin-btn-sm"
          onClick={() => setShowHistory(!showHistory)}
          style={{ fontSize: '12px' }}
        >
          <span>{showHistory ? '▲' : '▼'}</span> History
        </button>
      </div>

      {/* Distress Alerts */}
      {distress?.jim && (
        <div className="distress-alert">
          <span className="distress-alert-icon">⚠</span>
          <div>
            <div className="distress-alert-title">Jim Degraded</div>
            <div className="distress-alert-reason">{distress.jim.reason || 'Unknown issue'}</div>
            <div className="distress-alert-time">{formatDistressAge(distress.jim.ageMinutes)}</div>
          </div>
        </div>
      )}

      {distress?.leo && (
        <div className="distress-alert">
          <span className="distress-alert-icon">⚠</span>
          <div>
            <div className="distress-alert-title">Leo Degraded</div>
            <div className="distress-alert-reason">{distress.leo.reason || 'Unknown issue'}</div>
            <div className="distress-alert-time">{formatDistressAge(distress.leo.ageMinutes)}</div>
          </div>
        </div>
      )}

      {distress?.jemma && (
        <div className="distress-alert">
          <span className="distress-alert-icon">⚠</span>
          <div>
            <div className="distress-alert-title">Jemma Degraded</div>
            <div className="distress-alert-reason">{distress.jemma.reason || 'Unknown issue'}</div>
            <div className="distress-alert-time">{formatDistressAge(distress.jemma.ageMinutes)}</div>
          </div>
        </div>
      )}

      {/* Status Cards Row */}
      <div className="stat-row" style={{ marginBottom: '16px' }}>
        {jim && (
          <div className="stat-card">
            <span className="stat-label">Jim Status</span>
            <div style={{ marginTop: '6px' }}>
              <StatusBadge status={distress?.jim ? 'distressed' : jim.status} />
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px', display: 'block' }}>
              Updated {new Date(jim.timestamp).toLocaleString('en-AU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', display: 'block' }}>
              Cycle #{jim.cycle || '—'}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', display: 'block' }}>
              Uptime: {jim.uptimeMinutes}m
            </span>
          </div>
        )}

        {leo && (
          <div className="stat-card">
            <span className="stat-label">Leo Status</span>
            <div style={{ marginTop: '6px' }}>
              <StatusBadge status={distress?.leo ? 'distressed' : leo.status} />
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px', display: 'block' }}>
              Updated {new Date(leo.timestamp).toLocaleString('en-AU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', display: 'block' }}>
              Beat #{leo.beat || '—'}{leo.beatType ? ` (${leo.beatType})` : ''}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', display: 'block' }}>
              Uptime: {leo.uptimeMinutes}m
            </span>
          </div>
        )}

        {jemma && (
          <div className="stat-card">
            <span className="stat-label">Jemma Status</span>
            <div style={{ marginTop: '6px' }}>
              <StatusBadge status={distress?.jemma ? 'distressed' : jemma.status} />
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px', display: 'block' }}>
              Updated {new Date(jemma.timestamp).toLocaleString('en-AU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', display: 'block' }}>
              Gateway: {jemma.gatewayConnected ? 'Connected' : 'Disconnected'}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', display: 'block' }}>
              Uptime: {jemma.uptimeMinutes}m
            </span>
          </div>
        )}

        <div className="stat-card">
          <span className="stat-label">Server Uptime</span>
          <span className="stat-value" style={{ fontSize: '16px' }}>{systemUptimeMinutes}m</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px', display: 'block' }}>
            {Math.floor(systemUptimeMinutes / 60)}h {systemUptimeMinutes % 60}m
          </span>
        </div>
      </div>

      {/* Resurrection History */}
      {showHistory && resurrections && resurrections.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--text-heading)' }}>
            Resurrection History (Last {Math.min(resurrections.length, 10)})
          </h3>
          <table className="admin-table" style={{ fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Timestamp</th>
                <th style={{ textAlign: 'left' }}>Resurrector</th>
                <th style={{ textAlign: 'left' }}>Target</th>
                <th style={{ textAlign: 'left' }}>Reason</th>
                <th style={{ textAlign: 'center' }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {resurrections.slice(-10).reverse().map((res, idx) => {
                const resultColor = res.success ? 'var(--green)' : 'var(--red)';
                const resultLabel = res.success ? 'Success' : 'Failed';
                return (
                  <tr key={idx}>
                    <td>{new Date(res.timestamp).toLocaleString('en-AU', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td>{res.resurrector || '—'}</td>
                    <td>{res.target || '—'}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {res.reason || '—'}
                    </td>
                    <td style={{ textAlign: 'center', color: resultColor, fontWeight: 600 }}>{resultLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal, onRefresh }: { proposal: Proposal; onRefresh: () => void }) {
  const statusCls = proposal.status === 'approved' ? 'approved' : proposal.status === 'dismissed' ? 'dismissed' : '';

  const handleApprove = async () => {
    await apiFetch(`/api/supervisor/proposals/${proposal.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    onRefresh();
  };

  const handleDismiss = async () => {
    const notes = window.prompt('Dismiss reason (optional):');
    await apiFetch(`/api/supervisor/proposals/${proposal.id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes || '' })
    });
    onRefresh();
  };

  return (
    <div className={`proposal-card ${statusCls}`}>
      <div className="proposal-header">
        <span className="proposal-title">{proposal.title}</span>
        <span dangerouslySetInnerHTML={{ __html: categoryBadge(proposal.category || 'improvement') }} />
      </div>
      <div className="proposal-desc">{proposal.description || ''}</div>
      {proposal.supervisor_reasoning && (
        <div className="proposal-reasoning">{proposal.supervisor_reasoning.slice(0, 300)}</div>
      )}
      <div className="activity-meta">
        {proposal.project_path && `${proposal.project_path.split('/').pop() || ''} · `}
        {proposal.estimated_effort || 'medium'} effort · {timeSince(proposal.created_at)}
        {proposal.status !== 'pending' && ` · ${proposal.status}${proposal.reviewed_at ? ' ' + timeSince(proposal.reviewed_at) : ''}`}
      </div>
      {proposal.status === 'pending' && (
        <div className="proposal-actions">
          <button className="admin-btn admin-btn-success admin-btn-sm" onClick={handleApprove}>
            Approve
          </button>
          <button className="admin-btn admin-btn-sm" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function CycleHistoryTable({ cycles }: { cycles: Cycle[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="admin-card">
      <h2>Cycle History</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Actions</th>
            <th>Observations</th>
            <th>Cost</th>
            <th>Turns</th>
          </tr>
        </thead>
        <tbody>
          {cycles.slice(0, 30).map((c) => {
            const duration = c.started_at && c.completed_at
              ? Math.round((new Date(c.completed_at).getTime() - new Date(c.started_at).getTime()) / 1000) + 's'
              : '—';

            let actions = '—';
            try {
              const a = JSON.parse(c.actions_taken || '[]');
              actions = Array.isArray(a) ? `${a.length} actions` : '—';
            } catch {
              actions = c.actions_taken ? '1 action' : '—';
            }

            let observations = '—';
            try {
              const o = JSON.parse(c.observations || '[]');
              observations = Array.isArray(o) ? `${o.length} obs` : (typeof c.observations === 'string' ? c.observations.slice(0, 60) : '—');
            } catch {
              observations = c.observations ? String(c.observations).slice(0, 60) : '—';
            }

            const isExpanded = expandedId === c.id;

            return (
              <>
                <tr key={c.id} onClick={() => toggleExpand(c.id)}>
                  <td className="num">{c.cycle_number || '—'}</td>
                  <td>{formatDateTime(c.started_at)}</td>
                  <td className="num">{duration}</td>
                  <td>{actions}</td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {observations}
                  </td>
                  <td className="num">{formatCost(c.cost_usd || 0)}</td>
                  <td className="num">{c.num_turns || '—'}</td>
                </tr>
                {isExpanded && (
                  <tr className="cycle-detail-row">
                    <td colSpan={7} style={{ padding: '12px 16px', background: 'var(--bg-page)', borderRadius: '4px' }}>
                      {c.reasoning && (
                        <div style={{ marginBottom: '8px' }}>
                          <strong style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>
                            Reasoning
                          </strong>
                          <div style={{ fontSize: '12px', color: 'var(--text)', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                            {c.reasoning}
                          </div>
                        </div>
                      )}

                      {c.actions_taken && (() => {
                        try {
                          const actions = JSON.parse(c.actions_taken);
                          if (Array.isArray(actions) && actions.length > 0) {
                            return (
                              <div style={{ marginBottom: '8px' }}>
                                <strong style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>
                                  Actions
                                </strong>
                                <div style={{ fontSize: '12px', color: 'var(--text)', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                                  {JSON.stringify(actions, null, 2)}
                                </div>
                              </div>
                            );
                          }
                        } catch {}
                        return null;
                      })()}

                      {c.observations && (() => {
                        try {
                          const obs = JSON.parse(c.observations);
                          if (Array.isArray(obs) && obs.length > 0) {
                            return (
                              <div>
                                <strong style={{ color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase' }}>
                                  Observations
                                </strong>
                                <div style={{ fontSize: '12px', color: 'var(--text)', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                                  {JSON.stringify(obs, null, 2)}
                                </div>
                              </div>
                            );
                          }
                        } catch {}
                        return null;
                      })()}

                      {c.error && (
                        <div style={{ marginTop: '8px', color: 'var(--red)', fontSize: '12px' }}>{c.error}</div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MemoryBanks({ memoryFiles }: { memoryFiles: Record<string, string> }) {
  const [activeTab, setActiveTab] = useState<string>('');

  useEffect(() => {
    const keys = Object.keys(memoryFiles);
    if (keys.length > 0 && !activeTab) {
      setActiveTab(keys[0]);
    }
  }, [memoryFiles, activeTab]);

  const memoryKeys = Object.keys(memoryFiles);
  if (memoryKeys.length === 0) return null;

  return (
    <div className="admin-card">
      <h2>Memory Banks</h2>
      <div className="memory-tabs">
        {memoryKeys.map((k) => (
          <button
            key={k}
            className={`memory-tab ${activeTab === k ? 'active' : ''}`}
            onClick={() => setActiveTab(k)}
          >
            {k.replace('.md', '')}
          </button>
        ))}
      </div>
      <div className="memory-content">{memoryFiles[activeTab] || 'Empty'}</div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

export default function SupervisorPage() {
  const subscribeWs = useStore((state) => state.subscribeWs);

  const [status, setStatus] = useState<SupervisorStatus | null>(null);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [memoryFiles, setMemoryFiles] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const [costChartInstance, setCostChartInstance] = useState<Chart | null>(null);
  const [turnsChartInstance, setTurnsChartInstance] = useState<Chart | null>(null);

  const fetchData = async () => {
    try {
      const [statusRes, cyclesRes, memoryRes, proposalsRes, healthRes] = await Promise.all([
        apiFetch('/api/supervisor/status'),
        apiFetch('/api/supervisor/cycles?limit=50'),
        apiFetch('/api/supervisor/memory'),
        apiFetch('/api/supervisor/proposals'),
        apiFetch('/api/supervisor/health'),
      ]);

      const statusData = await statusRes.json();
      const cyclesData = await cyclesRes.json();
      const memoryData = await memoryRes.json();
      const proposalsData = await proposalsRes.json();
      const healthData = await healthRes.json();

      setStatus(statusData);
      setCycles(cyclesData.cycles || []);
      setMemoryFiles(memoryData.files || {});
      setProposals(proposalsData.proposals || []);
      setHealth(healthData);
    } catch (error) {
      console.error('Error fetching supervisor data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // WebSocket subscriptions
  useEffect(() => {
    const unsubCycle = subscribeWs('supervisor_cycle', () => {
      fetchData();
    });

    const unsubProposal = subscribeWs('strategic_proposal', () => {
      fetchData();
    });

    return () => {
      unsubCycle();
      unsubProposal();
    };
  }, [subscribeWs]);

  // Charts
  useEffect(() => {
    if (cycles.length === 0) return;

    const recentCycles = cycles.slice(0, 30).reverse();

    // Destroy existing charts
    if (costChartInstance) {
      costChartInstance.destroy();
    }
    if (turnsChartInstance) {
      turnsChartInstance.destroy();
    }

    // Cost chart
    const costCanvas = document.getElementById('supervisorCostChart') as HTMLCanvasElement;
    if (costCanvas) {
      const costChart = new Chart(costCanvas, {
        type: 'line',
        data: {
          labels: recentCycles.map((c) => c.cycle_number || ''),
          datasets: [{
            label: 'Cost (USD)',
            data: recentCycles.map((c) => c.cost_usd || 0),
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--purple').trim(),
            backgroundColor: 'rgba(179, 146, 240, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (value) => '$' + (value as number).toFixed(3)
              }
            }
          }
        }
      });
      setCostChartInstance(costChart);
    }

    // Turns chart
    const turnsCanvas = document.getElementById('supervisorTurnsChart') as HTMLCanvasElement;
    if (turnsCanvas) {
      const cyanColor = getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim();
      const turnsChart = new Chart(turnsCanvas, {
        type: 'bar',
        data: {
          labels: recentCycles.map((c) => c.cycle_number || ''),
          datasets: [{
            label: 'Turns',
            data: recentCycles.map((c) => c.num_turns || 0),
            backgroundColor: cyanColor + '60',
            borderColor: cyanColor,
            borderWidth: 1,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1 }
            }
          }
        }
      });
      setTurnsChartInstance(turnsChart);
    }

    return () => {
      if (costChartInstance) costChartInstance.destroy();
      if (turnsChartInstance) turnsChartInstance.destroy();
    };
  }, [cycles]);

  const handleTriggerCycle = async () => {
    await apiFetch('/api/supervisor/trigger', { method: 'POST' });
  };

  const handleTogglePause = async () => {
    await apiFetch('/api/supervisor/pause', { method: 'POST' });
    setTimeout(() => fetchData(), 500);
  };

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <p style={{ color: 'var(--text-dim)' }}>Loading supervisor data...</p>
      </div>
    );
  }

  const pending = proposals.filter((p) => p.status === 'pending');
  const resolved = proposals.filter((p) => p.status !== 'pending');

  const supStatus = status?.paused ? 'Paused' : status?.enabled ? 'Running' : 'Disabled';
  const supColor = status?.paused ? 'var(--amber)' : status?.enabled ? 'var(--green)' : 'var(--red)';

  return (
    <div style={{ padding: '20px' }} className="fade-in">
      {/* Header Actions */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', justifyContent: 'flex-end' }}>
        <button className="admin-btn admin-btn-sm" onClick={handleTogglePause}>
          {status?.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={handleTriggerCycle}>
          Trigger Cycle
        </button>
      </div>

      {/* Health Monitoring Panel */}
      <HealthPanel health={health} />

      {/* Status Cards */}
      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-label">Status</span>
          <span className="stat-value" style={{ fontSize: '18px', color: supColor }}>
            {supStatus}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Cycles</span>
          <span className="stat-value">{status?.totalCycles || cycles.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Last Cycle</span>
          <span className="stat-value" style={{ fontSize: '14px' }}>
            {status?.lastCycle ? timeSince(status.lastCycle.completed_at || status.lastCycle.started_at) : 'Never'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pending Proposals</span>
          <span className="stat-value" style={{ color: pending.length > 0 ? 'var(--amber)' : 'var(--text-heading)' }}>
            {pending.length}
          </span>
        </div>
      </div>

      {/* Pending Proposals */}
      {pending.length > 0 && (
        <div className="admin-card">
          <h2>Strategic Proposals ({pending.length} Pending)</h2>
          {pending.map((p) => (
            <ProposalCard key={p.id} proposal={p} onRefresh={fetchData} />
          ))}
        </div>
      )}

      {/* Charts */}
      {cycles.length > 0 && (
        <div className="chart-row">
          <div className="chart-container">
            <div className="chart-title">Supervisor Cost per Cycle (Last {Math.min(cycles.length, 30)})</div>
            <div className="chart-canvas-wrap">
              <canvas id="supervisorCostChart"></canvas>
            </div>
          </div>
          <div className="chart-container">
            <div className="chart-title">Turns per Cycle</div>
            <div className="chart-canvas-wrap">
              <canvas id="supervisorTurnsChart"></canvas>
            </div>
          </div>
        </div>
      )}

      {/* Cycle History */}
      <CycleHistoryTable cycles={cycles} />

      {/* Memory Banks */}
      <MemoryBanks memoryFiles={memoryFiles} />

      {/* Resolved Proposals History */}
      {resolved.length > 0 && (
        <div className="admin-card">
          <h2>Proposal History ({resolved.length})</h2>
          {resolved.slice(0, 10).map((p) => (
            <ProposalCard key={p.id} proposal={p} onRefresh={fetchData} />
          ))}
        </div>
      )}
    </div>
  );
}
