/**
 * Pure utility functions ported from admin.js
 * React-compatible (no direct DOM dependencies)
 */

/**
 * Escape HTML special characters using regex (React-compatible)
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Lightweight markdown to HTML converter
 * Supports: code blocks, inline code, headings, bold, italic, lists, paragraphs, line breaks
 */
export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks (```lang\n...\n```)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, _lang, code) =>
      `<pre style="background:var(--bg-input);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;margin:8px 0"><code>${code.trim()}</code></pre>`
  );

  // Inline code (`...`)
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--bg-input);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>'
  );

  // Headings
  html = html.replace(
    /^### (.+)$/gm,
    '<h4 style="margin:12px 0 4px;font-size:13px;color:var(--text-heading)">$1</h4>'
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h3 style="margin:14px 0 6px;font-size:14px;color:var(--text-heading)">$1</h3>'
  );

  // Horizontal rules
  html = html.replace(
    /^---$/gm,
    '<hr style="border:none;border-top:1px solid var(--border-subtle);margin:12px 0">'
  );

  // Bold/italic combinations and standalone
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Lists
  html = html.replace(
    /^- (.+)$/gm,
    '<li style="margin-left:16px;list-style:disc;font-size:inherit">$1</li>'
  );
  html = html.replace(
    /^\d+\. (.+)$/gm,
    '<li style="margin-left:16px;list-style:decimal;font-size:inherit">$1</li>'
  );

  // Paragraphs and line breaks
  html = html.replace(/\n\n/g, '</p><p style="margin:8px 0">');
  html = html.replace(/\n/g, '<br>');

  return `<p style="margin:0">${html}</p>`;
}

/**
 * Format ISO timestamp as HH:MM (en-AU locale)
 */
export function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format ISO timestamp as DD Mon HH:MM (en-AU locale)
 */
export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  );
}

/**
 * Format relative time (Xs ago, Xm ago, Xh ago, Xd ago)
 */
export function timeSince(iso: string): string {
  if (!iso) return '—';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * Format ISO timestamp as DD Mon YYYY (en-AU locale)
 */
export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
