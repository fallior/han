/**
 * PersonaTabBar Component
 *
 * Top-level tabs for switching between personas (Jim, Leo, Darron, Jemma)
 * Each persona has a distinct color and nested tabs
 */

import { useWorkshopStore, workshopPersonaTabs, type WorkshopPersona } from '../../store/workshopStore';

export function PersonaTabBar() {
  const { persona, setPersona } = useWorkshopStore();

  return (
    <div
      className="workshop-persona-bar"
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '2px solid var(--border)',
        background: 'var(--bg-card)',
      }}
    >
      {(Object.entries(workshopPersonaTabs) as [WorkshopPersona, typeof workshopPersonaTabs[WorkshopPersona]][]).map(([key, tab]) => {
        const isActive = persona === key;
        const color = `var(--${tab.color})`;

        return (
          <button
            key={key}
            className={`workshop-persona-tab ${isActive ? 'active' : ''}`}
            onClick={() => setPersona(key)}
            style={{
              flex: 1,
              padding: '12px 16px',
              textAlign: 'center',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? color : 'var(--text-dim)',
              borderBottom: isActive ? `3px solid ${color}` : 'none',
              transition: 'all 200ms ease',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
