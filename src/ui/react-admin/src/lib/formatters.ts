/**
 * Formatting utilities for display values
 * Ported from admin.ts and re-exported from utils.ts
 */

// Re-export existing formatters from utils.ts for convenience
export {
  timeSince,
  formatTime,
  formatDateTime,
  formatDate,
} from './utils';

/**
 * Formats USD cost with appropriate decimal places
 * - $0.00 for zero
 * - 4 decimals if < $0.01
 * - 3 decimals if < $1
 * - 2 decimals otherwise
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Formats a decimal as a percentage (e.g., 0.95 → "95.0%")
 */
export function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Returns CSS class name for status badge
 * Maps various status strings to badge CSS classes
 */
export function statusBadgeClass(status: string): string {
  if (status === 'done' || status === 'completed') return 'done';
  if (status === 'running' || status === 'active' || status === 'decomposing')
    return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  return 'cancelled';
}

/**
 * Returns CSS class name for category badge
 * Used for insight categories in supervisor reports
 */
export function categoryBadgeClass(cat: string): string {
  if (cat === 'improvement') return 'improvement';
  if (cat === 'opportunity') return 'opportunity';
  if (cat === 'risk') return 'risk';
  return 'strategic';
}
