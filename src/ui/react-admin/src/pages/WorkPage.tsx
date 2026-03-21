import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../api';
import { useStore } from '../store';
import { timeSince, formatCost } from '../utils/formatters';
import MarkdownRenderer from '../components/shared/MarkdownRenderer';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  model?: string;
  project_path?: string;
  cost_usd?: number;
  created_at: string;
  result?: string;
  error?: string;
  log_file?: string;
  commit_sha?: string;
  goal_id?: string;
}

interface Goal {
  id: string;
  title: string;
  description?: string;
  project_path?: string;
  tasks_completed?: number;
  task_count?: number;
  cost_usd?: number;
  child_task_count?: number;
}

type StatusColumn = 'pending' | 'running' | 'done' | 'failed';

const STATUSES: StatusColumn[] = ['pending', 'running', 'done', 'failed'];

export default function WorkPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeGoals, setActiveGoals] = useState<Goal[]>([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set());

  // Filters from store
  const workFilters = useStore((state) => state.workFilters);
  const setWorkFilters = useStore((state) => state.setWorkFilters);

  // WebSocket subscription for live updates
  const subscribeWs = useStore((state) => state.subscribeWs);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  // WebSocket refresh on task/goal updates
  useEffect(() => {
    const unsubTask = subscribeWs('task_update', () => loadData());
    const unsubGoal = subscribeWs('goal_update', () => loadData());
    return () => {
      unsubTask();
      unsubGoal();
    };
  }, [subscribeWs]);

  async function loadData() {
    try {
      const [tasksRes, activeGoalsRes] = await Promise.all([
        apiFetch('/api/tasks'),
        apiFetch('/api/goals?view=active'),
      ]);

      const tasksData = await tasksRes.json();
      const activeGoalsData = await activeGoalsRes.json();

      setTasks(tasksData.tasks || []);
      setActiveGoals(activeGoalsData.goals || []);
    } catch (error) {
      console.error('Failed to load work data:', error);
    }
  }

  // Extract unique values for filters
  const { projects, models } = useMemo(() => {
    const projectSet = new Set<string>();
    const modelSet = new Set<string>();

    tasks.forEach((t) => {
      const project = t.project_path?.split('/').pop() || 'unknown';
      projectSet.add(project);
      if (t.model) modelSet.add(t.model);
    });

    return {
      projects: Array.from(projectSet).sort(),
      models: Array.from(modelSet).filter((m) => m).sort(),
    };
  }, [tasks]);

  // Filter tasks by status and filters
  function filterTasksByStatus(status: StatusColumn): Task[] {
    return tasks.filter((t) => {
      const taskStatus = t.status || 'pending';
      const taskProject = t.project_path?.split('/').pop() || '';
      const taskModel = t.model || '';

      // Column status match (which column to put the task in)
      let columnStatusMatch = false;
      if (status === 'pending') columnStatusMatch = taskStatus === 'pending';
      else if (status === 'running')
        columnStatusMatch =
          taskStatus === 'running' ||
          taskStatus === 'active' ||
          taskStatus === 'decomposing';
      else if (status === 'done')
        columnStatusMatch = taskStatus === 'done' || taskStatus === 'completed';
      else if (status === 'failed') columnStatusMatch = taskStatus === 'failed';

      // Filter dropdown status match (which tasks to show across all columns)
      let filterStatusMatch = true;
      if (workFilters.status !== 'all') {
        if (workFilters.status === 'pending')
          filterStatusMatch = taskStatus === 'pending';
        else if (workFilters.status === 'running')
          filterStatusMatch =
            taskStatus === 'running' ||
            taskStatus === 'active' ||
            taskStatus === 'decomposing';
        else if (workFilters.status === 'done')
          filterStatusMatch = taskStatus === 'done' || taskStatus === 'completed';
        else if (workFilters.status === 'failed')
          filterStatusMatch = taskStatus === 'failed';
      }

      // Filter matches
      const projectMatch =
        workFilters.project === 'all' || taskProject === workFilters.project;
      const modelMatch =
        workFilters.model === 'all' || taskModel === workFilters.model;

      return columnStatusMatch && filterStatusMatch && projectMatch && modelMatch;
    });
  }

  // Toggle task expanded state
  function toggleTask(taskId: string) {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  // Toggle goal expanded state
  function toggleGoal(goalId: string) {
    setExpandedGoalIds((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }

  // Group goals by project
  const goalsByProject = useMemo(() => {
    const groups: Record<string, Goal[]> = {};
    activeGoals.forEach((goal) => {
      const project = goal.project_path?.split('/').pop() || 'unknown';
      if (!groups[project]) groups[project] = [];
      groups[project].push(goal);
    });
    return groups;
  }, [activeGoals]);

  return (
    <div className="fade-in">
      {/* Filter bar */}
      <div className="filter-bar">
        <select
          className="form-select"
          value={workFilters.status}
          onChange={(e) =>
            setWorkFilters({ ...workFilters, status: e.target.value })
          }
        >
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select
          className="form-select"
          value={workFilters.project}
          onChange={(e) =>
            setWorkFilters({ ...workFilters, project: e.target.value })
          }
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          className="form-select"
          value={workFilters.model}
          onChange={(e) =>
            setWorkFilters({ ...workFilters, model: e.target.value })
          }
        >
          <option value="all">All Models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Kanban board */}
      <div className="kanban-board">
        {STATUSES.map((status) => {
          const statusTasks = filterTasksByStatus(status);
          const borderColor =
            status === 'done'
              ? 'var(--green)'
              : status === 'running'
              ? 'var(--cyan)'
              : status === 'failed'
              ? 'var(--red)'
              : 'var(--amber)';

          return (
            <div key={status} className="kanban-column">
              <div
                className="kanban-column-header"
                style={{ borderBottomColor: borderColor }}
              >
                <span className="kanban-column-title">
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
                <span className="kanban-column-count">{statusTasks.length}</span>
              </div>
              <div className="kanban-column-body">
                {statusTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    expanded={expandedTaskIds.has(task.id)}
                    onToggle={() => toggleTask(task.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Goals section */}
      {activeGoals.length > 0 && (
        <div className="admin-card">
          <h2>Active Goals</h2>
          <div className="goals-list">
            {Object.entries(goalsByProject).map(([project, goals]) =>
              goals.map((goal) => (
                <GoalItem
                  key={goal.id}
                  goal={goal}
                  project={project}
                  expanded={expandedGoalIds.has(goal.id)}
                  onToggle={() => toggleGoal(goal.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
}

function TaskCard({ task, expanded, onToggle }: TaskCardProps) {
  const projectName = task.project_path?.split('/').pop() || '—';
  const taskStatus = task.status || 'pending';

  const borderColor =
    taskStatus === 'done' || taskStatus === 'completed'
      ? 'var(--green)'
      : taskStatus === 'running' ||
        taskStatus === 'active' ||
        taskStatus === 'decomposing'
      ? 'var(--cyan)'
      : taskStatus === 'failed'
      ? 'var(--red)'
      : 'var(--amber)';

  const pulseClass =
    taskStatus === 'running' || taskStatus === 'active' ? 'pulse' : '';

  // Model badge variant
  const badgeClass =
    task.model === 'opus'
      ? 'badge-strategic'
      : task.model === 'sonnet'
      ? 'badge-improvement'
      : 'badge-opportunity';

  return (
    <div
      className={`kanban-card ${pulseClass}`}
      style={{ borderLeftColor: borderColor }}
      onClick={onToggle}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-title">{task.title || 'Untitled'}</span>
      </div>
      <div className="kanban-card-meta">
        <span className={`badge ${badgeClass}`}>{task.model || '?'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {projectName}
        </span>
      </div>
      <div className="kanban-card-footer">
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {formatCost(task.cost_usd || 0)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {timeSince(task.created_at)}
        </span>
      </div>

      {/* Expanded detail section */}
      {expanded && (
        <div className="kanban-card-detail">
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ marginBottom: 6 }}>
              <strong
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                Description
              </strong>
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                lineHeight: 1.5,
              }}
            >
              {(task.description || '—').substring(0, 200)}
            </div>

            {task.result && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  <strong
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                    }}
                  >
                    Result
                  </strong>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    lineHeight: 1.5,
                  }}
                >
                  <MarkdownRenderer content={task.result} />
                </div>
              </div>
            )}

            {task.error && (
              <div
                style={{
                  marginTop: 8,
                  padding: '6px 8px',
                  background: 'rgba(248, 81, 73, 0.1)',
                  borderRadius: 4,
                  borderLeft: '2px solid var(--red)',
                }}
              >
                <strong
                  style={{
                    fontSize: 11,
                    color: 'var(--red)',
                    textTransform: 'uppercase',
                  }}
                >
                  Error
                </strong>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    marginTop: 2,
                  }}
                >
                  {task.error.substring(0, 150)}
                </div>
              </div>
            )}

            {task.log_file && (
              <div style={{ marginTop: 6 }}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    alert(`Log viewer for task ${task.id} would open here`);
                  }}
                  style={{ fontSize: 12, color: 'var(--blue)' }}
                >
                  View Log
                </a>
              </div>
            )}

            {task.commit_sha && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}
              >
                <strong>Commit:</strong> {task.commit_sha.slice(0, 8)}
              </div>
            )}

            {task.goal_id && (
              <div style={{ marginTop: 6 }}>
                <a href="#" style={{ fontSize: 12, color: 'var(--blue)' }}>
                  Goal: {task.goal_id}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface GoalItemProps {
  goal: Goal;
  project: string;
  expanded: boolean;
  onToggle: () => void;
}

function GoalItem({ goal, project, expanded, onToggle }: GoalItemProps) {
  const completed = goal.tasks_completed || 0;
  const total = goal.task_count || 1;
  const pct = total > 0 ? completed / total : 0;

  return (
    <div className="goal-item" onClick={onToggle}>
      <div className="goal-header">
        <span className="goal-title">{goal.title || 'Untitled Goal'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {project}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-dim)',
          marginBottom: 6,
          lineHeight: 1.4,
        }}
      >
        {(goal.description || '—').substring(0, 100)}
      </div>
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${(pct * 100).toFixed(1)}%` }}
        />
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          marginTop: 4,
        }}
      >
        {completed}/{total} tasks · {formatCost(goal.cost_usd || 0)}
      </div>

      {expanded && (
        <div
          className="goal-detail"
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
              }}
            >
              Child Tasks
            </strong>
          </div>
          {goal.child_task_count ? (
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {goal.child_task_count} tasks assigned
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
