import { useEffect, useRef, useState, useCallback } from 'react';
import type { ConversationThread, Message } from '../../types';
import { timeSince, renderMarkdown } from '../../utils';
import { apiFetch } from '../../api';
import { useVoice } from '../../hooks/useVoice';
import { LoopIndexPanel } from './LoopIndexPanel';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

  const [loopIndexOpen, setLoopIndexOpen] = useState(false);
  const [autoVoice, setAutoVoice] = useState(true);

  // Load auto-voice setting on mount
  useEffect(() => {
    apiFetch('/api/voice/config').then(r => r.json()).then(d => {
      setAutoVoice(d.autoGenerateVoice !== false);
    }).catch(() => {});
  }, []);

  const {
    isRecording, isTranscribing, toggleRecording,
    playbackState, currentMessageId, queuePosition, queueLength,
    speakMessage, speakUnread, pausePlayback, resumePlayback, escapePlayback, skipMessage,
    playbackSpeed, cycleSpeed, currentTime, duration, seekTo, skipAhead, skipBack
  } = useVoice();

  // Play specific messages by ID (used by loop index)
  const playMessagesByIds = useCallback((msgIds: string[]) => {
    const msgsToPlay = messages.filter(m => msgIds.includes(m.id));
    if (msgsToPlay.length > 0) {
      speakUnread(msgsToPlay);
    }
  }, [messages, speakUnread]);

  // Scroll to a specific message
  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Play the most recent loop (TTM single-press behaviour)
  const playMostRecentLoop = useCallback(async () => {
    if (!conversation) return;
    try {
      const res = await apiFetch(`/api/voice/loops/${conversation.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const loops = data.loops || [];
      if (loops.length === 0) return;

      // Get the most recent loop (last in array — highest loop_number)
      const latestLoop = loops[loops.length - 1];

      // Fetch its messages
      const msgRes = await apiFetch(`/api/voice/loops/${conversation.id}/${latestLoop.id}/messages`);
      if (!msgRes.ok) return;
      const msgData = await msgRes.json();
      const loopMessages = msgData.messages || [];
      if (loopMessages.length === 0) return;

      // Play them using the queue — match against loaded messages for full Message objects
      const msgIds = loopMessages.map((m: any) => m.id);
      const toPlay = messages.filter(m => msgIds.includes(m.id));
      if (toPlay.length > 0) {
        speakUnread(toPlay);
      }
    } catch { /* best effort */ }
  }, [conversation, messages, speakUnread]);

  // Toggle auto-voice generation
  const toggleAutoVoice = useCallback(async () => {
    const newValue = !autoVoice;
    setAutoVoice(newValue);
    try {
      await apiFetch('/api/voice/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoGenerateVoice: newValue })
      });
    } catch { setAutoVoice(!newValue); /* revert on failure */ }
  }, [autoVoice]);

  // playLoops still used by TTM single-press (plays most recent loop)

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

  const handlePTS = async () => {
    const text = await toggleRecording();
    if (text) {
      setMessageInput(prev => prev ? prev + ' ' + text : text);
      textareaRef.current?.focus();
    }
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
            Created {timeSince(conversation.created_at)}
          </span>
        </div>
        <div className="ttm-button-group">
          <button
            className={`auto-voice-toggle${autoVoice ? ' active' : ''}`}
            onClick={toggleAutoVoice}
            title={autoVoice ? 'Auto-voice ON — new messages generate TTS automatically' : 'Auto-voice OFF — TTS generated on demand only'}
          >
            {autoVoice ? '🔊' : '🔇'}
          </button>
          <button
            className="thread-ttm-btn"
            onClick={() => {
              if (playbackState === 'playing') { pausePlayback(); }
              else if (playbackState === 'paused') { resumePlayback(); }
              else if (playbackState !== 'loading') { playMostRecentLoop(); }
            }}
            disabled={playbackState === 'loading'}
            title="Play most recent loop (TTM)"
          >
            {playbackState === 'idle' ? '🔊 TTM' : playbackState === 'loading' ? '⏳ Loading...' : playbackState === 'playing' ? '⏸ Pause' : '▶ Resume'}
          </button>
          <button
            className="ttm-index-btn"
            onClick={() => setLoopIndexOpen(true)}
            title="Open Loop Index"
          >
            ☰
          </button>
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
            {messages.map((msg, idx) => (
              <div key={msg.id}>
              {msg.role === 'human' && idx > 0 && (
                <div className="loop-boundary-marker">
                  <span className="loop-boundary-line" />
                </div>
              )}
              <div data-message-id={msg.id} className={`message-bubble ${getRoleClass(msg.role)}${currentMessageId === msg.id ? ' speaking' : ''}`}>
                <div className="message-header">
                  <span className="message-role">{getRoleLabel(msg.role)}</span>
                  <span className="message-time">{timeSince(msg.created_at)}</span>
                  <button
                    className={`ttm-btn${currentMessageId === msg.id ? ' playing' : ''}`}
                    onClick={() => speakMessage(msg)}
                    disabled={playbackState === 'loading' && currentMessageId === msg.id}
                    title="Talk to Me"
                  >
                    {currentMessageId === msg.id && playbackState === 'loading' ? '⏳' : currentMessageId === msg.id ? '⏹' : '🔈'}
                  </button>
                  {(msg.listen_count || 0) === 0 && msg.role !== 'human' && (
                    <span className="listen-badge unread" title="Not yet listened">●</span>
                  )}
                </div>
                <div
                  className="message-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              </div>
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

      {playbackState !== 'idle' && (
        <div className="playback-bar">
          <div className="playback-controls">
            <button onClick={playbackState === 'playing' ? pausePlayback : resumePlayback} disabled={playbackState === 'loading'}>
              {playbackState === 'loading' ? '⏳' : playbackState === 'playing' ? '⏸' : '▶'}
            </button>
            <button onClick={() => skipBack(15)} title="Back 15s" disabled={playbackState === 'loading'}>⏪</button>
            <span className="now-playing">
              {playbackState === 'loading' ? 'Loading...' : `${queuePosition + 1} of ${queueLength}`}
            </span>
            <button onClick={() => skipAhead(15)} title="Forward 15s" disabled={playbackState === 'loading'}>⏩</button>
            <button onClick={skipMessage} title="Next message">⏭</button>
            <button onClick={cycleSpeed} className="speed-btn" title="Playback speed">{playbackSpeed}x</button>
            <button onClick={escapePlayback} title="Stop">✕</button>
          </div>
          {duration > 0 && (
            <div className="playback-scrubber">
              <span className="playback-time">{formatTime(currentTime)}</span>
              <input
                type="range"
                className="scrubber-range"
                min={0}
                max={duration || 0}
                step={0.5}
                value={currentTime}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
              />
              <span className="playback-time">{formatTime(duration)}</span>
            </div>
          )}
        </div>
      )}

      <div className="message-input-area">
        <button
          className={`pts-btn${isRecording ? ' recording' : ''}${isTranscribing ? ' transcribing' : ''}`}
          onClick={handlePTS}
          disabled={isTranscribing}
          title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Press to Start (PTS)'}
        >
          {isTranscribing ? '...' : isRecording ? '⏹' : '🎤'}
        </button>
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

      {loopIndexOpen && conversation && (
        <LoopIndexPanel
          conversationId={conversation.id}
          conversationTitle={conversation.title}
          onClose={() => setLoopIndexOpen(false)}
          onPlayMessages={playMessagesByIds}
          onScrollToMessage={scrollToMessage}
        />
      )}
    </div>
  );
}
