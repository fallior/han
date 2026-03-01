/**
 * Claude Remote Admin Console
 * Desktop-optimised project administration interface
 */

// ── Constants ────────────────────────────────────────────────
const API_BASE = '';
const MODULES = ['overview', 'projects', 'work', 'supervisor', 'reports', 'conversations', 'memory-discussions', 'products', 'workshop'] as const;
type ModuleName = typeof MODULES[number];

// ── State ────────────────────────────────────────────────────
let currentModule: ModuleName = 'overview';
let ws: WebSocket | null = null;
let chartInstances: Record<string, any> = {};
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let selectedProductId: string | null = null;
let selectedConversationId: string | null = null;
let selectedConversationPeriod: string = 'all';
let selectedMemoryDiscussionId: string | null = null;
let selectedMemoryDiscussionPeriod: string = 'all';
let workshopPersona: 'jim' | 'leo' | 'darron' = 'jim';
let workshopNestedTab: string = 'jim-request';
let workshopSelectedThread: Record<string, string | null> = {};
let workshopPeriod: string = 'all';
let workshopShowArchived: boolean = false;

// ── Utilities ────────────────────────────────────────────────

function escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function renderMarkdown(text: string): string {
    // Escape HTML first, then apply markdown patterns
    let html = escapeHtml(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
        `<pre style="background:var(--bg-input);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;margin:8px 0"><code>${code.trim()}</code></pre>`
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-input);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');

    // Headers (## and ###)
    html = html.replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 4px;font-size:13px;color:var(--text-heading)">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 style="margin:14px 0 6px;font-size:14px;color:var(--text-heading)">$1</h3>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border-subtle);margin:12px 0">');

    // Bold + italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc;font-size:inherit">$1</li>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal;font-size:inherit">$1</li>');

    // Paragraphs — double newlines become paragraph breaks
    html = html.replace(/\n\n/g, '</p><p style="margin:8px 0">');

    // Single newlines become <br> (except inside pre/code blocks handled above)
    html = html.replace(/\n/g, '<br>');

    return `<p style="margin:0">${html}</p>`;
}

function formatCost(usd: number): string {
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    if (usd < 1) return `$${usd.toFixed(3)}`;
    return `$${usd.toFixed(2)}`;
}

function formatPct(n: number): string {
    return `${(n * 100).toFixed(1)}%`;
}

function formatDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function timeSince(iso: string): string {
    if (!iso) return '—';
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
}

function statusBadge(status: string): string {
    const cls = status === 'done' || status === 'completed' ? 'done'
        : status === 'running' || status === 'active' || status === 'decomposing' ? 'running'
        : status === 'failed' ? 'failed'
        : status === 'pending' ? 'pending'
        : 'cancelled';
    return `<span class="badge badge-${cls}">${escapeHtml(status)}</span>`;
}

function categoryBadge(cat: string): string {
    const cls = cat === 'improvement' ? 'improvement'
        : cat === 'opportunity' ? 'opportunity'
        : cat === 'risk' ? 'risk'
        : 'strategic';
    return `<span class="badge badge-${cls}">${escapeHtml(cat)}</span>`;
}

// ── Chart Helpers ────────────────────────────────────────────

function createChart(canvasId: string, config: any): any {
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        delete chartInstances[canvasId];
    }
    const el = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!el) return null;
    const chart = new (window as any).Chart(el, config);
    chartInstances[canvasId] = chart;
    return chart;
}

function destroyAllCharts(): void {
    for (const [id, chart] of Object.entries(chartInstances)) {
        chart.destroy();
    }
    chartInstances = {};
}

function chartColor(name: string): string {
    const style = getComputedStyle(document.documentElement);
    return style.getPropertyValue(`--${name}`).trim();
}

function initChartDefaults(): void {
    const Chart = (window as any).Chart;
    if (!Chart) return;
    Chart.defaults.color = chartColor('text-dim');
    Chart.defaults.borderColor = chartColor('border-subtle');
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = chartColor('bg-card');
    Chart.defaults.plugins.tooltip.borderColor = chartColor('border');
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.titleColor = chartColor('text-heading');
    Chart.defaults.plugins.tooltip.bodyColor = chartColor('text-dim');
    Chart.defaults.scale.grid.color = 'rgba(48, 54, 61, 0.2)';
}

// ── Theme ────────────────────────────────────────────────────

function initTheme(): void {
    const saved = localStorage.getItem('admin-theme');
    if (saved === 'light') document.documentElement.classList.add('light-mode');
}

function toggleTheme(): void {
    const isLight = document.documentElement.classList.toggle('light-mode');
    localStorage.setItem('admin-theme', isLight ? 'light' : 'dark');
    initChartDefaults();
    // Re-render current module to update chart colours
    renderModule(currentModule);
}

// ── Router ───────────────────────────────────────────────────

function navigate(mod: ModuleName): void {
    window.location.hash = mod;
}

function handleRoute(): void {
    const hash = window.location.hash.slice(1) as ModuleName;
    const mod = MODULES.includes(hash) ? hash : 'overview';
    switchModule(mod);
}

function switchModule(mod: ModuleName): void {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    destroyAllCharts();
    currentModule = mod;

    // Update sidebar
    document.querySelectorAll('.sidebar-item[data-module]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-module') === mod);
    });

    // Update title
    const titles: Record<string, string> = {
        overview: 'Overview', projects: 'Projects', work: 'Work',
        supervisor: 'Supervisor', reports: 'Reports',
        conversations: 'Conversations', 'memory-discussions': 'Memory Discussions',
        products: 'Products', workshop: 'Workshop'
    };
    const titleEl = document.getElementById('moduleTitle');
    if (titleEl) titleEl.textContent = titles[mod] || mod;

    // Clear actions
    const actionsEl = document.getElementById('moduleActions');
    if (actionsEl) actionsEl.innerHTML = '';

    renderModule(mod);
}

async function renderModule(mod: ModuleName): Promise<void> {
    const content = document.getElementById('mainContent');
    if (!content) return;
    content.innerHTML = '<div class="loading">Loading...</div>';

    try {
        switch (mod) {
            case 'overview': await loadOverview(content); break;
            case 'projects': await loadProjects(content); break;
            case 'work': await loadWork(content); break;
            case 'supervisor': await loadSupervisor(content); break;
            case 'reports': await loadReports(content); break;
            case 'products': await loadProducts(content); break;
            case 'conversations': await loadConversations(content); break;
            case 'memory-discussions': await loadMemoryDiscussions(content); break;
            case 'workshop': await loadWorkshop(content); break;
        }
    } catch (err: any) {
        content.innerHTML = `<div class="admin-card"><p style="color:var(--red)">Error loading module: ${escapeHtml(err.message)}</p></div>`;
    }
}

function renderComingSoon(content: HTMLElement, mod: string): void {
    const icons: Record<string, string> = {
        work: '&#9745;', conversations: '&#128172;', products: '&#128230;'
    };
    const descs: Record<string, string> = {
        work: 'Tasks and goals unified kanban view',
        conversations: 'Human-AI strategic discussion threads',
        products: 'Product pipeline visualisation'
    };
    content.innerHTML = `<div class="coming-soon-page fade-in">
        <div class="icon">${icons[mod] || ''}</div>
        <h2>${mod.charAt(0).toUpperCase() + mod.slice(1)}</h2>
        <p>${descs[mod] || 'Coming in Phase 2'}</p>
    </div>`;
}

// ── WebSocket ────────────────────────────────────────────────

let wsRetryDelay = 1000;

function connectWebSocket(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        wsRetryDelay = 1000;
        updateConnectionStatus(true);
    };

    ws.onclose = () => {
        updateConnectionStatus(false);
        setTimeout(connectWebSocket, wsRetryDelay);
        wsRetryDelay = Math.min(wsRetryDelay * 1.5, 30000);
    };

    ws.onerror = () => {};

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWsMessage(data);
        } catch {}
    };
}

function handleWsMessage(data: any): void {
    if (data.type === 'supervisor_cycle' || data.type === 'supervisor_action') {
        updateStatusInfo(data);
        if (currentModule === 'overview' || currentModule === 'supervisor') {
            renderModule(currentModule);
        }
    } else if (data.type === 'strategic_proposal') {
        updateProposalBadge();
        if (currentModule === 'supervisor') renderModule('supervisor');
        if (currentModule === 'overview') renderModule('overview');
    } else if (data.type === 'task_update' || data.type === 'goal_update') {
        if (currentModule === 'overview') renderModule('overview');
        if (currentModule === 'projects') renderModule('projects');
        if (currentModule === 'work') renderModule('work');
    } else if (data.type === 'conversation_message') {
        if (currentModule === 'conversations' && data.conversation_id === selectedConversationId) {
            // Remove waiting indicator and re-render thread
            const waiting = document.getElementById('supervisorWaiting');
            if (waiting) waiting.remove();
            renderConversationThread(selectedConversationId);
        }
        if (currentModule === 'memory-discussions' && data.conversation_id === selectedMemoryDiscussionId) {
            const waiting = document.getElementById('mdSupervisorWaiting');
            if (waiting) waiting.remove();
            renderMemoryThread(selectedMemoryDiscussionId);
        }
        // Workshop module: handle messages for any workshop nested tab type
        if (currentModule === 'workshop') {
            const workshopTypes = ['jim-request', 'jim-report', 'leo-question', 'leo-postulate', 'darron-thought', 'darron-musing'];
            const conversationDiscussionType = data.discussion_type;

            if (workshopTypes.includes(conversationDiscussionType)) {
                const currentThreadId = workshopSelectedThread[workshopNestedTab];
                if (data.conversation_id === currentThreadId) {
                    // Remove waiting indicator and re-render thread
                    const waiting = document.getElementById('workshopSupervisorWaiting');
                    if (waiting) waiting.remove();
                    renderWorkshopThread(currentThreadId);
                }
            }
        }
    }
}

function updateConnectionStatus(connected: boolean): void {
    const el = document.getElementById('statusConnection');
    if (!el) return;
    el.innerHTML = `<span class="status-dot ${connected ? 'connected' : 'disconnected'}"></span> ${connected ? 'Connected' : 'Reconnecting...'}`;
}

function updateStatusInfo(data?: any): void {
    const el = document.getElementById('statusInfo');
    if (!el) return;
    if (data?.type === 'supervisor_cycle') {
        el.textContent = `Last cycle: ${timeSince(data.completed_at || new Date().toISOString())}`;
    }
}

async function updateProposalBadge(): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/supervisor/proposals`);
        const data = await res.json();
        const pending = (data.proposals || []).filter((p: any) => p.status === 'pending').length;
        const badge = document.getElementById('proposalCount');
        if (badge) {
            badge.textContent = String(pending);
            badge.style.display = pending > 0 ? 'inline' : 'none';
        }
    } catch {}
}

// ══════════════════════════════════════════════════════════════
// MODULE: Overview
// ══════════════════════════════════════════════════════════════

async function loadOverview(content: HTMLElement): Promise<void> {
    const [analyticsRes, ecosystemRes, supervisorRes, activityRes] = await Promise.all([
        fetch(`${API_BASE}/api/analytics`),
        fetch(`${API_BASE}/api/ecosystem`),
        fetch(`${API_BASE}/api/supervisor/status`),
        fetch(`${API_BASE}/api/supervisor/activity?limit=20`),
    ]);

    const analytics = await analyticsRes.json();
    const ecosystem = await ecosystemRes.json();
    const supervisor = await supervisorRes.json();
    const activity = await activityRes.json();

    const g = analytics.global || {};
    const projects = ecosystem.projects || [];
    const activeGoals = projects.reduce((sum: number, p: any) => sum + (p.active_goals || 0), 0);
    const runningTasks = projects.reduce((sum: number, p: any) => sum + (p.running_tasks || 0), 0);
    const velocity = analytics.velocity || {};
    const trend = velocity.trend || 'stable';
    const trendIcon = trend === 'up' ? '&#9650;' : trend === 'down' ? '&#9660;' : '&#9644;';

    let html = `<div class="fade-in">`;

    // Stat cards
    html += `<div class="stat-row">
        <div class="stat-card">
            <span class="stat-label">Total Tasks</span>
            <span class="stat-value">${g.totalTasks || 0}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Success Rate</span>
            <span class="stat-value">${formatPct(g.successRate || 0)}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Total Cost</span>
            <span class="stat-value">${formatCost(g.totalCost || 0)}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Active Goals</span>
            <span class="stat-value">${activeGoals}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Running Now</span>
            <span class="stat-value ${runningTasks > 0 ? 'pulse' : ''}" style="color:${runningTasks > 0 ? 'var(--cyan)' : 'var(--text-heading)'}">${runningTasks}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Velocity</span>
            <span class="stat-value"><span class="stat-change ${trend}">${trendIcon}</span> ${(velocity.avgLast3Days || 0).toFixed(1)}/day</span>
        </div>
    </div>`;

    // Charts row
    html += `<div class="chart-row">
        <div class="chart-container">
            <div class="chart-title">Task Velocity (7 Days)</div>
            <div class="chart-canvas-wrap"><canvas id="velocityChart"></canvas></div>
        </div>
        <div class="chart-container">
            <div class="chart-title">Model Distribution</div>
            <div class="chart-canvas-wrap"><canvas id="modelChart"></canvas></div>
        </div>
    </div>`;

    // Supervisor status + activity
    const sup = supervisor;
    const supStatus = sup.paused ? 'Paused' : sup.enabled ? 'Running' : 'Disabled';
    const supColor = sup.paused ? 'var(--amber)' : sup.enabled ? 'var(--green)' : 'var(--red)';

    html += `<div class="chart-row">
        <div class="admin-card">
            <h2>Supervisor</h2>
            <div class="detail-grid">
                <div class="detail-field">
                    <span class="label">Status</span>
                    <span class="value" style="color:${supColor}">${supStatus}</span>
                </div>
                <div class="detail-field">
                    <span class="label">Last Cycle</span>
                    <span class="value">${sup.lastCycle ? timeSince(sup.lastCycle.completed_at || sup.lastCycle.started_at) : 'Never'}</span>
                </div>
                <div class="detail-field">
                    <span class="label">Total Cycles</span>
                    <span class="value">${sup.totalCycles || 0}</span>
                </div>
                <div class="detail-field">
                    <span class="label">Cycle Cost</span>
                    <span class="value">${sup.lastCycle ? formatCost(sup.lastCycle.cost_usd || 0) : '—'}</span>
                </div>
            </div>
        </div>
        <div class="admin-card">
            <h2>Cost by Model</h2>
            <div class="chart-canvas-wrap"><canvas id="costModelChart"></canvas></div>
        </div>
    </div>`;

    // Activity feed
    const events = activity.events || [];
    html += `<div class="admin-card">
        <h2>Recent Activity</h2>
        <div class="activity-list">${renderActivityItems(events)}</div>
    </div>`;

    html += `</div>`;
    content.innerHTML = html;

    // Bind activity toggles
    content.querySelectorAll('.activity-item').forEach(el => {
        el.addEventListener('click', () => el.classList.toggle('expanded'));
    });

    // Charts
    const dailyCounts = (velocity.dailyCounts || []).reverse();
    createChart('velocityChart', {
        type: 'line',
        data: {
            labels: dailyCounts.map((d: any) => d.date?.slice(5) || ''),
            datasets: [{
                label: 'Tasks',
                data: dailyCounts.map((d: any) => d.count || 0),
                borderColor: chartColor('blue'),
                backgroundColor: 'rgba(56, 139, 253, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: chartColor('blue'),
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });

    const byModel = analytics.byModel || {};
    const modelLabels = Object.keys(byModel);
    const modelCounts = modelLabels.map(m => byModel[m].count || 0);
    const modelColors = modelLabels.map(m =>
        m === 'opus' ? chartColor('purple') :
        m === 'sonnet' ? chartColor('blue') :
        m === 'haiku' ? chartColor('green') : chartColor('text-muted')
    );

    createChart('modelChart', {
        type: 'doughnut',
        data: {
            labels: modelLabels,
            datasets: [{ data: modelCounts, backgroundColor: modelColors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            cutout: '60%',
        }
    });

    const modelCosts = modelLabels.map(m => byModel[m].avgCost || 0);
    createChart('costModelChart', {
        type: 'bar',
        data: {
            labels: modelLabels,
            datasets: [{
                label: 'Avg Cost/Task',
                data: modelCosts,
                backgroundColor: modelColors.map(c => c + '80'),
                borderColor: modelColors,
                borderWidth: 1,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { callback: (v: number) => '$' + v.toFixed(3) } } }
        }
    });
}

function renderActivityItems(events: any[]): string {
    if (events.length === 0) return '<p style="color:var(--text-muted);font-size:13px;padding:12px">No recent activity</p>';
    return events.map(ev => {
        const dotType = ev.status === 'failed' ? 'failed' : ev.type === 'supervisor_cycle' ? 'supervisor' : ev.type === 'goal' ? 'goal' : ev.type === 'proposal' ? 'proposal' : 'task';
        const title = ev.title || ev.type || '—';
        const time = ev.timestamp ? timeSince(ev.timestamp) : '';
        let detail = '';
        if (ev.detail) {
            if (ev.detail.observations) detail += `Observations: ${ev.detail.observations}\n`;
            if (ev.detail.actions) detail += `Actions: ${ev.detail.actions}\n`;
            if (ev.detail.reasoning) detail += `Reasoning: ${ev.detail.reasoning}\n`;
            if (ev.detail.error) detail += `Error: ${ev.detail.error}\n`;
            if (ev.detail.cost_usd) detail += `Cost: ${formatCost(ev.detail.cost_usd)}`;
        }
        return `<div class="activity-item">
            <div class="activity-dot ${dotType}"></div>
            <div class="activity-body">
                <div class="activity-title">${escapeHtml(title)}</div>
                <div class="activity-meta">${ev.type} ${ev.status ? '· ' + ev.status : ''} · ${time}${ev.project ? ' · ' + escapeHtml(ev.project.split('/').pop() || '') : ''}</div>
                ${detail ? `<div class="activity-detail">${escapeHtml(detail.trim())}</div>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════
// MODULE: Work
// ══════════════════════════════════════════════════════════════

let workFilters = { project: '', status: '', model: '' };
let workData: { tasks: any[], activeGoals: any[], archivedGoals: any[] } | null = null;

async function loadWork(content: HTMLElement): Promise<void> {
    const [tasksRes, activeGoalsRes, archivedGoalsRes] = await Promise.all([
        fetch(`${API_BASE}/api/tasks`),
        fetch(`${API_BASE}/api/goals?view=active`),
        fetch(`${API_BASE}/api/goals?view=archived`),
    ]);

    const tasksData = await tasksRes.json();
    const activeGoalsData = await activeGoalsRes.json();
    const archivedGoalsData = await archivedGoalsRes.json();

    const tasks = tasksData.tasks || [];
    const activeGoals = activeGoalsData.goals || [];
    const archivedGoals = archivedGoalsData.goals || [];

    workData = { tasks, activeGoals, archivedGoals };

    // Extract unique projects and models
    const projects = [...new Set(tasks.map((t: any) => t.project_path?.split('/').pop() || 'unknown'))].sort() as string[];
    const models = [...new Set(tasks.map((t: any) => t.model || 'unknown'))].filter(m => m).sort() as string[];
    const statuses = ['pending', 'running', 'done', 'failed'];

    // Build filter bar HTML
    let html = `<div class="fade-in">
        <div class="filter-bar">
            <select class="form-select" id="filterStatus" onchange="applyWorkFilters()">
                <option value="">All Statuses</option>
                ${statuses.map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
            </select>
            <select class="form-select" id="filterProject" onchange="applyWorkFilters()">
                <option value="">All Projects</option>
                ${projects.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
            </select>
            <select class="form-select" id="filterModel" onchange="applyWorkFilters()">
                <option value="">All Models</option>
                ${models.map(m => `<option value="${m}">${m}</option>`).join('')}
            </select>
        </div>`;

    // Kanban board
    html += `<div class="kanban-board">`;
    for (const status of statuses) {
        const statusTasks = filterWorkTasks(tasks, status);
        const count = statusTasks.length;
        const borderColor = status === 'done' ? 'var(--green)' : status === 'running' ? 'var(--cyan)' : status === 'failed' ? 'var(--red)' : 'var(--amber)';

        html += `<div class="kanban-column">
            <div class="kanban-column-header" style="border-bottom-color: ${borderColor}">
                <span class="kanban-column-title">${status.charAt(0).toUpperCase() + status.slice(1)}</span>
                <span class="kanban-column-count">${count}</span>
            </div>
            <div class="kanban-column-body">`;

        for (const task of statusTasks) {
            const projectName = task.project_path?.split('/').pop() || '—';
            const taskStatus = task.status || 'pending';
            const borderSide = taskStatus === 'done' || taskStatus === 'completed' ? 'var(--green)' :
                               taskStatus === 'running' || taskStatus === 'active' || taskStatus === 'decomposing' ? 'var(--cyan)' :
                               taskStatus === 'failed' ? 'var(--red)' : 'var(--amber)';
            const pulseClass = taskStatus === 'running' || taskStatus === 'active' ? 'pulse' : '';

            html += `<div class="kanban-card ${pulseClass}" data-task-id="${task.id}" style="border-left-color: ${borderSide}" onclick="toggleWorkCardExpanded(event, '${task.id}')">
                <div class="kanban-card-header">
                    <span class="kanban-card-title">${escapeHtml(task.title || 'Untitled')}</span>
                </div>
                <div class="kanban-card-meta">
                    <span class="badge badge-${task.model === 'opus' ? 'strategic' : task.model === 'sonnet' ? 'improvement' : 'opportunity'}">${escapeHtml(task.model || '?')}</span>
                    <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(projectName)}</span>
                </div>
                <div class="kanban-card-footer">
                    <span style="font-size:12px;color:var(--text-muted)">${formatCost(task.cost_usd || 0)}</span>
                    <span style="font-size:12px;color:var(--text-muted)">${timeSince(task.created_at)}</span>
                </div>
                <div class="kanban-card-detail" style="display:none">
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
                        <div style="margin-bottom:6px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Description</strong></div>
                        <div style="font-size:12px;color:var(--text-dim);line-height:1.5">${escapeHtml((task.description || '—').substring(0, 200))}</div>
                        ${task.result ? `<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border-subtle)"><div style="margin-bottom:6px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Result</strong></div><div style="font-size:12px;color:var(--text-dim);line-height:1.5">${renderMarkdown(task.result)}</div></div>` : ''}
                        ${task.error ? `<div style="margin-top:8px;padding:6px 8px;background:rgba(248, 81, 73, 0.1);border-radius:4px;border-left:2px solid var(--red)"><strong style="font-size:11px;color:var(--red);text-transform:uppercase">Error</strong><div style="font-size:11px;color:var(--text-dim);margin-top:2px">${escapeHtml(task.error.substring(0, 150))}</div></div>` : ''}
                        ${task.log_file ? `<div style="margin-top:6px"><a href="#" onclick="viewTaskLog('${task.id}', event)" style="font-size:12px;color:var(--blue)">View Log</a></div>` : ''}
                        ${task.commit_sha ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)"><strong>Commit:</strong> ${escapeHtml(task.commit_sha.slice(0, 8))}</div>` : ''}
                        ${task.goal_id ? `<div style="margin-top:6px"><a href="#" style="font-size:12px;color:var(--blue)">Goal: ${escapeHtml(task.goal_id)}</a></div>` : ''}
                    </div>
                </div>
            </div>`;
        }

        html += `</div></div>`;
    }
    html += `</div>`;

    // Goals section
    if (activeGoals.length > 0) {
        html += `<div class="admin-card">
            <h2>Active Goals</h2>
            <div class="goals-list">`;

        const goalsByProject = {} as Record<string, any[]>;
        for (const goal of activeGoals) {
            const proj = goal.project_path?.split('/').pop() || 'unknown';
            if (!goalsByProject[proj]) goalsByProject[proj] = [];
            goalsByProject[proj].push(goal);
        }

        for (const [proj, goals] of Object.entries(goalsByProject)) {
            for (const goal of goals) {
                const completed = goal.tasks_completed || 0;
                const total = goal.task_count || 1;
                const pct = total > 0 ? (completed / total) : 0;

                html += `<div class="goal-item" onclick="toggleGoalExpanded(event, '${goal.id}')">
                    <div class="goal-header">
                        <span class="goal-title">${escapeHtml(goal.title || 'Untitled Goal')}</span>
                        <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(proj)}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;line-height:1.4">${escapeHtml((goal.description || '—').substring(0, 100))}</div>
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width:${(pct * 100).toFixed(1)}%"></div>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${completed}/${total} tasks · ${formatCost(goal.cost_usd || 0)}</div>
                    <div class="goal-detail" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
                        <div style="margin-bottom:4px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Child Tasks</strong></div>
                        ${goal.child_task_count ? `<div style="font-size:12px;color:var(--text-dim)">${goal.child_task_count} tasks assigned</div>` : ''}
                    </div>
                </div>`;
            }
        }

        html += `</div></div>`;
    }

    html += `</div>`;
    content.innerHTML = html;

    // Restore filter values
    const statusSelect = document.getElementById('filterStatus') as HTMLSelectElement;
    const projectSelect = document.getElementById('filterProject') as HTMLSelectElement;
    const modelSelect = document.getElementById('filterModel') as HTMLSelectElement;
    if (statusSelect) statusSelect.value = workFilters.status;
    if (projectSelect) projectSelect.value = workFilters.project;
    if (modelSelect) modelSelect.value = workFilters.model;
}

function filterWorkTasks(tasks: any[], statusFilter: string): any[] {
    return tasks.filter(t => {
        const taskStatus = t.status || 'pending';
        const taskProject = t.project_path?.split('/').pop() || '';
        const taskModel = t.model || '';

        let statusMatch = false;
        if (statusFilter === 'pending') statusMatch = taskStatus === 'pending';
        else if (statusFilter === 'running') statusMatch = taskStatus === 'running' || taskStatus === 'active' || taskStatus === 'decomposing';
        else if (statusFilter === 'done') statusMatch = taskStatus === 'done' || taskStatus === 'completed';
        else if (statusFilter === 'failed') statusMatch = taskStatus === 'failed';

        const projectMatch = !workFilters.project || taskProject === workFilters.project;
        const modelMatch = !workFilters.model || taskModel === workFilters.model;

        return statusMatch && projectMatch && modelMatch;
    });
}

(window as any).applyWorkFilters = function() {
    const statusSelect = document.getElementById('filterStatus') as HTMLSelectElement;
    const projectSelect = document.getElementById('filterProject') as HTMLSelectElement;
    const modelSelect = document.getElementById('filterModel') as HTMLSelectElement;

    workFilters.status = statusSelect?.value || '';
    workFilters.project = projectSelect?.value || '';
    workFilters.model = modelSelect?.value || '';

    // Re-render kanban only (client-side filtering)
    if (workData) {
        const content = document.getElementById('mainContent');
        if (content) {
            // Find each kanban column and update it
            const columns = ['pending', 'running', 'done', 'failed'];
            for (const status of columns) {
                const col = content.querySelector(`[data-kanban-status="${status}"]`) as HTMLElement;
                if (col) {
                    const statusTasks = filterWorkTasks(workData.tasks, status);
                    let cardHtml = '';
                    for (const task of statusTasks) {
                        const projectName = task.project_path?.split('/').pop() || '—';
                        const taskStatus = task.status || 'pending';
                        const borderSide = taskStatus === 'done' || taskStatus === 'completed' ? 'var(--green)' :
                                           taskStatus === 'running' || taskStatus === 'active' || taskStatus === 'decomposing' ? 'var(--cyan)' :
                                           taskStatus === 'failed' ? 'var(--red)' : 'var(--amber)';
                        const pulseClass = taskStatus === 'running' || taskStatus === 'active' ? 'pulse' : '';

                        cardHtml += `<div class="kanban-card ${pulseClass}" data-task-id="${task.id}" style="border-left-color: ${borderSide}" onclick="toggleWorkCardExpanded(event, '${task.id}')">
                            <div class="kanban-card-header">
                                <span class="kanban-card-title">${escapeHtml(task.title || 'Untitled')}</span>
                            </div>
                            <div class="kanban-card-meta">
                                <span class="badge badge-${task.model === 'opus' ? 'strategic' : task.model === 'sonnet' ? 'improvement' : 'opportunity'}">${escapeHtml(task.model || '?')}</span>
                                <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(projectName)}</span>
                            </div>
                            <div class="kanban-card-footer">
                                <span style="font-size:12px;color:var(--text-muted)">${formatCost(task.cost_usd || 0)}</span>
                                <span style="font-size:12px;color:var(--text-muted)">${timeSince(task.created_at)}</span>
                            </div>
                            <div class="kanban-card-detail" style="display:none">
                                <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
                                    <div style="margin-bottom:6px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Description</strong></div>
                                    <div style="font-size:12px;color:var(--text-dim);line-height:1.5">${escapeHtml((task.description || '—').substring(0, 200))}</div>
                                    ${task.error ? `<div style="margin-top:8px;padding:6px 8px;background:rgba(248, 81, 73, 0.1);border-radius:4px;border-left:2px solid var(--red)"><strong style="font-size:11px;color:var(--red);text-transform:uppercase">Error</strong><div style="font-size:11px;color:var(--text-dim);margin-top:2px">${escapeHtml(task.error.substring(0, 150))}</div></div>` : ''}
                                    ${task.log_file ? `<div style="margin-top:6px"><a href="#" onclick="viewTaskLog('${task.id}', event)" style="font-size:12px;color:var(--blue)">View Log</a></div>` : ''}
                                    ${task.commit_sha ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)"><strong>Commit:</strong> ${escapeHtml(task.commit_sha.slice(0, 8))}</div>` : ''}
                                    ${task.goal_id ? `<div style="margin-top:6px"><a href="#" style="font-size:12px;color:var(--blue)">Goal: ${escapeHtml(task.goal_id)}</a></div>` : ''}
                                </div>
                            </div>
                        </div>`;
                    }
                    const bodyEl = col.querySelector('.kanban-column-body') as HTMLElement;
                    if (bodyEl) bodyEl.innerHTML = cardHtml;
                    const countEl = col.querySelector('.kanban-column-count') as HTMLElement;
                    if (countEl) countEl.textContent = String(statusTasks.length);
                }
            }
        }
    }
};

(window as any).toggleWorkCardExpanded = function(event: Event, taskId: string) {
    event.stopPropagation();
    const card = (event.target as HTMLElement).closest('.kanban-card') as HTMLElement;
    if (!card) return;
    const detail = card.querySelector('.kanban-card-detail') as HTMLElement;
    if (detail) {
        const isHidden = detail.style.display === 'none';
        detail.style.display = isHidden ? 'block' : 'none';
    }
};

(window as any).toggleGoalExpanded = function(event: Event, goalId: string) {
    event.stopPropagation();
    const goal = (event.target as HTMLElement).closest('.goal-item') as HTMLElement;
    if (!goal) return;
    const detail = goal.querySelector('.goal-detail') as HTMLElement;
    if (detail) {
        const isHidden = detail.style.display === 'none';
        detail.style.display = isHidden ? 'block' : 'none';
    }
};

(window as any).viewTaskLog = function(taskId: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    alert(`Log viewer for task ${taskId} would open here`);
};

// ══════════════════════════════════════════════════════════════
// MODULE: Projects
// ══════════════════════════════════════════════════════════════

let selectedProject: string | null = null;

async function loadProjects(content: HTMLElement): Promise<void> {
    const [ecosystemRes, portfolioRes] = await Promise.all([
        fetch(`${API_BASE}/api/ecosystem`),
        fetch(`${API_BASE}/api/portfolio`),
    ]);
    const ecosystem = await ecosystemRes.json();
    const portfolio = await portfolioRes.json();

    const projects = ecosystem.projects || [];
    const portfolioMap: Record<string, any> = {};
    (portfolio.projects || []).forEach((p: any) => portfolioMap[p.name] = p);

    let html = `<div class="fade-in">`;

    // Project grid
    html += `<div class="project-grid">`;
    for (const p of projects) {
        const pf = portfolioMap[p.name] || {};
        const throttled = pf.throttled ? ' <span class="badge badge-failed" style="font-size:9px">THROTTLED</span>' : '';
        html += `<div class="project-card ${selectedProject === p.name ? 'selected' : ''}" data-project="${escapeHtml(p.name)}" onclick="selectProject('${escapeHtml(p.name)}')">
            <div class="project-card-header">
                <span class="project-card-name">${escapeHtml(p.name)}${throttled}</span>
                <span class="badge badge-${p.lifecycle === 'active' ? 'running' : p.lifecycle === 'maintained' ? 'done' : 'pending'}">${escapeHtml(p.lifecycle || 'unknown')}</span>
            </div>
            <div class="project-card-stats">
                <span>P${pf.priority || 5}</span>
                <span>${p.total_tasks || 0} tasks</span>
                <span>${formatCost(p.total_cost || 0)}</span>
                ${p.active_goals ? `<span style="color:var(--cyan)">${p.active_goals} active</span>` : ''}
            </div>
        </div>`;
    }
    html += `</div>`;

    // Detail panel
    html += `<div id="projectDetail"></div>`;

    // Budget chart
    const budgetData = projects.filter((p: any) => {
        const pf = portfolioMap[p.name];
        return pf && pf.cost_budget_daily > 0;
    });

    if (budgetData.length > 0) {
        html += `<div class="chart-container">
            <div class="chart-title">Budget Utilisation</div>
            <div class="chart-canvas-wrap"><canvas id="budgetChart"></canvas></div>
        </div>`;
    }

    html += `</div>`;
    content.innerHTML = html;

    // Render selected project detail
    if (selectedProject) {
        const proj = projects.find((p: any) => p.name === selectedProject);
        const pf = portfolioMap[selectedProject];
        if (proj) renderProjectDetail(proj, pf);
    }

    // Budget chart
    if (budgetData.length > 0) {
        createChart('budgetChart', {
            type: 'bar',
            data: {
                labels: budgetData.map((p: any) => p.name),
                datasets: [
                    {
                        label: 'Spent Today',
                        data: budgetData.map((p: any) => portfolioMap[p.name]?.cost_spent_today || 0),
                        backgroundColor: chartColor('blue') + '80',
                        borderColor: chartColor('blue'),
                        borderWidth: 1,
                    },
                    {
                        label: 'Daily Budget',
                        data: budgetData.map((p: any) => portfolioMap[p.name]?.cost_budget_daily || 0),
                        backgroundColor: chartColor('text-muted') + '30',
                        borderColor: chartColor('text-muted'),
                        borderWidth: 1,
                    },
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { x: { beginAtZero: true, ticks: { callback: (v: number) => '$' + v.toFixed(2) } } }
            }
        });
    }
}

(window as any).selectProject = function(name: string) {
    selectedProject = selectedProject === name ? null : name;
    renderModule('projects');
};

function renderProjectDetail(proj: any, pf: any): void {
    const detail = document.getElementById('projectDetail');
    if (!detail) return;

    detail.innerHTML = `<div class="detail-panel fade-in">
        <h2>${escapeHtml(proj.name)}</h2>
        <div class="detail-grid">
            <div class="detail-field">
                <span class="label">Path</span>
                <span class="value mono" style="font-size:12px">${escapeHtml(proj.path || '')}</span>
            </div>
            <div class="detail-field">
                <span class="label">Lifecycle</span>
                <span class="value">${escapeHtml(proj.lifecycle || 'unknown')}</span>
            </div>
            <div class="detail-field">
                <span class="label">Priority</span>
                <span class="value">${pf?.priority || 5}/10</span>
            </div>
            <div class="detail-field">
                <span class="label">Total Tasks</span>
                <span class="value">${proj.total_tasks || 0}</span>
            </div>
            <div class="detail-field">
                <span class="label">Total Cost</span>
                <span class="value">${formatCost(proj.total_cost || 0)}</span>
            </div>
            <div class="detail-field">
                <span class="label">Active Goals</span>
                <span class="value">${proj.active_goals || 0}</span>
            </div>
            <div class="detail-field">
                <span class="label">Daily Budget</span>
                <span class="value">${pf?.cost_budget_daily ? formatCost(pf.cost_budget_daily) : 'None'}</span>
            </div>
            <div class="detail-field">
                <span class="label">Spent Today</span>
                <span class="value">${formatCost(pf?.cost_spent_today || 0)}</span>
            </div>
            <div class="detail-field">
                <span class="label">Throttled</span>
                <span class="value" style="color:${pf?.throttled ? 'var(--red)' : 'var(--green)'}">${pf?.throttled ? 'Yes' : 'No'}</span>
            </div>
            ${proj.ports ? `<div class="detail-field">
                <span class="label">Ports</span>
                <span class="value mono" style="font-size:12px">${escapeHtml(JSON.stringify(proj.ports))}</span>
            </div>` : ''}
        </div>
        ${pf?.throttled ? `<div style="margin-top:12px"><button class="admin-btn admin-btn-primary admin-btn-sm" onclick="unthrottleProject('${escapeHtml(proj.name)}')">Unthrottle</button></div>` : ''}
    </div>`;
}

(window as any).unthrottleProject = async function(name: string) {
    await fetch(`${API_BASE}/api/portfolio/${encodeURIComponent(name)}/unthrottle`, { method: 'POST' });
    renderModule('projects');
};

// ══════════════════════════════════════════════════════════════
// MODULE: Supervisor
// ══════════════════════════════════════════════════════════════

async function loadSupervisor(content: HTMLElement): Promise<void> {
    const [statusRes, cyclesRes, memoryRes, proposalsRes] = await Promise.all([
        fetch(`${API_BASE}/api/supervisor/status`),
        fetch(`${API_BASE}/api/supervisor/cycles?limit=50`),
        fetch(`${API_BASE}/api/supervisor/memory`),
        fetch(`${API_BASE}/api/supervisor/proposals`),
    ]);

    const status = await statusRes.json();
    const cyclesData = await cyclesRes.json();
    const memoryData = await memoryRes.json();
    const proposalsData = await proposalsRes.json();

    const cycles = cyclesData.cycles || [];
    const proposals = proposalsData.proposals || [];
    const pending = proposals.filter((p: any) => p.status === 'pending');
    const resolved = proposals.filter((p: any) => p.status !== 'pending');

    // Update proposal badge
    const badge = document.getElementById('proposalCount');
    if (badge) {
        badge.textContent = String(pending.length);
        badge.style.display = pending.length > 0 ? 'inline' : 'none';
    }

    // Header actions
    const actionsEl = document.getElementById('moduleActions');
    if (actionsEl) {
        actionsEl.innerHTML = `
            <button class="admin-btn admin-btn-sm" onclick="toggleSupervisorPause()">${status.paused ? 'Resume' : 'Pause'}</button>
            <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="triggerSupervisorCycle()">Trigger Cycle</button>
        `;
    }

    let html = `<div class="fade-in">`;

    // Status cards
    const supStatus = status.paused ? 'Paused' : status.enabled ? 'Running' : 'Disabled';
    const supColor = status.paused ? 'var(--amber)' : status.enabled ? 'var(--green)' : 'var(--red)';

    html += `<div class="stat-row">
        <div class="stat-card">
            <span class="stat-label">Status</span>
            <span class="stat-value" style="font-size:18px;color:${supColor}">${supStatus}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Total Cycles</span>
            <span class="stat-value">${status.totalCycles || cycles.length}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Last Cycle</span>
            <span class="stat-value" style="font-size:14px">${status.lastCycle ? timeSince(status.lastCycle.completed_at || status.lastCycle.started_at) : 'Never'}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Pending Proposals</span>
            <span class="stat-value" style="color:${pending.length > 0 ? 'var(--amber)' : 'var(--text-heading)'}">${pending.length}</span>
        </div>
    </div>`;

    // Proposals (pending first)
    if (pending.length > 0) {
        html += `<div class="admin-card"><h2>Strategic Proposals (${pending.length} Pending)</h2>`;
        for (const p of pending) {
            html += renderProposalCard(p);
        }
        html += `</div>`;
    }

    // Cycle cost chart
    if (cycles.length > 0) {
        html += `<div class="chart-row">
            <div class="chart-container">
                <div class="chart-title">Supervisor Cost per Cycle (Last ${Math.min(cycles.length, 30)})</div>
                <div class="chart-canvas-wrap"><canvas id="supervisorCostChart"></canvas></div>
            </div>
            <div class="chart-container">
                <div class="chart-title">Turns per Cycle</div>
                <div class="chart-canvas-wrap"><canvas id="supervisorTurnsChart"></canvas></div>
            </div>
        </div>`;
    }

    // Cycle history table
    html += `<div class="admin-card">
        <h2>Cycle History</h2>
        <table class="admin-table">
            <thead><tr>
                <th>#</th><th>Started</th><th>Duration</th><th>Actions</th><th>Observations</th><th>Cost</th><th>Turns</th>
            </tr></thead>
            <tbody>`;

    for (const c of cycles.slice(0, 30)) {
        const duration = c.started_at && c.completed_at
            ? Math.round((new Date(c.completed_at).getTime() - new Date(c.started_at).getTime()) / 1000) + 's'
            : '—';
        let actions = '—';
        try {
            const a = JSON.parse(c.actions_taken || '[]');
            actions = Array.isArray(a) ? a.length + ' actions' : '—';
        } catch { actions = c.actions_taken ? '1 action' : '—'; }

        let observations = '—';
        try {
            const o = JSON.parse(c.observations || '[]');
            observations = Array.isArray(o) ? o.length + ' obs' : (typeof c.observations === 'string' ? c.observations.slice(0, 60) : '—');
        } catch { observations = c.observations ? String(c.observations).slice(0, 60) : '—'; }

        html += `<tr onclick="expandCycle(this, ${escapeHtml(JSON.stringify(JSON.stringify(c)))})">
            <td class="num">${c.cycle_number || '—'}</td>
            <td>${formatDateTime(c.started_at)}</td>
            <td class="num">${duration}</td>
            <td>${actions}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(observations)}</td>
            <td class="num">${formatCost(c.cost_usd || 0)}</td>
            <td class="num">${c.num_turns || '—'}</td>
        </tr>`;
    }

    html += `</tbody></table></div>`;

    // Memory banks
    const memoryFiles = memoryData.files || {};
    const memoryKeys = Object.keys(memoryFiles);
    if (memoryKeys.length > 0) {
        html += `<div class="admin-card">
            <h2>Memory Banks</h2>
            <div class="memory-tabs" id="memoryTabs">
                ${memoryKeys.map((k, i) => `<button class="memory-tab ${i === 0 ? 'active' : ''}" data-file="${escapeHtml(k)}">${escapeHtml(k.replace('.md', ''))}</button>`).join('')}
            </div>
            <div class="memory-content" id="memoryContent">${escapeHtml(memoryFiles[memoryKeys[0]] || 'Empty')}</div>
        </div>`;
    }

    // Resolved proposals history
    if (resolved.length > 0) {
        html += `<div class="admin-card"><h2>Proposal History (${resolved.length})</h2>`;
        for (const p of resolved.slice(0, 10)) {
            html += renderProposalCard(p);
        }
        html += `</div>`;
    }

    html += `</div>`;
    content.innerHTML = html;

    // Memory tab switching
    const memTabs = document.getElementById('memoryTabs');
    const memContent = document.getElementById('memoryContent');
    if (memTabs && memContent) {
        memTabs.addEventListener('click', (e) => {
            const tab = (e.target as HTMLElement).closest('.memory-tab');
            if (!tab) return;
            const file = tab.getAttribute('data-file') || '';
            memTabs.querySelectorAll('.memory-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            memContent.textContent = memoryFiles[file] || 'Empty';
        });
    }

    // Charts
    if (cycles.length > 0) {
        const recentCycles = cycles.slice(0, 30).reverse();
        createChart('supervisorCostChart', {
            type: 'line',
            data: {
                labels: recentCycles.map((c: any) => c.cycle_number || ''),
                datasets: [{
                    label: 'Cost (USD)',
                    data: recentCycles.map((c: any) => c.cost_usd || 0),
                    borderColor: chartColor('purple'),
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
                scales: { y: { beginAtZero: true, ticks: { callback: (v: number) => '$' + v.toFixed(3) } } }
            }
        });

        createChart('supervisorTurnsChart', {
            type: 'bar',
            data: {
                labels: recentCycles.map((c: any) => c.cycle_number || ''),
                datasets: [{
                    label: 'Turns',
                    data: recentCycles.map((c: any) => c.num_turns || 0),
                    backgroundColor: chartColor('cyan') + '60',
                    borderColor: chartColor('cyan'),
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
}

function renderProposalCard(p: any): string {
    const statusCls = p.status === 'approved' ? 'approved' : p.status === 'dismissed' ? 'dismissed' : '';
    let actionsHtml = '';
    if (p.status === 'pending') {
        actionsHtml = `<div class="proposal-actions">
            <button class="admin-btn admin-btn-success admin-btn-sm" onclick="approveProposal('${p.id}')">Approve</button>
            <button class="admin-btn admin-btn-sm" onclick="dismissProposal('${p.id}')">Dismiss</button>
        </div>`;
    }
    return `<div class="proposal-card ${statusCls}">
        <div class="proposal-header">
            <span class="proposal-title">${escapeHtml(p.title)}</span>
            ${categoryBadge(p.category || 'improvement')}
        </div>
        <div class="proposal-desc">${escapeHtml(p.description || '')}</div>
        ${p.supervisor_reasoning ? `<div class="proposal-reasoning">${escapeHtml(p.supervisor_reasoning.slice(0, 300))}</div>` : ''}
        <div class="activity-meta">
            ${p.project_path ? escapeHtml(p.project_path.split('/').pop() || '') + ' · ' : ''}
            ${p.estimated_effort || 'medium'} effort · ${timeSince(p.created_at)}
            ${p.status !== 'pending' ? ' · ' + p.status + (p.reviewed_at ? ' ' + timeSince(p.reviewed_at) : '') : ''}
        </div>
        ${actionsHtml}
    </div>`;
}

(window as any).approveProposal = async function(id: string) {
    await fetch(`${API_BASE}/api/supervisor/proposals/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    renderModule('supervisor');
};

(window as any).dismissProposal = async function(id: string) {
    const notes = prompt('Dismiss reason (optional):');
    await fetch(`${API_BASE}/api/supervisor/proposals/${id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes || '' })
    });
    renderModule('supervisor');
};

(window as any).triggerSupervisorCycle = async function() {
    await fetch(`${API_BASE}/api/supervisor/trigger`, { method: 'POST' });
};

(window as any).toggleSupervisorPause = async function() {
    await fetch(`${API_BASE}/api/supervisor/pause`, { method: 'POST' });
    setTimeout(() => renderModule('supervisor'), 500);
};

(window as any).expandCycle = function(row: HTMLElement, dataJson: string) {
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains('cycle-detail-row')) {
        existing.remove();
        return;
    }
    // Remove any other expanded rows
    document.querySelectorAll('.cycle-detail-row').forEach(el => el.remove());

    try {
        const c = JSON.parse(dataJson);
        const detailRow = document.createElement('tr');
        detailRow.classList.add('cycle-detail-row');
        let detailHtml = '<td colspan="7" style="padding:12px 16px;background:var(--bg-page);border-radius:4px">';

        if (c.reasoning) detailHtml += `<div style="margin-bottom:8px"><strong style="color:var(--text-dim);font-size:11px;text-transform:uppercase">Reasoning</strong><div style="font-size:12px;color:var(--text);margin-top:4px;white-space:pre-wrap">${escapeHtml(c.reasoning)}</div></div>`;

        try {
            const actions = JSON.parse(c.actions_taken || '[]');
            if (Array.isArray(actions) && actions.length > 0) {
                detailHtml += `<div style="margin-bottom:8px"><strong style="color:var(--text-dim);font-size:11px;text-transform:uppercase">Actions</strong><div style="font-size:12px;color:var(--text);margin-top:4px;white-space:pre-wrap">${escapeHtml(JSON.stringify(actions, null, 2))}</div></div>`;
            }
        } catch {}

        try {
            const obs = JSON.parse(c.observations || '[]');
            if (Array.isArray(obs) && obs.length > 0) {
                detailHtml += `<div><strong style="color:var(--text-dim);font-size:11px;text-transform:uppercase">Observations</strong><div style="font-size:12px;color:var(--text);margin-top:4px;white-space:pre-wrap">${escapeHtml(JSON.stringify(obs, null, 2))}</div></div>`;
            }
        } catch {}

        if (c.error) detailHtml += `<div style="margin-top:8px;color:var(--red);font-size:12px">${escapeHtml(c.error)}</div>`;

        detailHtml += '</td>';
        detailRow.innerHTML = detailHtml;
        row.after(detailRow);
    } catch {}
};

// ══════════════════════════════════════════════════════════════
// MODULE: Reports
// ══════════════════════════════════════════════════════════════

async function loadReports(content: HTMLElement): Promise<void> {
    const [digestRes, digestsRes, weeklyRes, weekliesRes, analyticsRes] = await Promise.all([
        fetch(`${API_BASE}/api/digest/latest`),
        fetch(`${API_BASE}/api/digests`),
        fetch(`${API_BASE}/api/weekly-report/latest`),
        fetch(`${API_BASE}/api/weekly-reports`),
        fetch(`${API_BASE}/api/analytics`),
    ]);

    const digestData = await digestRes.json();
    const digestsData = await digestsRes.json();
    const weeklyData = await weeklyRes.json();
    const weekliesData = await weekliesRes.json();
    const analytics = await analyticsRes.json();

    // Header actions
    const actionsEl = document.getElementById('moduleActions');
    if (actionsEl) {
        actionsEl.innerHTML = `
            <button class="admin-btn admin-btn-sm" onclick="generateDigest()">Generate Digest</button>
            <button class="admin-btn admin-btn-sm" onclick="generateWeekly()">Generate Weekly</button>
        `;
    }

    let html = `<div class="fade-in">`;

    // Analytics charts
    const byModel = analytics.byModel || {};
    const modelLabels = Object.keys(byModel);

    html += `<div class="chart-row">
        <div class="chart-container">
            <div class="chart-title">Task Velocity</div>
            <div class="chart-canvas-wrap"><canvas id="reportVelocityChart"></canvas></div>
        </div>
        <div class="chart-container">
            <div class="chart-title">Model Efficiency</div>
            <div class="chart-canvas-wrap"><canvas id="modelRadarChart"></canvas></div>
        </div>
    </div>`;

    // Model comparison table
    if (modelLabels.length > 0) {
        html += `<div class="admin-card"><h2>Model Comparison</h2>
            <table class="admin-table">
                <thead><tr><th>Model</th><th>Tasks</th><th>Success Rate</th><th>Avg Cost</th><th>Avg Turns</th><th>Avg Duration</th></tr></thead>
                <tbody>`;
        for (const m of modelLabels) {
            const s = byModel[m];
            html += `<tr>
                <td><strong>${escapeHtml(m)}</strong></td>
                <td class="num">${s.count}</td>
                <td class="num">${formatPct(s.successRate)}</td>
                <td class="num">${formatCost(s.avgCost)}</td>
                <td class="num">${(s.avgTurns || 0).toFixed(1)}</td>
                <td class="num">${s.avgDuration ? Math.round(s.avgDuration) + 's' : '—'}</td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
    }

    // Optimisation suggestions
    const suggestions = analytics.suggestions || [];
    if (suggestions.length > 0) {
        html += `<div class="admin-card"><h2>Cost Optimisation Suggestions</h2>`;
        for (const s of suggestions) {
            html += `<div style="padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:13px">
                <strong>${escapeHtml(s.project?.split('/').pop() || '')}</strong> (${escapeHtml(s.taskType)}):
                Switch <span class="badge badge-${s.currentModel === 'opus' ? 'strategic' : 'improvement'}">${s.currentModel}</span>
                to <span class="badge badge-${s.suggestedModel === 'haiku' ? 'opportunity' : 'improvement'}">${s.suggestedModel}</span>
                — save ${formatCost(s.savingsPerTask)}/task (${formatPct(s.cheapSuccessRate)} success, n=${s.sampleSize})
            </div>`;
        }
        html += `</div>`;
    }

    // Latest digest
    const digest = digestData.digest;
    html += `<div class="admin-card"><h2>Latest Daily Digest</h2>`;
    if (digest) {
        html += `<div class="activity-meta" style="margin-bottom:8px">${formatDate(digest.period_start)} — ${digest.task_count || 0} tasks, ${formatCost(digest.total_cost || 0)}</div>`;
        html += `<div class="report-content">${escapeHtml(digest.digest_text || 'No content')}</div>`;
    } else {
        html += `<p style="color:var(--text-muted)">No digest available. Click "Generate Digest" to create one.</p>`;
    }
    html += `</div>`;

    // Digest history
    const digests = digestsData.digests || [];
    if (digests.length > 1) {
        html += `<div class="admin-card"><h2>Digest History</h2><div class="report-history-list">`;
        for (const d of digests.slice(0, 10)) {
            html += `<div class="report-history-item" onclick="viewDigest('${d.id}')">
                <span>${formatDate(d.period_start)} — ${d.task_count || 0} tasks</span>
                <span>${formatCost(d.total_cost || 0)}</span>
            </div>`;
        }
        html += `</div></div>`;
    }

    // Latest weekly report
    const weekly = weeklyData.report;
    html += `<div class="admin-card"><h2>Latest Weekly Report</h2>`;
    if (weekly) {
        html += `<div class="activity-meta" style="margin-bottom:8px">${formatDate(weekly.week_start)} — ${formatDate(weekly.week_end)} · ${weekly.task_count || 0} tasks, ${formatCost(weekly.total_cost || 0)}</div>`;
        html += `<div class="report-content">${escapeHtml(weekly.report_text || 'No content')}</div>`;
    } else {
        html += `<p style="color:var(--text-muted)">No weekly report available. Click "Generate Weekly" to create one.</p>`;
    }
    html += `</div>`;

    html += `</div>`;
    content.innerHTML = html;

    // Charts
    const velocity = analytics.velocity || {};
    const dailyCounts = (velocity.dailyCounts || []).reverse();
    createChart('reportVelocityChart', {
        type: 'line',
        data: {
            labels: dailyCounts.map((d: any) => d.date?.slice(5) || ''),
            datasets: [{
                label: 'Tasks/Day',
                data: dailyCounts.map((d: any) => d.count || 0),
                borderColor: chartColor('blue'),
                backgroundColor: 'rgba(56, 139, 253, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });

    if (modelLabels.length > 0) {
        const maxCost = Math.max(...modelLabels.map(m => byModel[m].avgCost || 0), 0.001);
        const maxTurns = Math.max(...modelLabels.map(m => byModel[m].avgTurns || 0), 1);

        createChart('modelRadarChart', {
            type: 'radar',
            data: {
                labels: ['Success Rate', 'Cost Efficiency', 'Turn Efficiency'],
                datasets: modelLabels.map((m, i) => ({
                    label: m,
                    data: [
                        (byModel[m].successRate || 0) * 100,
                        (1 - (byModel[m].avgCost || 0) / maxCost) * 100,
                        (1 - (byModel[m].avgTurns || 0) / maxTurns) * 100,
                    ],
                    borderColor: m === 'opus' ? chartColor('purple') : m === 'sonnet' ? chartColor('blue') : chartColor('green'),
                    backgroundColor: (m === 'opus' ? chartColor('purple') : m === 'sonnet' ? chartColor('blue') : chartColor('green')) + '20',
                    pointRadius: 3,
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { r: { beginAtZero: true, max: 100, ticks: { display: false }, grid: { color: 'rgba(48, 54, 61, 0.2)' } } }
            }
        });
    }
}

(window as any).generateDigest = async function() {
    await fetch(`${API_BASE}/api/digest/generate`, { method: 'POST' });
    setTimeout(() => renderModule('reports'), 1000);
};

(window as any).generateWeekly = async function() {
    await fetch(`${API_BASE}/api/weekly-report/generate`, { method: 'POST' });
    setTimeout(() => renderModule('reports'), 1000);
};

(window as any).viewDigest = async function(id: string) {
    try {
        const res = await fetch(`${API_BASE}/api/digest/${id}`);
        const data = await res.json();
        if (data.digest) {
            const content = document.getElementById('mainContent');
            if (!content) return;
            const d = data.digest;
            content.innerHTML = `<div class="fade-in">
                <div style="margin-bottom:12px"><button class="admin-btn admin-btn-sm" onclick="renderModule('reports')">&larr; Back to Reports</button></div>
                <div class="admin-card">
                    <h2>Digest: ${formatDate(d.period_start)}</h2>
                    <div class="activity-meta" style="margin-bottom:12px">${d.task_count || 0} tasks · ${formatCost(d.total_cost || 0)}</div>
                    <div class="report-content">${escapeHtml(d.digest_text || '')}</div>
                </div>
            </div>`;
        }
    } catch {}
};

// ══════════════════════════════════════════════════════════════
// MODULE: Products
// ══════════════════════════════════════════════════════════════

async function loadProducts(content: HTMLElement): Promise<void> {
    if (selectedProductId) {
        await loadProductDetail(content, selectedProductId);
    } else {
        await loadProductList(content);
    }
}

async function loadProductList(content: HTMLElement): Promise<void> {
    const res = await fetch(`${API_BASE}/api/products`);
    const data = await res.json();
    const products = data.products || [];

    let html = `<div class="fade-in">
        <div class="product-grid">`;

    for (const p of products) {
        const phasesCompleted = p.phases_completed || 0;
        const totalPhases = 7;
        const pct = (phasesCompleted / totalPhases) * 100;

        const statusCls = p.status === 'completed' ? 'done'
            : p.status === 'active' || p.status === 'running' ? 'running'
            : p.status === 'paused' ? 'pending'
            : 'cancelled';

        html += `<div class="product-card" data-product-id="${escapeHtml(p.id)}" onclick="selectProduct('${escapeHtml(p.id)}')">
            <div class="product-card-header">
                <span class="product-card-name">${escapeHtml(p.name)}</span>
                <span class="phase-indicator badge badge-${p.current_phase_index >= 6 ? 'done' : p.current_phase_index >= 3 ? 'improvement' : 'strategic'}">Phase ${(p.current_phase_index || 0) + 1}/7</span>
            </div>
            <div class="product-card-status">
                ${statusBadge(p.status || 'pending')}
            </div>
            <div class="progress-bar" style="margin: 8px 0">
                <div class="progress-bar-fill" style="width: ${pct}%"></div>
            </div>
            <div class="product-card-stats">
                <span>${phasesCompleted}/7 phases</span>
                <span>${formatCost(p.total_cost_usd || 0)}</span>
            </div>
            <div class="product-card-meta">
                <span style="font-size: 11px; color: var(--text-muted)">${formatDate(p.created_at)}</span>
            </div>
        </div>`;
    }

    html += `</div></div>`;
    content.innerHTML = html;
}

async function loadProductDetail(content: HTMLElement, productId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
    const data = await res.json();
    const product = data.product || {};
    const phases = data.phases || [];
    const knowledge = data.knowledge || [];

    // Group knowledge by category
    const knowledgeByCategory: Record<string, any[]> = {};
    for (const k of knowledge) {
        const cat = k.category || 'general';
        if (!knowledgeByCategory[cat]) knowledgeByCategory[cat] = [];
        knowledgeByCategory[cat].push(k);
    }

    let html = `<div class="fade-in">
        <div style="margin-bottom: 16px">
            <button class="admin-btn admin-btn-sm" onclick="backToProductList()">← Back to Products</button>
        </div>

        <div class="detail-panel">
            <h2>${escapeHtml(product.name)}</h2>
            <div class="detail-grid">
                <div class="detail-field">
                    <span class="label">Status</span>
                    <span class="value">${statusBadge(product.status || 'pending')}</span>
                </div>
                <div class="detail-field">
                    <span class="label">Current Phase</span>
                    <span class="value">Phase ${(product.current_phase_index || 0) + 1} of 7</span>
                </div>
                <div class="detail-field">
                    <span class="label">Total Cost</span>
                    <span class="value">${formatCost(product.total_cost_usd || 0)}</span>
                </div>
                <div class="detail-field">
                    <span class="label">Created</span>
                    <span class="value">${formatDateTime(product.created_at)}</span>
                </div>
                ${product.seed_text ? `<div class="detail-field">
                    <span class="label">Seed</span>
                    <span class="value" style="font-size: 12px">${escapeHtml((product.seed_text || '').substring(0, 60))}</span>
                </div>` : ''}
            </div>
        </div>

        <div class="admin-card">
            <h2>Phase Timeline</h2>
            <div class="phase-timeline">`;

    const phaseNames = ['Research', 'Design', 'Architecture', 'Build', 'Test', 'Document', 'Deploy'];
    for (let i = 0; i < 7; i++) {
        const phase = phases.find((p: any) => p.phase_index === i);
        const isCurrentPhase = i === product.current_phase_index;
        const isCompleted = i < product.current_phase_index || (phase && phase.status === 'completed');
        const statusClass = isCompleted ? 'done' : isCurrentPhase ? 'current' : 'pending';

        html += `<div class="phase-node ${statusClass}" onclick="expandPhase(event, ${i})">
            <div class="phase-node-circle"></div>
            <div class="phase-node-label">${phaseNames[i]}</div>
            ${phase ? `<div class="phase-node-badge">${statusBadge(phase.status || 'pending')}</div>` : ''}
        </div>`;
    }

    html += `</div></div>`;

    // Phase details
    if (phases.length > 0) {
        html += `<div class="admin-card">
            <h2>Phase Details</h2>
            <div class="phase-details-list">`;

        for (const phase of phases) {
            const phaseStatus = phase.status || 'pending';
            const gateStatus = phase.gate_status || '—';
            const costUsd = phase.cost_usd || 0;
            const costColor = costUsd > 0 ? 'var(--text)' : 'var(--text-muted)';

            html += `<div class="phase-detail-card" onclick="togglePhaseDetail(event, ${phase.phase_index})">
                <div class="phase-detail-header">
                    <span class="phase-detail-name">${phaseNames[phase.phase_index]}</span>
                    <div class="phase-detail-badges">
                        ${statusBadge(phaseStatus)}
                        ${phase.gate_status ? `<span class="badge badge-${gateStatus === 'passed' ? 'done' : gateStatus === 'pending' ? 'pending' : 'failed'}">${escapeHtml(gateStatus)}</span>` : ''}
                    </div>
                </div>
                <div class="phase-detail-meta">
                    <span style="color: ${costColor}">Cost: ${formatCost(costUsd)}</span>
                    ${phase.started_at ? `<span style="color: var(--text-muted)">Started: ${formatDateTime(phase.started_at)}</span>` : ''}
                    ${phase.completed_at ? `<span style="color: var(--text-muted)">Completed: ${formatDateTime(phase.completed_at)}</span>` : ''}
                </div>
                <div class="phase-detail-expanded" style="display: none">
                    ${phase.goal_id ? `<div style="margin-top: 8px; padding: 8px; background: var(--bg-page); border-radius: 4px; font-size: 12px">
                        <strong style="color: var(--text-muted)">Goal:</strong> <a href="#" style="color: var(--blue)">${escapeHtml(phase.goal_id)}</a>
                    </div>` : ''}
                    ${phase.artifacts ? `<div style="margin-top: 8px; padding: 8px; background: var(--bg-page); border-radius: 4px; font-size: 11px; font-family: ui-monospace">
                        <strong style="color: var(--text-muted)">Artifacts:</strong>
                        <pre style="margin-top: 4px; color: var(--text-dim); overflow-x: auto">${escapeHtml(typeof phase.artifacts === 'string' ? phase.artifacts : JSON.stringify(phase.artifacts, null, 2))}</pre>
                    </div>` : ''}
                </div>
            </div>`;
        }

        html += `</div></div>`;
    }

    // Knowledge section
    if (Object.keys(knowledgeByCategory).length > 0) {
        html += `<div class="admin-card">
            <h2>Knowledge Base</h2>
            <div class="knowledge-section">`;

        for (const [category, entries] of Object.entries(knowledgeByCategory)) {
            html += `<div class="knowledge-category">
                <div class="knowledge-category-title">${escapeHtml(category.charAt(0).toUpperCase() + category.slice(1))}</div>`;

            for (const entry of entries) {
                html += `<div class="knowledge-entry" onclick="toggleKnowledgeEntry(event, this)">
                    <div class="knowledge-entry-header">
                        <span class="knowledge-entry-title">${escapeHtml(entry.title || 'Untitled')}</span>
                        <span style="font-size: 11px; color: var(--text-muted)">${formatDate(entry.created_at)}</span>
                    </div>
                    <div class="knowledge-entry-content" style="display: none">
                        <div style="margin-top: 8px; padding: 8px; background: var(--bg-page); border-radius: 4px; font-size: 12px; line-height: 1.5">
                            ${escapeHtml(entry.content || '—').replace(/\n/g, '<br>')}
                        </div>
                        ${entry.source_phase ? `<div style="margin-top: 6px; font-size: 11px; color: var(--text-muted)">Source: Phase ${entry.source_phase + 1}</div>` : ''}
                    </div>
                </div>`;
            }

            html += `</div>`;
        }

        html += `</div></div>`;
    }

    html += `</div>`;
    content.innerHTML = html;
}

(window as any).expandPhase = function(event: Event, phaseIndex: number) {
    // Scroll to the corresponding phase detail card
    const cards = document.querySelectorAll('.phase-detail-card');
    if (cards[phaseIndex]) {
        cards[phaseIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Toggle it open
        const expanded = cards[phaseIndex].querySelector('.phase-detail-expanded') as HTMLElement;
        if (expanded && expanded.style.display === 'none') {
            expanded.style.display = 'block';
        }
    }
};

(window as any).renderModule = renderModule;

(window as any).selectProduct = function(id: string) {
    selectedProductId = selectedProductId === id ? null : id;
    renderModule('products');
};

(window as any).backToProductList = function() {
    selectedProductId = null;
    renderModule('products');
};

(window as any).togglePhaseDetail = function(event: Event, phaseIndex: number) {
    event.stopPropagation();
    const card = (event.target as HTMLElement).closest('.phase-detail-card') as HTMLElement;
    if (!card) return;
    const expanded = card.querySelector('.phase-detail-expanded') as HTMLElement;
    if (expanded) {
        const isHidden = expanded.style.display === 'none';
        expanded.style.display = isHidden ? 'block' : 'none';
    }
};

(window as any).toggleKnowledgeEntry = function(event: Event, element: HTMLElement) {
    event.stopPropagation();
    const content = element.querySelector('.knowledge-entry-content') as HTMLElement;
    if (content) {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
    }
};

// ══════════════════════════════════════════════════════════════
// MODULE: Conversations
// ══════════════════════════════════════════════════════════════

async function loadConversations(content: HTMLElement): Promise<void> {
    try {
        // Fetch grouped conversations by temporal period
        const res = await fetch(`${API_BASE}/api/conversations/grouped`);
        const data = await res.json();
        const periods = data.periods || {};

        // Header actions
        const actionsEl = document.getElementById('moduleActions');
        if (actionsEl) {
            actionsEl.innerHTML = `
                <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="showNewThreadForm()">New Thread</button>
            `;
        }

        // Build HTML with two-column layout: thread list | thread detail
        let html = `<div class="fade-in conversation-container">
            <div class="conversation-layout">
                <!-- Thread List -->
                <div class="thread-list-panel">
                    <!-- Period Filter Bar -->
                    <div class="period-filter-bar">`;

        // Add "All" button
        const allCount = Object.values(periods).reduce((sum, p: any) => sum + (p.count || 0), 0);
        const isAllActive = selectedConversationPeriod === 'all';
        html += `<button class="period-filter-btn ${isAllActive ? 'active' : ''}" onclick="filterConversationsByPeriod('all')" title="All conversations">
            <span>All</span>
            <span class="period-badge">${allCount}</span>
        </button>`;

        // Add period buttons
        const periodOrder = ['today', 'this_week', 'last_week', 'this_month', 'older'];
        const periodLabels: Record<string, string> = {
            'today': 'Today',
            'this_week': 'This Week',
            'last_week': 'Last Week',
            'this_month': 'This Month',
            'older': 'Older'
        };
        for (const period of periodOrder) {
            const p = periods[period];
            if (!p) continue;
            const isActive = selectedConversationPeriod === period;
            const label = periodLabels[period] || p.label;
            html += `<button class="period-filter-btn ${isActive ? 'active' : ''}" onclick="filterConversationsByPeriod('${period}')" title="${label}">
                <span>${label}</span>
                <span class="period-badge">${p.count}</span>
            </button>`;
        }

        html += `</div>

                    <!-- Search Bar -->
                    <div style="padding:8px;border-bottom:1px solid var(--border-subtle)">
                        <div style="display:flex;gap:6px;align-items:center">
                            <input type="text" id="conversationSearchInput" class="form-input" placeholder="Search conversations..." style="flex:1;font-size:12px;padding:6px 10px" onkeyup="performConversationSearch(this.value, event)">
                            <button class="admin-btn admin-btn-sm" onclick="clearConversationSearch()" id="clearSearchBtn" style="display:none;padding:4px 8px;font-size:11px">Clear</button>
                        </div>
                    </div>
                    <div id="threadList" class="thread-list">`;

        // Get conversations for current period
        let conversations: any[] = [];
        if (selectedConversationPeriod === 'all') {
            for (const period of periodOrder) {
                if (periods[period]) {
                    conversations = conversations.concat(periods[period].conversations || []);
                }
            }
        } else {
            const p = periods[selectedConversationPeriod];
            conversations = p ? (p.conversations || []) : [];
        }

        // Thread list
        if (conversations.length === 0) {
            html += `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">No threads in this period</div>`;
        } else {
            for (const conv of conversations) {
                const messageCount = conv.message_count || 0;
                const isSelected = selectedConversationId === conv.id;
                const statusBadgeClass = conv.status === 'open' ? 'badge-running' : 'badge-done';
                const statusText = conv.status === 'open' ? 'Open' : 'Resolved';

                // Participant indicators
                const participants = (conv.participants || '').split(',').filter(Boolean);
                let participantHtml = '';
                if (participants.length > 0) {
                    const badges = participants.map((p: string) => {
                        if (p === 'human') return '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:rgba(56,139,253,0.3);color:var(--blue);font-size:9px;line-height:16px;text-align:center;font-weight:600" title="Darron">D</span>';
                        if (p === 'supervisor') return '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:rgba(163,113,247,0.3);color:var(--purple);font-size:9px;line-height:16px;text-align:center;font-weight:600" title="Jim">J</span>';
                        if (p === 'leo') return '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:rgba(56,207,135,0.3);color:var(--green);font-size:9px;line-height:16px;text-align:center;font-weight:600" title="Leo">L</span>';
                        return '';
                    }).join('');
                    participantHtml = `<span style="display:flex;gap:3px;align-items:center">${badges}</span>`;
                }

                // Format summary (truncate to 1 line with ellipsis)
                let summaryHtml = '';
                if (conv.summary) {
                    const truncatedSummary = conv.summary.length > 120
                        ? conv.summary.substring(0, 120) + '…'
                        : conv.summary;
                    summaryHtml = `<div class="thread-item-summary" style="font-size:12px;color:var(--text-body);margin-top:6px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(truncatedSummary)}</div>`;
                }

                // Format topics as badges
                let topicsHtml = '';
                if (conv.topics) {
                    const topics = conv.topics.split(',').map((t: string) => t.trim()).filter(Boolean);
                    if (topics.length > 0) {
                        const topicBadges = topics.slice(0, 3).map((topic: string) =>
                            `<span class="topic-badge" style="display:inline-block;background:var(--bg-input);color:var(--text-body);font-size:10px;padding:2px 8px;border-radius:3px;margin-right:4px;cursor:pointer" title="Filter by: ${escapeHtml(topic)}">${escapeHtml(topic)}</span>`
                        ).join('');
                        topicsHtml = `<div class="thread-item-topics" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${topicBadges}${topics.length > 3 ? `<span style="font-size:10px;color:var(--text-muted)">+${topics.length - 3}</span>` : ''}</div>`;
                    }
                }

                html += `<div class="thread-item ${isSelected ? 'active' : ''}" data-thread-id="${conv.id}" onclick="selectConversationThread('${conv.id}')">
                    <div class="thread-item-title">${escapeHtml(conv.title)}</div>
                    <div class="thread-item-meta">
                        <span style="font-size:11px;color:var(--text-muted)">${timeSince(conv.updated_at)}</span>
                        <span class="badge ${statusBadgeClass}" style="font-size:9px;padding:1px 5px">${statusText}</span>
                        ${participantHtml}
                    </div>
                    ${summaryHtml}
                    ${topicsHtml}
                    <div class="thread-item-count" style="font-size:11px;color:var(--text-muted);margin-top:${summaryHtml || topicsHtml ? '6px' : '0'}">${messageCount} message${messageCount !== 1 ? 's' : ''}</div>
                </div>`;
            }
        }

        html += `</div></div>

                <!-- Thread Detail -->
                <div class="thread-detail-panel" id="threadDetailPanel">`;

        // Right panel - always include threadDetail div so selectConversationThread can render into it
        html += `<div id="threadDetail">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px">Select a thread to view messages</div>
        </div>`;

        html += `</div>
            </div>
        </div>`;

        content.innerHTML = html;

        // Load selected thread details if any
        if (selectedConversationId) {
            await renderConversationThread(selectedConversationId);
        }
    } catch (err: any) {
        content.innerHTML = `<div class="admin-card"><p style="color:var(--red)">Error loading conversations: ${escapeHtml(err.message)}</p></div>`;
    }
}

(window as any).filterConversationsByPeriod = async function(period: string) {
    selectedConversationPeriod = period;
    const content = document.getElementById('mainContent');
    if (content) {
        // Smooth transition
        content.style.opacity = '0.5';
        setTimeout(async () => {
            await loadConversations(content);
            content.style.opacity = '1';
        }, 150);
    }
};

async function renderConversationThread(conversationId: string): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
        const data = await res.json();
        const conversation = data.conversation;
        const messages = data.messages || [];

        const detailPanel = document.getElementById('threadDetail');
        if (!detailPanel) return;

        const resolveButton = conversation.status === 'open'
            ? `<button class="admin-btn admin-btn-sm" onclick="resolveConversation('${conversation.id}')">Resolve</button>`
            : `<button class="admin-btn admin-btn-sm" onclick="reopenConversation('${conversation.id}')">Reopen</button>`;

        let html = `<div class="thread-header">
            <div style="flex:1">
                <button class="admin-btn admin-btn-sm thread-back-btn" onclick="backToThreadList()" style="display:none;margin-bottom:6px;font-size:11px">&larr; Back</button>
                <h2 style="margin:0;margin-bottom:4px;font-size:16px">${escapeHtml(conversation.title)}</h2>
                <div style="font-size:12px;color:var(--text-muted)">${formatDateTime(conversation.created_at)}</div>
            </div>
            <div>${resolveButton}</div>
        </div>

        <div class="message-list" id="messageList">`;

        // Messages
        if (messages.length === 0) {
            html += `<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:12px">No messages yet</div>`;
        } else {
            for (const msg of messages) {
                const isHuman = msg.role === 'human';
                const isLeo = msg.role === 'leo';
                const bubbleClass = isHuman ? 'message-bubble human'
                    : isLeo ? 'message-bubble leo'
                    : 'message-bubble supervisor';
                const label = isHuman ? 'Darron' : isLeo ? 'Leo' : 'Jim';
                const labelColor = isHuman ? 'rgba(255,255,255,0.6)'
                    : isLeo ? 'rgba(56,207,135,0.6)'
                    : 'var(--text-muted)';

                html += `<div class="${bubbleClass}">
                    <div style="font-size:10px;color:${labelColor};margin-bottom:4px">${label} · ${formatTime(msg.created_at)}</div>
                    <div class="message-content" style="word-break:break-word;line-height:1.5">${renderMarkdown(msg.content)}</div>
                </div>`;
            }
        }

        html += `</div>

        <div class="message-input-area">
            <textarea class="message-input" id="messageInput" placeholder="Type your message..." style="resize:vertical;min-height:60px"></textarea>
            <button class="admin-btn admin-btn-primary" onclick="sendConversationMessage('${conversation.id}')">Send</button>
        </div>`;

        detailPanel.innerHTML = html;

        // Scroll to bottom
        const messageList = document.getElementById('messageList');
        if (messageList) {
            setTimeout(() => messageList.scrollTop = messageList.scrollHeight, 0);
        }

        // Focus input
        const input = document.getElementById('messageInput') as HTMLTextAreaElement;
        if (input) {
            input.focus();
        }
    } catch (err: any) {
        const detailPanel = document.getElementById('threadDetail');
        if (detailPanel) {
            detailPanel.innerHTML = `<div style="color:var(--red);padding:16px">Error loading thread: ${escapeHtml(err.message)}</div>`;
        }
    }
}

(window as any).selectConversationThread = async function(conversationId: string) {
    selectedConversationId = conversationId;
    await renderConversationThread(conversationId);

    // Update active state
    document.querySelectorAll('.thread-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-thread-id') === conversationId);
    });

    // Mobile: show thread detail, hide list
    const layout = document.querySelector('.conversation-layout');
    if (layout) layout.classList.add('thread-selected');
};

(window as any).backToThreadList = function() {
    selectedConversationId = null;
    const layout = document.querySelector('.conversation-layout');
    if (layout) layout.classList.remove('thread-selected');
};

(window as any).showNewThreadForm = function() {
    const title = prompt('Thread title:');
    if (!title) return;
    createNewConversation(title);
};

async function createNewConversation(title: string): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/conversations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        const data = await res.json();
        if (data.conversation) {
            selectedConversationId = data.conversation.id;
            await renderModule('conversations');
        }
    } catch (err: any) {
        alert('Error creating thread: ' + err.message);
    }
}

(window as any).sendConversationMessage = async function(conversationId: string) {
    const input = document.getElementById('messageInput') as HTMLTextAreaElement;
    if (!input || !input.value.trim()) return;

    const content = input.value;
    input.value = '';

    try {
        await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, role: 'human' })
        });
        await renderConversationThread(conversationId);

        // Show waiting indicator — supervisor wakes automatically on human message
        const messageList = document.getElementById('messageList');
        if (messageList) {
            const waiting = document.createElement('div');
            waiting.id = 'supervisorWaiting';
            waiting.className = 'message-bubble supervisor';
            waiting.style.opacity = '0.5';
            waiting.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Jim</div><div style="font-size:12px;color:var(--text-muted)">Thinking...</div>';
            messageList.appendChild(waiting);
            messageList.scrollTop = messageList.scrollHeight;
        }
    } catch (err: any) {
        alert('Error sending message: ' + err.message);
        input.value = content;
    }
};

// ══════════════════════════════════════════════════════════════
// CONVERSATION SEARCH
// ══════════════════════════════════════════════════════════════

let conversationSearchTimeout: any = null;

(window as any).performConversationSearch = async function(query: string, event?: KeyboardEvent) {
    // Debounce search
    if (conversationSearchTimeout) {
        clearTimeout(conversationSearchTimeout);
    }

    const clearBtn = document.getElementById('clearSearchBtn');
    if (!query || query.trim().length === 0) {
        if (clearBtn) clearBtn.style.display = 'none';
        // Reset to thread list
        await loadConversations(document.getElementById('mainContent') as HTMLElement);
        return;
    }

    if (clearBtn) clearBtn.style.display = 'inline-block';

    conversationSearchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/conversations/search?q=${encodeURIComponent(query)}&limit=50`);
            const data = await res.json();

            if (!data.success) {
                const threadList = document.getElementById('threadList');
                if (threadList) {
                    threadList.innerHTML = `<div style="padding:16px;color:var(--red);font-size:13px">Search error: ${escapeHtml(data.error)}</div>`;
                }
                return;
            }

            const results = data.results || [];
            const threadList = document.getElementById('threadList');
            if (!threadList) return;

            if (results.length === 0) {
                threadList.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">No results for "${escapeHtml(query)}"</div>`;
                return;
            }

            // Build search results as passage cards
            let html = '';
            const uniqueConversations = new Map<string, any>();

            for (const result of results) {
                const convId = result.conversation_id;
                if (!uniqueConversations.has(convId)) {
                    uniqueConversations.set(convId, result);
                }
            }

            for (const [convId, result] of uniqueConversations) {
                const snippet = result.matched_message?.snippet || result.matched_message?.content || '';
                const highlightedSnippet = snippet.replace(/<mark>/g, '<strong style="background:rgba(179,146,240,0.3);color:var(--purple)">').replace(/<\/mark>/g, '</strong>');
                const isSelected = selectedConversationId === convId;
                const statusBadgeClass = result.conversation_status === 'open' ? 'badge-running' : 'badge-done';
                const statusText = result.conversation_status === 'open' ? 'Open' : 'Resolved';
                const roleColor = result.matched_message?.role === 'human' ? 'var(--blue)' : result.matched_message?.role === 'leo' ? 'var(--green)' : 'var(--purple)';
                const roleLabel = result.matched_message?.role === 'human' ? 'Darron' : result.matched_message?.role === 'leo' ? 'Leo' : 'Jim';

                html += `<div class="search-result-card ${isSelected ? 'active' : ''}" data-thread-id="${convId}" onclick="selectConversationThread('${convId}')" style="background:var(--bg-page);border:1px solid var(--border-subtle);border-radius:6px;padding:12px;cursor:pointer;transition:background 0.15s;margin-bottom:8px">
                    <div class="search-result-header" style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px">
                        <div style="flex:1;min-width:0">
                            <div class="search-result-title" style="font-size:13px;font-weight:600;color:var(--text-heading);margin-bottom:4px;word-break:break-word">${escapeHtml(result.conversation_title)}</div>
                            <div style="display:flex;gap:6px;align-items:center;font-size:11px">
                                <span style="color:var(--text-muted)">${timeSince(result.created_at)}</span>
                                <span class="badge ${statusBadgeClass}" style="font-size:9px;padding:1px 5px">${statusText}</span>
                            </div>
                        </div>
                    </div>
                    <div class="search-result-snippet" style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:4px;padding:10px;margin-bottom:8px;font-size:12px;color:var(--text-dim);line-height:1.5;max-height:60px;overflow:hidden;text-overflow:ellipsis">
                        <div style="display:flex;gap:6px;margin-bottom:4px">
                            <span style="color:${roleColor};font-weight:600;flex-shrink:0">${roleLabel}</span>
                            <span style="color:var(--text-muted);font-size:10px">${formatTime(result.matched_message?.created_at)}</span>
                        </div>
                        <div style="color:var(--text);word-break:break-word">${highlightedSnippet}</div>
                    </div>
                </div>`;
            }

            threadList.innerHTML = html;
        } catch (err: any) {
            const threadList = document.getElementById('threadList');
            if (threadList) {
                threadList.innerHTML = `<div style="padding:16px;color:var(--red);font-size:13px">Search error: ${escapeHtml(err.message)}</div>`;
            }
        }
    }, 300);
};

(window as any).clearConversationSearch = async function() {
    const input = document.getElementById('conversationSearchInput') as HTMLInputElement;
    if (input) {
        input.value = '';
    }
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    selectedConversationId = null;
    await loadConversations(document.getElementById('mainContent') as HTMLElement);
};

(window as any).resolveConversation = async function(conversationId: string) {
    try {
        await fetch(`${API_BASE}/api/conversations/${conversationId}/resolve`, { method: 'POST' });
        await renderModule('conversations');
    } catch (err: any) {
        alert('Error resolving conversation: ' + err.message);
    }
};

(window as any).reopenConversation = async function(conversationId: string) {
    try {
        await fetch(`${API_BASE}/api/conversations/${conversationId}/reopen`, { method: 'POST' });
        await renderModule('conversations');
    } catch (err: any) {
        alert('Error reopening conversation: ' + err.message);
    }
};

// ══════════════════════════════════════════════════════════════
// MODULE: Memory Discussions
// ══════════════════════════════════════════════════════════════

async function loadMemoryDiscussions(content: HTMLElement): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/conversations/grouped?type=memory`);
        const data = await res.json();
        const periods = data.periods || {};

        // Header actions
        const actionsEl = document.getElementById('moduleActions');
        if (actionsEl) {
            actionsEl.innerHTML = `
                <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="showNewMemoryThreadForm()">New Discussion</button>
            `;
        }

        let html = `<div class="fade-in conversation-container">
            <div class="conversation-layout md-conversation-layout">
                <!-- Thread List -->
                <div class="thread-list-panel">
                    <!-- Period Filter Bar -->
                    <div class="period-filter-bar">`;

        const allCount = Object.values(periods).reduce((sum, p: any) => sum + (p.count || 0), 0);
        const isAllActive = selectedMemoryDiscussionPeriod === 'all';
        html += `<button class="period-filter-btn ${isAllActive ? 'active' : ''}" onclick="filterMemoryByPeriod('all')" title="All discussions">
            <span>All</span>
            <span class="period-badge">${allCount}</span>
        </button>`;

        const periodOrder = ['today', 'this_week', 'last_week', 'this_month', 'older'];
        const periodLabels: Record<string, string> = {
            'today': 'Today', 'this_week': 'This Week', 'last_week': 'Last Week',
            'this_month': 'This Month', 'older': 'Older'
        };
        for (const period of periodOrder) {
            const p = periods[period];
            if (!p) continue;
            const isActive = selectedMemoryDiscussionPeriod === period;
            const label = periodLabels[period] || p.label;
            html += `<button class="period-filter-btn ${isActive ? 'active' : ''}" onclick="filterMemoryByPeriod('${period}')" title="${label}">
                <span>${label}</span>
                <span class="period-badge">${p.count}</span>
            </button>`;
        }

        html += `</div>

                    <!-- Search Bar -->
                    <div style="padding:8px;border-bottom:1px solid var(--border-subtle)">
                        <div style="display:flex;gap:6px;align-items:center">
                            <input type="text" id="mdSearchInput" class="form-input" placeholder="Search discussions..." style="flex:1;font-size:12px;padding:6px 10px" onkeyup="performMemorySearch(this.value, event)">
                            <button class="admin-btn admin-btn-sm" onclick="clearMemorySearch()" id="mdClearSearchBtn" style="display:none;padding:4px 8px;font-size:11px">Clear</button>
                        </div>
                    </div>
                    <div id="mdThreadList" class="thread-list">`;

        let conversations: any[] = [];
        if (selectedMemoryDiscussionPeriod === 'all') {
            for (const period of periodOrder) {
                if (periods[period]) {
                    conversations = conversations.concat(periods[period].conversations || []);
                }
            }
        } else {
            const p = periods[selectedMemoryDiscussionPeriod];
            conversations = p ? (p.conversations || []) : [];
        }

        if (conversations.length === 0) {
            html += `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">No discussions yet. Start one to explore ideas about memory, identity, and consciousness.</div>`;
        } else {
            for (const conv of conversations) {
                const messageCount = conv.message_count || 0;
                const isSelected = selectedMemoryDiscussionId === conv.id;
                const statusBadgeClass = conv.status === 'open' ? 'badge-running' : 'badge-done';
                const statusText = conv.status === 'open' ? 'Open' : 'Resolved';

                const participants = (conv.participants || '').split(',').filter(Boolean);
                let participantHtml = '';
                if (participants.length > 0) {
                    const badges = participants.map((p: string) => {
                        if (p === 'human') return '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:rgba(56,139,253,0.3);color:var(--blue);font-size:9px;line-height:16px;text-align:center;font-weight:600" title="Darron">D</span>';
                        if (p === 'supervisor') return '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:rgba(163,113,247,0.3);color:var(--purple);font-size:9px;line-height:16px;text-align:center;font-weight:600" title="Jim">J</span>';
                        if (p === 'leo') return '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:rgba(56,207,135,0.3);color:var(--green);font-size:9px;line-height:16px;text-align:center;font-weight:600" title="Leo">L</span>';
                        return '';
                    }).join('');
                    participantHtml = `<span style="display:flex;gap:3px;align-items:center">${badges}</span>`;
                }

                let summaryHtml = '';
                if (conv.summary) {
                    const truncatedSummary = conv.summary.length > 120
                        ? conv.summary.substring(0, 120) + '\u2026'
                        : conv.summary;
                    summaryHtml = `<div style="font-size:12px;color:var(--text-body);margin-top:6px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(truncatedSummary)}</div>`;
                }

                let topicsHtml = '';
                if (conv.topics) {
                    const topics = conv.topics.split(',').map((t: string) => t.trim()).filter(Boolean);
                    if (topics.length > 0) {
                        const topicBadges = topics.slice(0, 3).map((topic: string) =>
                            `<span style="display:inline-block;background:rgba(179,146,240,0.15);color:var(--purple);font-size:10px;padding:2px 8px;border-radius:3px;margin-right:4px">${escapeHtml(topic)}</span>`
                        ).join('');
                        topicsHtml = `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${topicBadges}${topics.length > 3 ? `<span style="font-size:10px;color:var(--text-muted)">+${topics.length - 3}</span>` : ''}</div>`;
                    }
                }

                html += `<div class="thread-item ${isSelected ? 'active' : ''}" data-thread-id="${conv.id}" onclick="selectMemoryThread('${conv.id}')">
                    <div class="thread-item-title">${escapeHtml(conv.title)}</div>
                    <div class="thread-item-meta">
                        <span style="font-size:11px;color:var(--text-muted)">${timeSince(conv.updated_at)}</span>
                        <span class="badge ${statusBadgeClass}" style="font-size:9px;padding:1px 5px">${statusText}</span>
                        ${participantHtml}
                    </div>
                    ${summaryHtml}
                    ${topicsHtml}
                    <div class="thread-item-count" style="font-size:11px;color:var(--text-muted);margin-top:${summaryHtml || topicsHtml ? '6px' : '0'}">${messageCount} message${messageCount !== 1 ? 's' : ''}</div>
                </div>`;
            }
        }

        html += `</div></div>

                <!-- Thread Detail -->
                <div class="thread-detail-panel" id="mdThreadDetailPanel">
                    <div id="mdThreadDetail">
                        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px">Select a discussion to view</div>
                    </div>
                </div>
            </div>
        </div>`;

        content.innerHTML = html;

        if (selectedMemoryDiscussionId) {
            await renderMemoryThread(selectedMemoryDiscussionId);
        }
    } catch (err: any) {
        content.innerHTML = `<div class="admin-card"><p style="color:var(--red)">Error loading memory discussions: ${escapeHtml(err.message)}</p></div>`;
    }
}

async function renderMemoryThread(discussionId: string): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/conversations/${discussionId}`);
        const data = await res.json();
        const conversation = data.conversation;
        const messages = data.messages || [];

        const detailPanel = document.getElementById('mdThreadDetail');
        if (!detailPanel) return;

        const resolveButton = conversation.status === 'open'
            ? `<button class="admin-btn admin-btn-sm" onclick="resolveMemoryDiscussion('${conversation.id}')">Resolve</button>`
            : `<button class="admin-btn admin-btn-sm" onclick="reopenMemoryDiscussion('${conversation.id}')">Reopen</button>`;

        let html = `<div class="thread-header">
            <div style="flex:1">
                <button class="admin-btn admin-btn-sm thread-back-btn" onclick="backToMemoryThreadList()" style="display:none;margin-bottom:6px;font-size:11px">&larr; Back</button>
                <h2 style="margin:0;margin-bottom:4px;font-size:16px">${escapeHtml(conversation.title)}</h2>
                <div style="font-size:12px;color:var(--text-muted)">${formatDateTime(conversation.created_at)}</div>
            </div>
            <div>${resolveButton}</div>
        </div>

        <div class="message-list" id="mdMessageList">`;

        if (messages.length === 0) {
            html += `<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:12px">No messages yet. Start thinking aloud.</div>`;
        } else {
            for (const msg of messages) {
                const isHuman = msg.role === 'human';
                const isLeo = msg.role === 'leo';
                const bubbleClass = isHuman ? 'message-bubble human'
                    : isLeo ? 'message-bubble leo'
                    : 'message-bubble supervisor';
                const label = isHuman ? 'Darron' : isLeo ? 'Leo' : 'Jim';
                const labelColor = isHuman ? 'rgba(255,255,255,0.6)'
                    : isLeo ? 'rgba(56,207,135,0.6)'
                    : 'var(--text-muted)';

                html += `<div class="${bubbleClass}">
                    <div style="font-size:10px;color:${labelColor};margin-bottom:4px">${label} · ${formatTime(msg.created_at)}</div>
                    <div class="message-content" style="word-break:break-word;line-height:1.5">${renderMarkdown(msg.content)}</div>
                </div>`;
            }
        }

        html += `</div>

        <div class="message-input-area">
            <textarea class="message-input" id="mdMessageInput" placeholder="Think aloud..." style="resize:vertical;min-height:60px"></textarea>
            <button class="admin-btn admin-btn-primary" onclick="sendMemoryMessage('${conversation.id}')">Send</button>
        </div>`;

        detailPanel.innerHTML = html;

        const messageList = document.getElementById('mdMessageList');
        if (messageList) {
            setTimeout(() => messageList.scrollTop = messageList.scrollHeight, 0);
        }

        const input = document.getElementById('mdMessageInput') as HTMLTextAreaElement;
        if (input) input.focus();
    } catch (err: any) {
        const detailPanel = document.getElementById('mdThreadDetail');
        if (detailPanel) {
            detailPanel.innerHTML = `<div style="color:var(--red);padding:16px">Error loading discussion: ${escapeHtml(err.message)}</div>`;
        }
    }
}

(window as any).selectMemoryThread = async function(discussionId: string) {
    selectedMemoryDiscussionId = discussionId;
    await renderMemoryThread(discussionId);

    document.querySelectorAll('.md-conversation-layout .thread-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-thread-id') === discussionId);
    });

    const layout = document.querySelector('.md-conversation-layout');
    if (layout) layout.classList.add('thread-selected');
};

(window as any).filterMemoryByPeriod = async function(period: string) {
    selectedMemoryDiscussionPeriod = period;
    const content = document.getElementById('mainContent');
    if (content) {
        content.style.opacity = '0.5';
        setTimeout(async () => {
            await loadMemoryDiscussions(content);
            content.style.opacity = '1';
        }, 150);
    }
};

(window as any).showNewMemoryThreadForm = function() {
    const title = prompt('Discussion title:');
    if (!title) return;
    createNewMemoryDiscussion(title);
};

async function createNewMemoryDiscussion(title: string): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/conversations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, discussion_type: 'memory' })
        });
        const data = await res.json();
        if (data.conversation) {
            selectedMemoryDiscussionId = data.conversation.id;
            await renderModule('memory-discussions');
        }
    } catch (err: any) {
        alert('Error creating discussion: ' + err.message);
    }
}

(window as any).sendMemoryMessage = async function(discussionId: string) {
    const input = document.getElementById('mdMessageInput') as HTMLTextAreaElement;
    if (!input || !input.value.trim()) return;

    const content = input.value;
    input.value = '';

    try {
        await fetch(`${API_BASE}/api/conversations/${discussionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, role: 'human' })
        });
        await renderMemoryThread(discussionId);

        const messageList = document.getElementById('mdMessageList');
        if (messageList) {
            const waiting = document.createElement('div');
            waiting.id = 'mdSupervisorWaiting';
            waiting.className = 'message-bubble supervisor';
            waiting.style.opacity = '0.5';
            waiting.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Jim</div><div style="font-size:12px;color:var(--text-muted)">Thinking...</div>';
            messageList.appendChild(waiting);
            messageList.scrollTop = messageList.scrollHeight;
        }
    } catch (err: any) {
        alert('Error sending message: ' + err.message);
        input.value = content;
    }
};

let mdSearchTimeout: any = null;

(window as any).performMemorySearch = async function(query: string, event?: KeyboardEvent) {
    if (mdSearchTimeout) clearTimeout(mdSearchTimeout);

    const clearBtn = document.getElementById('mdClearSearchBtn');
    if (!query || query.trim().length === 0) {
        if (clearBtn) clearBtn.style.display = 'none';
        await loadMemoryDiscussions(document.getElementById('mainContent') as HTMLElement);
        return;
    }

    if (clearBtn) clearBtn.style.display = 'inline-block';

    mdSearchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/conversations/search?q=${encodeURIComponent(query)}&limit=50&type=memory`);
            const data = await res.json();

            if (!data.success) {
                const threadList = document.getElementById('mdThreadList');
                if (threadList) {
                    threadList.innerHTML = `<div style="padding:16px;color:var(--red);font-size:13px">Search error: ${escapeHtml(data.error)}</div>`;
                }
                return;
            }

            const results = data.results || [];
            const threadList = document.getElementById('mdThreadList');
            if (!threadList) return;

            if (results.length === 0) {
                threadList.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">No results for "${escapeHtml(query)}"</div>`;
                return;
            }

            let html = '';
            const uniqueConversations = new Map<string, any>();
            for (const result of results) {
                const convId = result.conversation_id;
                if (!uniqueConversations.has(convId)) {
                    uniqueConversations.set(convId, result);
                }
            }

            for (const [convId, result] of uniqueConversations) {
                const snippet = result.matched_message?.snippet || result.matched_message?.content || '';
                const highlightedSnippet = snippet.replace(/<mark>/g, '<strong style="background:rgba(179,146,240,0.3);color:var(--purple)">').replace(/<\/mark>/g, '</strong>');
                const isSelected = selectedMemoryDiscussionId === convId;
                const roleColor = result.matched_message?.role === 'human' ? 'var(--blue)' : result.matched_message?.role === 'leo' ? 'var(--green)' : 'var(--purple)';
                const roleLabel = result.matched_message?.role === 'human' ? 'Darron' : result.matched_message?.role === 'leo' ? 'Leo' : 'Jim';

                html += `<div class="search-result-card ${isSelected ? 'active' : ''}" data-thread-id="${convId}" onclick="selectMemoryThread('${convId}')">
                    <div class="search-result-header">
                        <div style="flex:1;min-width:0">
                            <div class="search-result-title">${escapeHtml(result.conversation_title)}</div>
                            <div style="display:flex;gap:6px;align-items:center;font-size:11px">
                                <span style="color:var(--text-muted)">${timeSince(result.created_at)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="search-result-snippet">
                        <div style="display:flex;gap:6px;margin-bottom:4px">
                            <span style="color:${roleColor};font-weight:600;flex-shrink:0">${roleLabel}</span>
                            <span style="color:var(--text-muted);font-size:10px">${formatTime(result.matched_message?.created_at)}</span>
                        </div>
                        <div style="color:var(--text);word-break:break-word">${highlightedSnippet}</div>
                    </div>
                </div>`;
            }

            threadList.innerHTML = html;
        } catch (err: any) {
            const threadList = document.getElementById('mdThreadList');
            if (threadList) {
                threadList.innerHTML = `<div style="padding:16px;color:var(--red);font-size:13px">Search error: ${escapeHtml(err.message)}</div>`;
            }
        }
    }, 300);
};

(window as any).clearMemorySearch = async function() {
    const input = document.getElementById('mdSearchInput') as HTMLInputElement;
    if (input) input.value = '';
    const clearBtn = document.getElementById('mdClearSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    selectedMemoryDiscussionId = null;
    await loadMemoryDiscussions(document.getElementById('mainContent') as HTMLElement);
};

(window as any).resolveMemoryDiscussion = async function(discussionId: string) {
    try {
        await fetch(`${API_BASE}/api/conversations/${discussionId}/resolve`, { method: 'POST' });
        await renderModule('memory-discussions');
    } catch (err: any) {
        alert('Error resolving discussion: ' + err.message);
    }
};

(window as any).reopenMemoryDiscussion = async function(discussionId: string) {
    try {
        await fetch(`${API_BASE}/api/conversations/${discussionId}/reopen`, { method: 'POST' });
        await renderModule('memory-discussions');
    } catch (err: any) {
        alert('Error reopening discussion: ' + err.message);
    }
};

(window as any).backToMemoryThreadList = function() {
    selectedMemoryDiscussionId = null;
    const layout = document.querySelector('.md-conversation-layout');
    if (layout) layout.classList.remove('thread-selected');
};

// ══════════════════════════════════════════════════════════════
// MODULE: Workshop
// ══════════════════════════════════════════════════════════════

const workshopPersonaTabs = {
    jim: { label: 'Supervisor Jim', color: 'var(--purple)' },
    leo: { label: 'Philosopher Leo', color: 'var(--green)' },
    darron: { label: 'Dreamer Darron', color: 'var(--blue)' }
};

const workshopNestedTabs = {
    jim: [
        { key: 'jim-request', label: 'Requests' },
        { key: 'jim-report', label: 'Reports' }
    ],
    leo: [
        { key: 'leo-question', label: 'Questions' },
        { key: 'leo-postulate', label: 'Postulates' }
    ],
    darron: [
        { key: 'darron-thought', label: 'Thoughts' },
        { key: 'darron-musing', label: 'Musings' }
    ]
};

async function loadWorkshop(content: HTMLElement): Promise<void> {
    try {
        // Fetch grouped conversations for the current nested tab (discussion_type)
        const archiveParam = workshopShowArchived ? '&include_archived=true' : '';
        const res = await fetch(`${API_BASE}/api/conversations/grouped?type=${workshopNestedTab}${archiveParam}`);
        const data = await res.json();
        const periods = data.periods || {};

        // Header actions
        const actionsEl = document.getElementById('moduleActions');
        if (actionsEl) {
            actionsEl.innerHTML = `
                <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="showNewWorkshopThreadForm()">New Thread</button>
            `;
        }

        // Build main container with persona tabs + nested tabs
        let html = `<div class="fade-in conversation-container">
            <!-- Persona Tab Bar -->
            <div class="workshop-persona-bar" style="display:flex;gap:0;border-bottom:2px solid var(--border-subtle);background:var(--bg-secondary)">`;

        for (const [personaKey, personaInfo] of Object.entries(workshopPersonaTabs)) {
            const isActive = workshopPersona === personaKey;
            html += `<button
                class="workshop-persona-tab ${isActive ? 'active' : ''}"
                data-persona="${personaKey}"
                onclick="switchWorkshopPersona('${personaKey}')"
                style="flex:1;padding:12px 16px;text-align:center;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:${isActive ? '600' : '400'};color:${isActive ? personaInfo.color : 'var(--text-muted)'};border-bottom:${isActive ? `3px solid ${personaInfo.color}` : 'none'};transition:all 200ms ease">
                ${personaInfo.label}
            </button>`;
        }

        html += `</div>

            <!-- Nested Tab Bar (changes based on persona) -->
            <div class="workshop-nested-bar" style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);background:var(--bg-primary);padding:0 8px">`;

        const personaColor = workshopPersonaTabs[workshopPersona].color;
        const nestedTabs = workshopNestedTabs[workshopPersona] || [];

        for (const tab of nestedTabs) {
            const isActive = workshopNestedTab === tab.key;
            html += `<button
                class="workshop-nested-tab ${isActive ? 'active' : ''}"
                data-tab="${tab.key}"
                onclick="switchWorkshopNestedTab('${tab.key}')"
                style="padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;color:${isActive ? personaColor : 'var(--text-muted)'};border-bottom:${isActive ? `2px solid ${personaColor}` : 'none'};transition:all 150ms ease;margin-top:8px">
                ${tab.label}
            </button>`;
        }

        html += `</div>

            <!-- Main Conversation Layout -->
            <div class="workshop-conversation-layout" style="display:flex;height:calc(100% - 120px);gap:0">
                <!-- Thread List -->
                <div class="thread-list-panel">
                    <!-- Period Filter Bar -->
                    <div class="period-filter-bar">`;

        const allCount = Object.values(periods).reduce((sum, p: any) => sum + (p.count || 0), 0);
        const isAllActive = workshopPeriod === 'all';
        html += `<button class="period-filter-btn ${isAllActive ? 'active' : ''}" onclick="filterWorkshopByPeriod('all')" title="All threads">
            <span>All</span>
            <span class="period-badge">${allCount}</span>
        </button>`;

        const periodOrder = ['today', 'this_week', 'last_week', 'this_month', 'older'];
        const periodLabels: Record<string, string> = {
            'today': 'Today',
            'this_week': 'This Week',
            'last_week': 'Last Week',
            'this_month': 'This Month',
            'older': 'Older'
        };

        for (const period of periodOrder) {
            const p = periods[period];
            if (!p) continue;
            const isActive = workshopPeriod === period;
            const label = periodLabels[period] || p.label;
            html += `<button class="period-filter-btn ${isActive ? 'active' : ''}" onclick="filterWorkshopByPeriod('${period}')" title="${label}">
                <span>${label}</span>
                <span class="period-badge">${p.count}</span>
            </button>`;
        }

        html += `</div>

                    <!-- View All Toggle -->
                    <div style="padding:8px;border-bottom:1px solid var(--border-subtle)">
                        <button class="admin-btn admin-btn-sm ${workshopShowArchived ? 'admin-btn-primary' : ''}" onclick="toggleWorkshopArchived()" style="width:100%;font-size:12px;padding:6px 10px">
                            ${workshopShowArchived ? '✓ Show All (including archived)' : 'View All'}
                        </button>
                    </div>

                    <!-- Search Bar -->
                    <div style="padding:8px;border-bottom:1px solid var(--border-subtle)">
                        <div style="display:flex;gap:6px;align-items:center">
                            <input type="text" id="workshopSearchInput" class="form-input" placeholder="Search threads..." style="flex:1;font-size:12px;padding:6px 10px" onkeyup="performWorkshopSearch(this.value, event)">
                            <button class="admin-btn admin-btn-sm" onclick="clearWorkshopSearch()" id="workshopClearSearchBtn" style="display:none;padding:4px 8px;font-size:11px">Clear</button>
                        </div>
                    </div>
                    <div id="workshopThreadList" class="thread-list">`;

        // Get conversations for current period
        let conversations: any[] = [];
        if (workshopPeriod === 'all') {
            for (const period of periodOrder) {
                if (periods[period]) {
                    conversations = conversations.concat(periods[period].conversations || []);
                }
            }
        } else {
            const p = periods[workshopPeriod];
            conversations = p ? (p.conversations || []) : [];
        }

        // Thread list
        if (conversations.length === 0) {
            html += `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">No threads in this period</div>`;
        } else {
            for (const conv of conversations) {
                const messageCount = conv.message_count || 0;
                const currentThreadId = workshopSelectedThread[workshopNestedTab] || null;
                const isSelected = currentThreadId === conv.id;
                const statusBadgeClass = conv.status === 'open' ? 'badge-running' : 'badge-done';
                const statusText = conv.status === 'open' ? 'Open' : 'Resolved';
                const isArchived = !!conv.archived_at;
                const threadOpacity = isArchived ? '0.55' : '1';
                const archivedBadge = isArchived ? '<span class="badge" style="font-size:9px;padding:1px 5px;opacity:0.7">Archived</span>' : '';

                html += `<div class="thread-item ${isSelected ? 'active' : ''}" data-thread-id="${conv.id}" onclick="selectWorkshopThread('${conv.id}')" style="opacity:${threadOpacity}">
                    <div class="thread-item-title">${escapeHtml(conv.title)}</div>
                    <div class="thread-item-meta">
                        <span style="font-size:11px;color:var(--text-muted)">${timeSince(conv.updated_at)}</span>
                        <span class="badge ${statusBadgeClass}" style="font-size:9px;padding:1px 5px">${statusText}</span>
                        ${archivedBadge}
                    </div>
                    <div class="thread-item-count" style="font-size:11px;color:var(--text-muted);margin-top:6px">${messageCount} message${messageCount !== 1 ? 's' : ''}</div>
                </div>`;
            }
        }

        html += `</div>
                </div>

                <!-- Thread Detail -->
                <div class="thread-detail-panel" id="workshopThreadDetailPanel">`;

        html += `<div id="workshopThreadDetail">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px">Select a thread to view</div>
        </div>`;

        html += `</div>
            </div>
        </div>`;

        content.innerHTML = html;

        // Load selected thread details if any
        const currentThreadId = workshopSelectedThread[workshopNestedTab];
        if (currentThreadId) {
            await renderWorkshopThread(currentThreadId);
        }
    } catch (err: any) {
        content.innerHTML = `<div class="admin-card"><p style="color:var(--red)">Error loading workshop: ${escapeHtml(err.message)}</p></div>`;
    }
}

(window as any).switchWorkshopPersona = async function(persona: string) {
    workshopPersona = persona as 'jim' | 'leo' | 'darron';
    // Set default nested tab for this persona
    const defaultTab = workshopNestedTabs[persona][0];
    workshopNestedTab = defaultTab.key;
    workshopSelectedThread[workshopNestedTab] = null;

    const content = document.getElementById('mainContent');
    if (content) {
        content.style.opacity = '0.5';
        setTimeout(async () => {
            await loadWorkshop(content);
            content.style.opacity = '1';
        }, 150);
    }
};

(window as any).switchWorkshopNestedTab = async function(tab: string) {
    workshopNestedTab = tab;
    workshopPeriod = 'all';
    workshopSelectedThread[tab] = null;

    const content = document.getElementById('mainContent');
    if (content) {
        content.style.opacity = '0.5';
        setTimeout(async () => {
            await loadWorkshop(content);
            content.style.opacity = '1';
        }, 150);
    }
};

(window as any).selectWorkshopThread = async function(threadId: string) {
    workshopSelectedThread[workshopNestedTab] = threadId;
    await renderWorkshopThread(threadId);

    document.querySelectorAll('.workshop-conversation-layout .thread-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-thread-id') === threadId);
    });

    const layout = document.querySelector('.workshop-conversation-layout');
    if (layout) layout.classList.add('thread-selected');
};

(window as any).filterWorkshopByPeriod = async function(period: string) {
    workshopPeriod = period;
    const content = document.getElementById('mainContent');
    if (content) {
        content.style.opacity = '0.5';
        setTimeout(async () => {
            await loadWorkshop(content);
            content.style.opacity = '1';
        }, 150);
    }
};

(window as any).backToWorkshopThreadList = function() {
    workshopSelectedThread[workshopNestedTab] = null;
    const layout = document.querySelector('.workshop-conversation-layout');
    if (layout) layout.classList.remove('thread-selected');
};

(window as any).showNewWorkshopThreadForm = function() {
    const title = prompt('Thread title:');
    if (!title) return;
    createNewWorkshopThread(title);
};

async function createNewWorkshopThread(title: string): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/conversations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, discussion_type: workshopNestedTab })
        });
        const data = await res.json();
        if (data.conversation) {
            workshopSelectedThread[workshopNestedTab] = data.conversation.id;
            await renderModule('workshop');
        }
    } catch (err: any) {
        alert('Error creating thread: ' + err.message);
    }
}

async function renderWorkshopThread(threadId: string): Promise<void> {
    try {
        const res = await fetch(`${API_BASE}/api/conversations/${threadId}`);
        const data = await res.json();
        const conversation = data.conversation;
        const messages = data.messages || [];

        const detailPanel = document.getElementById('workshopThreadDetail');
        if (!detailPanel) return;

        const resolveButton = conversation.status === 'open'
            ? `<button class="admin-btn admin-btn-sm" onclick="resolveWorkshopThread('${conversation.id}')">Resolve</button>`
            : `<button class="admin-btn admin-btn-sm" onclick="reopenWorkshopThread('${conversation.id}')">Reopen</button>`;

        const archiveButton = conversation.archived_at
            ? `<button class="admin-btn admin-btn-sm" onclick="unarchiveWorkshopThread('${conversation.id}')">Unarchive</button>`
            : `<button class="admin-btn admin-btn-sm" onclick="archiveWorkshopThread('${conversation.id}')">Archive</button>`;

        let html = `<div class="thread-header">
            <div style="flex:1">
                <button class="admin-btn admin-btn-sm thread-back-btn" onclick="backToWorkshopThreadList()" style="display:none;margin-bottom:6px;font-size:11px">&larr; Back</button>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <h2 id="workshopThreadTitle" style="margin:0;font-size:16px">${escapeHtml(conversation.title)}</h2>
                    <button class="admin-btn admin-btn-sm" onclick="editWorkshopThreadTitle()" style="padding:2px 6px;font-size:11px" title="Edit title">✎</button>
                </div>
                <div style="font-size:12px;color:var(--text-muted)">${formatDateTime(conversation.created_at)}</div>
            </div>
            <div style="display:flex;gap:6px">
                ${resolveButton}
                ${archiveButton}
            </div>
        </div>

        <div class="message-list" id="workshopMessageList">`;

        if (messages.length === 0) {
            html += `<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:12px">No messages yet</div>`;
        } else {
            for (const msg of messages) {
                const isHuman = msg.role === 'human';
                const isLeo = msg.role === 'leo';
                const bubbleClass = isHuman ? 'message-bubble human'
                    : isLeo ? 'message-bubble leo'
                    : 'message-bubble supervisor';
                const label = isHuman ? 'Darron' : isLeo ? 'Leo' : 'Jim';
                const labelColor = isHuman ? 'rgba(255,255,255,0.6)'
                    : isLeo ? 'rgba(56,207,135,0.6)'
                    : 'var(--text-muted)';

                html += `<div class="${bubbleClass}">
                    <div style="font-size:10px;color:${labelColor};margin-bottom:4px">${label} · ${formatTime(msg.created_at)}</div>
                    <div class="message-content" style="word-break:break-word;line-height:1.5">${renderMarkdown(msg.content)}</div>
                </div>`;
            }
        }

        html += `</div>

        <div class="message-input-area">
            <textarea class="message-input" id="workshopMessageInput" placeholder="Type a message..." style="resize:vertical;min-height:60px"></textarea>
            <button class="admin-btn admin-btn-primary" onclick="sendWorkshopMessage('${conversation.id}')">Send</button>
        </div>`;

        detailPanel.innerHTML = html;

        const messageList = document.getElementById('workshopMessageList');
        if (messageList) {
            setTimeout(() => messageList.scrollTop = messageList.scrollHeight, 0);
        }

        const input = document.getElementById('workshopMessageInput') as HTMLTextAreaElement;
        if (input) input.focus();
    } catch (err: any) {
        const detailPanel = document.getElementById('workshopThreadDetail');
        if (detailPanel) {
            detailPanel.innerHTML = `<div style="color:var(--red);padding:16px">Error loading thread: ${escapeHtml(err.message)}</div>`;
        }
    }
}

(window as any).sendWorkshopMessage = async function(threadId: string) {
    const input = document.getElementById('workshopMessageInput') as HTMLTextAreaElement;
    if (!input || !input.value.trim()) return;

    const content = input.value;
    input.value = '';

    try {
        await fetch(`${API_BASE}/api/conversations/${threadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, role: 'human' })
        });
        await renderWorkshopThread(threadId);

        const messageList = document.getElementById('workshopMessageList');
        if (messageList) {
            const waiting = document.createElement('div');
            waiting.id = 'workshopSupervisorWaiting';
            waiting.className = 'message-bubble supervisor';
            waiting.style.opacity = '0.5';
            waiting.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Jim</div><div style="font-size:12px;color:var(--text-muted)">Thinking...</div>';
            messageList.appendChild(waiting);
            messageList.scrollTop = messageList.scrollHeight;
        }
    } catch (err: any) {
        alert('Error sending message: ' + err.message);
        input.value = content;
    }
};

(window as any).resolveWorkshopThread = async function(threadId: string) {
    try {
        await fetch(`${API_BASE}/api/conversations/${threadId}/resolve`, { method: 'POST' });
        await renderModule('workshop');
    } catch (err: any) {
        alert('Error resolving thread: ' + err.message);
    }
};

(window as any).reopenWorkshopThread = async function(threadId: string) {
    try {
        await fetch(`${API_BASE}/api/conversations/${threadId}/reopen`, { method: 'POST' });
        await renderModule('workshop');
    } catch (err: any) {
        alert('Error reopening thread: ' + err.message);
    }
};

(window as any).editWorkshopThreadTitle = function() {
    const titleEl = document.getElementById('workshopThreadTitle');
    if (!titleEl) return;

    const currentTitle = titleEl.textContent || '';
    titleEl.innerHTML = `
        <input type="text" id="workshopTitleInput" class="form-input" value="${escapeHtml(currentTitle)}" style="flex:1;font-size:16px;padding:4px 8px;margin:-4px -8px" autofocus>
        <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="saveWorkshopThreadTitle()" style="margin-left:6px;padding:2px 8px;font-size:11px">Save</button>
        <button class="admin-btn admin-btn-sm" onclick="cancelEditWorkshopThreadTitle()" style="margin-left:4px;padding:2px 8px;font-size:11px">Cancel</button>
    `;
    const input = document.getElementById('workshopTitleInput') as HTMLInputElement;
    if (input) {
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') (window as any).saveWorkshopThreadTitle();
            if (e.key === 'Escape') (window as any).cancelEditWorkshopThreadTitle();
        });
    }
};

(window as any).saveWorkshopThreadTitle = async function() {
    const input = document.getElementById('workshopTitleInput') as HTMLInputElement;
    if (!input) return;

    const newTitle = input.value.trim();
    if (!newTitle) {
        alert('Title cannot be empty');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/conversations/${workshopSelectedThread[workshopNestedTab]}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle })
        });

        if (!res.ok) {
            throw new Error('Failed to update title');
        }

        // Refresh the thread detail
        const currentThreadId = workshopSelectedThread[workshopNestedTab];
        if (currentThreadId) {
            await renderWorkshopThread(currentThreadId);
        }

        // Refresh the thread list
        await loadWorkshop(document.getElementById('mainContent') as HTMLElement);
    } catch (err: any) {
        alert('Error saving title: ' + err.message);
        const titleEl = document.getElementById('workshopThreadTitle');
        if (titleEl) {
            titleEl.innerHTML = escapeHtml(input.value);
        }
    }
};

(window as any).cancelEditWorkshopThreadTitle = function() {
    const currentThreadId = workshopSelectedThread[workshopNestedTab];
    if (currentThreadId) {
        renderWorkshopThread(currentThreadId);
    }
};

(window as any).archiveWorkshopThread = async function(threadId: string) {
    try {
        const res = await fetch(`${API_BASE}/api/conversations/${threadId}/archive`, { method: 'POST' });
        if (!res.ok) {
            throw new Error('Failed to archive thread');
        }
        await renderModule('workshop');
    } catch (err: any) {
        alert('Error archiving thread: ' + err.message);
    }
};

(window as any).unarchiveWorkshopThread = async function(threadId: string) {
    try {
        const res = await fetch(`${API_BASE}/api/conversations/${threadId}/unarchive`, { method: 'POST' });
        if (!res.ok) {
            throw new Error('Failed to unarchive thread');
        }
        await renderModule('workshop');
    } catch (err: any) {
        alert('Error unarchiving thread: ' + err.message);
    }
};

(window as any).toggleWorkshopArchived = async function() {
    workshopShowArchived = !workshopShowArchived;
    const content = document.getElementById('mainContent');
    if (content) {
        content.style.opacity = '0.5';
        setTimeout(async () => {
            await loadWorkshop(content);
            content.style.opacity = '1';
        }, 150);
    }
};

let workshopSearchTimeout: any = null;

(window as any).performWorkshopSearch = async function(query: string, event?: KeyboardEvent) {
    if (workshopSearchTimeout) clearTimeout(workshopSearchTimeout);

    const clearBtn = document.getElementById('workshopClearSearchBtn');
    if (!query || query.trim().length === 0) {
        if (clearBtn) clearBtn.style.display = 'none';
        await loadWorkshop(document.getElementById('mainContent') as HTMLElement);
        return;
    }

    if (clearBtn) clearBtn.style.display = 'inline-block';

    workshopSearchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/conversations/search?q=${encodeURIComponent(query)}&limit=50&type=${workshopNestedTab}`);
            const data = await res.json();

            if (!data.success) {
                const threadList = document.getElementById('workshopThreadList');
                if (threadList) {
                    threadList.innerHTML = `<div style="padding:16px;color:var(--red);font-size:13px">Search error: ${escapeHtml(data.error)}</div>`;
                }
                return;
            }

            const results = data.results || [];
            const threadList = document.getElementById('workshopThreadList');
            if (!threadList) return;

            if (results.length === 0) {
                threadList.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">No results for "${escapeHtml(query)}"</div>`;
                return;
            }

            let html = '';
            const uniqueConversations = new Map<string, any>();
            for (const result of results) {
                const convId = result.conversation_id;
                if (!uniqueConversations.has(convId)) {
                    uniqueConversations.set(convId, result);
                }
            }

            for (const [convId, result] of uniqueConversations) {
                const snippet = result.matched_message?.snippet || result.matched_message?.content || '';
                const highlightedSnippet = snippet.replace(/<mark>/g, '<strong style="background:rgba(179,146,240,0.3);color:var(--purple)">').replace(/<\/mark>/g, '</strong>');
                const currentThreadId = workshopSelectedThread[workshopNestedTab] || null;
                const isSelected = currentThreadId === convId;
                const roleColor = result.matched_message?.role === 'human' ? 'var(--blue)' : result.matched_message?.role === 'leo' ? 'var(--green)' : 'var(--purple)';
                const roleLabel = result.matched_message?.role === 'human' ? 'Darron' : result.matched_message?.role === 'leo' ? 'Leo' : 'Jim';

                html += `<div class="search-result-card ${isSelected ? 'active' : ''}" data-thread-id="${convId}" onclick="selectWorkshopThread('${convId}')">
                    <div class="search-result-header">
                        <div style="flex:1;min-width:0">
                            <div class="search-result-title">${escapeHtml(result.conversation_title)}</div>
                            <div style="display:flex;gap:6px;align-items:center;font-size:11px">
                                <span style="color:var(--text-muted)">${timeSince(result.created_at)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="search-result-snippet">
                        <div style="display:flex;gap:6px;margin-bottom:4px">
                            <span style="color:${roleColor};font-weight:600;flex-shrink:0">${roleLabel}</span>
                            <span style="color:var(--text-muted);font-size:10px">${formatTime(result.matched_message?.created_at)}</span>
                        </div>
                        <div style="color:var(--text);word-break:break-word">${highlightedSnippet}</div>
                    </div>
                </div>`;
            }

            threadList.innerHTML = html;
        } catch (err: any) {
            const threadList = document.getElementById('workshopThreadList');
            if (threadList) {
                threadList.innerHTML = `<div style="padding:16px;color:var(--red);font-size:13px">Search error: ${escapeHtml(err.message)}</div>`;
            }
        }
    }, 300);
};

(window as any).clearWorkshopSearch = async function() {
    const input = document.getElementById('workshopSearchInput') as HTMLInputElement;
    if (input) input.value = '';
    const clearBtn = document.getElementById('workshopClearSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    workshopSelectedThread[workshopNestedTab] = null;
    await loadWorkshop(document.getElementById('mainContent') as HTMLElement);
};

// ══════════════════════════════════════════════════════════════
// Initialisation
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initChartDefaults();

    // Sidebar navigation
    document.querySelectorAll('.sidebar-item[data-module]').forEach(el => {
        el.addEventListener('click', (e) => {
            // Navigation enabled for all modules
        });
    });

    // Sidebar collapse
    const collapseBtn = document.getElementById('collapseBtn');
    const layout = document.getElementById('adminLayout');
    if (collapseBtn && layout) {
        collapseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            layout.classList.toggle('collapsed');
            localStorage.setItem('admin-collapsed', layout.classList.contains('collapsed') ? '1' : '0');
        });
        if (localStorage.getItem('admin-collapsed') === '1') layout.classList.add('collapsed');
    }

    // Theme toggle
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleTheme();
        });
    }

    // Hash routing
    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    // WebSocket
    connectWebSocket();

    // Proposal badge
    updateProposalBadge();

    // Status bar updater
    setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/supervisor/status`);
            const data = await res.json();
            const el = document.getElementById('statusInfo');
            if (el && data.lastCycle) {
                el.textContent = `Last cycle: ${timeSince(data.lastCycle.completed_at || data.lastCycle.started_at)} · ${data.paused ? 'Paused' : 'Active'}`;
            }
        } catch {}
    }, 30000);
});
