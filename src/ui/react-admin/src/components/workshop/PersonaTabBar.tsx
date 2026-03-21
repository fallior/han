import { useStore, workshopPersonaTabs, type WorkshopPersona } from '../../store';

export function PersonaTabBar() {
  const { workshopPersona, setPersona } = useStore();

  return (
    <div className="persona-tab-bar">
      {(Object.entries(workshopPersonaTabs) as [WorkshopPersona, typeof workshopPersonaTabs[WorkshopPersona]][]).map(([key, tab]) => {
        const isActive = workshopPersona === key;

        return (
          <button
            key={key}
            className={`persona-tab ${isActive ? 'active' : ''}`}
            onClick={() => setPersona(key)}
            style={{
              color: isActive ? `var(--persona-${tab.color})` : undefined,
              borderBottomColor: isActive ? `var(--persona-${tab.color})` : undefined,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
