import { PersonaTabBar } from '../components/workshop/PersonaTabBar';
import { NestedTabBar } from '../components/workshop/NestedTabBar';
import { useStore } from '../store';

export function WorkshopTest() {
  const { workshopPersona, workshopNestedTab } = useStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <PersonaTabBar />
      <NestedTabBar />
      <div style={{ flex: 1, padding: '24px' }}>
        <h2>Tab Bar Test Page</h2>
        <p>
          Current persona: <strong>{workshopPersona}</strong>
        </p>
        <p>
          Current nested tab: <strong>{workshopNestedTab}</strong>
        </p>
        <div style={{ marginTop: '24px', color: 'var(--text-muted)' }}>
          <h3>Instructions:</h3>
          <ol>
            <li>Click different persona tabs at the top</li>
            <li>Observe the nested tabs change to match the persona</li>
            <li>Click nested tabs to switch between them</li>
            <li>Verify active states show correct colors</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
