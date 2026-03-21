import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  Filler,
  Legend,
  Tooltip,
} from 'chart.js';
import { Line, Radar } from 'react-chartjs-2';
import { apiFetch } from '../api';
import { formatCost, formatPct, formatDate } from '../lib/formatters';
import MarkdownRenderer from '../components/shared/MarkdownRenderer';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadialLinearScale,
  Filler,
  Legend,
  Tooltip
);

interface ByModelStats {
  count: number;
  successRate: number;
  avgCost: number;
  avgTurns?: number;
  avgDuration?: number;
}

interface AnalyticsData {
  byModel?: Record<string, ByModelStats>;
  velocity?: {
    dailyCounts?: Array<{ date: string; count: number }>;
  };
  suggestions?: Array<{
    project?: string;
    taskType: string;
    currentModel: string;
    suggestedModel: string;
    savingsPerTask: number;
    cheapSuccessRate: number;
    sampleSize: number;
  }>;
}

interface DigestTask {
  id: number;
  title: string;
  project: string;
  status: string;
  cost: number;
  commit_sha?: string;
  result?: string;
}

interface Digest {
  id: number;
  period_start: string;
  task_count?: number;
  total_cost?: number;
  digest_text?: string;
  digest_json?: string | { tasks?: DigestTask[] };
}

interface WeeklyTask {
  id: number;
  title: string;
  status: string;
  cost: number;
  commit_sha?: string;
  result?: string;
}

interface WeeklyProject {
  name: string;
  cost: number;
  tasks?: WeeklyTask[];
}

interface WeeklyReport {
  id: number;
  week_start: string;
  week_end: string;
  task_count?: number;
  total_cost?: number;
  report_text?: string;
  report_tasks_json?: string | { projects?: WeeklyProject[] };
}

export default function ReportsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [latestDigest, setLatestDigest] = useState<Digest | null>(null);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [latestWeekly, setLatestWeekly] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<'digest' | 'weekly' | null>(null);

  // Expansion state
  const [expandedDigestTasks, setExpandedDigestTasks] = useState(false);
  const [expandedDigestTaskIds, setExpandedDigestTaskIds] = useState<Set<number>>(new Set());
  const [expandedWeeklyTasks, setExpandedWeeklyTasks] = useState(false);
  const [expandedWeeklyTaskIds, setExpandedWeeklyTaskIds] = useState<Set<number>>(new Set());

  // Detail view state
  const [viewingDigest, setViewingDigest] = useState<Digest | null>(null);
  const [viewingExpandedTasks, setViewingExpandedTasks] = useState(false);
  const [viewingExpandedTaskIds, setViewingExpandedTaskIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [digestRes, digestsRes, weeklyRes, weekliesRes, analyticsRes] = await Promise.all([
        apiFetch('/api/digest/latest'),
        apiFetch('/api/digests'),
        apiFetch('/api/weekly-report/latest'),
        apiFetch('/api/weekly-reports'),
        apiFetch('/api/analytics'),
      ]);

      const digestData = await digestRes.json();
      const digestsData = await digestsRes.json();
      const weeklyData = await weeklyRes.json();
      const weekliesData = await weekliesRes.json();
      const analyticsData = await analyticsRes.json();

      setLatestDigest(digestData.digest || null);
      setDigests(digestsData.digests || []);
      setLatestWeekly(weeklyData.report || null);
      setWeeklies(weekliesData.reports || []);
      setAnalytics(analyticsData);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateDigest() {
    setGenerating('digest');
    try {
      await apiFetch('/api/digest/generate', { method: 'POST' });
      setTimeout(() => {
        loadData();
        setGenerating(null);
      }, 1000);
    } catch (err) {
      console.error('Failed to generate digest:', err);
      setGenerating(null);
    }
  }

  async function handleGenerateWeekly() {
    setGenerating('weekly');
    try {
      await apiFetch('/api/weekly-report/generate', { method: 'POST' });
      setTimeout(() => {
        loadData();
        setGenerating(null);
      }, 1000);
    } catch (err) {
      console.error('Failed to generate weekly:', err);
      setGenerating(null);
    }
  }

  async function handleViewDigest(id: number) {
    try {
      const res = await apiFetch(`/api/digest/${id}`);
      const data = await res.json();
      if (data.digest) {
        setViewingDigest(data.digest);
        setViewingExpandedTasks(false);
        setViewingExpandedTaskIds(new Set());
      }
    } catch (err) {
      console.error('Failed to load digest detail:', err);
    }
  }

  function handleBackToList() {
    setViewingDigest(null);
    setViewingExpandedTasks(false);
    setViewingExpandedTaskIds(new Set());
  }

  function toggleDigestTaskExpanded(taskId: number) {
    const newSet = new Set(expandedDigestTaskIds);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      newSet.add(taskId);
    }
    setExpandedDigestTaskIds(newSet);
  }

  function toggleWeeklyTaskExpanded(taskId: number) {
    const newSet = new Set(expandedWeeklyTaskIds);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      newSet.add(taskId);
    }
    setExpandedWeeklyTaskIds(newSet);
  }

  function toggleViewingTaskExpanded(taskId: number) {
    const newSet = new Set(viewingExpandedTaskIds);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      newSet.add(taskId);
    }
    setViewingExpandedTaskIds(newSet);
  }

  // Parse digest JSON
  function parseDigestTasks(digest: Digest | null): DigestTask[] {
    if (!digest) return [];
    const json =
      typeof digest.digest_json === 'string'
        ? JSON.parse(digest.digest_json)
        : digest.digest_json;
    return json?.tasks || [];
  }

  // Parse weekly JSON
  function parseWeeklyProjects(weekly: WeeklyReport | null): WeeklyProject[] {
    if (!weekly) return [];
    const json =
      typeof weekly.report_tasks_json === 'string'
        ? JSON.parse(weekly.report_tasks_json)
        : weekly.report_tasks_json;
    return json?.projects || [];
  }

  if (loading) {
    return (
      <div className="loading">
        Loading reports...
      </div>
    );
  }

  // If viewing a specific digest detail
  if (viewingDigest) {
    const tasks = parseDigestTasks(viewingDigest);
    return (
      <div className="fade-in">
        <div style={{ marginBottom: 12 }}>
          <button className="admin-btn admin-btn-sm" onClick={handleBackToList}>
            ← Back to Reports
          </button>
        </div>
        <div className="admin-card">
          <h2>Digest: {formatDate(viewingDigest.period_start)}</h2>
          <div className="activity-meta" style={{ marginBottom: 12 }}>
            {viewingDigest.task_count || 0} tasks · {formatCost(viewingDigest.total_cost || 0)}
          </div>
          <div className="report-content">{viewingDigest.digest_text || ''}</div>

          {tasks.length > 0 && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <button
                className="admin-btn admin-btn-sm"
                style={{ marginBottom: 12 }}
                onClick={() => setViewingExpandedTasks(!viewingExpandedTasks)}
              >
                <span>{viewingExpandedTasks ? '▼' : '▶'}</span>
                Show {tasks.length} tasks
              </button>
              {viewingExpandedTasks && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {tasks.map((task) => {
                    const expanded = viewingExpandedTaskIds.has(task.id);
                    const commitDisplay = task.commit_sha
                      ? task.commit_sha.slice(0, 7)
                      : '—';
                    const borderColor = task.status === 'done' ? '#10b981' : '#ef4444';
                    return (
                      <div
                        key={task.id}
                        style={{
                          marginBottom: 12,
                          padding: 10,
                          background: 'var(--bg-input)',
                          borderRadius: 6,
                          borderLeft: `3px solid ${borderColor}`,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500, marginBottom: 2 }}>
                              {task.title}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {task.project} · {task.status === 'done' ? '✓ Done' : '✗ Failed'} ·{' '}
                              {formatCost(task.cost)} · Commit:{' '}
                              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                {commitDisplay}
                              </span>
                            </div>
                          </div>
                          <button
                            className="admin-btn admin-btn-xs"
                            onClick={() => toggleViewingTaskExpanded(task.id)}
                            style={{ padding: '2px 8px', fontSize: 11 }}
                          >
                            {expanded ? '▼' : '▶'}
                          </button>
                        </div>
                        {expanded && (
                          <div
                            style={{
                              marginTop: 10,
                              padding: 10,
                              background: 'var(--bg-subtle)',
                              borderRadius: 4,
                              borderLeft: '2px solid var(--border-subtle)',
                            }}
                          >
                            <div className="report-content" style={{ margin: 0 }}>
                              <MarkdownRenderer content={task.result || '*No result captured*'} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main reports view
  const modelLabels = Object.keys(analytics?.byModel || {});
  const dailyCounts = (analytics?.velocity?.dailyCounts || []).slice().reverse();

  // Velocity chart data
  const velocityChartData = {
    labels: dailyCounts.map((d) => d.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Tasks/Day',
        data: dailyCounts.map((d) => d.count || 0),
        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
        backgroundColor: 'rgba(56, 139, 253, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      },
    ],
  };

  const velocityChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
  };

  // Radar chart data
  const maxCost =
    modelLabels.length > 0
      ? Math.max(...modelLabels.map((m) => analytics?.byModel?.[m].avgCost || 0), 0.001)
      : 0.001;
  const maxTurns =
    modelLabels.length > 0
      ? Math.max(...modelLabels.map((m) => analytics?.byModel?.[m].avgTurns || 0), 1)
      : 1;

  const radarChartData = {
    labels: ['Success Rate', 'Cost Efficiency', 'Turn Efficiency'],
    datasets: modelLabels.map((m) => {
      const stats = analytics?.byModel?.[m];
      let color = '#10b981'; // green
      if (m === 'opus') color = '#b392f0'; // purple
      else if (m === 'sonnet') color = '#388bfd'; // blue

      return {
        label: m,
        data: [
          (stats?.successRate || 0) * 100,
          (1 - (stats?.avgCost || 0) / maxCost) * 100,
          (1 - (stats?.avgTurns || 0) / maxTurns) * 100,
        ],
        borderColor: color,
        backgroundColor: color + '20',
        pointRadius: 3,
      };
    }),
  };

  const radarChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const } },
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        ticks: { display: false },
        grid: { color: 'rgba(48, 54, 61, 0.2)' },
      },
    },
  };

  const latestDigestTasks = parseDigestTasks(latestDigest);
  const weeklyProjects = parseWeeklyProjects(latestWeekly);
  const totalWeeklyTasks = weeklyProjects.reduce(
    (sum, p) => sum + (p.tasks?.length || 0),
    0
  );

  return (
    <div className="fade-in">
      {/* Header actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className="admin-btn admin-btn-sm"
          onClick={handleGenerateDigest}
          disabled={generating === 'digest'}
        >
          {generating === 'digest' ? 'Generating...' : 'Generate Digest'}
        </button>
        <button
          className="admin-btn admin-btn-sm"
          onClick={handleGenerateWeekly}
          disabled={generating === 'weekly'}
        >
          {generating === 'weekly' ? 'Generating...' : 'Generate Weekly'}
        </button>
      </div>

      {/* Charts row */}
      <div className="chart-row">
        <div className="chart-container">
          <div className="chart-title">Task Velocity</div>
          <div className="chart-canvas-wrap">
            <Line data={velocityChartData} options={velocityChartOptions} />
          </div>
        </div>
        <div className="chart-container">
          <div className="chart-title">Model Efficiency</div>
          <div className="chart-canvas-wrap">
            {modelLabels.length > 0 ? (
              <Radar data={radarChartData} options={radarChartOptions} />
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                No model data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Model comparison table */}
      {modelLabels.length > 0 && (
        <div className="admin-card">
          <h2>Model Comparison</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Tasks</th>
                <th>Success Rate</th>
                <th>Avg Cost</th>
                <th>Avg Turns</th>
                <th>Avg Duration</th>
              </tr>
            </thead>
            <tbody>
              {modelLabels.map((m) => {
                const s = analytics?.byModel?.[m];
                if (!s) return null;
                return (
                  <tr key={m}>
                    <td>
                      <strong>{m}</strong>
                    </td>
                    <td className="num">{s.count}</td>
                    <td className="num">{formatPct(s.successRate)}</td>
                    <td className="num">{formatCost(s.avgCost)}</td>
                    <td className="num">{(s.avgTurns || 0).toFixed(1)}</td>
                    <td className="num">
                      {s.avgDuration ? Math.round(s.avgDuration) + 's' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Cost optimisation suggestions */}
      {analytics?.suggestions && analytics.suggestions.length > 0 && (
        <div className="admin-card">
          <h2>Cost Optimisation Suggestions</h2>
          {analytics.suggestions.map((s, i) => {
            const projectName = s.project?.split('/').pop() || '';
            const currentModelClass =
              s.currentModel === 'opus' ? 'strategic' : 'improvement';
            const suggestedModelClass =
              s.suggestedModel === 'haiku' ? 'opportunity' : 'improvement';
            return (
              <div
                key={i}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 13,
                }}
              >
                <strong>{projectName}</strong> ({s.taskType}): Switch{' '}
                <span className={`badge badge-${currentModelClass}`}>
                  {s.currentModel}
                </span>{' '}
                to{' '}
                <span className={`badge badge-${suggestedModelClass}`}>
                  {s.suggestedModel}
                </span>{' '}
                — save {formatCost(s.savingsPerTask)}/task (
                {formatPct(s.cheapSuccessRate)} success, n={s.sampleSize})
              </div>
            );
          })}
        </div>
      )}

      {/* Latest daily digest */}
      <div className="admin-card">
        <h2>Latest Daily Digest</h2>
        {latestDigest ? (
          <>
            <div className="activity-meta" style={{ marginBottom: 8 }}>
              {formatDate(latestDigest.period_start)} — {latestDigest.task_count || 0} tasks,{' '}
              {formatCost(latestDigest.total_cost || 0)}
            </div>
            <div className="report-content">{latestDigest.digest_text || 'No content'}</div>

            {latestDigestTasks.length > 0 && (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  className="admin-btn admin-btn-sm"
                  style={{ marginBottom: 12 }}
                  onClick={() => setExpandedDigestTasks(!expandedDigestTasks)}
                >
                  <span>{expandedDigestTasks ? '▼' : '▶'}</span>
                  Show {latestDigestTasks.length} tasks
                </button>
                {expandedDigestTasks && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {latestDigestTasks.map((task) => {
                      const expanded = expandedDigestTaskIds.has(task.id);
                      const commitDisplay = task.commit_sha
                        ? task.commit_sha.slice(0, 7)
                        : '—';
                      const borderColor =
                        task.status === 'done' ? '#10b981' : '#ef4444';
                      return (
                        <div
                          key={task.id}
                          style={{
                            marginBottom: 12,
                            padding: 10,
                            background: 'var(--bg-input)',
                            borderRadius: 6,
                            borderLeft: `3px solid ${borderColor}`,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              marginBottom: 8,
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 500, marginBottom: 2 }}>
                                {task.title}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {task.project} ·{' '}
                                {task.status === 'done' ? '✓ Done' : '✗ Failed'} ·{' '}
                                {formatCost(task.cost)} · Commit:{' '}
                                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                  {commitDisplay}
                                </span>
                              </div>
                            </div>
                            <button
                              className="admin-btn admin-btn-xs"
                              onClick={() => toggleDigestTaskExpanded(task.id)}
                              style={{ padding: '2px 8px', fontSize: 11 }}
                            >
                              {expanded ? '▼' : '▶'}
                            </button>
                          </div>
                          {expanded && (
                            <div
                              style={{
                                marginTop: 10,
                                padding: 10,
                                background: 'var(--bg-subtle)',
                                borderRadius: 4,
                                borderLeft: '2px solid var(--border-subtle)',
                              }}
                            >
                              <div className="report-content" style={{ margin: 0 }}>
                                <MarkdownRenderer
                                  content={task.result || '*No result captured*'}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>
            No digest available. Click "Generate Digest" to create one.
          </p>
        )}
      </div>

      {/* Digest history */}
      {digests.length > 1 && (
        <div className="admin-card">
          <h2>Digest History</h2>
          <div className="report-history-list">
            {digests.slice(0, 10).map((d) => (
              <div
                key={d.id}
                className="report-history-item"
                onClick={() => handleViewDigest(d.id)}
              >
                <span>
                  {formatDate(d.period_start)} — {d.task_count || 0} tasks
                </span>
                <span>{formatCost(d.total_cost || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest weekly report */}
      <div className="admin-card">
        <h2>Latest Weekly Report</h2>
        {latestWeekly ? (
          <>
            <div className="activity-meta" style={{ marginBottom: 8 }}>
              {formatDate(latestWeekly.week_start)} — {formatDate(latestWeekly.week_end)} ·{' '}
              {latestWeekly.task_count || 0} tasks, {formatCost(latestWeekly.total_cost || 0)}
            </div>
            <div className="report-content">{latestWeekly.report_text || 'No content'}</div>

            {totalWeeklyTasks > 0 && (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  className="admin-btn admin-btn-sm"
                  style={{ marginBottom: 12 }}
                  onClick={() => setExpandedWeeklyTasks(!expandedWeeklyTasks)}
                >
                  <span>{expandedWeeklyTasks ? '▼' : '▶'}</span>
                  Show {totalWeeklyTasks} tasks across {weeklyProjects.length} projects
                </button>
                {expandedWeeklyTasks && (
                  <div>
                    {weeklyProjects.map((proj) => {
                      const projectTasks = proj.tasks || [];
                      return (
                        <div key={proj.name} style={{ marginBottom: 16 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              color: 'var(--text-heading)',
                              marginBottom: 8,
                              padding: '8px 0',
                              borderBottom: '1px solid var(--border-subtle)',
                            }}
                          >
                            {proj.name} · {projectTasks.length} tasks ·{' '}
                            {formatCost(proj.cost)}
                          </div>

                          {projectTasks.map((task) => {
                            const expanded = expandedWeeklyTaskIds.has(task.id);
                            const commitDisplay = task.commit_sha
                              ? task.commit_sha.slice(0, 7)
                              : '—';
                            const borderColor =
                              task.status === 'done' ? '#10b981' : '#ef4444';
                            return (
                              <div
                                key={task.id}
                                style={{
                                  marginBottom: 10,
                                  padding: 10,
                                  background: 'var(--bg-input)',
                                  borderRadius: 6,
                                  borderLeft: `3px solid ${borderColor}`,
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                    marginBottom: 8,
                                  }}
                                >
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 500, marginBottom: 2 }}>
                                      {task.title}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                      {task.status === 'done' ? '✓ Done' : '✗ Failed'} ·{' '}
                                      {formatCost(task.cost)} · Commit:{' '}
                                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                        {commitDisplay}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    className="admin-btn admin-btn-xs"
                                    onClick={() => toggleWeeklyTaskExpanded(task.id)}
                                    style={{ padding: '2px 8px', fontSize: 11 }}
                                  >
                                    {expanded ? '▼' : '▶'}
                                  </button>
                                </div>
                                {expanded && (
                                  <div
                                    style={{
                                      marginTop: 10,
                                      padding: 10,
                                      background: 'var(--bg-subtle)',
                                      borderRadius: 4,
                                      borderLeft: '2px solid var(--border-subtle)',
                                    }}
                                  >
                                    <div className="report-content" style={{ margin: 0 }}>
                                      <MarkdownRenderer
                                        content={task.result || '*No result captured*'}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>
            No weekly report available. Click "Generate Weekly" to create one.
          </p>
        )}
      </div>
    </div>
  );
}
