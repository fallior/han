import { useEffect, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { apiFetch } from '../api';
import { useStore } from '../store';
import { formatCost } from '../lib/formatters';
import { escapeHtml } from '../lib/utils';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface Project {
  name: string;
  path?: string;
  lifecycle?: string;
  total_tasks?: number;
  total_cost?: number;
  active_goals?: number;
  running_tasks?: number;
  ports?: Record<string, number>;
}

interface PortfolioProject {
  name: string;
  priority?: number;
  cost_budget_daily?: number;
  cost_spent_today?: number;
  throttled?: boolean;
}

interface EcosystemData {
  projects?: Project[];
}

interface PortfolioData {
  projects?: PortfolioProject[];
}

function lifecycleBadgeClass(lifecycle?: string): string {
  if (lifecycle === 'active') return 'badge-running';
  if (lifecycle === 'maintained') return 'badge-done';
  return 'badge-pending';
}

function chartColor(name: string): string {
  const colors: Record<string, string> = {
    blue: 'rgb(56, 139, 253)',
    'text-muted': 'rgb(139, 148, 158)',
  };
  return colors[name] || colors['text-muted'];
}

export default function ProjectsPage() {
  const [ecosystem, setEcosystem] = useState<EcosystemData>({});
  const [portfolio, setPortfolio] = useState<PortfolioData>({});
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const subscribeWs = useStore((state) => state.subscribeWs);

  const projects = ecosystem.projects || [];
  const portfolioMap: Record<string, PortfolioProject> = {};
  (portfolio.projects || []).forEach((p) => (portfolioMap[p.name] = p));

  // Fetch data
  async function fetchData() {
    try {
      const [ecosystemRes, portfolioRes] = await Promise.all([
        apiFetch('/api/ecosystem'),
        apiFetch('/api/portfolio'),
      ]);
      setEcosystem(await ecosystemRes.json());
      setPortfolio(await portfolioRes.json());
    } catch (err) {
      console.error('Failed to fetch projects data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    fetchData();
  }, []);

  // WebSocket refresh
  useEffect(() => {
    const handleTaskUpdate = () => fetchData();
    const handleGoalUpdate = () => fetchData();

    subscribe('task_update', handleTaskUpdate);
    subscribe('goal_update', handleGoalUpdate);

    return () => {
      unsubscribe('task_update', handleTaskUpdate);
      unsubscribe('goal_update', handleGoalUpdate);
    };
  }, [subscribe, unsubscribe]);

  // Unthrottle action
  async function handleUnthrottle(projectName: string) {
    try {
      await apiFetch(`/api/portfolio/${encodeURIComponent(projectName)}/unthrottle`, {
        method: 'POST',
      });
      fetchData();
    } catch (err) {
      console.error('Failed to unthrottle project:', err);
    }
  }

  // Toggle selection
  function toggleSelect(projectName: string) {
    setSelectedProject((prev) => (prev === projectName ? null : projectName));
  }

  // Find selected project data
  const selectedProj = selectedProject
    ? projects.find((p) => p.name === selectedProject)
    : null;
  const selectedPf = selectedProject ? portfolioMap[selectedProject] : null;

  // Budget chart data
  const budgetData = projects.filter((p) => {
    const pf = portfolioMap[p.name];
    return pf && pf.cost_budget_daily && pf.cost_budget_daily > 0;
  });

  if (loading) {
    return <div className="loading">Loading projects...</div>;
  }

  return (
    <div className="fade-in">
      {/* Project Grid */}
      <div className="project-grid">
        {projects.map((p) => {
          const pf = portfolioMap[p.name] || {};
          const throttled = pf.throttled;
          const isSelected = selectedProject === p.name;

          return (
            <div
              key={p.name}
              className={`project-card ${isSelected ? 'selected' : ''}`}
              onClick={() => toggleSelect(p.name)}
            >
              <div className="project-card-header">
                <span className="project-card-name">
                  {escapeHtml(p.name)}
                  {throttled && (
                    <span
                      className="badge badge-failed"
                      style={{ fontSize: '9px', marginLeft: '6px' }}
                    >
                      THROTTLED
                    </span>
                  )}
                </span>
                <span className={`badge ${lifecycleBadgeClass(p.lifecycle)}`}>
                  {escapeHtml(p.lifecycle || 'unknown')}
                </span>
              </div>
              <div className="project-card-stats">
                <span>P{pf.priority || 5}</span>
                <span>{p.total_tasks || 0} tasks</span>
                <span>{formatCost(p.total_cost || 0)}</span>
                {p.active_goals ? (
                  <span style={{ color: 'var(--cyan)' }}>{p.active_goals} active</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Panel */}
      {selectedProj && (
        <div className="detail-panel fade-in">
          <h2>{escapeHtml(selectedProj.name)}</h2>
          <div className="detail-grid">
            <div className="detail-field">
              <span className="label">Path</span>
              <span className="value mono" style={{ fontSize: '12px' }}>
                {escapeHtml(selectedProj.path || '')}
              </span>
            </div>
            <div className="detail-field">
              <span className="label">Lifecycle</span>
              <span className="value">{escapeHtml(selectedProj.lifecycle || 'unknown')}</span>
            </div>
            <div className="detail-field">
              <span className="label">Priority</span>
              <span className="value">{selectedPf?.priority || 5}/10</span>
            </div>
            <div className="detail-field">
              <span className="label">Total Tasks</span>
              <span className="value">{selectedProj.total_tasks || 0}</span>
            </div>
            <div className="detail-field">
              <span className="label">Total Cost</span>
              <span className="value">{formatCost(selectedProj.total_cost || 0)}</span>
            </div>
            <div className="detail-field">
              <span className="label">Active Goals</span>
              <span className="value">{selectedProj.active_goals || 0}</span>
            </div>
            <div className="detail-field">
              <span className="label">Daily Budget</span>
              <span className="value">
                {selectedPf?.cost_budget_daily
                  ? formatCost(selectedPf.cost_budget_daily)
                  : 'None'}
              </span>
            </div>
            <div className="detail-field">
              <span className="label">Spent Today</span>
              <span className="value">{formatCost(selectedPf?.cost_spent_today || 0)}</span>
            </div>
            <div className="detail-field">
              <span className="label">Throttled</span>
              <span
                className="value"
                style={{ color: selectedPf?.throttled ? 'var(--red)' : 'var(--green)' }}
              >
                {selectedPf?.throttled ? 'Yes' : 'No'}
              </span>
            </div>
            {selectedProj.ports && (
              <div className="detail-field">
                <span className="label">Ports</span>
                <span className="value mono" style={{ fontSize: '12px' }}>
                  {escapeHtml(JSON.stringify(selectedProj.ports))}
                </span>
              </div>
            )}
          </div>
          {selectedPf?.throttled && (
            <div style={{ marginTop: '12px' }}>
              <button
                className="admin-btn admin-btn-primary admin-btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnthrottle(selectedProj.name);
                }}
              >
                Unthrottle
              </button>
            </div>
          )}
        </div>
      )}

      {/* Budget Utilisation Chart */}
      {budgetData.length > 0 && (
        <div className="chart-container">
          <div className="chart-title">Budget Utilisation</div>
          <div className="chart-canvas-wrap">
            <Bar
              data={{
                labels: budgetData.map((p) => p.name),
                datasets: [
                  {
                    label: 'Spent Today',
                    data: budgetData.map((p) => portfolioMap[p.name]?.cost_spent_today || 0),
                    backgroundColor: chartColor('blue') + '80',
                    borderColor: chartColor('blue'),
                    borderWidth: 1,
                  },
                  {
                    label: 'Daily Budget',
                    data: budgetData.map((p) => portfolioMap[p.name]?.cost_budget_daily || 0),
                    backgroundColor: chartColor('text-muted') + '30',
                    borderColor: chartColor('text-muted'),
                    borderWidth: 1,
                  },
                ],
              }}
              options={{
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: { color: 'var(--text-dim)', font: { size: 11 } },
                  },
                },
                scales: {
                  x: {
                    beginAtZero: true,
                    ticks: {
                      callback: (value) => '$' + (value as number).toFixed(2),
                      color: 'var(--text-dim)',
                      font: { size: 11 },
                    },
                    grid: { color: 'var(--border-subtle)' },
                  },
                  y: {
                    ticks: { color: 'var(--text-dim)', font: { size: 11 } },
                    grid: { display: false },
                  },
                },
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
