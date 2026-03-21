/**
 * Workshop Page
 *
 * The main workshop interface with persona-based navigation.
 * Includes:
 * - Persona tabs (Jim, Leo, Darron, Jemma)
 * - Nested tabs (vary by persona)
 * - Special Jemma view for Discord message routing
 * - ThreadList + ThreadDetail for other personas
 */

import { PersonaTabBar } from '../components/workshop/PersonaTabBar';
import { NestedTabBar } from '../components/workshop/NestedTabBar';
import { JemmaView } from '../components/workshop/JemmaView';
import { useWorkshopStore } from '../store/workshopStore';

export default function WorkshopPage() {
  const { persona } = useWorkshopStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Persona Tab Bar */}
      <PersonaTabBar />

      {/* Nested Tab Bar */}
      <NestedTabBar />

      {/* Content Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {persona === 'jemma' ? (
          <JemmaView />
        ) : (
          <div style={{ flex: 1, padding: '20px', textAlign: 'center', color: 'var(--color-muted-fg)' }}>
            ThreadList + ThreadDetail coming soon for {persona}
          </div>
        )}
      </div>
    </div>
  );
}
