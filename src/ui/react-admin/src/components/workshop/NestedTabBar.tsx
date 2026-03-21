import { useStore } from '../../store';
import { workshopPersonaTabs, workshopNestedTabs } from '../../store/slices/workshop';

export function NestedTabBar() {
  const { workshopPersona, workshopNestedTab, setNestedTab } = useStore();

  const personaConfig = workshopPersonaTabs[workshopPersona];
  const nestedTabs = workshopNestedTabs[workshopPersona];

  return (
    <div className="nested-tab-bar">
      {nestedTabs.map((tab) => {
        const isActive = workshopNestedTab === tab.key;

        return (
          <button
            key={tab.key}
            className={`nested-tab ${isActive ? 'active' : ''}`}
            onClick={() => setNestedTab(tab.key)}
            style={{
              color: isActive ? `var(--persona-${personaConfig.color})` : undefined,
              borderBottomColor: isActive ? `var(--persona-${personaConfig.color})` : undefined,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
