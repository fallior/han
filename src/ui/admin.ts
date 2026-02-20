/**
 * Claude Remote Admin Console
 * Desktop-optimised project administration interface
 */

// ── Constants ────────────────────────────────────────────────
const API_BASE = '';
const MODULES = ['overview', 'projects', 'work', 'supervisor', 'reports', 'conversations', 'products'] as const;
type ModuleName = typeof MODULES[number];

// ── State ────────────────────────────────────────────────────
let currentModule: ModuleName = 'overview';
let ws: WebSocket | null = null;
let chartInstances: Record<string, any> = {};
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// ── Utilities ────────────────────────────────────────────────

function escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
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
        conversations: 'Conversations', products: 'Products'
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
            case 'supervisor': await loadSupervisor(content); break;
            case 'reports': await loadReports(content); break;
            case 'work':
            case 'conversations':
            case 'products':
                renderComingSoon(content, mod); break;
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
// Initialisation
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initChartDefaults();

    // Sidebar navigation
    document.querySelectorAll('.sidebar-item[data-module]').forEach(el => {
        el.addEventListener('click', (e) => {
            if (el.classList.contains('coming-soon')) {
                e.preventDefault();
                return;
            }
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
