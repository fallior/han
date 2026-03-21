import { useEffect, useRef, useState } from 'react';
import type { ConversationThread, Message } from '../../types';
import { formatRelativeTime, renderMarkdown } from '../../utils';

interface ThreadDetailPanelProps {
  conversation: ConversationThread | null;
  messages: Message[];
  loading: boolean;
  onSendMessage: (content: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onTogglePanel: () => void;
  onBack: () => void;
  inputPlaceholder?: string;
  draftKeyPrefix?: string; // 'conversation' or 'memory'
}

export function ThreadDetailPanel({
  conversation,
  messages,
  loading,
  onSendMessage,
  onResolve,
  onReopen,
  onTogglePanel,
  onBack,
  inputPlaceholder = 'Type your message...',
  draftKeyPrefix = 'conversation'
}: ThreadDetailPanelProps) {
  const [messageInput, setMessageInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [draftRecovered, setDraftRecovered] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Draft key based on conversation ID
  const draftKey = conversation ? `draft-${draftKeyPrefix}-${conversation.id}` : null;

  // Load draft on conversation change
  useEffect(() => {
    if (!conversation || !draftKey) {
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
  }, [conversation?.id, draftKey]);

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // Clear thinking indicator when new messages arrive
  useEffect(() => {
    if (messages.length > 0 && thinking) {
      setThinking(false);
    }
  }, [messages.length]);

  const handleSend = () => {
    const content = messageInput.trim();
    if (!content || !conversation) return;

    onSendMessage(content);
    setMessageInput('');
    setDraftRecovered(false);
    if (draftKey) {
      localStorage.removeItem(draftKey);
    }
    setThinking(true);

    // Focus textarea after sending
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const getRoleLabel = (role: string): string => {
    if (role === 'human') return 'Darron';
    if (role === 'supervisor') return 'Jim';
    if (role === 'leo') return 'Leo';
    return role;
  };

  const getRoleClass = (role: string): string => {
    if (role === 'human') return 'human';
    if (role === 'supervisor') return 'supervisor';
    if (role === 'leo') return 'leo';
    return '';
  };

  // Empty state - no conversation selected
  if (!conversation) {
    return (
      <div className="thread-detail-panel empty">
        <div className="panel-header">
          <button className="toggle-btn" onClick={onTogglePanel} aria-label="Toggle panel">
            ✕
          </button>
        </div>
        <div className="empty-state">
          <p>Select a thread to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-detail-panel">
      <div className="panel-header">
        <button className="toggle-btn" onClick={onTogglePanel} aria-label="Toggle panel">
          ✕
        </button>
        <button className="back-btn mobile-only" onClick={onBack} aria-label="Back to list">
          ← Back
        </button>
        <div className="thread-info">
          <h2>{conversation.title}</h2>
          <span className="thread-meta">
            Created {formatRelativeTime(conversation.created_at)}
          </span>
        </div>
        <button
          className={`status-btn ${conversation.status}`}
          onClick={conversation.status === 'open' ? onResolve : onReopen}
        >
          {conversation.status === 'open' ? 'Resolve' : 'Reopen'}
        </button>
      </div>

      <div className="messages-container">
        {loading && messages.length === 0 ? (
          <div className="loading-state">
            <p>Loading messages...</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className={`message-bubble ${getRoleClass(msg.role)}`}>
                <div className="message-header">
                  <span className="message-role">{getRoleLabel(msg.role)}</span>
                  <span className="message-time">{formatRelativeTime(msg.created_at)}</span>
                </div>
                <div
                  className="message-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              </div>
            ))}
            {thinking && (
              <div className="message-bubble supervisor thinking">
                <div className="message-header">
                  <span className="message-role">Jim</span>
                </div>
                <div className="message-content">
                  <em>Thinking...</em>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="message-input-area">
        <textarea
          ref={textareaRef}
          className={draftRecovered ? 'draft-recovered' : ''}
          value={messageInput}
          onChange={(e) => {
            setMessageInput(e.target.value);
            if (draftRecovered) setDraftRecovered(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder={draftRecovered ? 'Draft recovered' : inputPlaceholder}
          rows={3}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!messageInput.trim() || thinking}
        >
          Send
        </button>
      </div>
    </div>
  );
}
