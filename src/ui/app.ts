// @ts-nocheck

        const POLL_INTERVAL = 3000;
        const WS_RECONNECT_BASE = 1000;
        const WS_RECONNECT_MAX = 30000;
        const API_BASE = '';

        let currentPrompt = null;
        let pollTimer = null;
        let isSending = false;
        let userHasTapped = false;
        let showingHistory = false;
        let ws = null;
        let wsReconnectDelay = WS_RECONNECT_BASE;
        let wsReconnectTimer = null;
        let usingWebSocket = false;
        let terminalLive = false;
        let terminalSession = null;

        let lastWrittenContent = '';

        const terminal = document.getElementById('terminal');
        const termContent = document.getElementById('termContent');
        const mobileInput = document.getElementById('mobileInput');
        const titleText = document.getElementById('titleText');
        const statusText = document.getElementById('statusText');
        const footerLeft = document.getElementById('footerLeft');
        const footerHint = document.getElementById('footerHint');
        const toastWrap = document.getElementById('toastWrap');
        const quickbar = document.getElementById('quickbar');
        const statusDot = statusText.parentElement.querySelector('.status-dot');

        // Search elements
        const searchToggle = document.getElementById('searchToggle');
        const searchbar = document.getElementById('searchbar');
        const searchInput = document.getElementById('searchInput');
        const searchCount = document.getElementById('searchCount');
        const searchPrev = document.getElementById('searchPrev');
        const searchNext = document.getElementById('searchNext');
        const searchClose = document.getElementById('searchClose');
        const copyBtn = document.getElementById('copyBtn');
        const themeToggle = document.getElementById('themeToggle');

        // ── Dark Mode Theme Management ─────────────────────────────────

        function initTheme() {
            const root = document.documentElement;

            // Disable transitions during initialization
            root.classList.add('instant');

            // 1. Check localStorage for user preference
            const savedTheme = localStorage.getItem('theme');

            // 2. Check system preference
            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

            // 3. Determine theme
            let theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

            // Apply theme
            applyTheme(theme);

            // Re-enable transitions after setting theme
            setTimeout(() => {
                root.classList.remove('instant');
            }, 0);
        }

        function applyTheme(theme) {
            const root = document.documentElement;

            // Remove both classes first
            root.classList.remove('dark-mode', 'light-mode');

            // Add the appropriate class
            if (theme === 'dark') {
                root.classList.add('dark-mode');
                themeToggle.textContent = '🌙';
                themeToggle.title = 'Switch to light mode';
            } else {
                root.classList.add('light-mode');
                themeToggle.textContent = '☀️';
                themeToggle.title = 'Switch to dark mode';
            }

            // Save to localStorage
            localStorage.setItem('theme', theme);

            // Update document meta theme-color
            const isDark = theme === 'dark';
            const themeColor = isDark ? '#0d1117' : '#ffffff';
            let metaTheme = document.querySelector('meta[name="theme-color"]');
            if (!metaTheme) {
                metaTheme = document.createElement('meta');
                metaTheme.name = 'theme-color';
                document.head.appendChild(metaTheme);
            }
            metaTheme.content = themeColor;
        }

        function toggleTheme() {
            const currentTheme = document.documentElement.classList.contains('dark-mode') ? 'dark' : 'light';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(newTheme);
        }

        // Initialize theme on load
        initTheme();

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            // Only apply if user hasn't set a preference
            if (!localStorage.getItem('theme')) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        });

        // ── Prompt handling ───────────────────────────────────

        // Shared prompt update handler (used by both WS and HTTP)
        function handlePromptsUpdate(prompts) {
            if (prompts.length > 0) {
                const prompt = prompts[0];
                if (!currentPrompt || currentPrompt.id !== prompt.id) {
                    currentPrompt = prompt;
                    userHasTapped = false;
                    if (!showingHistory) renderPromptOverlay();
                } else {
                    currentPrompt = prompt;
                    if (!showingHistory) renderPromptOverlay();
                }
            } else if (currentPrompt) {
                currentPrompt = null;
                if (!showingHistory) {
                    if (terminalLive) {
                        // Return to watching state — update chrome only
                        footerLeft.textContent = 'Watching session';
                        footerHint.textContent = 'history';
                        updateQuickbar();
                    } else {
                        renderNoSession();
                    }
                }
            }

            statusDot.style.background = 'var(--green)';
        }

        // ── WebSocket ─────────────────────────────────────────

        function connectWebSocket() {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${location.host}/ws`;

            try {
                ws = new WebSocket(wsUrl);
            } catch (e) {
                startPolling();
                return;
            }

            ws.onopen = () => {
                usingWebSocket = true;
                wsReconnectDelay = WS_RECONNECT_BASE;
                stopPolling();
                statusText.textContent = 'live';
                statusDot.style.background = 'var(--green)';
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'prompts') {
                        handlePromptsUpdate(data.prompts);
                    } else if (data.type === 'terminal') {
                        handleTerminalUpdate(data);
                    } else if (data.type === 'task_update') {
                        handleTaskUpdate(data.task);
                    } else if (data.type === 'task_progress') {
                        handleTaskProgressMessage(data);
                    } else if (data.type === 'goal_update') {
                        handleGoalUpdate(data);
                    } else if (data.type === 'goal_decomposed') {
                        handleGoalDecomposed(data);
                    } else if (data.type === 'approval_request') {
                        handleApprovalRequest(data);
                    } else if (data.type === 'digest_ready') {
                        if (dashOverlay.classList.contains('visible') && document.getElementById('dashDigests').classList.contains('active')) loadDigests();
                    }
                    // Refresh dashboard analytics on task/goal updates if visible
                    if ((data.type === 'task_update' || data.type === 'goal_update') && dashOverlay.classList.contains('visible') && document.getElementById('dashAnalytics').classList.contains('active')) {
                        loadAnalytics();
                    }
                } catch (e) {
                    console.error('WS parse error:', e);
                }
            };

            ws.onclose = () => {
                usingWebSocket = false;
                ws = null;
                statusText.textContent = 'polling';
                startPolling();

                wsReconnectTimer = setTimeout(() => {
                    wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_RECONNECT_MAX);
                    connectWebSocket();
                }, wsReconnectDelay);
            };

            ws.onerror = () => {};
        }

        // ── HTTP polling (fallback) ──────────────────────────

        async function poll() {
            if (usingWebSocket) return;

            try {
                const res = await fetch(`${API_BASE}/api/prompts`);
                const data = await res.json();
                if (data.success) handlePromptsUpdate(data.prompts);
            } catch {
                statusText.textContent = 'disconnected';
                statusDot.style.background = 'var(--red)';
            }
        }

        function startPolling() {
            if (pollTimer) return;
            poll();
            pollTimer = setInterval(poll, POLL_INTERVAL);
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        // ── Terminal rendering (append-only log) ──────────────
        //
        // The terminal is an ever-growing text file. The server sends a
        // fixed-size tmux snapshot every ~1s. We find what's new by
        // comparing consecutive snapshots, append new lines, and only
        // re-render the last 10 lines. Everything above that is frozen.

        let renderedLines = []; // DOM elements — append-only buffer
        let lastSnapshotLines = []; // previous server snapshot for overlap detection
        const MAX_BUFFER_LINES = 5000; // auto-trim when exceeded
        const TRIM_KEEP_LINES = 2000; // keep this many after auto-trim

        function appendLine(text) {
            const div = document.createElement('div');
            div.textContent = text;
            div._text = text;
            termContent.appendChild(div);
            renderedLines.push(div);
        }

        function updateTerminalAppend(content) {
            const newSnap = content.split('\n');

            // Strip trailing blank lines from tmux snapshot — they break overlap detection
            while (newSnap.length > 1 && newSnap[newSnap.length - 1] === '') {
                newSnap.pop();
            }

            if (renderedLines.length === 0) {
                // First render — show the whole snapshot, start at bottom
                for (const line of newSnap) appendLine(line);
                termContent.scrollTop = termContent.scrollHeight;
                lastSnapshotLines = newSnap;
                return;
            }

            // Find overlap: longest suffix of lastSnapshot that matches a prefix of newSnap
            // This tells us what scrolled and what's new
            const oldSnap = lastSnapshotLines;
            const maxOverlap = Math.min(oldSnap.length, newSnap.length);
            let overlap = 0;

            for (let tryLen = maxOverlap; tryLen >= 1; tryLen--) {
                let match = true;
                for (let j = 0; j < tryLen; j++) {
                    if (oldSnap[oldSnap.length - tryLen + j] !== newSnap[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) { overlap = tryLen; break; }
            }

            // Append lines that are new (after the overlap)
            for (let i = overlap; i < newSnap.length; i++) {
                appendLine(newSnap[i]);
            }

            // Re-render last 10 rendered lines from the new snapshot tail
            const TAIL = 10;
            const reCount = Math.min(TAIL, renderedLines.length, newSnap.length);
            for (let i = 0; i < reCount; i++) {
                const ri = renderedLines.length - reCount + i;
                const ni = newSnap.length - reCount + i;
                if (renderedLines[ri]._text !== newSnap[ni]) {
                    renderedLines[ri].textContent = newSnap[ni];
                    renderedLines[ri]._text = newSnap[ni];
                }
            }

            lastSnapshotLines = newSnap;

            // Auto-trim if buffer too large
            autoTrimBuffer();
        }

        function clearRenderedLines() {
            renderedLines = [];
            termContent.innerHTML = '';
        }

        function autoTrimBuffer() {
            if (renderedLines.length <= MAX_BUFFER_LINES) return;
            const removeCount = renderedLines.length - TRIM_KEEP_LINES;
            for (let i = 0; i < removeCount; i++) {
                termContent.removeChild(renderedLines[i]);
            }
            renderedLines.splice(0, removeCount);
        }

        function trimTerminalBuffer(keepLines = 500) {
            if (renderedLines.length <= keepLines) return;
            const removeCount = renderedLines.length - keepLines;
            for (let i = 0; i < removeCount; i++) {
                termContent.removeChild(renderedLines[i]);
            }
            renderedLines.splice(0, removeCount);
        }

        function handleTerminalUpdate(data) {
            const { mode, content, changes, session } = data;

            if (content === null && !mode) {
                // No active session
                terminalLive = false;
                terminalSession = null;
                if (!showingHistory && !currentPrompt) renderNoSession();
                return;
            }

            terminalLive = true;
            terminalSession = session;

            if (showingHistory) return;

            termContent.style.display = '';

            // Check scroll position BEFORE appending (DEC-014)
            const nearBottom = termContent.scrollHeight - termContent.scrollTop - termContent.clientHeight < 50;

            if (content && content !== lastWrittenContent) {
                lastWrittenContent = content;
                updateTerminalAppend(content);
            }

            // Auto-follow only if we were already at the bottom
            if (nearBottom) termContent.scrollTop = termContent.scrollHeight;

            // Update chrome
            titleText.textContent = session || 'claude-remote';
            if (!currentPrompt) {
                footerLeft.textContent = `Watching (${renderedLines.length} lines)`;
                footerHint.textContent = 'history';
                updateQuickbar();
            }
        }

        // ── Rendering ─────────────────────────────────────────

        function renderPromptOverlay() {
            const p = currentPrompt;

            // If terminal broadcast hasn't started yet, show prompt's terminal content
            if (!terminalLive) {
                const content = (p.terminal || p.terminal_content || '').trim();
                termContent.style.display = '';
                if (content && content !== lastWrittenContent) {
                    lastWrittenContent = content;
                    updateTerminalAppend(content);
                }
            }

            // Update chrome for prompt state
            const session = p.tmux_session || terminalSession || 'claude-remote';
            titleText.textContent = session;
            footerLeft.textContent = p.event === 'permission_prompt' ? 'Permission required' : 'Waiting for input';
            footerHint.textContent = 'type below \u00b7 Enter to send';
            updateQuickbar();
        }

        function renderNoSession() {
            termContent.style.display = '';
            lastWrittenContent = '';

            clearRenderedLines();
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.innerHTML = '<div class="empty-icon">\u25c7</div>'
                + '<div class="empty-title">No active session</div>'
                + '<div class="empty-hint">Start a claude-remote session to begin</div>';
            termContent.appendChild(empty);

            titleText.textContent = 'claude-remote';
            footerLeft.textContent = 'No active session';
            footerHint.textContent = 'history';
            updateQuickbar();
        }

        // ── Input ─────────────────────────────────────────────

        async function sendKey(key) {
            if (!currentPrompt || isSending) return;
            isSending = true;
            quickbar.classList.add('sending');

            try {
                const res = await fetch(`${API_BASE}/api/respond`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: currentPrompt.id,
                        response: key,
                        noEnter: true
                    })
                });

                const data = await res.json();
                if (data.success) {
                    showToast('Sent: ' + (key || 'Enter'));
                    currentPrompt = null;
                    if (!showingHistory) {
                        if (terminalLive) {
                            footerLeft.textContent = 'Watching session';
                            footerHint.textContent = 'history';
                            updateQuickbar();
                        } else {
                            renderNoSession();
                        }
                    }
                    if (!usingWebSocket) setTimeout(poll, 1000);
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch (err) {
                showToast('Connection error', true);
            } finally {
                isSending = false;
                quickbar.classList.remove('sending');
            }
        }

        async function sendKeyDirect(key) {
            if (!terminalLive || isSending) return;
            isSending = true;

            try {
                const res = await fetch(`${API_BASE}/api/keys`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                const data = await res.json();
                if (!data.success) {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Connection error', true);
            } finally {
                isSending = false;
            }
        }

        // Focus management — tap terminal to focus input bar
        terminal.addEventListener('click', () => {
            userHasTapped = true;
            mobileInput.focus();
        });

        // Line-buffered input — type locally, send full line on Enter
        const inputSend = document.getElementById('inputSend');

        // Auto-resize textarea as content grows/shrinks
        function autoResizeInput() {
            mobileInput.style.height = 'auto';
            mobileInput.style.height = Math.min(mobileInput.scrollHeight, 120) + 'px';
        }
        mobileInput.addEventListener('input', autoResizeInput);

        async function submitInputLine() {
            const text = mobileInput.value;
            mobileInput.value = '';
            mobileInput.style.height = 'auto'; // reset height
            mobileInput.focus(); // keep keyboard open

            try {
                if (currentPrompt) {
                    // Prompt mode: send full response via /api/respond
                    const res = await fetch(`${API_BASE}/api/respond`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: currentPrompt.id,
                            response: text || '',
                            noEnter: false
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        showToast('Sent: ' + (text || 'Enter'));
                        currentPrompt = null;
                        if (terminalLive) {
                            footerLeft.textContent = 'Watching session';
                            footerHint.textContent = 'history';
                            updateQuickbar();
                        } else {
                            renderNoSession();
                        }
                        if (!usingWebSocket) setTimeout(poll, 1000);
                    } else {
                        showToast(data.error || 'Failed', true);
                    }
                } else if (terminalLive) {
                    // Terminal mode: send text + Enter via /api/keys
                    if (text) {
                        await fetch(`${API_BASE}/api/keys`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key: text, enter: true })
                        });
                    } else {
                        await sendKeyDirect('Enter');
                    }
                }

                // Force terminal refresh after short delay (let tmux process)
                setTimeout(async () => {
                    try {
                        const res = await fetch(`${API_BASE}/api/terminal`);
                        const data = await res.json();
                        if (data.success && data.content) {
                            handleTerminalUpdate(data.content, terminalSession || 'claude-remote');
                        }
                    } catch { /* next WS broadcast will catch up */ }
                }, 300);
            } catch {
                showToast('Connection error', true);
            }
        }

        mobileInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitInputLine();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                mobileInput.value = '';
                if (currentPrompt) {
                    sendKey('Escape');
                } else if (terminalLive) {
                    sendKeyDirect('Escape');
                }
            }
            // All other keys: browser handles natively
        });

        inputSend.addEventListener('click', () => submitInputLine());

        // ── Quick-action bar ──────────────────────────────────

        quickbar.addEventListener('click', (e) => {
            const btn = e.target.closest('.qbtn');
            if (!btn) return;

            // Handle scroll buttons (scroll the plain text div)
            const scroll = btn.dataset.scroll;
            if (scroll) {
                const pages = parseInt(scroll);
                termContent.scrollTop += pages * termContent.clientHeight;
                return;
            }

            // Handle End button — jump to bottom
            if (btn.id === 'scrollEndBtn') {
                termContent.scrollTop = termContent.scrollHeight;
                return;
            }

            if (isSending) return;
            const key = btn.dataset.key;
            if (!key) return;

            if (currentPrompt) {
                sendKey(key);
            } else if (terminalLive) {
                sendKeyDirect(key);
            }
        });

        function updateQuickbar() {
            const inputBar = document.getElementById('inputBar');
            if ((currentPrompt || terminalLive) && !showingHistory) {
                quickbar.classList.add('visible');
                inputBar.classList.add('visible');
            } else {
                quickbar.classList.remove('visible');
                inputBar.classList.remove('visible');
            }
        }

        // ── Toast ─────────────────────────────────────────────

        function showToast(msg, isError = false) {
            const t = document.createElement('div');
            t.className = 'toast' + (isError ? ' error' : '');
            t.textContent = msg;
            toastWrap.appendChild(t);
            setTimeout(() => t.remove(), 2000);
        }

        // ── History ───────────────────────────────────────────

        function timeAgo(isoStr) {
            const diff = Date.now() - new Date(isoStr).getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            return Math.floor(hrs / 24) + 'd ago';
        }

        let savedTerminalNodes = null; // stash terminal DOM while showing history

        async function showHistory() {
            showingHistory = true;
            updateQuickbar();
            termContent.style.display = '';
            footerHint.textContent = 'back to live';

            // Stash accumulated terminal nodes (don't destroy them)
            savedTerminalNodes = Array.from(termContent.childNodes);
            termContent.innerHTML = '';

            try {
                const res = await fetch(`${API_BASE}/api/history?limit=20`);
                const data = await res.json();

                titleText.textContent = 'history';
                footerLeft.textContent = data.count + ' resolved';

                if (!data.success || data.history.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'history-empty';
                    empty.textContent = 'No history yet';
                    termContent.appendChild(empty);
                    return;
                }

                const list = document.createElement('div');
                list.className = 'history-list';

                for (const item of data.history) {
                    const el = document.createElement('div');
                    el.className = 'history-item';

                    const header = document.createElement('div');
                    header.className = 'history-header';

                    const event = document.createElement('span');
                    event.className = 'history-event ' + (item.event === 'permission_prompt' ? 'permission' : 'idle');
                    event.textContent = item.event === 'permission_prompt' ? 'permission' : 'idle';

                    const time = document.createElement('span');
                    time.className = 'history-time';
                    time.textContent = item.resolved_at ? timeAgo(item.resolved_at) : '';

                    header.appendChild(event);
                    header.appendChild(time);

                    const msg = document.createElement('div');
                    msg.className = 'history-message';
                    msg.textContent = (item.message || '').substring(0, 100);

                    el.appendChild(header);
                    el.appendChild(msg);

                    if (item.dismissed) {
                        const badge = document.createElement('span');
                        badge.className = 'history-response dismissed';
                        badge.textContent = 'dismissed';
                        el.appendChild(badge);
                    } else if (item.response) {
                        const badge = document.createElement('span');
                        badge.className = 'history-response';
                        badge.textContent = item.response;
                        el.appendChild(badge);
                    }

                    list.appendChild(el);
                }

                termContent.appendChild(list);
                termContent.scrollTop = 0;
            } catch {
                clearRenderedLines();
                const err = document.createElement('div');
                err.className = 'history-empty';
                err.textContent = 'Failed to load history';
                termContent.appendChild(err);
            }
        }

        function hideHistory() {
            showingHistory = false;

            // Restore stashed terminal nodes
            if (savedTerminalNodes) {
                termContent.innerHTML = '';
                for (const node of savedTerminalNodes) {
                    termContent.appendChild(node);
                }
                savedTerminalNodes = null;
            }

            if (currentPrompt) {
                renderPromptOverlay();
            } else if (terminalLive) {
                // Restore watching state — buffer is already accumulated
                termContent.style.display = '';
                // Scroll to bottom to show latest
                termContent.scrollTop = termContent.scrollHeight;
                titleText.textContent = terminalSession || 'claude-remote';
                footerLeft.textContent = `Watching (${renderedLines.length} lines)`;
                footerHint.textContent = 'history';
                updateQuickbar();
            } else {
                renderNoSession();
            }
        }

        // Footer hint toggles history
        footerHint.addEventListener('click', (e) => {
            e.stopPropagation();
            if (showingHistory) {
                hideHistory();
            } else {
                showHistory();
            }
        });

        // ── Search ───────────────────────────────────────────────

        function toggleSearch() {
            const isVisible = searchbar.classList.contains('visible');
            if (isVisible) {
                closeSearch();
            } else {
                searchbar.classList.add('visible');
                searchToggle.classList.add('active');
                searchInput.focus();
            }
        }

        function closeSearch() {
            searchbar.classList.remove('visible');
            searchToggle.classList.remove('active');
            searchInput.value = '';
            searchCount.textContent = '';
            searchMatches = [];
            searchMatchIdx = -1;
        }

        let searchMatches = [];
        let searchMatchIdx = -1;

        function doSearch(direction = 'next') {
            const query = searchInput.value.toLowerCase();
            if (!query || !lastWrittenContent) {
                searchCount.textContent = '';
                searchMatches = [];
                searchMatchIdx = -1;
                return;
            }

            const text = lastWrittenContent.toLowerCase();

            // Find all match positions
            searchMatches = [];
            let pos = 0;
            while ((pos = text.indexOf(query, pos)) !== -1) {
                searchMatches.push(pos);
                pos += query.length;
            }

            if (searchMatches.length === 0) {
                searchCount.textContent = 'No match';
                searchCount.style.color = 'var(--text-muted)';
                searchMatchIdx = -1;
                return;
            }

            // Navigate
            if (direction === 'next') {
                searchMatchIdx = (searchMatchIdx + 1) % searchMatches.length;
            } else {
                searchMatchIdx = searchMatchIdx <= 0 ? searchMatches.length - 1 : searchMatchIdx - 1;
            }

            searchCount.textContent = `${searchMatchIdx + 1}/${searchMatches.length}`;
            searchCount.style.color = 'var(--green)';

            // Scroll to match — find the line number and scroll to it
            const beforeMatch = lastWrittenContent.substring(0, searchMatches[searchMatchIdx]);
            const lineNum = beforeMatch.split('\n').length - 1;
            const lineHeight = parseFloat(getComputedStyle(termContent).lineHeight) || 20;
            termContent.scrollTop = lineNum * lineHeight - termContent.clientHeight / 2;
        }

        searchToggle.addEventListener('click', toggleSearch);
        searchClose.addEventListener('click', closeSearch);

        searchInput.addEventListener('input', () => doSearch('next'));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSearch(e.shiftKey ? 'prev' : 'next');
            } else if (e.key === 'Escape') {
                closeSearch();
            }
        });

        searchPrev.addEventListener('click', () => doSearch('prev'));
        searchNext.addEventListener('click', () => doSearch('next'));

        // ── Copy ─────────────────────────────────────────────────

        function copyTerminalContent() {
            const text = lastWrittenContent || '';
            if (!text) {
                showToast('Nothing to copy', true);
                return;
            }

            // Try Share API (works on iOS Safari over HTTP)
            if (navigator.share) {
                navigator.share({ text }).catch(() => {});
                return;
            }

            // Fallback: show selectable overlay
            showCopyOverlay(text);
        }

        function showCopyOverlay(text) {
            const overlay = document.createElement('div');
            const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-overlay').trim();
            overlay.style.cssText = `position:fixed;inset:0;z-index:200;background:${bgColor};display:flex;flex-direction:column;padding:16px;`;

            const header = document.createElement('div');
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';

            const label = document.createElement('span');
            label.style.cssText = 'color:var(--text-dim);font-size:13px;';
            label.textContent = 'Long-press to select & copy';
            header.appendChild(label);

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕ Close';
            closeBtn.style.cssText = 'background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);padding:6px 12px;font-size:13px;font-family:inherit;cursor:pointer;';
            closeBtn.onclick = () => overlay.remove();
            header.appendChild(closeBtn);

            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.readOnly = true;
            textarea.style.cssText = 'flex:1;background:var(--bg-term);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px;line-height:1.5;resize:none;-webkit-user-select:text;user-select:text;';

            overlay.appendChild(header);
            overlay.appendChild(textarea);
            document.body.appendChild(overlay);

            // Auto-select all text
            textarea.focus();
            textarea.setSelectionRange(0, text.length);
        }

        copyBtn.addEventListener('click', copyTerminalContent);

        // ── Trim button ─────────────────────────────────────
        document.getElementById('trimBtn').addEventListener('click', () => {
            const before = renderedLines.length;
            trimTerminalBuffer(500);
            const after = renderedLines.length;
            showToast(`Trimmed ${before - after} lines (kept last ${after})`);
        });

        // ── Theme toggle ─────────────────────────────────────
        themeToggle.addEventListener('click', toggleTheme);

        // ── Bridge ────────────────────────────────────────────

        const bridgeBtn = document.getElementById('bridgeBtn');
        const bridgeOverlay = document.getElementById('bridgeOverlay');
        const bridgeClose = document.getElementById('bridgeClose');
        const exportSendBtn = document.getElementById('exportSendBtn');
        const exportSaveBtn = document.getElementById('exportSaveBtn');
        const exportShareBtn = document.getElementById('exportShareBtn');
        const exportResult = document.getElementById('exportResult');
        const exportResultLabel = document.getElementById('exportResultLabel');
        const importContent = document.getElementById('importContent');
        const importLabel = document.getElementById('importLabel');
        const importSaveBtn = document.getElementById('importSaveBtn');
        const importInjectBtn = document.getElementById('importInjectBtn');
        const handoffTask = document.getElementById('handoffTask');
        const handoffContext = document.getElementById('handoffContext');
        const handoffDir = document.getElementById('handoffDir');
        const handoffBtn = document.getElementById('handoffBtn');
        const bridgeHistoryList = document.getElementById('bridgeHistoryList');

        let lastExportContent = '';

        function openBridge() {
            bridgeOverlay.classList.add('visible');
            bridgeBtn.classList.add('active');
        }

        function closeBridge() {
            bridgeOverlay.classList.remove('visible');
            bridgeBtn.classList.remove('active');
        }

        function switchBridgeTab(tab) {
            bridgeOverlay.querySelectorAll('.bridge-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tab);
            });
            bridgeOverlay.querySelectorAll('.bridge-section').forEach(s => {
                s.classList.remove('active');
            });
            document.getElementById('bridge' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');

            if (tab === 'history') loadBridgeHistory();
        }

        bridgeBtn.addEventListener('click', () => {
            if (bridgeOverlay.classList.contains('visible')) {
                closeBridge();
            } else {
                openBridge();
            }
        });

        bridgeClose.addEventListener('click', closeBridge);

        bridgeOverlay.querySelector('.bridge-tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.bridge-tab');
            if (tab) switchBridgeTab(tab.dataset.tab);
        });

        // Export
        async function doExport(inject) {
            const btn = inject ? exportSendBtn : exportSaveBtn;
            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = inject ? 'Exporting & sending...' : 'Exporting...';

            try {
                const url = `${API_BASE}/api/bridge/export` + (inject ? '?inject=true' : '');
                const res = await fetch(url);
                const data = await res.json();
                if (data.success) {
                    lastExportContent = data.content;
                    exportResult.style.display = '';
                    exportResultLabel.textContent = `Saved: ${data.filename} (${data.lineCount} lines)` + (data.injected ? ' — sent to Claude Code' : '');
                    exportShareBtn.style.display = '';
                    showToast(inject ? `Exported & sent (${data.lineCount} lines)` : `Exported (${data.lineCount} lines)`);
                } else {
                    showToast(data.error || 'Export failed', true);
                }
            } catch {
                showToast('Connection error', true);
            } finally {
                btn.disabled = false;
                btn.textContent = origText;
            }
        }

        exportSendBtn.addEventListener('click', () => doExport(true));
        exportSaveBtn.addEventListener('click', () => doExport(false));

        exportShareBtn.addEventListener('click', () => {
            if (!lastExportContent) return;
            if (navigator.share) {
                navigator.share({ text: lastExportContent }).catch(() => {});
            } else {
                showCopyOverlay(lastExportContent);
            }
        });

        // Import
        async function doImport(inject) {
            const content = importContent.value.trim();
            if (!content) {
                showToast('Paste some content first', true);
                return;
            }

            const btn = inject ? importInjectBtn : importSaveBtn;
            btn.disabled = true;
            btn.textContent = inject ? 'Sending...' : 'Saving...';

            try {
                const res = await fetch(`${API_BASE}/api/bridge/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content,
                        label: importLabel.value.trim() || undefined,
                        inject
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(inject ? 'Sent to Claude Code' : 'Context saved');
                    importContent.value = '';
                    importLabel.value = '';
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Connection error', true);
            } finally {
                btn.disabled = false;
                btn.textContent = inject ? 'Save & Send to Claude Code' : 'Save Context';
            }
        }

        importSaveBtn.addEventListener('click', () => doImport(false));
        importInjectBtn.addEventListener('click', () => doImport(true));

        // Handoff
        handoffBtn.addEventListener('click', async () => {
            const task = handoffTask.value.trim();
            if (!task) {
                showToast('Describe the task first', true);
                return;
            }

            handoffBtn.disabled = true;
            handoffBtn.textContent = 'Handing off...';

            try {
                const res = await fetch(`${API_BASE}/api/bridge/handoff`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task,
                        context: handoffContext.value.trim() || undefined,
                        workingDir: handoffDir.value.trim() || undefined
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.injected ? 'Handed off to Claude Code' : 'Saved (no active session)');
                    handoffTask.value = '';
                    handoffContext.value = '';
                    handoffDir.value = '';
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Connection error', true);
            } finally {
                handoffBtn.disabled = false;
                handoffBtn.textContent = 'Hand Off to Claude Code';
            }
        });

        // Bridge history
        async function loadBridgeHistory() {
            bridgeHistoryList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</div>';
            try {
                const res = await fetch(`${API_BASE}/api/bridge/history?limit=30`);
                const data = await res.json();

                if (!data.success || data.history.length === 0) {
                    bridgeHistoryList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;">No bridge activity yet</div>';
                    return;
                }

                bridgeHistoryList.innerHTML = '';
                for (const item of data.history) {
                    const el = document.createElement('div');
                    el.className = 'bridge-history-item';

                    const badge = document.createElement('span');
                    badge.className = 'bridge-history-type ' + (item.type || 'export');
                    badge.textContent = item.type || 'event';

                    const label = document.createElement('div');
                    label.className = 'bridge-history-label';
                    label.textContent = item.label || '';

                    const time = document.createElement('div');
                    time.className = 'bridge-history-time';
                    time.textContent = item.timestamp ? timeAgo(item.timestamp) : '';

                    el.appendChild(badge);
                    el.appendChild(label);
                    el.appendChild(time);
                    bridgeHistoryList.appendChild(el);
                }
            } catch {
                bridgeHistoryList.innerHTML = '<div style="text-align:center;color:var(--red);padding:20px;">Failed to load</div>';
            }
        }

        // ── Tasks ─────────────────────────────────────────────

        const tasksBtn = document.getElementById('tasksBtn');
        const taskOverlay = document.getElementById('taskOverlay');
        const taskClose = document.getElementById('taskClose');
        const taskListContent = document.getElementById('taskListContent');
        const taskDetailTab = document.getElementById('taskDetailTab');
        const taskDetailSummary = document.getElementById('taskDetailSummary');
        const taskProgressLog = document.getElementById('taskProgressLog');
        const taskDetailActions = document.getElementById('taskDetailActions');

        let allTasks = [];
        let viewingTaskId = null;
        let taskProgressEntries = []; // accumulated progress for the viewed task

        function openTasks() {
            taskOverlay.classList.add('visible');
            tasksBtn.classList.add('active');
            loadTasks();
        }

        function closeTasks() {
            taskOverlay.classList.remove('visible');
            tasksBtn.classList.remove('active');
        }

        function switchTaskTab(tab) {
            taskOverlay.querySelectorAll('[data-task-tab]').forEach(t => {
                t.classList.toggle('active', t.dataset.taskTab === tab);
            });
            taskOverlay.querySelectorAll('.bridge-section').forEach(s => s.classList.remove('active'));
            if (tab === 'list') document.getElementById('taskList').classList.add('active');
            else if (tab === 'goals') document.getElementById('taskGoals').classList.add('active');
            else if (tab === 'portfolio') document.getElementById('taskPortfolio').classList.add('active');
            else if (tab === 'create') document.getElementById('taskCreate').classList.add('active');
            else if (tab === 'detail') document.getElementById('taskDetail').classList.add('active');
            else if (tab === 'goalDetail') document.getElementById('goalDetail').classList.add('active');

            if (tab === 'list') loadTasks();
            else if (tab === 'goals') loadGoals();
            else if (tab === 'portfolio') loadPortfolio();
        }

        tasksBtn.addEventListener('click', () => {
            if (taskOverlay.classList.contains('visible')) closeTasks();
            else openTasks();
        });

        taskClose.addEventListener('click', closeTasks);

        taskOverlay.querySelector('.bridge-tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('[data-task-tab]');
            if (tab && tab.style.display !== 'none') switchTaskTab(tab.dataset.taskTab);
        });

        // Load task list
        async function loadTasks() {
            taskListContent.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</div>';
            try {
                const res = await fetch(`${API_BASE}/api/tasks`);
                const data = await res.json();
                if (!data.success) throw new Error(data.error);
                allTasks = data.tasks;
                renderTaskList();
            } catch (err) {
                taskListContent.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;">${err.message}</div>`;
            }
        }

        function renderTaskList() {
            if (allTasks.length === 0) {
                taskListContent.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;">No tasks yet<br><span style="font-size:11px;">Tap Create to add one</span></div>';
                return;
            }

            taskListContent.innerHTML = '';
            for (const task of allTasks) {
                const el = document.createElement('div');
                el.className = 'task-item';

                const header = document.createElement('div');
                header.className = 'task-item-header';

                const title = document.createElement('span');
                title.className = 'task-item-title';
                title.textContent = task.title;

                const badge = document.createElement('span');
                badge.className = 'task-status-badge ' + task.status;
                badge.textContent = task.status;

                header.appendChild(title);
                header.appendChild(badge);

                const desc = document.createElement('div');
                desc.className = 'task-item-desc';
                desc.textContent = task.description.substring(0, 100);

                const meta = document.createElement('div');
                meta.className = 'task-item-meta';
                meta.innerHTML = `<span>${task.model}</span>`;
                if (task.cost_usd > 0) meta.innerHTML += `<span>$${task.cost_usd.toFixed(4)}</span>`;
                if (task.turns > 0) meta.innerHTML += `<span>${task.turns} turns</span>`;
                if (task.created_at) meta.innerHTML += `<span>${timeAgo(task.created_at)}</span>`;

                el.appendChild(header);
                el.appendChild(desc);
                el.appendChild(meta);

                el.addEventListener('click', () => viewTask(task.id));
                taskListContent.appendChild(el);
            }
        }

        // View task detail
        async function viewTask(taskId) {
            viewingTaskId = taskId;
            taskProgressEntries = [];
            taskDetailTab.style.display = '';
            switchTaskTab('detail');

            const task = allTasks.find(t => t.id === taskId);
            if (!task) return;

            renderTaskDetail(task);
        }

        function renderTaskDetail(task) {
            // Summary
            let summaryHtml = '<div class="task-summary">';
            summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Status</span><span class="task-status-badge ${task.status}">${task.status}</span></div>`;
            summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Title</span><span class="task-summary-value">${escHtml(task.title)}</span></div>`;
            summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Model</span><span class="task-summary-value">${task.model}</span></div>`;
            if (task.cost_usd > 0) summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Cost</span><span class="task-summary-value">$${task.cost_usd.toFixed(4)}</span></div>`;
            if (task.turns > 0) summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Turns</span><span class="task-summary-value">${task.turns}</span></div>`;
            if (task.tokens_in > 0) summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Tokens</span><span class="task-summary-value">${(task.tokens_in + task.tokens_out).toLocaleString()}</span></div>`;
            if (task.started_at) summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Started</span><span class="task-summary-value">${timeAgo(task.started_at)}</span></div>`;
            if (task.completed_at) summaryHtml += `<div class="task-summary-row"><span class="task-summary-label">Completed</span><span class="task-summary-value">${timeAgo(task.completed_at)}</span></div>`;
            summaryHtml += '</div>';

            if (task.result) {
                summaryHtml += '<div class="bridge-label">Result</div>';
                summaryHtml += `<div class="bridge-preview">${escHtml(task.result)}</div>`;
            }
            if (task.error) {
                summaryHtml += '<div class="bridge-label" style="color:var(--red)">Error</div>';
                summaryHtml += `<div class="bridge-preview" style="border-color:rgba(248,81,73,0.3)">${escHtml(task.error)}</div>`;
            }

            taskDetailSummary.innerHTML = summaryHtml;

            // Actions
            let actionsHtml = '';
            if (task.log_file) {
                actionsHtml += `<button class="bridge-btn" onclick="viewTaskLog('${task.id}')">View Log</button>`;
            }
            if (task.status === 'failed') {
                actionsHtml += `<button class="bridge-btn" style="border-color:var(--green);color:var(--green);background:rgba(63,185,80,0.1);" onclick="retryTask('${task.id}', true)">Smart Retry</button>`;
                actionsHtml += `<button class="bridge-btn bridge-btn-secondary" onclick="retryTask('${task.id}', false)">Simple Retry</button>`;
            }
            if (task.status === 'pending' || task.status === 'running') {
                actionsHtml += `<button class="bridge-btn" style="border-color:var(--red);color:var(--red);background:rgba(248,81,73,0.1);" onclick="cancelTask('${task.id}')">Cancel Task</button>`;
            }
            if (task.status !== 'running') {
                actionsHtml += `<button class="bridge-btn bridge-btn-secondary" onclick="deleteTask('${task.id}')">Delete Task</button>`;
            }
            taskDetailActions.innerHTML = actionsHtml;
        }

        function escHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        // Handle real-time task updates from WebSocket
        function handleTaskUpdate(task) {
            // Update in allTasks
            const idx = allTasks.findIndex(t => t.id === task.id);
            if (idx >= 0) {
                if (task.status === 'deleted') {
                    allTasks.splice(idx, 1);
                } else {
                    allTasks[idx] = task;
                }
            } else if (task.status !== 'deleted') {
                allTasks.unshift(task);
            }

            // Re-render list if visible
            if (taskOverlay.classList.contains('visible')) {
                const listActive = document.getElementById('taskList').classList.contains('active');
                if (listActive) renderTaskList();
            }

            // Update detail view if viewing this task
            if (viewingTaskId === task.id) {
                renderTaskDetail(task);
            }
        }

        function handleTaskProgressMessage(data) {
            if (data.taskId !== viewingTaskId) return;

            const entry = document.createElement('div');
            entry.className = 'task-progress-entry';

            const role = document.createElement('div');
            role.className = 'role';

            const content = document.createElement('div');
            content.className = 'content';

            if (data.messageType === 'assistant' || data.role === 'assistant') {
                role.className += ' assistant';
                role.textContent = 'assistant';
                content.textContent = data.text || '';
            } else if (data.messageType === 'tool_use_summary') {
                role.className += ' tool';
                role.textContent = data.tool || 'tool';
                content.textContent = data.input || '';
            } else if (data.messageType === 'result') {
                role.className += ' system';
                role.textContent = data.subtype === 'success' ? 'completed' : 'error';
                content.textContent = data.result || '';
                if (data.cost_usd) content.textContent += `\nCost: $${data.cost_usd.toFixed(4)} | Turns: ${data.num_turns || 0}`;
            } else if (data.messageType === 'system') {
                role.className += ' system';
                role.textContent = 'system';
                content.textContent = data.subtype || '';
            } else {
                return; // Skip unknown types
            }

            entry.appendChild(role);
            entry.appendChild(content);
            taskProgressLog.appendChild(entry);

            // Auto-scroll to bottom
            taskProgressLog.scrollTop = taskProgressLog.scrollHeight;
        }

        // Create task
        document.getElementById('taskCreateBtn').addEventListener('click', async () => {
            const title = document.getElementById('taskTitle').value.trim();
            const description = document.getElementById('taskDesc').value.trim();
            const project_path = document.getElementById('taskPath').value.trim();
            const model = document.getElementById('taskModel').value;
            const max_turns = parseInt(document.getElementById('taskMaxTurns').value) || 100;
            const gate_mode = document.getElementById('taskGateMode').value;
            const allowed_tools_str = document.getElementById('taskAllowedTools').value.trim();
            const deadline = document.getElementById('taskDeadline').value || null;
            const priority = parseInt(document.getElementById('taskPriority').value) || 0;

            if (!title || !description || !project_path) {
                showToast('Fill in title, description, and project path', true);
                return;
            }

            // Parse allowed_tools if provided
            let allowed_tools = null;
            if (allowed_tools_str) {
                allowed_tools = allowed_tools_str.split(',').map(t => t.trim()).filter(Boolean);
            }

            const btn = document.getElementById('taskCreateBtn');
            btn.disabled = true;
            btn.textContent = 'Creating...';

            try {
                const res = await fetch(`${API_BASE}/api/tasks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, deadline })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('Task created');
                    document.getElementById('taskTitle').value = '';
                    document.getElementById('taskDesc').value = '';
                    document.getElementById('taskAllowedTools').value = '';
                    switchTaskTab('list');
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Connection error', true);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Create Task';
            }
        });

        // Cancel task
        async function cancelTask(id) {
            try {
                const res = await fetch(`${API_BASE}/api/tasks/${id}/cancel`, { method: 'POST' });
                const data = await res.json();
                if (data.success) showToast('Task cancelled');
                else showToast(data.error || 'Failed', true);
            } catch {
                showToast('Connection error', true);
            }
        }

        // Retry failed task
        async function retryTask(id, smart) {
            try {
                const res = await fetch(`${API_BASE}/api/tasks/${id}/retry`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ smart })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(smart ? 'Smart retry: diagnosing failure...' : 'Task reset to pending');
                } else {
                    showToast(data.error || 'Retry failed', true);
                }
            } catch {
                showToast('Connection error', true);
            }
        }

        // Delete task
        async function deleteTask(id) {
            try {
                const res = await fetch(`${API_BASE}/api/tasks/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast('Task deleted');
                    viewingTaskId = null;
                    taskDetailTab.style.display = 'none';
                    switchTaskTab('list');
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Connection error', true);
            }
        }

        async function viewTaskLog(id) {
            try {
                const res = await fetch(`${API_BASE}/api/tasks/${id}/log`);
                const data = await res.json();
                if (data.success) {
                    taskProgressLog.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;color:var(--text);">${escHtml(data.log)}</pre>`;
                    showToast('Log loaded');
                } else {
                    showToast(data.error || 'No log available', true);
                }
            } catch {
                showToast('Connection error', true);
            }
        }

        // ── Goals ──────────────────────────────────────────────

        const goalListContent = document.getElementById('goalListContent');
        const goalDescription = document.getElementById('goalDescription');
        const goalProjectPath = document.getElementById('goalProjectPath');
        const goalAutoExecute = document.getElementById('goalAutoExecute');
        const goalCreateBtn = document.getElementById('goalCreateBtn');
        const goalDetailSummary = document.getElementById('goalDetailSummary');
        const goalDetailTasks = document.getElementById('goalDetailTasks');
        const goalDetailActions = document.getElementById('goalDetailActions');

        let allGoals = [];
        let archivedByProject = {};
        let viewingGoalId = null;
        let showingArchived = false;

        async function loadGoals() {
            goalListContent.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</div>';
            try {
                // Fetch active goals
                const res = await fetch(`${API_BASE}/api/goals?view=active`);
                const data = await res.json();
                if (!data.success) throw new Error(data.error);
                allGoals = data.goals || [];
                showingArchived = false;
                renderGoalList();
            } catch (err) {
                goalListContent.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;">${err.message}</div>`;
            }
        }

        async function loadArchivedGoals() {
            goalListContent.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading archived...</div>';
            try {
                const res = await fetch(`${API_BASE}/api/goals?view=archived`);
                const data = await res.json();
                if (!data.success) throw new Error(data.error);
                archivedByProject = data.projects || {};
                showingArchived = true;
                renderArchivedGoals();
            } catch (err) {
                goalListContent.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;">${err.message}</div>`;
            }
        }

        function renderGoalCard(goal) {
            const el = document.createElement('div');
            el.className = 'task-item';
            el.style.cursor = 'pointer';

            const header = document.createElement('div');
            header.className = 'task-item-header';

            const title = document.createElement('span');
            title.className = 'task-item-title';
            title.textContent = goal.description.length > 60
                ? goal.description.substring(0, 60) + '...'
                : goal.description;

            const badge = document.createElement('span');
            badge.className = 'task-status-badge ' + goal.status;
            badge.textContent = goal.status;

            header.appendChild(title);
            header.appendChild(badge);

            const meta = document.createElement('div');
            meta.className = 'task-item-meta';
            meta.style.fontSize = '11px';
            meta.style.color = 'var(--text-dim)';

            const progress = `${goal.tasks_completed || 0}/${goal.task_count || 0} tasks`;
            const cost = goal.total_cost_usd > 0 ? ` • $${goal.total_cost_usd.toFixed(4)}` : '';
            meta.textContent = progress + cost;

            el.appendChild(header);
            el.appendChild(meta);

            if (goal.task_count > 0) {
                const progressBar = document.createElement('div');
                progressBar.style.cssText = 'width:100%;height:3px;background:var(--border);margin-top:8px;border-radius:2px;overflow:hidden';
                const progressFill = document.createElement('div');
                const pct = (goal.tasks_completed / goal.task_count) * 100;
                progressFill.style.cssText = `width:${pct}%;height:100%;transition:width 0.3s;background:${
                    goal.status === 'done' ? 'var(--green)' : goal.status === 'failed' ? 'var(--red)' : 'var(--cyan)'}`;
                progressBar.appendChild(progressFill);
                el.appendChild(progressBar);
            }

            el.addEventListener('click', () => viewGoal(goal.id));
            return el;
        }

        function renderGoalList() {
            goalListContent.innerHTML = '';

            if (allGoals.length === 0) {
                goalListContent.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;">No active goals<br><span style="font-size:11px;">Create a goal below to get started</span></div>';
            } else {
                for (const goal of allGoals) {
                    goalListContent.appendChild(renderGoalCard(goal));
                }
            }

            // Archive toggle button
            const toggleRow = document.createElement('div');
            toggleRow.style.cssText = 'text-align:center;padding:12px 0;border-top:1px solid var(--border);margin-top:12px';
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'bridge-btn bridge-btn-secondary';
            toggleBtn.style.cssText = 'font-size:11px;padding:6px 16px';
            toggleBtn.textContent = 'View Archived Goals';
            toggleBtn.addEventListener('click', loadArchivedGoals);
            toggleRow.appendChild(toggleBtn);
            goalListContent.appendChild(toggleRow);
        }

        function renderArchivedGoals() {
            goalListContent.innerHTML = '';

            // Back to active button
            const backRow = document.createElement('div');
            backRow.style.cssText = 'padding:8px 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px';
            const backBtn = document.createElement('button');
            backBtn.className = 'bridge-btn bridge-btn-secondary';
            backBtn.style.cssText = 'font-size:11px;padding:6px 16px';
            backBtn.textContent = '← Active Goals';
            backBtn.addEventListener('click', loadGoals);
            backRow.appendChild(backBtn);
            goalListContent.appendChild(backRow);

            const projects = Object.keys(archivedByProject).sort();
            if (projects.length === 0) {
                goalListContent.innerHTML += '<div style="text-align:center;color:var(--text-muted);padding:40px;">No archived goals</div>';
                return;
            }

            for (const projectPath of projects) {
                const goals = archivedByProject[projectPath];
                const projectName = projectPath.split('/').pop() || projectPath;

                // Project group header
                const groupHeader = document.createElement('div');
                groupHeader.style.cssText = 'padding:10px 12px;margin-bottom:4px;font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:var(--overlay-subtle);border-radius:4px';

                const doneCount = goals.filter(g => g.status === 'done').length;
                const failedCount = goals.filter(g => g.status === 'failed').length;
                const totalCost = goals.reduce((s, g) => s + (g.total_cost_usd || 0), 0);

                groupHeader.innerHTML = `
                    <span>${projectName} <span style="font-weight:400;font-size:10px;color:var(--text-dim)">${goals.length} goals</span></span>
                    <span style="font-size:10px;font-weight:400;">
                        ${doneCount ? `<span style="color:var(--green)">${doneCount} done</span>` : ''}
                        ${failedCount ? ` <span style="color:var(--red)">${failedCount} failed</span>` : ''}
                        ${totalCost > 0 ? ` • $${totalCost.toFixed(2)}` : ''}
                    </span>`;

                const groupContent = document.createElement('div');
                groupContent.style.cssText = 'display:none;margin-bottom:12px';
                for (const goal of goals) {
                    groupContent.appendChild(renderGoalCard(goal));
                }

                groupHeader.addEventListener('click', () => {
                    groupContent.style.display = groupContent.style.display === 'none' ? 'block' : 'none';
                });

                goalListContent.appendChild(groupHeader);
                goalListContent.appendChild(groupContent);
            }
        }

        async function viewGoal(goalId) {
            viewingGoalId = goalId;
            taskDetailTab.style.display = 'block';
            taskDetailTab.textContent = 'Goal Detail';
            taskDetailTab.dataset.taskTab = 'goalDetail';
            switchTaskTab('goalDetail');

            goalDetailSummary.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</div>';
            goalDetailTasks.innerHTML = '';
            goalDetailActions.innerHTML = '';

            try {
                const res = await fetch(`${API_BASE}/api/goals/${goalId}`);
                const data = await res.json();
                if (!data.success) throw new Error(data.error);

                const goal = data.goal;
                const tasks = data.tasks;

                // Summary
                const statusClass = goal.status === 'done' ? 'var(--green)'
                    : goal.status === 'failed' ? 'var(--red)'
                    : goal.status === 'decomposing' ? 'var(--amber)' : 'var(--cyan)';

                goalDetailSummary.innerHTML = `
                    <div style="font-size:14px;font-weight:600;margin-bottom:8px;">${goal.description}</div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
                        Status: <span style="color:${statusClass}">${goal.status}</span> •
                        ${goal.tasks_completed || 0}/${goal.task_count || 0} done •
                        ${goal.tasks_failed || 0} failed •
                        $${(goal.total_cost_usd || 0).toFixed(4)} cost
                    </div>
                    <div style="font-size:11px;color:var(--text-dim);">
                        Backend: ${goal.orchestrator_backend || 'unknown'} (${goal.orchestrator_model || 'unknown'})<br>
                        Project: ${goal.project_path}<br>
                        Created: ${new Date(goal.created_at).toLocaleString()}
                    </div>
                `;

                // Tasks
                if (tasks.length === 0) {
                    goalDetailTasks.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">No tasks yet (decomposing...)</div>';
                } else {
                    goalDetailTasks.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:8px;">Tasks:</div>';
                    for (const task of tasks) {
                        const taskEl = document.createElement('div');
                        taskEl.style.padding = '8px';
                        taskEl.style.marginBottom = '6px';
                        taskEl.style.background = 'var(--overlay-subtle)';
                        taskEl.style.borderRadius = '4px';
                        taskEl.style.fontSize = '11px';

                        const statusColor = task.status === 'done' ? 'var(--green)'
                            : task.status === 'failed' ? 'var(--red)'
                            : task.status === 'running' ? 'var(--amber)' : 'var(--text-dim)';

                        taskEl.innerHTML = `
                            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                                <span style="font-weight:600;">${task.title}</span>
                                <span style="color:${statusColor};">${task.status}</span>
                            </div>
                            <div style="color:var(--text-dim);font-size:10px;">
                                Model: ${task.model} • Priority: ${task.priority}
                                ${task.cost_usd ? ` • $${task.cost_usd.toFixed(4)}` : ''}
                            </div>
                        `;
                        taskEl.style.cursor = 'pointer';
                        taskEl.addEventListener('click', () => {
                            viewTask(task.id);
                        });
                        goalDetailTasks.appendChild(taskEl);
                    }
                }

                // Actions
                if (goal.status === 'failed') {
                    const retryBtn = document.createElement('button');
                    retryBtn.className = 'bridge-btn';
                    retryBtn.textContent = '🔄 Retry Failed Tasks';
                    retryBtn.addEventListener('click', async () => {
                        try {
                            const res = await fetch(`${API_BASE}/api/goals/${goalId}/retry`, { method: 'POST' });
                            const data = await res.json();
                            if (data.success) {
                                showToast('Retrying failed tasks');
                                setTimeout(() => viewGoal(goalId), 500);
                            } else {
                                showToast('Failed: ' + data.error, true);
                            }
                        } catch (err) {
                            showToast('Error: ' + err.message, true);
                        }
                    });
                    goalDetailActions.appendChild(retryBtn);
                }

                const backBtn = document.createElement('button');
                backBtn.className = 'bridge-btn bridge-btn-secondary';
                backBtn.textContent = '← Back to Goals';
                backBtn.style.marginLeft = '8px';
                backBtn.addEventListener('click', () => {
                    taskDetailTab.style.display = 'none';
                    switchTaskTab('goals');
                });
                goalDetailActions.appendChild(backBtn);

            } catch (err) {
                goalDetailSummary.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;">${err.message}</div>`;
            }
        }

        goalCreateBtn.addEventListener('click', async () => {
            const description = goalDescription.value.trim();
            const projectPath = goalProjectPath.value.trim();
            const autoExecute = goalAutoExecute.checked;

            if (!description || !projectPath) {
                showToast('Please fill in description and project path', true);
                return;
            }

            goalCreateBtn.disabled = true;
            goalCreateBtn.textContent = '🧠 Decomposing...';

            try {
                const res = await fetch(`${API_BASE}/api/goals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description, project_path: projectPath, auto_execute: autoExecute })
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error);

                showToast('Goal created, decomposing...');
                goalDescription.value = '';
                setTimeout(() => loadGoals(), 1000);
            } catch (err) {
                showToast('Error: ' + err.message, true);
            } finally {
                goalCreateBtn.disabled = false;
                goalCreateBtn.textContent = '🧠 Decompose & Create Goal';
            }
        });

        function handleGoalUpdate(data) {
            // Update goal in list if we're viewing goals
            loadGoals();

            // If viewing this specific goal, refresh detail
            if (viewingGoalId === data.goal?.id) {
                viewGoal(viewingGoalId);
            }
        }

        function handleGoalDecomposed(data) {
            showToast(`Goal decomposed into ${data.tasks?.length || 0} tasks`);
            loadGoals();
        }

        // ── Portfolio (Level 9) ──────────────────────────────
        let portfolioData = [];
        let portfolioDetailView = null; // project name if in detail view

        async function loadPortfolio() {
            try {
                const res = await fetch(`${API_BASE}/api/portfolio`);
                const data = await res.json();
                if (data.success) {
                    portfolioData = data.projects;
                    updateProjectPathsDatalist();
                    if (portfolioDetailView) renderProjectDetail(portfolioDetailView);
                    else renderPortfolio();
                }
            } catch (err) {
                document.getElementById('portfolioContent').innerHTML =
                    `<p style="color:var(--red);font-size:12px;">Failed to load portfolio</p>`;
            }
        }

        function renderPortfolio() {
            const container = document.getElementById('portfolioContent');
            if (!portfolioData.length) {
                container.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No projects found. Sync from registry.</p>';
                return;
            }
            container.innerHTML = portfolioData.map(p => {
                const s = p.stats;
                const costStr = s.total_cost_usd > 0 ? `$${s.total_cost_usd.toFixed(2)}` : '';
                const hasActivity = s.tasks_total > 0;
                return `<div class="portfolio-card" data-project="${p.name}">
                    <div class="portfolio-card-header">
                        <span class="portfolio-card-name">${p.name}</span>
                        ${p.throttled ? '<span class="portfolio-throttled-badge">THROTTLED</span>' : ''}
                        <span class="portfolio-lifecycle">${p.lifecycle}</span>
                    </div>
                    <div class="portfolio-card-desc">${p.description || 'No description'}</div>
                    <div class="portfolio-stats">
                        ${s.tasks_total > 0 ? `<span class="portfolio-stat has-value">${s.tasks_completed}/${s.tasks_total} tasks</span>` : '<span class="portfolio-stat">0 tasks</span>'}
                        ${s.tasks_running > 0 ? `<span class="portfolio-stat has-value" style="color:var(--cyan)">▶ ${s.tasks_running} running</span>` : ''}
                        ${s.tasks_failed > 0 ? `<span class="portfolio-stat has-value" style="color:var(--red)">${s.tasks_failed} failed</span>` : ''}
                        ${s.goals_total > 0 ? `<span class="portfolio-stat has-value">${s.goals_completed}/${s.goals_total} goals</span>` : ''}
                        ${costStr ? `<span class="portfolio-stat has-value">${costStr}</span>` : ''}
                    </div>
                </div>`;
            }).join('');

            container.querySelectorAll('.portfolio-card').forEach(card => {
                card.addEventListener('click', () => {
                    portfolioDetailView = card.dataset.project;
                    renderProjectDetail(portfolioDetailView);
                });
            });
        }

        function renderProjectDetail(name) {
            const container = document.getElementById('portfolioContent');
            const project = portfolioData.find(p => p.name === name);
            if (!project) {
                portfolioDetailView = null;
                renderPortfolio();
                return;
            }
            const s = project.stats;
            const costStr = s.total_cost_usd > 0 ? `$${s.total_cost_usd.toFixed(2)}` : '$0.00';
            const dailyBudgetStr = project.cost_budget_daily > 0 ? `$${project.cost_budget_daily.toFixed(2)}` : 'Unlimited';
            const totalBudgetStr = project.cost_budget_total > 0 ? `$${project.cost_budget_total.toFixed(2)}` : 'Unlimited';
            const spentTodayStr = `$${(project.cost_spent_today || 0).toFixed(2)}`;
            const spentTotalStr = `$${(project.cost_spent_total || 0).toFixed(2)}`;

            container.innerHTML = `
                <div class="portfolio-detail-back" id="portfolioBack">← All Projects</div>
                <div style="margin-bottom:12px;">
                    <span class="portfolio-card-name" style="font-size:16px;">${project.name}</span>
                    ${project.throttled ? '<span class="portfolio-throttled-badge" style="margin-left:8px;">THROTTLED</span>' : ''}
                    <span class="portfolio-lifecycle" style="margin-left:8px;">${project.lifecycle}</span>
                </div>
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">${project.description || ''}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-bottom:16px;">${project.path}</div>
                <div class="task-summary">
                    <div class="task-summary-row">
                        <span class="task-summary-label">Tasks</span>
                        <span class="task-summary-value">${s.tasks_completed} done / ${s.tasks_pending || 0} pending / ${s.tasks_failed} failed</span>
                    </div>
                    <div class="task-summary-row">
                        <span class="task-summary-label">Goals</span>
                        <span class="task-summary-value">${s.goals_completed}/${s.goals_total}</span>
                    </div>
                    <div class="task-summary-row">
                        <span class="task-summary-label">Total Cost</span>
                        <span class="task-summary-value">${costStr}</span>
                    </div>
                    <div class="task-summary-row">
                        <span class="task-summary-label">Priority</span>
                        <span class="task-summary-value">
                            <select class="portfolio-priority-select" data-project="${project.name}" value="${project.priority}">
                                ${[0,1,2,3,4,5,6,7,8,9,10].map(v => `<option value="${v}" ${v === project.priority ? 'selected' : ''}>${v}</option>`).join('')}
                            </select>
                        </span>
                    </div>
                </div>
                <div class="task-summary" style="margin-top:12px;">
                    <div class="task-summary-row" style="font-weight:600;color:var(--text-bright);">
                        <span class="task-summary-label">Budget</span>
                        <span class="task-summary-value"></span>
                    </div>
                    <div class="task-summary-row">
                        <span class="task-summary-label">Spent today</span>
                        <span class="task-summary-value">${spentTodayStr} / ${dailyBudgetStr}</span>
                    </div>
                    <div class="task-summary-row">
                        <span class="task-summary-label">Spent total</span>
                        <span class="task-summary-value">${spentTotalStr} / ${totalBudgetStr}</span>
                    </div>
                    <div class="task-summary-row">
                        <span class="task-summary-label">Daily limit</span>
                        <span class="task-summary-value">
                            <input class="budget-input" id="budgetDaily" type="number" step="0.01" min="0" value="${project.cost_budget_daily || 0}" placeholder="0 = unlimited">
                        </span>
                    </div>
                    <div class="task-summary-row">
                        <span class="task-summary-label">Total limit</span>
                        <span class="task-summary-value">
                            <input class="budget-input" id="budgetTotal" type="number" step="0.01" min="0" value="${project.cost_budget_total || 0}" placeholder="0 = unlimited">
                        </span>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="bridge-btn bridge-btn-secondary" id="budgetSaveBtn" style="font-size:12px;padding:8px 12px;">Save Budget</button>
                    ${project.throttled ? '<button class="bridge-btn" id="unthrottleBtn" style="font-size:12px;padding:8px 12px;background:var(--red);">Unthrottle</button>' : ''}
                    <button class="bridge-btn bridge-btn-secondary" id="portfolioCreateTask" style="font-size:12px;padding:8px 12px;">Create Task</button>
                </div>
            `;

            document.getElementById('portfolioBack').addEventListener('click', () => {
                portfolioDetailView = null;
                renderPortfolio();
            });

            container.querySelector('.portfolio-priority-select').addEventListener('change', async (e) => {
                await updateProjectPriority(project.name, parseInt(e.target.value, 10));
            });

            document.getElementById('portfolioCreateTask').addEventListener('click', () => {
                document.getElementById('taskPath').value = project.path;
                switchTaskTab('create');
            });

            document.getElementById('budgetSaveBtn').addEventListener('click', async () => {
                const daily = parseFloat(document.getElementById('budgetDaily').value) || 0;
                const total = parseFloat(document.getElementById('budgetTotal').value) || 0;
                try {
                    const res = await fetch(`${API_BASE}/api/portfolio/${encodeURIComponent(project.name)}/budget`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cost_budget_daily: daily, cost_budget_total: total })
                    });
                    const data = await res.json();
                    if (data.success) {
                        showToast('Budget saved');
                        await loadPortfolio();
                        renderProjectDetail(name);
                    } else {
                        showToast(data.error || 'Failed', true);
                    }
                } catch { showToast('Connection error', true); }
            });

            const unthrottleBtn = document.getElementById('unthrottleBtn');
            if (unthrottleBtn) {
                unthrottleBtn.addEventListener('click', async () => {
                    try {
                        const res = await fetch(`${API_BASE}/api/portfolio/${encodeURIComponent(project.name)}/unthrottle`, {
                            method: 'POST'
                        });
                        const data = await res.json();
                        if (data.success) {
                            showToast('Project unthrottled');
                            await loadPortfolio();
                            renderProjectDetail(name);
                        } else {
                            showToast(data.error || 'Failed', true);
                        }
                    } catch { showToast('Connection error', true); }
                });
            }
        }

        async function updateProjectPriority(name, priority) {
            try {
                await fetch(`${API_BASE}/api/portfolio/${encodeURIComponent(name)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ priority })
                });
            } catch (err) {
                showToast('Failed to update priority', true);
            }
        }

        function updateProjectPathsDatalist() {
            const datalist = document.getElementById('projectPaths');
            datalist.innerHTML = portfolioData.map(p =>
                `<option value="${p.path}">${p.name}</option>`
            ).join('');
        }

        document.getElementById('portfolioSyncBtn').addEventListener('click', async () => {
            try {
                const res = await fetch(`${API_BASE}/api/portfolio/sync`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast(`Synced ${data.synced} projects`);
                    loadPortfolio();
                }
            } catch (err) {
                showToast('Sync failed', true);
            }
        });

        // Pre-load portfolio data for datalist autocomplete
        loadPortfolio();

        // Load orchestrator status
        async function loadOrchestratorStatus() {
            try {
                const res = await fetch(`${API_BASE}/api/orchestrator/status`);
                const data = await res.json();
                if (data.success) {
                    const orchStatus = document.getElementById('orchestratorStatus');
                    const orchText = document.getElementById('orchestratorText');
                    if (data.ollamaAvailable) {
                        orchText.textContent = data.ollamaModel.split(':')[0];
                        orchStatus.style.display = 'flex';
                    } else if (data.hasApiKey) {
                        orchText.textContent = 'API';
                        orchStatus.style.display = 'flex';
                    }
                }
            } catch (err) {
                // Silently fail
            }
        }

        loadOrchestratorStatus();

        // ── Approval gates ─────────────────────────────────────

        let currentApproval = null;

        function handleApprovalRequest(data) {
            currentApproval = data;
            const overlay = document.getElementById('approvalOverlay');
            document.getElementById('approvalTaskId').textContent = data.taskId || 'Unknown';
            document.getElementById('approvalToolName').textContent = data.toolName || 'Unknown';
            document.getElementById('approvalTime').textContent = new Date(data.timestamp).toLocaleTimeString();
            document.getElementById('approvalInput').textContent = JSON.stringify(data.input, null, 2);
            overlay.style.display = 'flex';
            showToast('⚠️ Approval required');
        }

        document.getElementById('approvalApproveBtn').addEventListener('click', async () => {
            if (!currentApproval) return;
            const btn = document.getElementById('approvalApproveBtn');
            btn.disabled = true;
            btn.textContent = 'Approving...';
            try {
                const res = await fetch(`${API_BASE}/api/approvals/${currentApproval.approvalId}/approve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (data.success) {
                    showToast('✅ Approved');
                    document.getElementById('approvalOverlay').style.display = 'none';
                    currentApproval = null;
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Connection error', true);
            } finally {
                btn.disabled = false;
                btn.textContent = '✅ Approve';
            }
        });

        document.getElementById('approvalDenyBtn').addEventListener('click', async () => {
            if (!currentApproval) return;
            const btn = document.getElementById('approvalDenyBtn');
            btn.disabled = true;
            btn.textContent = 'Denying...';
            try {
                const res = await fetch(`${API_BASE}/api/approvals/${currentApproval.approvalId}/deny`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Denied by user via phone' })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('❌ Denied');
                    document.getElementById('approvalOverlay').style.display = 'none';
                    currentApproval = null;
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Connection error', true);
            } finally {
                btn.disabled = false;
                btn.textContent = '❌ Deny';
            }
        });

        // ── Dashboard ─────────────────────────────────────────

        const dashOverlay = document.getElementById('dashOverlay');
        const dashBtn = document.getElementById('dashBtn');
        let dashData = { analytics: null, digests: null, reports: null, ecosystem: null, proposals: null };

        function openDash() {
            dashOverlay.classList.add('visible');
            dashBtn.classList.add('active');
            loadAnalytics();
        }

        function closeDash() {
            dashOverlay.classList.remove('visible');
            dashBtn.classList.remove('active');
        }

        function switchDashTab(tab) {
            dashOverlay.querySelectorAll('[data-dash-tab]').forEach(t => {
                t.classList.toggle('active', t.dataset.dashTab === tab);
            });
            dashOverlay.querySelectorAll('.bridge-section').forEach(s => s.classList.remove('active'));
            if (tab === 'analytics') { document.getElementById('dashAnalytics').classList.add('active'); loadAnalytics(); }
            else if (tab === 'digests') { document.getElementById('dashDigests').classList.add('active'); loadDigests(); }
            else if (tab === 'reports') { document.getElementById('dashReports').classList.add('active'); loadReports(); }
            else if (tab === 'health') { document.getElementById('dashHealth').classList.add('active'); loadHealth(); }
        }

        dashBtn.addEventListener('click', () => {
            if (dashOverlay.classList.contains('visible')) closeDash();
            else openDash();
        });
        document.getElementById('dashClose').addEventListener('click', closeDash);
        dashOverlay.querySelector('.bridge-tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('[data-dash-tab]');
            if (tab) switchDashTab(tab.dataset.dashTab);
        });

        async function loadAnalytics() {
            const el = document.getElementById('dashAnalyticsContent');
            try {
                const res = await fetch(`${API_BASE}/api/analytics`);
                const data = await res.json();
                if (data.success) { dashData.analytics = data; renderAnalytics(data); }
                else el.innerHTML = `<p style="color:var(--red);font-size:12px;">Failed to load analytics</p>`;
            } catch { el.innerHTML = `<p style="color:var(--red);font-size:12px;">Connection error</p>`; }
        }

        function renderAnalytics(data) {
            const el = document.getElementById('dashAnalyticsContent');
            const g = data.global;

            // Stat cards
            let html = `<div class="dash-stat-grid">
                <div class="dash-stat-card"><div class="dash-stat-value">${g.totalTasks}</div><div class="dash-stat-label">Total Tasks</div></div>
                <div class="dash-stat-card"><div class="dash-stat-value" style="color:var(--green)">${(g.successRate * 100).toFixed(0)}%</div><div class="dash-stat-label">Success Rate</div></div>
                <div class="dash-stat-card"><div class="dash-stat-value">$${g.totalCost.toFixed(2)}</div><div class="dash-stat-label">Total Cost</div></div>
                <div class="dash-stat-card"><div class="dash-stat-value">$${g.avgCostPerTask.toFixed(3)}</div><div class="dash-stat-label">Avg Cost/Task</div></div>
            </div>`;

            // Model breakdown
            const models = Object.entries(data.byModel);
            if (models.length) {
                html += `<div class="bridge-label">Model Breakdown</div>
                <table class="dash-model-table"><thead><tr><th>Model</th><th>Count</th><th>Success</th><th>Avg Cost</th><th>Avg Turns</th></tr></thead><tbody>`;
                for (const [model, s] of models) {
                    html += `<tr><td style="font-weight:600">${model}</td><td>${s.count}</td><td style="color:var(--green)">${(s.successRate * 100).toFixed(0)}%</td><td>$${s.avgCost.toFixed(3)}</td><td>${s.avgTurns.toFixed(1)}</td></tr>`;
                }
                html += `</tbody></table>`;
            }

            // Velocity chart
            const v = data.velocity;
            if (v && v.dailyCounts.length) {
                const maxCount = Math.max(...v.dailyCounts.map(d => d.count), 1);
                const bars = [...v.dailyCounts].reverse();
                html += `<div class="bridge-label">7-Day Velocity <span style="text-transform:none;font-size:10px;color:${v.trend === 'up' ? 'var(--green)' : v.trend === 'down' ? 'var(--red)' : 'var(--text-muted)'}">${v.trend === 'up' ? '▲ trending up' : v.trend === 'down' ? '▼ trending down' : '● stable'}</span></div>`;
                html += `<div class="dash-velocity-chart">`;
                for (const d of bars) {
                    const pct = maxCount > 0 ? (d.count / maxCount * 100) : 0;
                    html += `<div class="dash-velocity-bar" style="height:${Math.max(pct, 3)}%" title="${d.date}: ${d.count} tasks"></div>`;
                }
                html += `</div><div class="dash-velocity-labels">`;
                for (const d of bars) {
                    html += `<span>${d.date.slice(5)}</span>`;
                }
                html += `</div>`;
            }

            // Suggestions
            if (data.suggestions.length) {
                html += `<div class="bridge-label">Optimisation Suggestions</div>`;
                for (const s of data.suggestions) {
                    html += `<div class="dash-suggestion">💡 <strong>${s.taskType}</strong> in ${s.project.split('/').pop()}: switch ${s.currentModel} → ${s.suggestedModel} (save $${s.savingsPerTask.toFixed(3)}/task, ${(s.cheapSuccessRate * 100).toFixed(0)}% success rate on ${s.sampleSize} samples)</div>`;
                }
            }

            // Per-project
            const projects = Object.entries(data.byProject);
            if (projects.length) {
                html += `<div class="bridge-label" style="margin-top:16px">By Project</div>`;
                for (const [path, s] of projects.sort((a, b) => b[1].totalCost - a[1].totalCost)) {
                    html += `<div class="dash-project-card"><div class="dash-project-header"><span class="dash-project-name">${path.split('/').pop()}</span><span style="font-size:11px;color:var(--text-dim)">$${s.totalCost.toFixed(2)}</span></div><div class="dash-project-stats">
                        <span class="portfolio-stat has-value">${s.count} tasks</span>
                        <span class="portfolio-stat has-value" style="color:var(--green)">${(s.successRate * 100).toFixed(0)}% success</span>
                    </div></div>`;
                }
            }

            el.innerHTML = html;
        }

        async function loadDigests() {
            const el = document.getElementById('dashDigestsContent');
            try {
                const res = await fetch(`${API_BASE}/api/digest/latest`);
                const data = await res.json();
                if (data.success) { renderDigestTab(data.digest); }
                else el.innerHTML = `<p style="color:var(--red);font-size:12px;">Failed to load digests</p>`;
            } catch { el.innerHTML = `<p style="color:var(--red);font-size:12px;">Connection error</p>`; }
        }

        function renderDigestTab(digest) {
            const el = document.getElementById('dashDigestsContent');
            if (!digest) {
                el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No digests yet. They are generated daily.</p>';
                return;
            }
            const d = digest.digest_json || {};
            let html = `<div class="task-summary" style="margin-bottom:12px;">
                <div class="task-summary-row"><span class="task-summary-label">Date</span><span class="task-summary-value">${digest.period_start ? digest.period_start.split('T')[0] : 'Unknown'}</span></div>
                <div class="task-summary-row"><span class="task-summary-label">Tasks</span><span class="task-summary-value">${d.tasks_completed || 0} completed</span></div>
                <div class="task-summary-row"><span class="task-summary-label">Cost</span><span class="task-summary-value">$${(d.total_cost || 0).toFixed(2)}</span></div>
            </div>`;
            html += `<div class="dash-digest-content">${digest.digest_text || 'No content'}</div>`;
            html += `<button class="bridge-btn" style="margin-top:12px" onclick="loadDigestHistory()">View History</button>`;
            el.innerHTML = html;
        }

        async function loadDigestHistory() {
            const el = document.getElementById('dashDigestsContent');
            try {
                const res = await fetch(`${API_BASE}/api/digest/history`);
                const data = await res.json();
                if (!data.success || !data.digests.length) {
                    el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No digest history.</p>';
                    return;
                }
                let html = `<div class="bridge-label">Digest History</div>`;
                for (const d of data.digests) {
                    const date = d.period_start ? d.period_start.split('T')[0] : 'Unknown';
                    const preview = (d.digest_text || '').split('\n')[0].slice(0, 80);
                    html += `<div class="dash-history-item" onclick="loadDigestById(${d.id})">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:13px;color:var(--text);font-weight:500">${date}</span>
                            ${d.viewed_at ? '' : '<span class="task-status-badge running">New</span>'}
                        </div>
                        <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${preview}</div>
                    </div>`;
                }
                el.innerHTML = html;
            } catch { el.innerHTML = `<p style="color:var(--red);font-size:12px;">Connection error</p>`; }
        }

        async function loadDigestById(id) {
            const el = document.getElementById('dashDigestsContent');
            try {
                const res = await fetch(`${API_BASE}/api/digest/history`);
                const data = await res.json();
                const digest = data.digests.find(d => d.id === id);
                if (digest) {
                    digest.digest_json = JSON.parse(digest.digest_json || '{}');
                    renderDigestTab(digest);
                }
            } catch {}
        }

        async function loadReports() {
            const el = document.getElementById('dashReportsContent');
            try {
                const res = await fetch(`${API_BASE}/api/weekly-report/latest`);
                const data = await res.json();
                if (data.success) { renderReportTab(data.report); }
                else el.innerHTML = `<p style="color:var(--red);font-size:12px;">Failed to load reports</p>`;
            } catch { el.innerHTML = `<p style="color:var(--red);font-size:12px;">Connection error</p>`; }
        }

        function renderReportTab(report) {
            const el = document.getElementById('dashReportsContent');
            if (!report) {
                el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No weekly reports yet.</p>';
                return;
            }
            const r = report.report_json || {};
            let html = `<div class="task-summary" style="margin-bottom:12px;">
                <div class="task-summary-row"><span class="task-summary-label">Period</span><span class="task-summary-value">${report.period_start ? report.period_start.split('T')[0] : '?'} — ${report.period_end ? report.period_end.split('T')[0] : '?'}</span></div>
                <div class="task-summary-row"><span class="task-summary-label">Tasks</span><span class="task-summary-value">${r.tasks_completed || 0} completed</span></div>
                <div class="task-summary-row"><span class="task-summary-label">Cost</span><span class="task-summary-value">$${(r.total_cost || 0).toFixed(2)}</span></div>
                ${r.velocity_trend ? `<div class="task-summary-row"><span class="task-summary-label">Trend</span><span class="task-summary-value">${r.velocity_trend}</span></div>` : ''}
            </div>`;
            html += `<div class="dash-digest-content">${report.report_text || 'No content'}</div>`;
            html += `<button class="bridge-btn" style="margin-top:12px" onclick="loadReportHistory()">View History</button>`;
            el.innerHTML = html;
        }

        async function loadReportHistory() {
            const el = document.getElementById('dashReportsContent');
            try {
                const res = await fetch(`${API_BASE}/api/weekly-report/history`);
                const data = await res.json();
                if (!data.success || !data.reports.length) {
                    el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">No report history.</p>';
                    return;
                }
                let html = `<div class="bridge-label">Report History</div>`;
                for (const r of data.reports) {
                    const start = r.period_start ? r.period_start.split('T')[0] : '?';
                    const end = r.period_end ? r.period_end.split('T')[0] : '?';
                    const preview = (r.report_text || '').split('\n')[0].slice(0, 80);
                    html += `<div class="dash-history-item" onclick="loadReportById(${r.id})">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:13px;color:var(--text);font-weight:500">${start} — ${end}</span>
                            ${r.viewed_at ? '' : '<span class="task-status-badge running">New</span>'}
                        </div>
                        <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${preview}</div>
                    </div>`;
                }
                el.innerHTML = html;
            } catch { el.innerHTML = `<p style="color:var(--red);font-size:12px;">Connection error</p>`; }
        }

        async function loadReportById(id) {
            const el = document.getElementById('dashReportsContent');
            try {
                const res = await fetch(`${API_BASE}/api/weekly-report/history`);
                const data = await res.json();
                const report = data.reports.find(r => r.id === id);
                if (report) {
                    report.report_json = JSON.parse(report.report_json || '{}');
                    renderReportTab(report);
                }
            } catch {}
        }

        async function loadHealth() {
            const el = document.getElementById('dashHealthContent');
            try {
                const [ecoRes, propRes] = await Promise.all([
                    fetch(`${API_BASE}/api/ecosystem`),
                    fetch(`${API_BASE}/api/proposals`)
                ]);
                const ecoData = await ecoRes.json();
                const propData = await propRes.json();
                if (ecoData.success) {
                    dashData.ecosystem = ecoData.projects;
                    dashData.proposals = propData.success ? propData.proposals : [];
                    renderHealth(ecoData.projects, dashData.proposals);
                } else {
                    el.innerHTML = `<p style="color:var(--red);font-size:12px;">Failed to load ecosystem</p>`;
                }
            } catch { el.innerHTML = `<p style="color:var(--red);font-size:12px;">Connection error</p>`; }
        }

        function renderHealth(projects, proposals) {
            const el = document.getElementById('dashHealthContent');
            let html = '';

            // Pending proposals
            const pending = proposals.filter(p => p.status === 'pending');
            if (pending.length) {
                html += `<div class="bridge-label">Pending Proposals (${pending.length})</div>`;
                for (const p of pending) {
                    const d = p.parsed_data || {};
                    let detail = '';
                    if (p.type === 'learning') {
                        detail = `<div style="margin-top:8px;font-size:12px;line-height:1.5;">
                            ${d.severity ? `<div><span style="color:var(--text-muted)">Severity:</span> <span style="color:${d.severity === 'HIGH' ? 'var(--red)' : d.severity === 'MEDIUM' ? 'var(--amber)' : 'var(--text)'}">${d.severity}</span></div>` : ''}
                            ${d.tech ? `<div><span style="color:var(--text-muted)">Tech:</span> ${d.tech}</div>` : ''}
                            <div style="margin-top:6px;"><span style="color:var(--text-muted)">Problem:</span><div style="color:var(--text);margin-top:2px;">${d.problem || ''}</div></div>
                            ${d.root_cause ? `<div style="margin-top:6px;"><span style="color:var(--text-muted)">Root cause:</span><div style="color:var(--text);margin-top:2px;">${d.root_cause}</div></div>` : ''}
                            <div style="margin-top:6px;"><span style="color:var(--text-muted)">Solution:</span><div style="color:var(--text);margin-top:2px;">${d.solution || ''}</div></div>
                        </div>`;
                    } else if (p.type === 'decision') {
                        detail = `<div style="margin-top:8px;font-size:12px;line-height:1.5;">
                            ${d.context ? `<div><span style="color:var(--text-muted)">Context:</span><div style="color:var(--text);margin-top:2px;">${d.context}</div></div>` : ''}
                            ${d.options ? `<div style="margin-top:6px;"><span style="color:var(--text-muted)">Options:</span><div style="color:var(--text);margin-top:2px;">${d.options}</div></div>` : ''}
                            <div style="margin-top:6px;"><span style="color:var(--text-muted)">Decision:</span><div style="color:var(--text);margin-top:2px;">${d.decision || ''}</div></div>
                            ${d.consequences ? `<div style="margin-top:6px;"><span style="color:var(--text-muted)">Consequences:</span><div style="color:var(--text);margin-top:2px;">${d.consequences}</div></div>` : ''}
                        </div>`;
                    }
                    html += `<div class="dash-proposal-card">
                        <div class="dash-proposal-header">
                            <span style="font-size:13px;color:var(--text);font-weight:500">${d.title || d.problem || p.type}</span>
                            <span class="task-status-badge pending">${p.type}</span>
                        </div>
                        <div style="font-size:10px;color:var(--text-muted);">Project: ${(p.project_path || '').split('/').pop()}</div>
                        ${detail}
                        <div class="dash-proposal-actions">
                            <button class="bridge-btn" style="flex:1;padding:6px;font-size:11px;" onclick="approveProposal(${p.id})">Approve</button>
                            <button class="bridge-btn bridge-btn-secondary" style="flex:1;padding:6px;font-size:11px;" onclick="rejectProposal(${p.id})">Reject</button>
                        </div>
                    </div>`;
                }
            }

            // Ecosystem grid
            html += `<div class="bridge-label" style="${pending.length ? 'margin-top:16px' : ''}">Ecosystem (${projects.length} projects)</div>`;
            for (const p of projects) {
                const t = p.tasks;
                const b = p.budget;
                html += `<div class="dash-project-card">
                    <div class="dash-project-header">
                        <span class="dash-project-name">${p.name}</span>
                        <div style="display:flex;gap:4px;align-items:center;">
                            ${b.throttled ? '<span class="portfolio-throttled-badge">THROTTLED</span>' : ''}
                            <span class="portfolio-lifecycle">${p.lifecycle}</span>
                        </div>
                    </div>
                    <div class="dash-project-stats">
                        ${t.total > 0 ? `<span class="portfolio-stat has-value">${t.completed}/${t.total} tasks</span>` : '<span class="portfolio-stat">0 tasks</span>'}
                        ${t.running > 0 ? `<span class="portfolio-stat has-value" style="color:var(--cyan)">▶ ${t.running} running</span>` : ''}
                        ${t.failed > 0 ? `<span class="portfolio-stat has-value" style="color:var(--red)">${t.failed} failed</span>` : ''}
                        ${p.goals.total > 0 ? `<span class="portfolio-stat has-value">${p.goals.completed}/${p.goals.total} goals</span>` : ''}
                        ${b.spent_total > 0 ? `<span class="portfolio-stat has-value">$${b.spent_total.toFixed(2)}</span>` : ''}
                        ${b.daily_limit ? `<span class="portfolio-stat">${b.spent_today.toFixed(2)}/${b.daily_limit} daily</span>` : ''}
                    </div>
                </div>`;
            }

            el.innerHTML = html;
        }

        async function approveProposal(id) {
            try {
                const res = await fetch(`${API_BASE}/api/proposals/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                const data = await res.json();
                if (data.success) { showToast('Proposal approved'); loadHealth(); }
                else showToast(data.error || 'Failed', true);
            } catch { showToast('Connection error', true); }
        }

        async function rejectProposal(id) {
            try {
                const res = await fetch(`${API_BASE}/api/proposals/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                const data = await res.json();
                if (data.success) { showToast('Proposal rejected'); loadHealth(); }
                else showToast(data.error || 'Failed', true);
            } catch { showToast('Connection error', true); }
        }

        // ── Start ─────────────────────────────────────────────

        async function loadPersistedTerminal() {
            try {
                const res = await fetch(`${API_BASE}/api/terminal`);
                const data = await res.json();
                if (data.success && data.content) {
                    handleTerminalUpdate(data.content, 'claude-remote');
                }
            } catch { /* WebSocket will pick up shortly */ }
        }

        function start() {
            // Load persisted terminal content immediately (before WebSocket connects)
            loadPersistedTerminal();

            connectWebSocket();

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    if (!ws || ws.readyState !== WebSocket.OPEN) {
                        clearTimeout(wsReconnectTimer);
                        wsReconnectDelay = WS_RECONNECT_BASE;
                        connectWebSocket();
                    }
                    poll();
                }
            });
        }

        start();
