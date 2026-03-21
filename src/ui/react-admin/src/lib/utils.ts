/**
 * Utility functions ported from admin.ts
 */

/**
 * Escapes HTML special characters to prevent XSS
 */
export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Formats a relative time string (e.g., "5m ago", "3h ago", "2d ago")
 * Uses en-AU locale conventions
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
 * Formats time only (HH:MM in 24-hour format)
 * Uses en-AU locale
 */
export function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Formats date and time (e.g., "15 Mar, 14:30")
 * Uses en-AU locale
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
 * Formats date only (e.g., "15 Mar 2024")
 * Uses en-AU locale
 */
export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
