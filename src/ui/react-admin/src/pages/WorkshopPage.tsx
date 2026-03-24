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

import { useState } from 'react';
import { PersonaTabBar } from '../components/workshop/PersonaTabBar';
import { NestedTabBar } from '../components/workshop/NestedTabBar';
import { JemmaView } from '../components/workshop/JemmaView';
import { ThreadList } from '../components/workshop/ThreadList';
import { ThreadDetail } from '../components/workshop/ThreadDetail';
import { useWorkshopStore, workshopPersonaTabs } from '../store/workshopStore';
import { createThread } from '../lib/api';
import '../styles/workshop.css';

export default function WorkshopPage() {
  const { persona, nestedTab, selectedThreadId, selectThread } = useWorkshopStore();
  const [threadPanelCollapsed, setThreadPanelCollapsed] = useState(false);

  const personaConfig = workshopPersonaTabs[persona];
  const accentColor = `var(--${personaConfig.color})`;

  const handleNewThread = async () => {
    const title = prompt('Enter thread title:');
    if (!title?.trim()) return;

    if (!nestedTab) {
      alert('Please select a tab first');
      return;
    }

    try {
      const thread = await createThread(title.trim(), nestedTab);
      // Select the newly created thread
      selectThread(nestedTab, thread.id.toString());
    } catch (err) {
      console.error('Failed to create thread:', err);
      alert('Failed to create thread. Please try again.');
    }
  };

  const handleTogglePanel = () => {
    setThreadPanelCollapsed(!threadPanelCollapsed);
  };

  const handleBack = () => {
    // Mobile only: deselect thread to go back to list view
    if (nestedTab) {
      selectThread(nestedTab, null);
    }
  };

  return (
    <div
      className={`workshop-layout-${persona}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 120px)',
        backgroundColor: 'var(--bg-page)',
      }}
    >
      {/* Persona Tab Bar */}
      <PersonaTabBar />

      {/* Nested Tab Bar */}
      <NestedTabBar />

      {/* Actions Bar (New Thread button, etc.) */}
      {persona !== 'jemma' && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <button
            onClick={handleNewThread}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: `1px solid ${accentColor}`,
              backgroundColor: accentColor,
              color: 'var(--bg-page)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
            New Thread
          </button>
        </div>
      )}

      {/* Content Area */}
      <div
        className="conversation-container"
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {persona === 'jemma' ? (
          // Jemma persona: show special dispatcher view
          <JemmaView />
        ) : (
          // All other personas: ThreadList + ThreadDetail layout
          <div
            className={[
              'workshop-conversation-layout',
              threadPanelCollapsed && 'thread-panel-collapsed',
              selectedThreadId && 'thread-selected',
            ].filter(Boolean).join(' ')}
            style={{
              width: '100%',
              height: '100%',
            }}
          >
            {/* Thread List Panel */}
            <div className="thread-list-panel">
              <ThreadList />
            </div>

            {/* Thread Detail Panel */}
            <div className="thread-detail-panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <ThreadDetail onTogglePanel={handleTogglePanel} onBack={handleBack} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
