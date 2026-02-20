"use strict";
(() => {
  const API_BASE = "";
  const MODULES = ["overview", "projects", "work", "supervisor", "reports", "conversations", "products"];
  let currentModule = "overview";
  let ws = null;
  let chartInstances = {};
  let refreshInterval = null;
  let selectedProductId = null;
  let selectedConversationId = null;
  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
  function formatCost(usd) {
    if (usd === 0) return "$0.00";
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    if (usd < 1) return `$${usd.toFixed(3)}`;
    return `$${usd.toFixed(2)}`;
  }
  function formatPct(n) {
    return `${(n * 100).toFixed(1)}%`;
  }
  function formatDate(iso) {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  }
  function formatTime(iso) {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    return d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
  }
  function formatDateTime(iso) {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
  }
  function timeSince(iso) {
    if (!iso) return "\u2014";
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1e3);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  }
  function statusBadge(status) {
    const cls = status === "done" || status === "completed" ? "done" : status === "running" || status === "active" || status === "decomposing" ? "running" : status === "failed" ? "failed" : status === "pending" ? "pending" : "cancelled";
    return `<span class="badge badge-${cls}">${escapeHtml(status)}</span>`;
  }
  function categoryBadge(cat) {
    const cls = cat === "improvement" ? "improvement" : cat === "opportunity" ? "opportunity" : cat === "risk" ? "risk" : "strategic";
    return `<span class="badge badge-${cls}">${escapeHtml(cat)}</span>`;
  }
  function createChart(canvasId, config) {
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
      delete chartInstances[canvasId];
    }
    const el = document.getElementById(canvasId);
    if (!el) return null;
    const chart = new window.Chart(el, config);
    chartInstances[canvasId] = chart;
    return chart;
  }
  function destroyAllCharts() {
    for (const [id, chart] of Object.entries(chartInstances)) {
      chart.destroy();
    }
    chartInstances = {};
  }
  function chartColor(name) {
    const style = getComputedStyle(document.documentElement);
    return style.getPropertyValue(`--${name}`).trim();
  }
  function initChartDefaults() {
    const Chart = window.Chart;
    if (!Chart) return;
    Chart.defaults.color = chartColor("text-dim");
    Chart.defaults.borderColor = chartColor("border-subtle");
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = chartColor("bg-card");
    Chart.defaults.plugins.tooltip.borderColor = chartColor("border");
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.titleColor = chartColor("text-heading");
    Chart.defaults.plugins.tooltip.bodyColor = chartColor("text-dim");
    Chart.defaults.scale.grid.color = "rgba(48, 54, 61, 0.2)";
  }
  function initTheme() {
    const saved = localStorage.getItem("admin-theme");
    if (saved === "light") document.documentElement.classList.add("light-mode");
  }
  function toggleTheme() {
    const isLight = document.documentElement.classList.toggle("light-mode");
    localStorage.setItem("admin-theme", isLight ? "light" : "dark");
    initChartDefaults();
    renderModule(currentModule);
  }
  function handleRoute() {
    const hash = window.location.hash.slice(1);
    const mod = MODULES.includes(hash) ? hash : "overview";
    switchModule(mod);
  }
  function switchModule(mod) {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    destroyAllCharts();
    currentModule = mod;
    document.querySelectorAll(".sidebar-item[data-module]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-module") === mod);
    });
    const titles = {
      overview: "Overview",
      projects: "Projects",
      work: "Work",
      supervisor: "Supervisor",
      reports: "Reports",
      conversations: "Conversations",
      products: "Products"
    };
    const titleEl = document.getElementById("moduleTitle");
    if (titleEl) titleEl.textContent = titles[mod] || mod;
    const actionsEl = document.getElementById("moduleActions");
    if (actionsEl) actionsEl.innerHTML = "";
    renderModule(mod);
  }
  async function renderModule(mod) {
    const content = document.getElementById("mainContent");
    if (!content) return;
    content.innerHTML = '<div class="loading">Loading...</div>';
    try {
      switch (mod) {
        case "overview":
          await loadOverview(content);
          break;
        case "projects":
          await loadProjects(content);
          break;
        case "work":
          await loadWork(content);
          break;
        case "supervisor":
          await loadSupervisor(content);
          break;
        case "reports":
          await loadReports(content);
          break;
        case "products":
          await loadProducts(content);
          break;
        case "conversations":
          await loadConversations(content);
          break;
      }
    } catch (err) {
      content.innerHTML = `<div class="admin-card"><p style="color:var(--red)">Error loading module: ${escapeHtml(err.message)}</p></div>`;
    }
  }
  let wsRetryDelay = 1e3;
  function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws`;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      wsRetryDelay = 1e3;
      updateConnectionStatus(true);
    };
    ws.onclose = () => {
      updateConnectionStatus(false);
      setTimeout(connectWebSocket, wsRetryDelay);
      wsRetryDelay = Math.min(wsRetryDelay * 1.5, 3e4);
    };
    ws.onerror = () => {
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
      } catch {
      }
    };
  }
  function handleWsMessage(data) {
    if (data.type === "supervisor_cycle" || data.type === "supervisor_action") {
      updateStatusInfo(data);
      if (currentModule === "overview" || currentModule === "supervisor") {
        renderModule(currentModule);
      }
    } else if (data.type === "strategic_proposal") {
      updateProposalBadge();
      if (currentModule === "supervisor") renderModule("supervisor");
      if (currentModule === "overview") renderModule("overview");
    } else if (data.type === "task_update" || data.type === "goal_update") {
      if (currentModule === "overview") renderModule("overview");
      if (currentModule === "projects") renderModule("projects");
      if (currentModule === "work") renderModule("work");
    } else if (data.type === "conversation_message") {
      if (currentModule === "conversations" && data.conversation_id === selectedConversationId) {
        renderModule("conversations");
      }
    }
  }
  function updateConnectionStatus(connected) {
    const el = document.getElementById("statusConnection");
    if (!el) return;
    el.innerHTML = `<span class="status-dot ${connected ? "connected" : "disconnected"}"></span> ${connected ? "Connected" : "Reconnecting..."}`;
  }
  function updateStatusInfo(data) {
    const el = document.getElementById("statusInfo");
    if (!el) return;
    if (data?.type === "supervisor_cycle") {
      el.textContent = `Last cycle: ${timeSince(data.completed_at || (/* @__PURE__ */ new Date()).toISOString())}`;
    }
  }
  async function updateProposalBadge() {
    try {
      const res = await fetch(`${API_BASE}/api/supervisor/proposals`);
      const data = await res.json();
      const pending = (data.proposals || []).filter((p) => p.status === "pending").length;
      const badge = document.getElementById("proposalCount");
      if (badge) {
        badge.textContent = String(pending);
        badge.style.display = pending > 0 ? "inline" : "none";
      }
    } catch {
    }
  }
  async function loadOverview(content) {
    const [analyticsRes, ecosystemRes, supervisorRes, activityRes] = await Promise.all([
      fetch(`${API_BASE}/api/analytics`),
      fetch(`${API_BASE}/api/ecosystem`),
      fetch(`${API_BASE}/api/supervisor/status`),
      fetch(`${API_BASE}/api/supervisor/activity?limit=20`)
    ]);
    const analytics = await analyticsRes.json();
    const ecosystem = await ecosystemRes.json();
    const supervisor = await supervisorRes.json();
    const activity = await activityRes.json();
    const g = analytics.global || {};
    const projects = ecosystem.projects || [];
    const activeGoals = projects.reduce((sum, p) => sum + (p.active_goals || 0), 0);
    const runningTasks = projects.reduce((sum, p) => sum + (p.running_tasks || 0), 0);
    const velocity = analytics.velocity || {};
    const trend = velocity.trend || "stable";
    const trendIcon = trend === "up" ? "&#9650;" : trend === "down" ? "&#9660;" : "&#9644;";
    let html = `<div class="fade-in">`;
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
            <span class="stat-value ${runningTasks > 0 ? "pulse" : ""}" style="color:${runningTasks > 0 ? "var(--cyan)" : "var(--text-heading)"}">${runningTasks}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Velocity</span>
            <span class="stat-value"><span class="stat-change ${trend}">${trendIcon}</span> ${(velocity.avgLast3Days || 0).toFixed(1)}/day</span>
        </div>
    </div>`;
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
    const sup = supervisor;
    const supStatus = sup.paused ? "Paused" : sup.enabled ? "Running" : "Disabled";
    const supColor = sup.paused ? "var(--amber)" : sup.enabled ? "var(--green)" : "var(--red)";
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
                    <span class="value">${sup.lastCycle ? timeSince(sup.lastCycle.completed_at || sup.lastCycle.started_at) : "Never"}</span>
                </div>
                <div class="detail-field">
                    <span class="label">Total Cycles</span>
                    <span class="value">${sup.totalCycles || 0}</span>
                </div>
                <div class="detail-field">
                    <span class="label">Cycle Cost</span>
                    <span class="value">${sup.lastCycle ? formatCost(sup.lastCycle.cost_usd || 0) : "\u2014"}</span>
                </div>
            </div>
        </div>
        <div class="admin-card">
            <h2>Cost by Model</h2>
            <div class="chart-canvas-wrap"><canvas id="costModelChart"></canvas></div>
        </div>
    </div>`;
    const events = activity.events || [];
    html += `<div class="admin-card">
        <h2>Recent Activity</h2>
        <div class="activity-list">${renderActivityItems(events)}</div>
    </div>`;
    html += `</div>`;
    content.innerHTML = html;
    content.querySelectorAll(".activity-item").forEach((el) => {
      el.addEventListener("click", () => el.classList.toggle("expanded"));
    });
    const dailyCounts = (velocity.dailyCounts || []).reverse();
    createChart("velocityChart", {
      type: "line",
      data: {
        labels: dailyCounts.map((d) => d.date?.slice(5) || ""),
        datasets: [{
          label: "Tasks",
          data: dailyCounts.map((d) => d.count || 0),
          borderColor: chartColor("blue"),
          backgroundColor: "rgba(56, 139, 253, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: chartColor("blue")
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
    const modelCounts = modelLabels.map((m) => byModel[m].count || 0);
    const modelColors = modelLabels.map(
      (m) => m === "opus" ? chartColor("purple") : m === "sonnet" ? chartColor("blue") : m === "haiku" ? chartColor("green") : chartColor("text-muted")
    );
    createChart("modelChart", {
      type: "doughnut",
      data: {
        labels: modelLabels,
        datasets: [{ data: modelCounts, backgroundColor: modelColors, borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        cutout: "60%"
      }
    });
    const modelCosts = modelLabels.map((m) => byModel[m].avgCost || 0);
    createChart("costModelChart", {
      type: "bar",
      data: {
        labels: modelLabels,
        datasets: [{
          label: "Avg Cost/Task",
          data: modelCosts,
          backgroundColor: modelColors.map((c) => c + "80"),
          borderColor: modelColors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => "$" + v.toFixed(3) } } }
      }
    });
  }
  function renderActivityItems(events) {
    if (events.length === 0) return '<p style="color:var(--text-muted);font-size:13px;padding:12px">No recent activity</p>';
    return events.map((ev) => {
      const dotType = ev.status === "failed" ? "failed" : ev.type === "supervisor_cycle" ? "supervisor" : ev.type === "goal" ? "goal" : ev.type === "proposal" ? "proposal" : "task";
      const title = ev.title || ev.type || "\u2014";
      const time = ev.timestamp ? timeSince(ev.timestamp) : "";
      let detail = "";
      if (ev.detail) {
        if (ev.detail.observations) detail += `Observations: ${ev.detail.observations}
`;
        if (ev.detail.actions) detail += `Actions: ${ev.detail.actions}
`;
        if (ev.detail.reasoning) detail += `Reasoning: ${ev.detail.reasoning}
`;
        if (ev.detail.error) detail += `Error: ${ev.detail.error}
`;
        if (ev.detail.cost_usd) detail += `Cost: ${formatCost(ev.detail.cost_usd)}`;
      }
      return `<div class="activity-item">
            <div class="activity-dot ${dotType}"></div>
            <div class="activity-body">
                <div class="activity-title">${escapeHtml(title)}</div>
                <div class="activity-meta">${ev.type} ${ev.status ? "\xB7 " + ev.status : ""} \xB7 ${time}${ev.project ? " \xB7 " + escapeHtml(ev.project.split("/").pop() || "") : ""}</div>
                ${detail ? `<div class="activity-detail">${escapeHtml(detail.trim())}</div>` : ""}
            </div>
        </div>`;
    }).join("");
  }
  let workFilters = { project: "", status: "", model: "" };
  let workData = null;
  async function loadWork(content) {
    const [tasksRes, activeGoalsRes, archivedGoalsRes] = await Promise.all([
      fetch(`${API_BASE}/api/tasks`),
      fetch(`${API_BASE}/api/goals?view=active`),
      fetch(`${API_BASE}/api/goals?view=archived`)
    ]);
    const tasksData = await tasksRes.json();
    const activeGoalsData = await activeGoalsRes.json();
    const archivedGoalsData = await archivedGoalsRes.json();
    const tasks = tasksData.tasks || [];
    const activeGoals = activeGoalsData.goals || [];
    const archivedGoals = archivedGoalsData.goals || [];
    workData = { tasks, activeGoals, archivedGoals };
    const projects = [...new Set(tasks.map((t) => t.project_path?.split("/").pop() || "unknown"))].sort();
    const models = [...new Set(tasks.map((t) => t.model || "unknown"))].filter((m) => m).sort();
    const statuses = ["pending", "running", "done", "failed"];
    let html = `<div class="fade-in">
        <div class="filter-bar">
            <select class="form-select" id="filterStatus" onchange="applyWorkFilters()">
                <option value="">All Statuses</option>
                ${statuses.map((s) => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join("")}
            </select>
            <select class="form-select" id="filterProject" onchange="applyWorkFilters()">
                <option value="">All Projects</option>
                ${projects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
            </select>
            <select class="form-select" id="filterModel" onchange="applyWorkFilters()">
                <option value="">All Models</option>
                ${models.map((m) => `<option value="${m}">${m}</option>`).join("")}
            </select>
        </div>`;
    html += `<div class="kanban-board">`;
    for (const status of statuses) {
      const statusTasks = filterWorkTasks(tasks, status);
      const count = statusTasks.length;
      const borderColor = status === "done" ? "var(--green)" : status === "running" ? "var(--cyan)" : status === "failed" ? "var(--red)" : "var(--amber)";
      html += `<div class="kanban-column">
            <div class="kanban-column-header" style="border-bottom-color: ${borderColor}">
                <span class="kanban-column-title">${status.charAt(0).toUpperCase() + status.slice(1)}</span>
                <span class="kanban-column-count">${count}</span>
            </div>
            <div class="kanban-column-body">`;
      for (const task of statusTasks) {
        const projectName = task.project_path?.split("/").pop() || "\u2014";
        const taskStatus = task.status || "pending";
        const borderSide = taskStatus === "done" || taskStatus === "completed" ? "var(--green)" : taskStatus === "running" || taskStatus === "active" || taskStatus === "decomposing" ? "var(--cyan)" : taskStatus === "failed" ? "var(--red)" : "var(--amber)";
        const pulseClass = taskStatus === "running" || taskStatus === "active" ? "pulse" : "";
        html += `<div class="kanban-card ${pulseClass}" data-task-id="${task.id}" style="border-left-color: ${borderSide}" onclick="toggleWorkCardExpanded(event, '${task.id}')">
                <div class="kanban-card-header">
                    <span class="kanban-card-title">${escapeHtml(task.title || "Untitled")}</span>
                </div>
                <div class="kanban-card-meta">
                    <span class="badge badge-${task.model === "opus" ? "strategic" : task.model === "sonnet" ? "improvement" : "opportunity"}">${escapeHtml(task.model || "?")}</span>
                    <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(projectName)}</span>
                </div>
                <div class="kanban-card-footer">
                    <span style="font-size:12px;color:var(--text-muted)">${formatCost(task.cost_usd || 0)}</span>
                    <span style="font-size:12px;color:var(--text-muted)">${timeSince(task.created_at)}</span>
                </div>
                <div class="kanban-card-detail" style="display:none">
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
                        <div style="margin-bottom:6px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Description</strong></div>
                        <div style="font-size:12px;color:var(--text-dim);line-height:1.5">${escapeHtml((task.description || "\u2014").substring(0, 200))}</div>
                        ${task.error ? `<div style="margin-top:8px;padding:6px 8px;background:rgba(248, 81, 73, 0.1);border-radius:4px;border-left:2px solid var(--red)"><strong style="font-size:11px;color:var(--red);text-transform:uppercase">Error</strong><div style="font-size:11px;color:var(--text-dim);margin-top:2px">${escapeHtml(task.error.substring(0, 150))}</div></div>` : ""}
                        ${task.log_file ? `<div style="margin-top:6px"><a href="#" onclick="viewTaskLog('${task.id}', event)" style="font-size:12px;color:var(--blue)">View Log</a></div>` : ""}
                        ${task.commit_sha ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)"><strong>Commit:</strong> ${escapeHtml(task.commit_sha.slice(0, 8))}</div>` : ""}
                        ${task.goal_id ? `<div style="margin-top:6px"><a href="#" style="font-size:12px;color:var(--blue)">Goal: ${escapeHtml(task.goal_id)}</a></div>` : ""}
                    </div>
                </div>
            </div>`;
      }
      html += `</div></div>`;
    }
    html += `</div>`;
    if (activeGoals.length > 0) {
      html += `<div class="admin-card">
            <h2>Active Goals</h2>
            <div class="goals-list">`;
      const goalsByProject = {};
      for (const goal of activeGoals) {
        const proj = goal.project_path?.split("/").pop() || "unknown";
        if (!goalsByProject[proj]) goalsByProject[proj] = [];
        goalsByProject[proj].push(goal);
      }
      for (const [proj, goals] of Object.entries(goalsByProject)) {
        for (const goal of goals) {
          const completed = goal.tasks_completed || 0;
          const total = goal.task_count || 1;
          const pct = total > 0 ? completed / total : 0;
          html += `<div class="goal-item" onclick="toggleGoalExpanded(event, '${goal.id}')">
                    <div class="goal-header">
                        <span class="goal-title">${escapeHtml(goal.title || "Untitled Goal")}</span>
                        <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(proj)}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;line-height:1.4">${escapeHtml((goal.description || "\u2014").substring(0, 100))}</div>
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width:${(pct * 100).toFixed(1)}%"></div>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${completed}/${total} tasks \xB7 ${formatCost(goal.cost_usd || 0)}</div>
                    <div class="goal-detail" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
                        <div style="margin-bottom:4px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Child Tasks</strong></div>
                        ${goal.child_task_count ? `<div style="font-size:12px;color:var(--text-dim)">${goal.child_task_count} tasks assigned</div>` : ""}
                    </div>
                </div>`;
        }
      }
      html += `</div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;
    const statusSelect = document.getElementById("filterStatus");
    const projectSelect = document.getElementById("filterProject");
    const modelSelect = document.getElementById("filterModel");
    if (statusSelect) statusSelect.value = workFilters.status;
    if (projectSelect) projectSelect.value = workFilters.project;
    if (modelSelect) modelSelect.value = workFilters.model;
  }
  function filterWorkTasks(tasks, statusFilter) {
    return tasks.filter((t) => {
      const taskStatus = t.status || "pending";
      const taskProject = t.project_path?.split("/").pop() || "";
      const taskModel = t.model || "";
      let statusMatch = false;
      if (statusFilter === "pending") statusMatch = taskStatus === "pending";
      else if (statusFilter === "running") statusMatch = taskStatus === "running" || taskStatus === "active" || taskStatus === "decomposing";
      else if (statusFilter === "done") statusMatch = taskStatus === "done" || taskStatus === "completed";
      else if (statusFilter === "failed") statusMatch = taskStatus === "failed";
      const projectMatch = !workFilters.project || taskProject === workFilters.project;
      const modelMatch = !workFilters.model || taskModel === workFilters.model;
      return statusMatch && projectMatch && modelMatch;
    });
  }
  window.applyWorkFilters = function() {
    const statusSelect = document.getElementById("filterStatus");
    const projectSelect = document.getElementById("filterProject");
    const modelSelect = document.getElementById("filterModel");
    workFilters.status = statusSelect?.value || "";
    workFilters.project = projectSelect?.value || "";
    workFilters.model = modelSelect?.value || "";
    if (workData) {
      const content = document.getElementById("mainContent");
      if (content) {
        const columns = ["pending", "running", "done", "failed"];
        for (const status of columns) {
          const col = content.querySelector(`[data-kanban-status="${status}"]`);
          if (col) {
            const statusTasks = filterWorkTasks(workData.tasks, status);
            let cardHtml = "";
            for (const task of statusTasks) {
              const projectName = task.project_path?.split("/").pop() || "\u2014";
              const taskStatus = task.status || "pending";
              const borderSide = taskStatus === "done" || taskStatus === "completed" ? "var(--green)" : taskStatus === "running" || taskStatus === "active" || taskStatus === "decomposing" ? "var(--cyan)" : taskStatus === "failed" ? "var(--red)" : "var(--amber)";
              const pulseClass = taskStatus === "running" || taskStatus === "active" ? "pulse" : "";
              cardHtml += `<div class="kanban-card ${pulseClass}" data-task-id="${task.id}" style="border-left-color: ${borderSide}" onclick="toggleWorkCardExpanded(event, '${task.id}')">
                            <div class="kanban-card-header">
                                <span class="kanban-card-title">${escapeHtml(task.title || "Untitled")}</span>
                            </div>
                            <div class="kanban-card-meta">
                                <span class="badge badge-${task.model === "opus" ? "strategic" : task.model === "sonnet" ? "improvement" : "opportunity"}">${escapeHtml(task.model || "?")}</span>
                                <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(projectName)}</span>
                            </div>
                            <div class="kanban-card-footer">
                                <span style="font-size:12px;color:var(--text-muted)">${formatCost(task.cost_usd || 0)}</span>
                                <span style="font-size:12px;color:var(--text-muted)">${timeSince(task.created_at)}</span>
                            </div>
                            <div class="kanban-card-detail" style="display:none">
                                <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
                                    <div style="margin-bottom:6px"><strong style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Description</strong></div>
                                    <div style="font-size:12px;color:var(--text-dim);line-height:1.5">${escapeHtml((task.description || "\u2014").substring(0, 200))}</div>
                                    ${task.error ? `<div style="margin-top:8px;padding:6px 8px;background:rgba(248, 81, 73, 0.1);border-radius:4px;border-left:2px solid var(--red)"><strong style="font-size:11px;color:var(--red);text-transform:uppercase">Error</strong><div style="font-size:11px;color:var(--text-dim);margin-top:2px">${escapeHtml(task.error.substring(0, 150))}</div></div>` : ""}
                                    ${task.log_file ? `<div style="margin-top:6px"><a href="#" onclick="viewTaskLog('${task.id}', event)" style="font-size:12px;color:var(--blue)">View Log</a></div>` : ""}
                                    ${task.commit_sha ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)"><strong>Commit:</strong> ${escapeHtml(task.commit_sha.slice(0, 8))}</div>` : ""}
                                    ${task.goal_id ? `<div style="margin-top:6px"><a href="#" style="font-size:12px;color:var(--blue)">Goal: ${escapeHtml(task.goal_id)}</a></div>` : ""}
                                </div>
                            </div>
                        </div>`;
            }
            const bodyEl = col.querySelector(".kanban-column-body");
            if (bodyEl) bodyEl.innerHTML = cardHtml;
            const countEl = col.querySelector(".kanban-column-count");
            if (countEl) countEl.textContent = String(statusTasks.length);
          }
        }
      }
    }
  };
  window.toggleWorkCardExpanded = function(event, taskId) {
    event.stopPropagation();
    const card = event.target.closest(".kanban-card");
    if (!card) return;
    const detail = card.querySelector(".kanban-card-detail");
    if (detail) {
      const isHidden = detail.style.display === "none";
      detail.style.display = isHidden ? "block" : "none";
    }
  };
  window.toggleGoalExpanded = function(event, goalId) {
    event.stopPropagation();
    const goal = event.target.closest(".goal-item");
    if (!goal) return;
    const detail = goal.querySelector(".goal-detail");
    if (detail) {
      const isHidden = detail.style.display === "none";
      detail.style.display = isHidden ? "block" : "none";
    }
  };
  window.viewTaskLog = function(taskId, event) {
    event.preventDefault();
    event.stopPropagation();
    alert(`Log viewer for task ${taskId} would open here`);
  };
  let selectedProject = null;
  async function loadProjects(content) {
    const [ecosystemRes, portfolioRes] = await Promise.all([
      fetch(`${API_BASE}/api/ecosystem`),
      fetch(`${API_BASE}/api/portfolio`)
    ]);
    const ecosystem = await ecosystemRes.json();
    const portfolio = await portfolioRes.json();
    const projects = ecosystem.projects || [];
    const portfolioMap = {};
    (portfolio.projects || []).forEach((p) => portfolioMap[p.name] = p);
    let html = `<div class="fade-in">`;
    html += `<div class="project-grid">`;
    for (const p of projects) {
      const pf = portfolioMap[p.name] || {};
      const throttled = pf.throttled ? ' <span class="badge badge-failed" style="font-size:9px">THROTTLED</span>' : "";
      html += `<div class="project-card ${selectedProject === p.name ? "selected" : ""}" data-project="${escapeHtml(p.name)}" onclick="selectProject('${escapeHtml(p.name)}')">
            <div class="project-card-header">
                <span class="project-card-name">${escapeHtml(p.name)}${throttled}</span>
                <span class="badge badge-${p.lifecycle === "active" ? "running" : p.lifecycle === "maintained" ? "done" : "pending"}">${escapeHtml(p.lifecycle || "unknown")}</span>
            </div>
            <div class="project-card-stats">
                <span>P${pf.priority || 5}</span>
                <span>${p.total_tasks || 0} tasks</span>
                <span>${formatCost(p.total_cost || 0)}</span>
                ${p.active_goals ? `<span style="color:var(--cyan)">${p.active_goals} active</span>` : ""}
            </div>
        </div>`;
    }
    html += `</div>`;
    html += `<div id="projectDetail"></div>`;
    const budgetData = projects.filter((p) => {
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
    if (selectedProject) {
      const proj = projects.find((p) => p.name === selectedProject);
      const pf = portfolioMap[selectedProject];
      if (proj) renderProjectDetail(proj, pf);
    }
    if (budgetData.length > 0) {
      createChart("budgetChart", {
        type: "bar",
        data: {
          labels: budgetData.map((p) => p.name),
          datasets: [
            {
              label: "Spent Today",
              data: budgetData.map((p) => portfolioMap[p.name]?.cost_spent_today || 0),
              backgroundColor: chartColor("blue") + "80",
              borderColor: chartColor("blue"),
              borderWidth: 1
            },
            {
              label: "Daily Budget",
              data: budgetData.map((p) => portfolioMap[p.name]?.cost_budget_daily || 0),
              backgroundColor: chartColor("text-muted") + "30",
              borderColor: chartColor("text-muted"),
              borderWidth: 1
            }
          ]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
          scales: { x: { beginAtZero: true, ticks: { callback: (v) => "$" + v.toFixed(2) } } }
        }
      });
    }
  }
  window.selectProject = function(name) {
    selectedProject = selectedProject === name ? null : name;
    renderModule("projects");
  };
  function renderProjectDetail(proj, pf) {
    const detail = document.getElementById("projectDetail");
    if (!detail) return;
    detail.innerHTML = `<div class="detail-panel fade-in">
        <h2>${escapeHtml(proj.name)}</h2>
        <div class="detail-grid">
            <div class="detail-field">
                <span class="label">Path</span>
                <span class="value mono" style="font-size:12px">${escapeHtml(proj.path || "")}</span>
            </div>
            <div class="detail-field">
                <span class="label">Lifecycle</span>
                <span class="value">${escapeHtml(proj.lifecycle || "unknown")}</span>
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
                <span class="value">${pf?.cost_budget_daily ? formatCost(pf.cost_budget_daily) : "None"}</span>
            </div>
            <div class="detail-field">
                <span class="label">Spent Today</span>
                <span class="value">${formatCost(pf?.cost_spent_today || 0)}</span>
            </div>
            <div class="detail-field">
                <span class="label">Throttled</span>
                <span class="value" style="color:${pf?.throttled ? "var(--red)" : "var(--green)"}">${pf?.throttled ? "Yes" : "No"}</span>
            </div>
            ${proj.ports ? `<div class="detail-field">
                <span class="label">Ports</span>
                <span class="value mono" style="font-size:12px">${escapeHtml(JSON.stringify(proj.ports))}</span>
            </div>` : ""}
        </div>
        ${pf?.throttled ? `<div style="margin-top:12px"><button class="admin-btn admin-btn-primary admin-btn-sm" onclick="unthrottleProject('${escapeHtml(proj.name)}')">Unthrottle</button></div>` : ""}
    </div>`;
  }
  window.unthrottleProject = async function(name) {
    await fetch(`${API_BASE}/api/portfolio/${encodeURIComponent(name)}/unthrottle`, { method: "POST" });
    renderModule("projects");
  };
  async function loadSupervisor(content) {
    const [statusRes, cyclesRes, memoryRes, proposalsRes] = await Promise.all([
      fetch(`${API_BASE}/api/supervisor/status`),
      fetch(`${API_BASE}/api/supervisor/cycles?limit=50`),
      fetch(`${API_BASE}/api/supervisor/memory`),
      fetch(`${API_BASE}/api/supervisor/proposals`)
    ]);
    const status = await statusRes.json();
    const cyclesData = await cyclesRes.json();
    const memoryData = await memoryRes.json();
    const proposalsData = await proposalsRes.json();
    const cycles = cyclesData.cycles || [];
    const proposals = proposalsData.proposals || [];
    const pending = proposals.filter((p) => p.status === "pending");
    const resolved = proposals.filter((p) => p.status !== "pending");
    const badge = document.getElementById("proposalCount");
    if (badge) {
      badge.textContent = String(pending.length);
      badge.style.display = pending.length > 0 ? "inline" : "none";
    }
    const actionsEl = document.getElementById("moduleActions");
    if (actionsEl) {
      actionsEl.innerHTML = `
            <button class="admin-btn admin-btn-sm" onclick="toggleSupervisorPause()">${status.paused ? "Resume" : "Pause"}</button>
            <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="triggerSupervisorCycle()">Trigger Cycle</button>
        `;
    }
    let html = `<div class="fade-in">`;
    const supStatus = status.paused ? "Paused" : status.enabled ? "Running" : "Disabled";
    const supColor = status.paused ? "var(--amber)" : status.enabled ? "var(--green)" : "var(--red)";
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
            <span class="stat-value" style="font-size:14px">${status.lastCycle ? timeSince(status.lastCycle.completed_at || status.lastCycle.started_at) : "Never"}</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Pending Proposals</span>
            <span class="stat-value" style="color:${pending.length > 0 ? "var(--amber)" : "var(--text-heading)"}">${pending.length}</span>
        </div>
    </div>`;
    if (pending.length > 0) {
      html += `<div class="admin-card"><h2>Strategic Proposals (${pending.length} Pending)</h2>`;
      for (const p of pending) {
        html += renderProposalCard(p);
      }
      html += `</div>`;
    }
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
    html += `<div class="admin-card">
        <h2>Cycle History</h2>
        <table class="admin-table">
            <thead><tr>
                <th>#</th><th>Started</th><th>Duration</th><th>Actions</th><th>Observations</th><th>Cost</th><th>Turns</th>
            </tr></thead>
            <tbody>`;
    for (const c of cycles.slice(0, 30)) {
      const duration = c.started_at && c.completed_at ? Math.round((new Date(c.completed_at).getTime() - new Date(c.started_at).getTime()) / 1e3) + "s" : "\u2014";
      let actions = "\u2014";
      try {
        const a = JSON.parse(c.actions_taken || "[]");
        actions = Array.isArray(a) ? a.length + " actions" : "\u2014";
      } catch {
        actions = c.actions_taken ? "1 action" : "\u2014";
      }
      let observations = "\u2014";
      try {
        const o = JSON.parse(c.observations || "[]");
        observations = Array.isArray(o) ? o.length + " obs" : typeof c.observations === "string" ? c.observations.slice(0, 60) : "\u2014";
      } catch {
        observations = c.observations ? String(c.observations).slice(0, 60) : "\u2014";
      }
      html += `<tr onclick="expandCycle(this, ${escapeHtml(JSON.stringify(JSON.stringify(c)))})">
            <td class="num">${c.cycle_number || "\u2014"}</td>
            <td>${formatDateTime(c.started_at)}</td>
            <td class="num">${duration}</td>
            <td>${actions}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(observations)}</td>
            <td class="num">${formatCost(c.cost_usd || 0)}</td>
            <td class="num">${c.num_turns || "\u2014"}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;
    const memoryFiles = memoryData.files || {};
    const memoryKeys = Object.keys(memoryFiles);
    if (memoryKeys.length > 0) {
      html += `<div class="admin-card">
            <h2>Memory Banks</h2>
            <div class="memory-tabs" id="memoryTabs">
                ${memoryKeys.map((k, i) => `<button class="memory-tab ${i === 0 ? "active" : ""}" data-file="${escapeHtml(k)}">${escapeHtml(k.replace(".md", ""))}</button>`).join("")}
            </div>
            <div class="memory-content" id="memoryContent">${escapeHtml(memoryFiles[memoryKeys[0]] || "Empty")}</div>
        </div>`;
    }
    if (resolved.length > 0) {
      html += `<div class="admin-card"><h2>Proposal History (${resolved.length})</h2>`;
      for (const p of resolved.slice(0, 10)) {
        html += renderProposalCard(p);
      }
      html += `</div>`;
    }
    html += `</div>`;
    content.innerHTML = html;
    const memTabs = document.getElementById("memoryTabs");
    const memContent = document.getElementById("memoryContent");
    if (memTabs && memContent) {
      memTabs.addEventListener("click", (e) => {
        const tab = e.target.closest(".memory-tab");
        if (!tab) return;
        const file = tab.getAttribute("data-file") || "";
        memTabs.querySelectorAll(".memory-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        memContent.textContent = memoryFiles[file] || "Empty";
      });
    }
    if (cycles.length > 0) {
      const recentCycles = cycles.slice(0, 30).reverse();
      createChart("supervisorCostChart", {
        type: "line",
        data: {
          labels: recentCycles.map((c) => c.cycle_number || ""),
          datasets: [{
            label: "Cost (USD)",
            data: recentCycles.map((c) => c.cost_usd || 0),
            borderColor: chartColor("purple"),
            backgroundColor: "rgba(179, 146, 240, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: (v) => "$" + v.toFixed(3) } } }
        }
      });
      createChart("supervisorTurnsChart", {
        type: "bar",
        data: {
          labels: recentCycles.map((c) => c.cycle_number || ""),
          datasets: [{
            label: "Turns",
            data: recentCycles.map((c) => c.num_turns || 0),
            backgroundColor: chartColor("cyan") + "60",
            borderColor: chartColor("cyan"),
            borderWidth: 1
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
  function renderProposalCard(p) {
    const statusCls = p.status === "approved" ? "approved" : p.status === "dismissed" ? "dismissed" : "";
    let actionsHtml = "";
    if (p.status === "pending") {
      actionsHtml = `<div class="proposal-actions">
            <button class="admin-btn admin-btn-success admin-btn-sm" onclick="approveProposal('${p.id}')">Approve</button>
            <button class="admin-btn admin-btn-sm" onclick="dismissProposal('${p.id}')">Dismiss</button>
        </div>`;
    }
    return `<div class="proposal-card ${statusCls}">
        <div class="proposal-header">
            <span class="proposal-title">${escapeHtml(p.title)}</span>
            ${categoryBadge(p.category || "improvement")}
        </div>
        <div class="proposal-desc">${escapeHtml(p.description || "")}</div>
        ${p.supervisor_reasoning ? `<div class="proposal-reasoning">${escapeHtml(p.supervisor_reasoning.slice(0, 300))}</div>` : ""}
        <div class="activity-meta">
            ${p.project_path ? escapeHtml(p.project_path.split("/").pop() || "") + " \xB7 " : ""}
            ${p.estimated_effort || "medium"} effort \xB7 ${timeSince(p.created_at)}
            ${p.status !== "pending" ? " \xB7 " + p.status + (p.reviewed_at ? " " + timeSince(p.reviewed_at) : "") : ""}
        </div>
        ${actionsHtml}
    </div>`;
  }
  window.approveProposal = async function(id) {
    await fetch(`${API_BASE}/api/supervisor/proposals/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    renderModule("supervisor");
  };
  window.dismissProposal = async function(id) {
    const notes = prompt("Dismiss reason (optional):");
    await fetch(`${API_BASE}/api/supervisor/proposals/${id}/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes || "" })
    });
    renderModule("supervisor");
  };
  window.triggerSupervisorCycle = async function() {
    await fetch(`${API_BASE}/api/supervisor/trigger`, { method: "POST" });
  };
  window.toggleSupervisorPause = async function() {
    await fetch(`${API_BASE}/api/supervisor/pause`, { method: "POST" });
    setTimeout(() => renderModule("supervisor"), 500);
  };
  window.expandCycle = function(row, dataJson) {
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains("cycle-detail-row")) {
      existing.remove();
      return;
    }
    document.querySelectorAll(".cycle-detail-row").forEach((el) => el.remove());
    try {
      const c = JSON.parse(dataJson);
      const detailRow = document.createElement("tr");
      detailRow.classList.add("cycle-detail-row");
      let detailHtml = '<td colspan="7" style="padding:12px 16px;background:var(--bg-page);border-radius:4px">';
      if (c.reasoning) detailHtml += `<div style="margin-bottom:8px"><strong style="color:var(--text-dim);font-size:11px;text-transform:uppercase">Reasoning</strong><div style="font-size:12px;color:var(--text);margin-top:4px;white-space:pre-wrap">${escapeHtml(c.reasoning)}</div></div>`;
      try {
        const actions = JSON.parse(c.actions_taken || "[]");
        if (Array.isArray(actions) && actions.length > 0) {
          detailHtml += `<div style="margin-bottom:8px"><strong style="color:var(--text-dim);font-size:11px;text-transform:uppercase">Actions</strong><div style="font-size:12px;color:var(--text);margin-top:4px;white-space:pre-wrap">${escapeHtml(JSON.stringify(actions, null, 2))}</div></div>`;
        }
      } catch {
      }
      try {
        const obs = JSON.parse(c.observations || "[]");
        if (Array.isArray(obs) && obs.length > 0) {
          detailHtml += `<div><strong style="color:var(--text-dim);font-size:11px;text-transform:uppercase">Observations</strong><div style="font-size:12px;color:var(--text);margin-top:4px;white-space:pre-wrap">${escapeHtml(JSON.stringify(obs, null, 2))}</div></div>`;
        }
      } catch {
      }
      if (c.error) detailHtml += `<div style="margin-top:8px;color:var(--red);font-size:12px">${escapeHtml(c.error)}</div>`;
      detailHtml += "</td>";
      detailRow.innerHTML = detailHtml;
      row.after(detailRow);
    } catch {
    }
  };
  async function loadReports(content) {
    const [digestRes, digestsRes, weeklyRes, weekliesRes, analyticsRes] = await Promise.all([
      fetch(`${API_BASE}/api/digest/latest`),
      fetch(`${API_BASE}/api/digests`),
      fetch(`${API_BASE}/api/weekly-report/latest`),
      fetch(`${API_BASE}/api/weekly-reports`),
      fetch(`${API_BASE}/api/analytics`)
    ]);
    const digestData = await digestRes.json();
    const digestsData = await digestsRes.json();
    const weeklyData = await weeklyRes.json();
    const weekliesData = await weekliesRes.json();
    const analytics = await analyticsRes.json();
    const actionsEl = document.getElementById("moduleActions");
    if (actionsEl) {
      actionsEl.innerHTML = `
            <button class="admin-btn admin-btn-sm" onclick="generateDigest()">Generate Digest</button>
            <button class="admin-btn admin-btn-sm" onclick="generateWeekly()">Generate Weekly</button>
        `;
    }
    let html = `<div class="fade-in">`;
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
                <td class="num">${s.avgDuration ? Math.round(s.avgDuration) + "s" : "\u2014"}</td>
            </tr>`;
      }
      html += `</tbody></table></div>`;
    }
    const suggestions = analytics.suggestions || [];
    if (suggestions.length > 0) {
      html += `<div class="admin-card"><h2>Cost Optimisation Suggestions</h2>`;
      for (const s of suggestions) {
        html += `<div style="padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:13px">
                <strong>${escapeHtml(s.project?.split("/").pop() || "")}</strong> (${escapeHtml(s.taskType)}):
                Switch <span class="badge badge-${s.currentModel === "opus" ? "strategic" : "improvement"}">${s.currentModel}</span>
                to <span class="badge badge-${s.suggestedModel === "haiku" ? "opportunity" : "improvement"}">${s.suggestedModel}</span>
                \u2014 save ${formatCost(s.savingsPerTask)}/task (${formatPct(s.cheapSuccessRate)} success, n=${s.sampleSize})
            </div>`;
      }
      html += `</div>`;
    }
    const digest = digestData.digest;
    html += `<div class="admin-card"><h2>Latest Daily Digest</h2>`;
    if (digest) {
      html += `<div class="activity-meta" style="margin-bottom:8px">${formatDate(digest.period_start)} \u2014 ${digest.task_count || 0} tasks, ${formatCost(digest.total_cost || 0)}</div>`;
      html += `<div class="report-content">${escapeHtml(digest.digest_text || "No content")}</div>`;
    } else {
      html += `<p style="color:var(--text-muted)">No digest available. Click "Generate Digest" to create one.</p>`;
    }
    html += `</div>`;
    const digests = digestsData.digests || [];
    if (digests.length > 1) {
      html += `<div class="admin-card"><h2>Digest History</h2><div class="report-history-list">`;
      for (const d of digests.slice(0, 10)) {
        html += `<div class="report-history-item" onclick="viewDigest('${d.id}')">
                <span>${formatDate(d.period_start)} \u2014 ${d.task_count || 0} tasks</span>
                <span>${formatCost(d.total_cost || 0)}</span>
            </div>`;
      }
      html += `</div></div>`;
    }
    const weekly = weeklyData.report;
    html += `<div class="admin-card"><h2>Latest Weekly Report</h2>`;
    if (weekly) {
      html += `<div class="activity-meta" style="margin-bottom:8px">${formatDate(weekly.week_start)} \u2014 ${formatDate(weekly.week_end)} \xB7 ${weekly.task_count || 0} tasks, ${formatCost(weekly.total_cost || 0)}</div>`;
      html += `<div class="report-content">${escapeHtml(weekly.report_text || "No content")}</div>`;
    } else {
      html += `<p style="color:var(--text-muted)">No weekly report available. Click "Generate Weekly" to create one.</p>`;
    }
    html += `</div>`;
    html += `</div>`;
    content.innerHTML = html;
    const velocity = analytics.velocity || {};
    const dailyCounts = (velocity.dailyCounts || []).reverse();
    createChart("reportVelocityChart", {
      type: "line",
      data: {
        labels: dailyCounts.map((d) => d.date?.slice(5) || ""),
        datasets: [{
          label: "Tasks/Day",
          data: dailyCounts.map((d) => d.count || 0),
          borderColor: chartColor("blue"),
          backgroundColor: "rgba(56, 139, 253, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 3
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
      const maxCost = Math.max(...modelLabels.map((m) => byModel[m].avgCost || 0), 1e-3);
      const maxTurns = Math.max(...modelLabels.map((m) => byModel[m].avgTurns || 0), 1);
      createChart("modelRadarChart", {
        type: "radar",
        data: {
          labels: ["Success Rate", "Cost Efficiency", "Turn Efficiency"],
          datasets: modelLabels.map((m, i) => ({
            label: m,
            data: [
              (byModel[m].successRate || 0) * 100,
              (1 - (byModel[m].avgCost || 0) / maxCost) * 100,
              (1 - (byModel[m].avgTurns || 0) / maxTurns) * 100
            ],
            borderColor: m === "opus" ? chartColor("purple") : m === "sonnet" ? chartColor("blue") : chartColor("green"),
            backgroundColor: (m === "opus" ? chartColor("purple") : m === "sonnet" ? chartColor("blue") : chartColor("green")) + "20",
            pointRadius: 3
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
          scales: { r: { beginAtZero: true, max: 100, ticks: { display: false }, grid: { color: "rgba(48, 54, 61, 0.2)" } } }
        }
      });
    }
  }
  window.generateDigest = async function() {
    await fetch(`${API_BASE}/api/digest/generate`, { method: "POST" });
    setTimeout(() => renderModule("reports"), 1e3);
  };
  window.generateWeekly = async function() {
    await fetch(`${API_BASE}/api/weekly-report/generate`, { method: "POST" });
    setTimeout(() => renderModule("reports"), 1e3);
  };
  window.viewDigest = async function(id) {
    try {
      const res = await fetch(`${API_BASE}/api/digest/${id}`);
      const data = await res.json();
      if (data.digest) {
        const content = document.getElementById("mainContent");
        if (!content) return;
        const d = data.digest;
        content.innerHTML = `<div class="fade-in">
                <div style="margin-bottom:12px"><button class="admin-btn admin-btn-sm" onclick="renderModule('reports')">&larr; Back to Reports</button></div>
                <div class="admin-card">
                    <h2>Digest: ${formatDate(d.period_start)}</h2>
                    <div class="activity-meta" style="margin-bottom:12px">${d.task_count || 0} tasks \xB7 ${formatCost(d.total_cost || 0)}</div>
                    <div class="report-content">${escapeHtml(d.digest_text || "")}</div>
                </div>
            </div>`;
      }
    } catch {
    }
  };
  async function loadProducts(content) {
    if (selectedProductId) {
      await loadProductDetail(content, selectedProductId);
    } else {
      await loadProductList(content);
    }
  }
  async function loadProductList(content) {
    const res = await fetch(`${API_BASE}/api/products`);
    const data = await res.json();
    const products = data.products || [];
    let html = `<div class="fade-in">
        <div class="product-grid">`;
    for (const p of products) {
      const phasesCompleted = p.phases_completed || 0;
      const totalPhases = 7;
      const pct = phasesCompleted / totalPhases * 100;
      const statusCls = p.status === "completed" ? "done" : p.status === "active" || p.status === "running" ? "running" : p.status === "paused" ? "pending" : "cancelled";
      html += `<div class="product-card" data-product-id="${escapeHtml(p.id)}" onclick="selectProduct('${escapeHtml(p.id)}')">
            <div class="product-card-header">
                <span class="product-card-name">${escapeHtml(p.name)}</span>
                <span class="phase-indicator badge badge-${p.current_phase_index >= 6 ? "done" : p.current_phase_index >= 3 ? "improvement" : "strategic"}">Phase ${(p.current_phase_index || 0) + 1}/7</span>
            </div>
            <div class="product-card-status">
                ${statusBadge(p.status || "pending")}
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
  async function loadProductDetail(content, productId) {
    const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
    const data = await res.json();
    const product = data.product || {};
    const phases = data.phases || [];
    const knowledge = data.knowledge || [];
    const knowledgeByCategory = {};
    for (const k of knowledge) {
      const cat = k.category || "general";
      if (!knowledgeByCategory[cat]) knowledgeByCategory[cat] = [];
      knowledgeByCategory[cat].push(k);
    }
    let html = `<div class="fade-in">
        <div style="margin-bottom: 16px">
            <button class="admin-btn admin-btn-sm" onclick="backToProductList()">\u2190 Back to Products</button>
        </div>

        <div class="detail-panel">
            <h2>${escapeHtml(product.name)}</h2>
            <div class="detail-grid">
                <div class="detail-field">
                    <span class="label">Status</span>
                    <span class="value">${statusBadge(product.status || "pending")}</span>
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
                    <span class="value" style="font-size: 12px">${escapeHtml((product.seed_text || "").substring(0, 60))}</span>
                </div>` : ""}
            </div>
        </div>

        <div class="admin-card">
            <h2>Phase Timeline</h2>
            <div class="phase-timeline">`;
    const phaseNames = ["Research", "Design", "Architecture", "Build", "Test", "Document", "Deploy"];
    for (let i = 0; i < 7; i++) {
      const phase = phases.find((p) => p.phase_index === i);
      const isCurrentPhase = i === product.current_phase_index;
      const isCompleted = i < product.current_phase_index || phase && phase.status === "completed";
      const statusClass = isCompleted ? "done" : isCurrentPhase ? "current" : "pending";
      html += `<div class="phase-node ${statusClass}" onclick="expandPhase(event, ${i})">
            <div class="phase-node-circle"></div>
            <div class="phase-node-label">${phaseNames[i]}</div>
            ${phase ? `<div class="phase-node-badge">${statusBadge(phase.status || "pending")}</div>` : ""}
        </div>`;
    }
    html += `</div></div>`;
    if (phases.length > 0) {
      html += `<div class="admin-card">
            <h2>Phase Details</h2>
            <div class="phase-details-list">`;
      for (const phase of phases) {
        const phaseStatus = phase.status || "pending";
        const gateStatus = phase.gate_status || "\u2014";
        const costUsd = phase.cost_usd || 0;
        const costColor = costUsd > 0 ? "var(--text)" : "var(--text-muted)";
        html += `<div class="phase-detail-card" onclick="togglePhaseDetail(event, ${phase.phase_index})">
                <div class="phase-detail-header">
                    <span class="phase-detail-name">${phaseNames[phase.phase_index]}</span>
                    <div class="phase-detail-badges">
                        ${statusBadge(phaseStatus)}
                        ${phase.gate_status ? `<span class="badge badge-${gateStatus === "passed" ? "done" : gateStatus === "pending" ? "pending" : "failed"}">${escapeHtml(gateStatus)}</span>` : ""}
                    </div>
                </div>
                <div class="phase-detail-meta">
                    <span style="color: ${costColor}">Cost: ${formatCost(costUsd)}</span>
                    ${phase.started_at ? `<span style="color: var(--text-muted)">Started: ${formatDateTime(phase.started_at)}</span>` : ""}
                    ${phase.completed_at ? `<span style="color: var(--text-muted)">Completed: ${formatDateTime(phase.completed_at)}</span>` : ""}
                </div>
                <div class="phase-detail-expanded" style="display: none">
                    ${phase.goal_id ? `<div style="margin-top: 8px; padding: 8px; background: var(--bg-page); border-radius: 4px; font-size: 12px">
                        <strong style="color: var(--text-muted)">Goal:</strong> <a href="#" style="color: var(--blue)">${escapeHtml(phase.goal_id)}</a>
                    </div>` : ""}
                    ${phase.artifacts ? `<div style="margin-top: 8px; padding: 8px; background: var(--bg-page); border-radius: 4px; font-size: 11px; font-family: ui-monospace">
                        <strong style="color: var(--text-muted)">Artifacts:</strong>
                        <pre style="margin-top: 4px; color: var(--text-dim); overflow-x: auto">${escapeHtml(typeof phase.artifacts === "string" ? phase.artifacts : JSON.stringify(phase.artifacts, null, 2))}</pre>
                    </div>` : ""}
                </div>
            </div>`;
      }
      html += `</div></div>`;
    }
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
                        <span class="knowledge-entry-title">${escapeHtml(entry.title || "Untitled")}</span>
                        <span style="font-size: 11px; color: var(--text-muted)">${formatDate(entry.created_at)}</span>
                    </div>
                    <div class="knowledge-entry-content" style="display: none">
                        <div style="margin-top: 8px; padding: 8px; background: var(--bg-page); border-radius: 4px; font-size: 12px; line-height: 1.5">
                            ${escapeHtml(entry.content || "\u2014").replace(/\n/g, "<br>")}
                        </div>
                        ${entry.source_phase ? `<div style="margin-top: 6px; font-size: 11px; color: var(--text-muted)">Source: Phase ${entry.source_phase + 1}</div>` : ""}
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
  window.selectProduct = function(id) {
    selectedProductId = selectedProductId === id ? null : id;
    renderModule("products");
  };
  window.backToProductList = function() {
    selectedProductId = null;
    renderModule("products");
  };
  window.togglePhaseDetail = function(event, phaseIndex) {
    event.stopPropagation();
    const card = event.target.closest(".phase-detail-card");
    if (!card) return;
    const expanded = card.querySelector(".phase-detail-expanded");
    if (expanded) {
      const isHidden = expanded.style.display === "none";
      expanded.style.display = isHidden ? "block" : "none";
    }
  };
  window.toggleKnowledgeEntry = function(event, element) {
    event.stopPropagation();
    const content = element.querySelector(".knowledge-entry-content");
    if (content) {
      const isHidden = content.style.display === "none";
      content.style.display = isHidden ? "block" : "none";
    }
  };
  async function loadConversations(content) {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`);
      const data = await res.json();
      const conversations = data.conversations || [];
      const actionsEl = document.getElementById("moduleActions");
      if (actionsEl) {
        actionsEl.innerHTML = `
                <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="showNewThreadForm()">New Thread</button>
            `;
      }
      let html = `<div class="fade-in conversation-container">
            <div class="conversation-layout">
                <div class="thread-list-panel">
                    <div id="threadList" class="thread-list">`;
      if (conversations.length === 0) {
        html += `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">No threads yet</div>`;
      } else {
        for (const conv of conversations) {
          const messageCount = conv.message_count || 0;
          const isSelected = selectedConversationId === conv.id;
          const statusBadgeClass = conv.status === "open" ? "badge-running" : "badge-done";
          const statusText = conv.status === "open" ? "Open" : "Resolved";
          html += `<div class="thread-item ${isSelected ? "active" : ""}" data-thread-id="${conv.id}" onclick="selectConversationThread('${conv.id}')">
                    <div class="thread-item-title">${escapeHtml(conv.title)}</div>
                    <div class="thread-item-meta">
                        <span style="font-size:11px;color:var(--text-muted)">${timeSince(conv.updated_at)}</span>
                        <span class="badge ${statusBadgeClass}" style="font-size:9px;padding:1px 5px">${statusText}</span>
                    </div>
                    <div class="thread-item-count" style="font-size:11px;color:var(--text-muted)">${messageCount} message${messageCount !== 1 ? "s" : ""}</div>
                </div>`;
        }
      }
      html += `</div></div>
                <div class="thread-detail-panel" id="threadDetailPanel">`;
      if (selectedConversationId && conversations.find((c) => c.id === selectedConversationId)) {
        html += `<div id="threadDetail"></div>`;
      } else {
        html += `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px">Select a thread to view messages</div>`;
      }
      html += `</div>
            </div>
        </div>`;
      content.innerHTML = html;
      if (selectedConversationId) {
        await renderConversationThread(selectedConversationId);
      }
    } catch (err) {
      content.innerHTML = `<div class="admin-card"><p style="color:var(--red)">Error loading conversations: ${escapeHtml(err.message)}</p></div>`;
    }
  }
  async function renderConversationThread(conversationId) {
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
      const data = await res.json();
      const conversation = data.conversation;
      const messages = data.messages || [];
      const detailPanel = document.getElementById("threadDetail");
      if (!detailPanel) return;
      const resolveButton = conversation.status === "open" ? `<button class="admin-btn admin-btn-sm" onclick="resolveConversation('${conversation.id}')">Resolve</button>` : `<button class="admin-btn admin-btn-sm" onclick="reopenConversation('${conversation.id}')">Reopen</button>`;
      let html = `<div class="thread-header">
            <div style="flex:1">
                <h2 style="margin:0;margin-bottom:4px;font-size:16px">${escapeHtml(conversation.title)}</h2>
                <div style="font-size:12px;color:var(--text-muted)">${formatDateTime(conversation.created_at)}</div>
            </div>
            <div>${resolveButton}</div>
        </div>

        <div class="message-list" id="messageList">`;
      if (messages.length === 0) {
        html += `<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:12px">No messages yet</div>`;
      } else {
        for (const msg of messages) {
          const isHuman = msg.role === "human";
          const bubbleClass = isHuman ? "message-bubble human" : "message-bubble supervisor";
          const label = isHuman ? "You" : "Supervisor";
          html += `<div class="${bubbleClass}">
                    <div style="font-size:10px;color:${isHuman ? "rgba(255,255,255,0.6)" : "var(--text-muted)"};margin-bottom:4px">${label} \xB7 ${formatTime(msg.created_at)}</div>
                    <div style="word-break:break-word;line-height:1.5">${escapeHtml(msg.content)}</div>
                </div>`;
        }
      }
      html += `</div>

        <div class="message-input-area">
            <textarea class="message-input" id="messageInput" placeholder="Type your message..." style="resize:vertical;min-height:60px"></textarea>
            <button class="admin-btn admin-btn-primary" onclick="sendConversationMessage('${conversation.id}')">Send</button>
        </div>`;
      detailPanel.innerHTML = html;
      const messageList = document.getElementById("messageList");
      if (messageList) {
        setTimeout(() => messageList.scrollTop = messageList.scrollHeight, 0);
      }
      const input = document.getElementById("messageInput");
      if (input) {
        input.focus();
      }
    } catch (err) {
      const detailPanel = document.getElementById("threadDetail");
      if (detailPanel) {
        detailPanel.innerHTML = `<div style="color:var(--red);padding:16px">Error loading thread: ${escapeHtml(err.message)}</div>`;
      }
    }
  }
  window.selectConversationThread = async function(conversationId) {
    selectedConversationId = conversationId;
    await renderConversationThread(conversationId);
    document.querySelectorAll(".thread-item").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-thread-id") === conversationId);
    });
  };
  window.showNewThreadForm = function() {
    const title = prompt("Thread title:");
    if (!title) return;
    createNewConversation(title);
  };
  async function createNewConversation(title) {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await res.json();
      if (data.conversation) {
        selectedConversationId = data.conversation.id;
        await renderModule("conversations");
      }
    } catch (err) {
      alert("Error creating thread: " + err.message);
    }
  }
  window.sendConversationMessage = async function(conversationId) {
    const input = document.getElementById("messageInput");
    if (!input || !input.value.trim()) return;
    const content = input.value;
    input.value = "";
    try {
      await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, role: "human" })
      });
      await renderConversationThread(conversationId);
    } catch (err) {
      alert("Error sending message: " + err.message);
      input.value = content;
    }
  };
  window.resolveConversation = async function(conversationId) {
    try {
      await fetch(`${API_BASE}/api/conversations/${conversationId}/resolve`, { method: "POST" });
      await renderModule("conversations");
    } catch (err) {
      alert("Error resolving conversation: " + err.message);
    }
  };
  window.reopenConversation = async function(conversationId) {
    try {
      await fetch(`${API_BASE}/api/conversations/${conversationId}/reopen`, { method: "POST" });
      await renderModule("conversations");
    } catch (err) {
      alert("Error reopening conversation: " + err.message);
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initChartDefaults();
    document.querySelectorAll(".sidebar-item[data-module]").forEach((el) => {
      el.addEventListener("click", (e) => {
      });
    });
    const collapseBtn = document.getElementById("collapseBtn");
    const layout = document.getElementById("adminLayout");
    if (collapseBtn && layout) {
      collapseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        layout.classList.toggle("collapsed");
        localStorage.setItem("admin-collapsed", layout.classList.contains("collapsed") ? "1" : "0");
      });
      if (localStorage.getItem("admin-collapsed") === "1") layout.classList.add("collapsed");
    }
    const themeBtn = document.getElementById("themeToggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleTheme();
      });
    }
    window.addEventListener("hashchange", handleRoute);
    handleRoute();
    connectWebSocket();
    updateProposalBadge();
    setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/supervisor/status`);
        const data = await res.json();
        const el = document.getElementById("statusInfo");
        if (el && data.lastCycle) {
          el.textContent = `Last cycle: ${timeSince(data.lastCycle.completed_at || data.lastCycle.started_at)} \xB7 ${data.paused ? "Paused" : "Active"}`;
        }
      } catch {
      }
    }, 3e4);
  });
})();
