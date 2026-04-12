/**
 * NestedTabBar Component
 *
 * Second-level tabs that change based on the selected persona.
 * Now reads dynamically from persona registry via the store.
 */

import { useStore } from '../../store';

export function NestedTabBar() {
  const persona = useStore((s) => s.workshopPersona);
  const nestedTab = useStore((s) => s.workshopNestedTab);
  const setNestedTab = useStore((s) => s.setNestedTab);
  const personaTabs = useStore((s) => s.personaTabs);
  const nestedTabsMap = useStore((s) => s.nestedTabs);

  const personaConfig = personaTabs[persona] || { label: persona, color: 'gray' };
  const tabs = nestedTabsMap[persona] || [];
  const color = `var(--${personaConfig.color})`;

  return (
    <div
      className="workshop-nested-bar"
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-page)',
        padding: '0 8px',
      }}
    >
      {tabs.map((tab) => {
        const isActive = nestedTab === tab.key;

        return (
          <button
            key={tab.key}
            className={`workshop-nested-tab ${isActive ? 'active' : ''}`}
            onClick={() => setNestedTab(tab.key)}
            style={{
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '12px',
              color: isActive ? color : 'var(--text-dim)',
              borderBottom: isActive ? `2px solid ${color}` : 'none',
              transition: 'all 150ms ease',
              marginTop: '8px',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
