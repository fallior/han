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

  // Auto-scroll to bottom only when NEW messages arrive (not on every poll/refetch)
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    const count = currentThread?.messages?.length || 0;
    if (count > prevMessageCountRef.current) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
    prevMessageCountRef.current = count;
  }, [currentThread?.messages?.length]);

  // WebSocket: Listen for new messages and add them to current thread
  useEffect(() => {
    if (!threadId) return;

    const unsubMessage = subscribeWs('conversation_message', (data: any) => {
      // Only handle messages for the currently viewed thread
      if (String(data.conversation_id) === String(threadId) && data.message) {
        // Add message to current thread — thinking indicators disappear
        // automatically because respondents is derived from whether the
        // last message is human (React state, not DOM manipulation)
        addMessageToCurrentThread(data.message);
      }
    });

    // On WS reconnect, refetch the current thread to catch messages missed during disconnect
    const unsubReconnect = subscribeWs('ws_reconnected', async () => {
      try {
        const thread = await fetchThread(threadId as string);
        setCurrentThread(thread);
      } catch (err) {
        console.error('Failed to refetch thread on reconnect:', err);
      }
    });

    // Polling fallback — if WebSocket misses a broadcast (silent disconnect,
    // IPC failure, etc.), the poll catches it. Compares message count to avoid
    // unnecessary re-renders when nothing changed.
    const pollInterval = setInterval(async () => {
      try {
        const thread = await fetchThread(threadId as string);
        if (thread && currentThread &&
            thread.messages.length !== currentThread.messages.length) {
          setCurrentThread(thread);
        }
      } catch { /* silent — poll is best-effort */ }
    }, 15000); // 15 seconds

    return () => {
      unsubMessage();
      unsubReconnect();
      clearInterval(pollInterval);
    };
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

  // Determine if thinking indicator should show and who's thinking
  const lastMessageIsHuman =
    currentThread?.messages &&
    currentThread.messages.length > 0 &&
    currentThread.messages[currentThread.messages.length - 1]?.role === 'human';

  // Who's expected to respond based on discussion type
  const respondents = (() => {
    if (!lastMessageIsHuman || !nestedTab) return [];
    const isJimTab = nestedTab === 'jim-request' || nestedTab === 'jim-report';
    const isLeoTab = nestedTab === 'leo-question' || nestedTab === 'leo-postulate';
    const isDarronTab = nestedTab === 'darron-thought' || nestedTab === 'darron-musing';
    // Darron tabs and general always wake both
    if (isDarronTab || (!isJimTab && !isLeoTab)) return ['jim', 'leo'];
    if (isJimTab) return ['jim'];
    if (isLeoTab) return ['leo'];
    return ['jim', 'leo'];
  })();

  // Empty state - no thread selected
  if (!threadId) {
    return (
      <div className="workshop-thread-detail" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-card)' }}>
        <div className="thread-header" style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onTogglePanel}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--text)',
              fontSize: '14px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            title="Toggle thread list"
          >
            ☰
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '14px' }}>
          Select a thread to view
        </div>
      </div>
    );
  }

  // Loading state
  if (loading || !currentThread) {
    return (
      <div className="workshop-thread-detail" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-card)' }}>
        <div className="thread-header" style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onTogglePanel}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--text)',
              fontSize: '14px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            title="Toggle thread list"
          >
            ☰
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '14px' }}>
          Loading thread...
        </div>
      </div>
    );
  }

  return (
    <div className="workshop-thread-detail" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-card)' }}>
      {/* Thread header */}
      <div className="thread-header" style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Toggle button */}
        <button
          onClick={onTogglePanel}
          style={{
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            color: 'var(--text)',
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
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            color: 'var(--text)',
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
                  border: '1px solid var(--blue)',
                  backgroundColor: 'var(--bg-page)',
                  color: 'var(--text)',
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
                  border: '1px solid var(--blue)',
                  backgroundColor: 'var(--blue)',
                  color: '#fff',
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
                  border: '1px solid var(--border)',
                  backgroundColor: 'transparent',
                  color: 'var(--text)',
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
                    border: '1px solid var(--border)',
                    backgroundColor: 'transparent',
                    color: 'var(--text)',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                  title="Edit title"
                >
                  ✎
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
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
              border: '1px solid var(--border)',
              backgroundColor: currentThread.status === 'open' ? 'var(--green)' : 'var(--amber)',
              color: 'var(--bg-page)',
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
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--text)',
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
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
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
            {/* Thinking indicators — one per expected respondent */}
            {respondents.map((agent) => (
              <div
                key={`thinking-${agent}`}
                style={{
                  opacity: 0.5,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  borderLeft: `3px solid ${agent === 'leo' ? 'var(--green)' : 'var(--purple, #a855f7)'}`,
                  backgroundColor: 'var(--bg-page)',
                  maxWidth: '80%',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: agent === 'leo' ? 'var(--green)' : 'var(--purple, #a855f7)', marginBottom: '0.25rem', fontWeight: 500 }}>
                  {agent === 'leo' ? 'Leo' : 'Jim'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  Thinking...
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Message input area */}
      <div className="message-input-area" style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
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
            border: draftRecovered ? '2px solid var(--amber)' : '1px solid var(--border)',
            backgroundColor: 'var(--bg-page)',
            color: 'var(--text)',
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
            backgroundColor: messageInput.trim() ? 'var(--blue)' : 'var(--bg-card-hover)',
            color: messageInput.trim() ? '#fff' : 'var(--text-dim)',
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
