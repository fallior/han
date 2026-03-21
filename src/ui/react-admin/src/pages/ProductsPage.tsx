import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatCost, formatDate, formatDateTime, statusBadgeClass } from '../lib/formatters';

// ============================================================================
// Types
// ============================================================================

interface Product {
  id: string;
  name: string;
  status: string;
  current_phase_index: number;
  phases_completed: number;
  total_cost_usd: number;
  created_at: string;
  seed_text?: string;
}

interface Phase {
  phase_index: number;
  status: string;
  gate_status?: string;
  cost_usd: number;
  started_at?: string;
  completed_at?: string;
  goal_id?: string;
  artifacts?: string | Record<string, unknown>;
}

interface KnowledgeEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  created_at: string;
  source_phase?: number;
}

interface ProductListResponse {
  success: boolean;
  products: Product[];
}

interface ProductDetailResponse {
  success: boolean;
  product: Product;
  phases: Phase[];
  knowledge: KnowledgeEntry[];
}

// ============================================================================
// Product List View
// ============================================================================

interface ProductCardProps {
  product: Product;
  onSelect: (id: string) => void;
}

function ProductCard({ product, onSelect }: ProductCardProps) {
  const phasesCompleted = product.phases_completed || 0;
  const totalPhases = 7;
  const pct = (phasesCompleted / totalPhases) * 100;

  const statusCls = statusBadgeClass(product.status || 'pending');

  const phaseIndicatorClass =
    product.current_phase_index >= 6
      ? 'done'
      : product.current_phase_index >= 3
      ? 'improvement'
      : 'strategic';

  return (
    <div
      className="product-card"
      onClick={() => onSelect(product.id)}
      style={{ cursor: 'pointer' }}
    >
      <div className="product-card-header">
        <span className="product-card-name">{product.name}</span>
        <span className={`phase-indicator badge badge-${phaseIndicatorClass}`}>
          Phase {(product.current_phase_index || 0) + 1}/7
        </span>
      </div>
      <div className="product-card-status">
        <span className={`badge badge-${statusCls}`}>
          {product.status || 'pending'}
        </span>
      </div>
      <div className="progress-bar" style={{ margin: '8px 0' }}>
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="product-card-stats">
        <span>
          {phasesCompleted}/{totalPhases} phases
        </span>
        <span>{formatCost(product.total_cost_usd || 0)}</span>
      </div>
      <div className="product-card-meta">
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDate(product.created_at)}
        </span>
      </div>
    </div>
  );
}

function ProductListView({ onSelectProduct }: { onSelectProduct: (id: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await apiFetch('/api/products');
        const data: ProductListResponse = await response.json();
        setProducts(data.products || []);
      } catch (err) {
        console.error('Failed to fetch products:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  if (loading) {
    return <div style={{ color: 'var(--text-dim)' }}>Loading products...</div>;
  }

  if (products.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)' }}>
        No products yet. Create one to start the autonomous product factory.
      </div>
    );
  }

  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onSelect={onSelectProduct}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Product Detail View
// ============================================================================

const PHASE_NAMES = [
  'Research',
  'Design',
  'Architecture',
  'Build',
  'Test',
  'Document',
  'Deploy',
];

interface PhaseTimelineProps {
  phases: Phase[];
  currentPhaseIndex: number;
  onPhaseClick: (index: number) => void;
}

function PhaseTimeline({ phases, currentPhaseIndex, onPhaseClick }: PhaseTimelineProps) {
  return (
    <div className="admin-card">
      <h2>Phase Timeline</h2>
      <div className="phase-timeline">
        {PHASE_NAMES.map((name, i) => {
          const phase = phases.find((p) => p.phase_index === i);
          const isCurrentPhase = i === currentPhaseIndex;
          const isCompleted =
            i < currentPhaseIndex || (phase && phase.status === 'completed');
          const statusClass = isCompleted
            ? 'done'
            : isCurrentPhase
            ? 'current'
            : 'pending';

          return (
            <div
              key={i}
              className={`phase-node ${statusClass}`}
              onClick={() => onPhaseClick(i)}
              style={{ cursor: 'pointer' }}
            >
              <div className="phase-node-circle" />
              <div className="phase-node-label">{name}</div>
              {phase && (
                <div className="phase-node-badge">
                  <span className={`badge badge-${statusBadgeClass(phase.status || 'pending')}`}>
                    {phase.status || 'pending'}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PhaseDetailCardProps {
  phase: Phase;
  phaseIndex: number;
}

function PhaseDetailCard({ phase, phaseIndex }: PhaseDetailCardProps) {
  const [expanded, setExpanded] = useState(false);

  const phaseStatus = phase.status || 'pending';
  const gateStatus = phase.gate_status || '—';
  const costUsd = phase.cost_usd || 0;
  const costColor = costUsd > 0 ? 'var(--text)' : 'var(--text-muted)';

  const gateStatusClass =
    gateStatus === 'passed'
      ? 'done'
      : gateStatus === 'pending'
      ? 'pending'
      : 'failed';

  return (
    <div
      className="phase-detail-card"
      onClick={() => setExpanded(!expanded)}
      style={{ cursor: 'pointer' }}
    >
      <div className="phase-detail-header">
        <span className="phase-detail-name">{PHASE_NAMES[phaseIndex]}</span>
        <div className="phase-detail-badges">
          <span className={`badge badge-${statusBadgeClass(phaseStatus)}`}>
            {phaseStatus}
          </span>
          {phase.gate_status && (
            <span className={`badge badge-${gateStatusClass}`}>
              {gateStatus}
            </span>
          )}
        </div>
      </div>
      <div className="phase-detail-meta">
        <span style={{ color: costColor }}>Cost: {formatCost(costUsd)}</span>
        {phase.started_at && (
          <span style={{ color: 'var(--text-muted)' }}>
            Started: {formatDateTime(phase.started_at)}
          </span>
        )}
        {phase.completed_at && (
          <span style={{ color: 'var(--text-muted)' }}>
            Completed: {formatDateTime(phase.completed_at)}
          </span>
        )}
      </div>
      {expanded && (
        <div className="phase-detail-expanded">
          {phase.goal_id && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px',
                background: 'var(--bg-page)',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              <strong style={{ color: 'var(--text-muted)' }}>Goal:</strong>{' '}
              <a href="#" style={{ color: 'var(--blue)' }}>
                {phase.goal_id}
              </a>
            </div>
          )}
          {phase.artifacts && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px',
                background: 'var(--bg-page)',
                borderRadius: '4px',
                fontSize: '11px',
                fontFamily: 'ui-monospace',
              }}
            >
              <strong style={{ color: 'var(--text-muted)' }}>Artifacts:</strong>
              <pre
                style={{
                  marginTop: '4px',
                  color: 'var(--text-dim)',
                  overflowX: 'auto',
                }}
              >
                {typeof phase.artifacts === 'string'
                  ? phase.artifacts
                  : JSON.stringify(phase.artifacts, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PhaseDetailsProps {
  phases: Phase[];
  phaseRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
}

function PhaseDetails({ phases, phaseRefs }: PhaseDetailsProps) {
  if (phases.length === 0) return null;

  return (
    <div className="admin-card">
      <h2>Phase Details</h2>
      <div className="phase-details-list">
        {phases.map((phase) => (
          <div
            key={phase.phase_index}
            ref={(el) => {
              if (el) {
                phaseRefs.current[phase.phase_index] = el;
              }
            }}
          >
            <PhaseDetailCard phase={phase} phaseIndex={phase.phase_index} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface KnowledgeEntryProps {
  entry: KnowledgeEntry;
}

function KnowledgeEntryComponent({ entry }: KnowledgeEntryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="knowledge-entry"
      onClick={() => setExpanded(!expanded)}
      style={{ cursor: 'pointer' }}
    >
      <div className="knowledge-entry-header">
        <span className="knowledge-entry-title">{entry.title || 'Untitled'}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {formatDate(entry.created_at)}
        </span>
      </div>
      {expanded && (
        <div className="knowledge-entry-content">
          <div
            style={{
              marginTop: '8px',
              padding: '8px',
              background: 'var(--bg-page)',
              borderRadius: '4px',
              fontSize: '12px',
              lineHeight: '1.5',
            }}
            dangerouslySetInnerHTML={{
              __html: (entry.content || '—').replace(/\n/g, '<br>'),
            }}
          />
          {entry.source_phase !== undefined && (
            <div
              style={{
                marginTop: '6px',
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              Source: Phase {entry.source_phase + 1}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface KnowledgeBaseProps {
  knowledge: KnowledgeEntry[];
}

function KnowledgeBase({ knowledge }: KnowledgeBaseProps) {
  // Group by category
  const knowledgeByCategory: Record<string, KnowledgeEntry[]> = {};
  for (const k of knowledge) {
    const cat = k.category || 'general';
    if (!knowledgeByCategory[cat]) knowledgeByCategory[cat] = [];
    knowledgeByCategory[cat].push(k);
  }

  if (Object.keys(knowledgeByCategory).length === 0) return null;

  return (
    <div className="admin-card">
      <h2>Knowledge Base</h2>
      <div className="knowledge-section">
        {Object.entries(knowledgeByCategory).map(([category, entries]) => (
          <div key={category} className="knowledge-category">
            <div className="knowledge-category-title">
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </div>
            {entries.map((entry) => (
              <KnowledgeEntryComponent key={entry.id} entry={entry} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ProductDetailViewProps {
  productId: string;
  onBack: () => void;
}

function ProductDetailView({ productId, onBack }: ProductDetailViewProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const phaseRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await apiFetch(`/api/products/${encodeURIComponent(productId)}`);
        const data: ProductDetailResponse = await response.json();
        setProduct(data.product || null);
        setPhases(data.phases || []);
        setKnowledge(data.knowledge || []);
      } catch (err) {
        console.error('Failed to fetch product:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);

  const handlePhaseClick = (index: number) => {
    const phaseCard = phaseRefs.current[index];
    if (phaseCard) {
      phaseCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--text-dim)' }}>Loading product...</div>;
  }

  if (!product) {
    return <div style={{ color: 'var(--text-dim)' }}>Product not found</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <button
          className="admin-btn admin-btn-sm"
          onClick={onBack}
          style={{ cursor: 'pointer' }}
        >
          ← Back to Products
        </button>
      </div>

      <div className="detail-panel">
        <h2>{product.name}</h2>
        <div className="detail-grid">
          <div className="detail-field">
            <span className="label">Status</span>
            <span className="value">
              <span className={`badge badge-${statusBadgeClass(product.status || 'pending')}`}>
                {product.status || 'pending'}
              </span>
            </span>
          </div>
          <div className="detail-field">
            <span className="label">Current Phase</span>
            <span className="value">
              Phase {(product.current_phase_index || 0) + 1} of 7
            </span>
          </div>
          <div className="detail-field">
            <span className="label">Total Cost</span>
            <span className="value">{formatCost(product.total_cost_usd || 0)}</span>
          </div>
          <div className="detail-field">
            <span className="label">Created</span>
            <span className="value">{formatDateTime(product.created_at)}</span>
          </div>
          {product.seed_text && (
            <div className="detail-field">
              <span className="label">Seed</span>
              <span className="value" style={{ fontSize: '12px' }}>
                {(product.seed_text || '').substring(0, 60)}
              </span>
            </div>
          )}
        </div>
      </div>

      <PhaseTimeline
        phases={phases}
        currentPhaseIndex={product.current_phase_index}
        onPhaseClick={handlePhaseClick}
      />

      <PhaseDetails phases={phases} phaseRefs={phaseRefs} />

      <KnowledgeBase knowledge={knowledge} />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function ProductsPage() {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  return (
    <div>
      {selectedProductId ? (
        <ProductDetailView
          productId={selectedProductId}
          onBack={() => setSelectedProductId(null)}
        />
      ) : (
        <>
          <h1>Products</h1>
          <ProductListView onSelectProduct={setSelectedProductId} />
        </>
      )}
    </div>
  );
}
