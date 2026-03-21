/**
 * Component test page for visual verification
 * This file is not part of the production app
 */

import { Badge } from '../../components/shared/Badge';
import { StatCard } from '../../components/shared/StatCard';
import { formatCost, formatPct } from '../../lib/formatters';

export default function ComponentTest() {
  return (
    <div style={{ padding: '2rem' }}>
      <h2>Badge Component Tests</h2>

      <div style={{ marginBottom: '2rem' }}>
        <h3>Status Badges</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge status="done" />
          <Badge status="completed" />
          <Badge status="running" />
          <Badge status="active" />
          <Badge status="decomposing" />
          <Badge status="failed" />
          <Badge status="pending" />
          <Badge status="cancelled" />
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h3>Category Badges</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge status="improvement" variant="category" />
          <Badge status="opportunity" variant="category" />
          <Badge status="risk" variant="category" />
          <Badge status="strategic" variant="category" />
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h3>Custom Content Badge</h3>
        <Badge status="done">Custom Text</Badge>
      </div>

      <h2>StatCard Component Tests</h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <StatCard label="Total Tasks" value={42} />
        <StatCard label="Success Rate" value={formatPct(0.95)} />
        <StatCard
          label="Total Cost"
          value={formatCost(125.5)}
          valueColor="#10b981"
        />
        <StatCard
          label="Velocity"
          value="3.2 tasks/day"
          change={{ direction: 'up', text: '+12% from last week' }}
        />
      </div>

      <h2>Formatter Tests</h2>
      <div style={{ fontFamily: 'monospace' }}>
        <div>formatCost(0): {formatCost(0)}</div>
        <div>formatCost(0.005): {formatCost(0.005)}</div>
        <div>formatCost(0.5): {formatCost(0.5)}</div>
        <div>formatCost(5.5): {formatCost(5.5)}</div>
        <div>formatPct(0.95): {formatPct(0.95)}</div>
      </div>
    </div>
  );
}
