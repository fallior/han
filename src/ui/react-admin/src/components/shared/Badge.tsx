/**
 * Badge component for status and category labels
 * Supports status badges (done, running, failed, pending, cancelled)
 * and category badges (improvement, opportunity, risk, strategic)
 */

import { statusBadgeClass, categoryBadgeClass } from '../../lib/formatters';

interface BadgeProps {
  /** Status or category value */
  status: string;
  /** Optional custom content, defaults to status value */
  children?: React.ReactNode;
  /** Use category colors instead of status colors */
  variant?: 'status' | 'category';
}

/**
 * Badge component for displaying status or category labels with colored styling
 */
export function Badge({ status, children, variant = 'status' }: BadgeProps) {
  const className =
    variant === 'category'
      ? categoryBadgeClass(status)
      : statusBadgeClass(status);

  return (
    <span className={`badge badge-${className}`}>{children || status}</span>
  );
}
