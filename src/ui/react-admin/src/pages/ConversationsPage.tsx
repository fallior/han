import { useState, useEffect } from 'react';
import { ThreadListPanel } from '../components/shared/ThreadListPanel';
import { ThreadDetailPanel } from '../components/shared/ThreadDetailPanel';
import { useStore } from '../store';
import type { ConversationThread, Message, SearchResult } from '../types';

interface Period {
  count: number;
  label: string;
  conversations: ConversationThread[];
}

interface GroupedData {
  [key: string]: Period;
}

export default function ConversationsPage() {
  // Zustand store state
  const selectedId = useStore(state => state.conversationsSelectedId);
  const selectedPeriod = useStore(state => state.conversationsPeriod);
  const setSelectedId = useStore(state => state.setConversationsSelectedId);
  const setPeriod = useStore(state => state.setConversationsPeriod);
  const subscribeWs = useStore(state => state.subscribeWs);

  // Local state
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [periods, setPeriods] = useState<GroupedData>({});
  const [selectedConversation, setSelectedConversation] = useState<ConversationThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [newThreadDialogOpen, setNewThreadDialogOpen] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState('');

  // Fetch grouped conversations on mount
  useEffect(() => {
    fetchGroupedConversations();
  }, []);

  // WebSocket subscription for conversation updates
  useEffect(() => {
    const unsubscribe = subscribeWs('conversation_message', (data: any) => {
      // Only process if NOT memory or workshop types
      const workshopTypes = ['jim', 'leo', 'darron', 'jemma'];
      if (data.discussion_type === 'memory' || workshopTypes.includes(data.discussion_type)) {
        return;
      }

      // If this is the selected conversation, refresh messages
      if (data.conversation_id === selectedId) {
        fetchConversationDetail(data.conversation_id);
      } else {
        // Otherwise refresh thread list
        fetchGroupedConversations();
      }
    });

    return unsubscribe;
  }, [subscribeWs, selectedId]);

  const fetchGroupedConversations = async () => {
    try {
      const response = await fetch('/api/conversations/grouped');
      if (!response.ok) throw new Error('Failed to fetch conversations');
      const data = await response.json();

      // data shape: { all: Thread[], today: { count, label, conversations }, ... }
      const allThreads = data.all || [];
      delete data.all; // Remove 'all' from periods object

      setThreads(allThreads);
      setPeriods(data);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    }
  };

  const fetchConversationDetail = async (id: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) throw new Error('Failed to fetch conversation');
      const data = await response.json();

      setSelectedConversation(data.conversation);
      setMessages(data.messages || []);

      // Mark as read
      localStorage.setItem(`lastRead:${id}`, new Date().toISOString());
    } catch (error) {
      console.error('Error fetching conversation detail:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectThread = (id: string) => {
    setSelectedId(id);
    fetchConversationDetail(id);
    setSearchResults(null); // Clear search when selecting a thread
  };

  const handlePeriodChange = (period: string) => {
    setPeriod(period);
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    try {
      const response = await fetch(`/api/conversations/search?q=${encodeURIComponent(query)}&limit=50`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    }
  };

  const handleClearSearch = () => {
    setSearchResults(null);
  };

  const handleSendMessage = async (content: string) => {
    if (!selectedConversation) return;

    try {
      const response = await fetch(`/api/conversations/${selectedConversation.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'human', content })
      });

      if (!response.ok) throw new Error('Failed to send message');

      // Refresh conversation to get new messages (including AI response via WebSocket)
      await fetchConversationDetail(selectedConversation.id);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleResolve = async () => {
    if (!selectedConversation) return;

    try {
      const response = await fetch(`/api/conversations/${selectedConversation.id}/resolve`, {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to resolve conversation');

      // Refetch conversation and thread list
      await Promise.all([
        fetchConversationDetail(selectedConversation.id),
        fetchGroupedConversations()
      ]);
    } catch (error) {
      console.error('Error resolving conversation:', error);
    }
  };

  const handleReopen = async () => {
    if (!selectedConversation) return;

    try {
      const response = await fetch(`/api/conversations/${selectedConversation.id}/reopen`, {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to reopen conversation');

      // Refetch conversation and thread list
      await Promise.all([
        fetchConversationDetail(selectedConversation.id),
        fetchGroupedConversations()
      ]);
    } catch (error) {
      console.error('Error reopening conversation:', error);
    }
  };

  const handleTogglePanel = () => {
    setPanelCollapsed(!panelCollapsed);
  };

  const handleBack = () => {
    setSelectedId(null);
    setSelectedConversation(null);
    setMessages([]);
  };

  const handleNewThread = async () => {
    if (!newThreadTitle.trim()) return;

    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newThreadTitle })
      });

      if (!response.ok) throw new Error('Failed to create conversation');

      const data = await response.json();

      // Close dialog and reset
      setNewThreadDialogOpen(false);
      setNewThreadTitle('');

      // Refresh thread list and select the new thread
      await fetchGroupedConversations();
      handleSelectThread(data.conversation.id);
    } catch (error) {
      console.error('Error creating conversation:', error);
    }
  };

  const layoutClasses = [
    'conversation-layout',
    panelCollapsed && 'thread-panel-collapsed',
    selectedId && 'thread-selected'
  ].filter(Boolean).join(' ');

  return (
    <div className="page-container">
      {/* Page Header with New Thread Button */}
      <div className="page-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        padding: '0 16px'
      }}>
        <h1 style={{ margin: 0 }}>Conversations</h1>
        <button
          className="btn btn-primary"
          onClick={() => setNewThreadDialogOpen(true)}
          style={{
            padding: '8px 16px',
            background: 'var(--blue)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500
          }}
        >
          + New Thread
        </button>
      </div>

      {/* Two-column layout */}
      <div className={layoutClasses}>
        <ThreadListPanel
          threads={threads}
          periods={periods}
          selectedId={selectedId}
          selectedPeriod={selectedPeriod}
          onSelectThread={handleSelectThread}
          onPeriodChange={handlePeriodChange}
          onSearch={handleSearch}
          onClearSearch={handleClearSearch}
          searchResults={searchResults}
          accentColor="var(--blue)"
          searchPlaceholder="Search conversations..."
          emptyMessage="No conversations yet"
        />

        <ThreadDetailPanel
          conversation={selectedConversation}
          messages={messages}
          loading={loading}
          onSendMessage={handleSendMessage}
          onResolve={handleResolve}
          onReopen={handleReopen}
          onTogglePanel={handleTogglePanel}
          onBack={handleBack}
          inputPlaceholder="Type your message..."
          draftKeyPrefix="conversation"
        />
      </div>

      {/* New Thread Dialog */}
      {newThreadDialogOpen && (
        <div
          className="dialog-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setNewThreadDialogOpen(false)}
        >
          <div
            className="dialog"
            style={{
              background: 'var(--bg-secondary)',
              padding: '24px',
              borderRadius: '8px',
              minWidth: '400px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px' }}>
              New Conversation
            </h2>
            <input
              type="text"
              className="input"
              placeholder="Thread title..."
              value={newThreadTitle}
              onChange={(e) => setNewThreadTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewThread();
                if (e.key === 'Escape') setNewThreadDialogOpen(false);
              }}
              autoFocus
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text)',
                fontSize: '14px',
                marginBottom: '16px'
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setNewThreadDialogOpen(false)}
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: 'var(--text)'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleNewThread}
                disabled={!newThreadTitle.trim()}
                style={{
                  padding: '8px 16px',
                  background: newThreadTitle.trim() ? 'var(--blue)' : 'var(--bg-disabled)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: newThreadTitle.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
