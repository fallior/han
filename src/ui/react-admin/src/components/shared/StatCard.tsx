/**
 * StatCard component for displaying key metrics
 * Used in the Overview page dashboard
 */

interface StatCardProps {
  /** Label text (e.g., "Total Tasks") */
  label: string;
  /** Main value to display (number or formatted string) */
  value: string | number;
  /** Optional color override for the value */
  valueColor?: string;
  /** Optional CSS class name for the value */
  valueClassName?: string;
  /** Optional change indicator */
  change?: {
    /** Direction of change */
    direction: 'up' | 'down' | 'stable';
    /** Change text (e.g., "+5.2% from last week") */
    text: string;
  };
}

/**
 * Displays a single statistic in a card format with optional change indicator
 */
export function StatCard({
  label,
  value,
  valueColor,
  valueClassName,
  change,
}: StatCardProps) {
  const valueStyle = valueColor ? { color: valueColor } : undefined;

  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${valueClassName || ''}`} style={valueStyle}>
        {value}
      </div>
      {change && (
        <div className={`stat-change stat-change-${change.direction}`}>
          {change.text}
        </div>
      )}
    </div>
  );
}
