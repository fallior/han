import { useEffect, useRef, useState } from 'react';
import { useWorkshopStore } from '../../store/workshopStore';
import { useStore } from '../../store';
import { MessageBubble } from '../shared/MessageBubble';
import {
  fetchThread,
  postMessage,
  resolveThread,
  reopenThread,
  archiveThread,
  unarchiveThread,
  updateThreadTitle,
  fetchGroupedThreads,
} from '../../lib/api';

interface ThreadDetailProps {
  onTogglePanel: () => void;
  onBack: () => void;
}

export function ThreadDetail({ onTogglePanel, onBack }: ThreadDetailProps) {
  const {
    currentThread,
    nestedTab,
    workshopShowArchived,
    selectedThreadId,
    setCurrentThread,
    addMessageToCurrentThread,
    setThreads,
  } = useWorkshopStore();

  const subscribeWs = useStore((state) => state.subscribeWs);

  const [messageInput, setMessageInput] = useState('');
  const [draftRecovered, setDraftRecovered] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const threadId = selectedThreadId;

  // Draft key based on thread ID
  const draftKey = threadId ? `draft-workshop-${threadId}` : null;

  // Fetch thread when selectedThread changes
  useEffect(() => {
    if (!threadId) {
      setCurrentThread(null);
      return;
    }

    let cancelled = false;

    async function loadThread() {
      setLoading(true);
      try {
        const thread = await fetchThread(threadId as string);
        if (!cancelled) {
          setCurrentThread(thread);
        }
      } catch (err) {
        console.error('Failed to fetch thread:', err);
        if (!cancelled) {
          setCurrentThread(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadThread();

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Load draft on thread change
  useEffect(() => {
    if (!threadId || !draftKey) {
      setMessageInput('');
      setDraftRecovered(false);
      return;
    }

    const draft = localStorage.getItem(draftKey);
    if (draft) {
      setMessageInput(draft);
      setDraftRecovered(true);
    } else {
      setMessageInput('');
      setDraftRecovered(false);
    }
  }, [threadId, draftKey]);

  // Save draft on input change
  useEffect(() => {
    if (!draftKey) return;

    if (messageInput.trim()) {
      localStorage.setItem(draftKey, messageInput);
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [messageInput, draftKey]);

  // Auto-scroll to bottom on messages change
  useEffect(() => {
    if (currentThread?.messages) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [currentThread?.messages]);

  // WebSocket: Listen for new messages and add them to current thread
  useEffect(() => {
    if (!threadId) return;

    const unsubscribe = subscribeWs('conversation_message', (data: any) => {
      // Only handle messages for the currently viewed thread
      if (data.conversation_id === threadId && data.message) {
        // Remove thinking indicator (if exists)
        const thinkingEl = document.getElementById('workshop-thinking');
        if (thinkingEl) thinkingEl.remove();

        // Add message to current thread
        addMessageToCurrentThread(data.message);
      }
    });

    return unsubscribe;
  }, [threadId, addMessageToCurrentThread, subscribeWs]);

  const handleSend = async () => {
    const content = messageInput.trim();
    if (!content || !threadId) return;

    try {
      // Send message
      await postMessage(threadId, content, 'human');

      // Clear input and draft
      setMessageInput('');
      setDraftRecovered(false);
      if (draftKey) {
        localStorage.removeItem(draftKey);
      }

      // Re-fetch thread to get the new message
      const updatedThread = await fetchThread(threadId);
      setCurrentThread(updatedThread);

      // Refresh thread list to update last message preview
      const threads = await fetchGroupedThreads(nestedTab, workshopShowArchived);
      setThreads(nestedTab, threads);

      // Focus textarea
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    } catch (err) {
      console.error('Failed to send message:', err);
      alert('Failed to send message. Please try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleResolveToggle = async () => {
    if (!threadId || !currentThread) return;

    try {
      if (currentThread.status === 'open') {
        await resolveThread(threadId);
      } else {
        await reopenThread(threadId);
      }

      // Re-fetch thread
      const updatedThread = await fetchThread(threadId);
      setCurrentThread(updatedThread);

      // Refresh thread list
      const threads = await fetchGroupedThreads(nestedTab, workshopShowArchived);
      setThreads(nestedTab, threads);
    } catch (err) {
      console.error('Failed to toggle thread status:', err);
      alert('Failed to update thread status. Please try again.');
    }
  };

  const handleArchiveToggle = async () => {
    if (!threadId || !currentThread) return;

    try {
      if (currentThread.archived) {
        await unarchiveThread(threadId);
      } else {
        await archiveThread(threadId);
      }

      // Re-fetch thread
      const updatedThread = await fetchThread(threadId);
      setCurrentThread(updatedThread);

      // Refresh thread list
      const threads = await fetchGroupedThreads(nestedTab, workshopShowArchived);
      setThreads(nestedTab, threads);
    } catch (err) {
      console.error('Failed to toggle thread archive status:', err);
      alert('Failed to archive/unarchive thread. Please try again.');
    }
  };

  const startEditingTitle = () => {
    if (!currentThread) return;
    setEditedTitle(currentThread.title);
    setEditingTitle(true);
  };

  const cancelEditingTitle = () => {
    setEditingTitle(false);
    setEditedTitle('');
  };

  const saveTitle = async () => {
    if (!threadId || !editedTitle.trim()) return;

    try {
      await updateThreadTitle(threadId, editedTitle.trim());

      // Re-fetch thread
      const updatedThread = await fetchThread(threadId);
      setCurrentThread(updatedThread);

      // Refresh thread list
      const threads = await fetchGroupedThreads(nestedTab, workshopShowArchived);
      setThreads(nestedTab, threads);

      setEditingTitle(false);
      setEditedTitle('');
    } catch (err) {
      console.error('Failed to update title:', err);
      alert('Failed to update thread title. Please try again.');
    }
  };

  // Format date as readable string (e.g., "Mar 21, 2026 at 3:45 PM")
  const formatDateTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleString('en-AU', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Determine if thinking indicator should show
  const shouldShowThinking =
    currentThread?.messages &&
    currentThread.messages.length > 0 &&
    currentThread.messages[currentThread.messages.length - 1]?.role === 'human';

  // Empty state - no thread selected
  if (!threadId) {
    return (
      <div className="workshop-thread-detail" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-card)' }}>
        <div className="thread-header" style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onTogglePanel}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'transparent',
              color: 'var(--color-fg)',
              fontSize: '14px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            title="Toggle thread list"
          >
            ☰
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted-fg)', fontSize: '14px' }}>
          Select a thread to view
        </div>
      </div>
    );
  }

  // Loading state
  if (loading || !currentThread) {
    return (
      <div className="workshop-thread-detail" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-card)' }}>
        <div className="thread-header" style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onTogglePanel}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'transparent',
              color: 'var(--color-fg)',
              fontSize: '14px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            title="Toggle thread list"
          >
            ☰
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted-fg)', fontSize: '14px' }}>
          Loading thread...
        </div>
      </div>
    );
  }

  return (
    <div className="workshop-thread-detail" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-card)' }}>
      {/* Thread header */}
      <div className="thread-header" style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Toggle button */}
        <button
          onClick={onTogglePanel}
          style={{
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1px solid var(--color-border)',
            backgroundColor: 'transparent',
            color: 'var(--color-fg)',
            fontSize: '14px',
            cursor: 'pointer',
            lineHeight: 1,
          }}
          title="Toggle thread list"
        >
          ☰
        </button>

        {/* Back button (mobile only, hidden via CSS) */}
        <button
          onClick={onBack}
          className="mobile-only"
          style={{
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1px solid var(--color-border)',
            backgroundColor: 'transparent',
            color: 'var(--color-fg)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>

        {/* Thread info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingTitle ? (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') cancelEditingTitle();
                }}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-primary)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-fg)',
                  fontSize: '15px',
                  fontWeight: 600,
                }}
                autoFocus
              />
              <button
                onClick={saveTitle}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-primary)',
                  backgroundColor: 'var(--color-primary)',
                  color: 'var(--color-primary-fg)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Save
              </button>
              <button
                onClick={cancelEditingTitle}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-fg)',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentThread.title}
                </h2>
                <button
                  onClick={startEditingTitle}
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-fg)',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                  title="Edit title"
                >
                  ✎
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-muted-fg)' }}>
                {formatDateTime(currentThread.created_at)}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={handleResolveToggle}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: currentThread.status === 'open' ? 'var(--color-success)' : 'var(--color-warning)',
              color: 'var(--color-bg)',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {currentThread.status === 'open' ? 'Resolve' : 'Reopen'}
          </button>
          <button
            onClick={handleArchiveToggle}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'transparent',
              color: 'var(--color-fg)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {currentThread.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      {/* Message list */}
      <div className="message-list" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {currentThread.messages.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-muted-fg)', fontSize: '13px' }}>
            No messages yet
          </div>
        ) : (
          <>
            {currentThread.messages.map((msg: any) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.created_at}
              />
            ))}
            {/* Thinking indicator */}
            {shouldShowThinking && (
              <div id="workshop-thinking" className="message-bubble supervisor" style={{ opacity: 0.5 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Jim
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-muted-fg)', fontStyle: 'italic' }}>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Message input area */}
      <div className="message-input-area" style={{ padding: '16px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={messageInput}
          onChange={(e) => {
            setMessageInput(e.target.value);
            if (draftRecovered) setDraftRecovered(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder={draftRecovered ? 'Draft recovered' : 'Type a message...'}
          rows={3}
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '6px',
            border: draftRecovered ? '2px solid var(--color-warning)' : '1px solid var(--color-border)',
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-fg)',
            fontSize: '13px',
            resize: 'vertical',
            minHeight: '60px',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!messageInput.trim()}
          style={{
            padding: '10px 20px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: messageInput.trim() ? 'var(--color-primary)' : 'var(--color-muted)',
            color: messageInput.trim() ? 'var(--color-primary-fg)' : 'var(--color-muted-fg)',
            fontSize: '13px',
            cursor: messageInput.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
