import { useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Legend, Tooltip } from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { apiFetch } from '../api';
import { useStore } from '../store';
import { formatCost, formatPct, timeSince } from '../lib/formatters';
import { escapeHtml } from '../lib/utils';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Legend,
  Tooltip
);

interface AnalyticsData {
  global?: {
    totalTasks?: number;
    successRate?: number;
    totalCost?: number;
  };
  velocity?: {
    avgLast3Days?: number;
    trend?: 'up' | 'down' | 'stable';
    dailyCounts?: Array<{ date: string; count: number }>;
  };
  byModel?: Record<string, { count: number; avgCost: number }>;
}

interface EcosystemData {
  projects?: Array<{
    active_goals?: number;
    running_tasks?: number;
  }>;
}

interface SupervisorData {
  paused?: boolean;
  enabled?: boolean;
  lastCycle?: {
    completed_at?: string;
    started_at?: string;
    cost_usd?: number;
  };
  totalCycles?: number;
}

interface ActivityEvent {
  type: string;
  status?: string;
  title?: string;
  timestamp?: string;
  project?: string;
  detail?: {
    observations?: string;
    actions?: string;
    reasoning?: string;
    error?: string;
    cost_usd?: number;
  };
}

interface ActivityData {
  events?: ActivityEvent[];
}

interface VoiceAnomaly {
  timestamp: string;
  kind: string;
  input_chars?: number;
  output_bytes?: number;
  bytes_per_char?: number;
  floor?: number;
  voice?: string;
  model?: string;
  text_hash?: string;
}

interface VoiceAnomaliesData {
  anomalies?: VoiceAnomaly[];
  total?: number;
}

// Helper to get CSS variable color
function chartColor(name: string): string {
  const style = getComputedStyle(document.documentElement);
  return style.getPropertyValue(`--${name}`).trim();
}

export default function OverviewPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [ecosystem, setEcosystem] = useState<EcosystemData | null>(null);
  const [supervisor, setSupervisor] = useState<SupervisorData | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [voiceAnomalies, setVoiceAnomalies] = useState<VoiceAnomaliesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedActivity, setExpandedActivity] = useState<Set<number>>(new Set());

  const subscribeWs = useStore((state) => state.subscribeWs);

  // Fetch all data
  const fetchData = async () => {
    try {
      // Promise.allSettled — the new /api/voice/anomalies endpoint may be
      // unavailable during deployment lag (server restart pending after a
      // PR lands). Fail-fast Promise.all would dark the entire Overview tab
      // on a single missing endpoint. Each fetch is now independent; missing
      // sections render their empty-state copy.
      const results = await Promise.allSettled([
        apiFetch('/api/analytics'),
        apiFetch('/api/ecosystem'),
        apiFetch('/api/supervisor/status'),
        apiFetch('/api/supervisor/activity?limit=20'),
        apiFetch('/api/voice/anomalies?limit=10'),
      ]);

      const parseJson = async (idx: number): Promise<any | null> => {
        const r = results[idx];
        if (r.status !== 'fulfilled') {
          console.error(`[Overview] fetch #${idx} rejected:`, r.reason);
          return null;
        }
        try { return await r.value.json(); } catch (err) {
          console.error(`[Overview] fetch #${idx} json parse failed:`, err);
          return null;
        }
      };

      const [analyticsData, ecosystemData, supervisorData, activityData, voiceAnomaliesData] =
        await Promise.all([parseJson(0), parseJson(1), parseJson(2), parseJson(3), parseJson(4)]);

      setAnalytics(analyticsData);
      setEcosystem(ecosystemData);
      setSupervisor(supervisorData);
      setActivity(activityData);
      setVoiceAnomalies(voiceAnomaliesData);
    } catch (error) {
      console.error('Failed to fetch overview data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Subscribe to WebSocket events for real-time updates
  useEffect(() => {
    const unsubscribers = [
      subscribeWs('supervisor_cycle', fetchData),
      subscribeWs('supervisor_action', fetchData),
      subscribeWs('task_update', fetchData),
      subscribeWs('goal_update', fetchData),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [subscribeWs]);

  if (loading) {
    return <div className="loading">Loading overview...</div>;
  }

  // Compute derived values
  const g = analytics?.global || {};
  const projects = ecosystem?.projects || [];
  const activeGoals = projects.reduce((sum, p) => sum + (p.active_goals || 0), 0);
  const runningTasks = projects.reduce((sum, p) => sum + (p.running_tasks || 0), 0);
  const velocity = analytics?.velocity || {};
  const trend = velocity.trend || 'stable';
  const trendIcon = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '■';

  // Supervisor status
  const sup = supervisor || {};
  const supStatus = sup.paused ? 'Paused' : sup.enabled ? 'Running' : 'Disabled';
  const supColor = sup.paused ? 'var(--amber)' : sup.enabled ? 'var(--green)' : 'var(--red)';

  // Activity events
  const events = activity?.events || [];

  // Chart: Velocity (7 days)
  const dailyCounts = (velocity.dailyCounts || []).slice().reverse();
  const velocityChartData = {
    labels: dailyCounts.map((d) => d.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Tasks',
        data: dailyCounts.map((d) => d.count || 0),
        borderColor: chartColor('blue'),
        backgroundColor: 'rgba(56, 139, 253, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: chartColor('blue'),
      },
    ],
  };

  const velocityChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
  };

  // Chart: Model Distribution
  const byModel = analytics?.byModel || {};
  const modelLabels = Object.keys(byModel);
  const modelCounts = modelLabels.map((m) => byModel[m].count || 0);
  const modelColors = modelLabels.map((m) =>
    m === 'opus' ? chartColor('purple') :
    m === 'sonnet' ? chartColor('blue') :
    m === 'haiku' ? chartColor('green') : chartColor('text-muted')
  );

  const modelChartData = {
    labels: modelLabels,
    datasets: [
      {
        data: modelCounts,
        backgroundColor: modelColors,
        borderWidth: 0,
      },
    ],
  };

  const modelChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const } },
    cutout: '60%',
  };

  // Chart: Cost by Model
  const modelCosts = modelLabels.map((m) => byModel[m].avgCost || 0);
  const costModelChartData = {
    labels: modelLabels,
    datasets: [
      {
        label: 'Avg Cost/Task',
        data: modelCosts,
        backgroundColor: modelColors.map((c) => c + '80'),
        borderColor: modelColors,
        borderWidth: 1,
      },
    ],
  };

  const costModelChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value: number | string) => '$' + Number(value).toFixed(3),
        },
      },
    },
  };

  // Toggle activity item expansion
  const toggleActivity = (index: number) => {
    const newExpanded = new Set(expandedActivity);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedActivity(newExpanded);
  };

  // Render activity items
  const renderActivityItem = (ev: ActivityEvent, index: number) => {
    const dotType =
      ev.status === 'failed' ? 'failed' :
      ev.type === 'supervisor_cycle' ? 'supervisor' :
      ev.type === 'goal' ? 'goal' :
      ev.type === 'proposal' ? 'proposal' : 'task';
    const title = ev.title || ev.type || '—';
    const time = ev.timestamp ? timeSince(ev.timestamp) : '';
    const isExpanded = expandedActivity.has(index);

    let detail = '';
    if (ev.detail) {
      if (ev.detail.observations) detail += `Observations: ${ev.detail.observations}\n`;
      if (ev.detail.actions) detail += `Actions: ${ev.detail.actions}\n`;
      if (ev.detail.reasoning) detail += `Reasoning: ${ev.detail.reasoning}\n`;
      if (ev.detail.error) detail += `Error: ${ev.detail.error}\n`;
      if (ev.detail.cost_usd) detail += `Cost: ${formatCost(ev.detail.cost_usd)}`;
    }

    return (
      <div
        key={index}
        className={`activity-item ${isExpanded ? 'expanded' : ''}`}
        onClick={() => toggleActivity(index)}
      >
        <div className={`activity-dot ${dotType}`} />
        <div className="activity-body">
          <div className="activity-title">{escapeHtml(title)}</div>
          <div className="activity-meta">
            {ev.type}
            {ev.status ? ` · ${ev.status}` : ''}
            {` · ${time}`}
            {ev.project ? ` · ${escapeHtml(ev.project.split('/').pop() || '')}` : ''}
          </div>
          {detail && (
            <div className="activity-detail">{escapeHtml(detail.trim())}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fade-in">
      {/* Stat Cards Row */}
      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-label">Total Tasks</span>
          <span className="stat-value">{g.totalTasks || 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Success Rate</span>
          <span className="stat-value">{formatPct(g.successRate || 0)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Cost</span>
          <span className="stat-value">{formatCost(g.totalCost || 0)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Goals</span>
          <span className="stat-value">{activeGoals}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Running Now</span>
          <span
            className={`stat-value ${runningTasks > 0 ? 'pulse' : ''}`}
            style={{ color: runningTasks > 0 ? 'var(--cyan)' : 'var(--text-heading)' }}
          >
            {runningTasks}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Velocity</span>
          <span className="stat-value">
            <span className={`stat-change ${trend}`}>{trendIcon}</span>{' '}
            {(velocity.avgLast3Days || 0).toFixed(1)}/day
          </span>
        </div>
      </div>

      {/* Charts Row 1: Velocity + Model Distribution */}
      <div className="chart-row">
        <div className="chart-container">
          <div className="chart-title">Task Velocity (7 Days)</div>
          <div className="chart-canvas-wrap">
            <Line data={velocityChartData} options={velocityChartOptions} />
          </div>
        </div>
        <div className="chart-container">
          <div className="chart-title">Model Distribution</div>
          <div className="chart-canvas-wrap">
            <Doughnut data={modelChartData} options={modelChartOptions} />
          </div>
        </div>
      </div>

      {/* Charts Row 2: Supervisor Status + Cost by Model */}
      <div className="chart-row">
        <div className="admin-card">
          <h2>Supervisor</h2>
          <div className="detail-grid">
            <div className="detail-field">
              <span className="label">Status</span>
              <span className="value" style={{ color: supColor }}>
                {supStatus}
              </span>
            </div>
            <div className="detail-field">
              <span className="label">Last Cycle</span>
              <span className="value">
                {sup.lastCycle
                  ? timeSince(sup.lastCycle.completed_at || sup.lastCycle.started_at || '')
                  : 'Never'}
              </span>
            </div>
            <div className="detail-field">
              <span className="label">Total Cycles</span>
              <span className="value">{sup.totalCycles || 0}</span>
            </div>
            <div className="detail-field">
              <span className="label">Cycle Cost</span>
              <span className="value">
                {sup.lastCycle ? formatCost(sup.lastCycle.cost_usd || 0) : '—'}
              </span>
            </div>
          </div>
        </div>
        <div className="admin-card">
          <h2>Cost by Model</h2>
          <div className="chart-canvas-wrap">
            <Bar data={costModelChartData} options={costModelChartOptions} />
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="admin-card">
        <h2>Recent Activity</h2>
        <div className="activity-list">
          {events.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px' }}>
              No recent activity
            </p>
          ) : (
            events.map(renderActivityItem)
          )}
        </div>
      </div>

      {/* Voice Anomalies (recent TTS truncations / refusals) */}
      <div className="admin-card">
        <h2>Voice Anomalies</h2>
        {voiceAnomalies && voiceAnomalies.anomalies && voiceAnomalies.anomalies.length > 0 ? (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '0 12px 8px' }}>
              {voiceAnomalies.total} total · showing {voiceAnomalies.anomalies.length} most recent
            </p>
            <div className="activity-list">
              {voiceAnomalies.anomalies.map((a, i) => (
                <div key={i} className="activity-item">
                  <div className="activity-dot failed" />
                  <div className="activity-body">
                    <div className="activity-title">
                      {a.kind || 'anomaly'}
                      {a.bytes_per_char !== undefined && a.floor !== undefined &&
                        ` · ${a.bytes_per_char} bytes/char (floor ${a.floor})`}
                    </div>
                    <div className="activity-meta">
                      {a.timestamp ? timeSince(a.timestamp) : ''}
                      {a.voice ? ` · ${a.voice}` : ''}
                      {a.model ? ` · ${a.model}` : ''}
                      {a.input_chars !== undefined ? ` · ${a.input_chars} chars in` : ''}
                      {a.output_bytes !== undefined ? ` · ${a.output_bytes}B out` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px' }}>
            No voice anomalies recorded
          </p>
        )}
      </div>
    </div>
  );
}
