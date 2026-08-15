import { useEffect, useRef, useState, useCallback } from 'react';
import type { ConversationThread, Message } from '../../types';
import { timeSince, renderMarkdown } from '../../utils';
import { useStore } from '../../store';
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
  // MNT-035 fix (S226, option B): optimistic OWN message instead of the false
  // Jim-thinking bubble — the only thing known at send-time is the sender's
  // post; no respondent is named until Jemma classifies (roster-true indicators = C,
  // the Ring-2 rider). `pending` holds the just-sent content until the server echo.
  const [pending, setPending] = useState<string | null>(null);
  const [draftRecovered, setDraftRecovered] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [loopIndexOpen, setLoopIndexOpen] = useState(false);
  const [autoVoice, setAutoVoice] = useState(true);

  // B5 (catch-me-up v2.1): optimistic overrides for the owner's read-state toggle —
  // messages come from props, so local overrides carry the toggled value until the
  // parent's next refetch reconciles. Keyed by message id → effective listen_count.
  const [listenOverrides, setListenOverrides] = useState<Record<string, number>>({});
  const effectiveListenCount = (msg: Message): number =>
    listenOverrides[msg.id] ?? (msg.listen_count || 0);

  const toggleReadState = useCallback(async (msg: Message) => {
    const currentlyRead = effectiveListenCount(msg) > 0;
    const target = !currentlyRead;
    // Optimistic flip; server response reconciles below.
    setListenOverrides(prev => ({ ...prev, [msg.id]: target ? 1 : 0 }));
    try {
      const res = await apiFetch(`/api/voice/read-state/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: target })
      });
      if (res.ok) {
        const data = await res.json();
        setListenOverrides(prev => ({ ...prev, [msg.id]: data.listen_count || 0 }));
      } else {
        setListenOverrides(prev => ({ ...prev, [msg.id]: msg.listen_count || 0 }));
      }
    } catch {
      setListenOverrides(prev => ({ ...prev, [msg.id]: msg.listen_count || 0 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenOverrides]);

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

  // Play specific messages by ID (used by loop index). B5: apply the local
  // read-state overrides so a just-toggled-unread post is picked up before the
  // parent's refetch (speakUnread filters on listen_count internally).
  const playMessagesByIds = useCallback((msgIds: string[]) => {
    const msgsToPlay = messages
      .filter(m => msgIds.includes(m.id))
      .map(m => ({ ...m, listen_count: listenOverrides[m.id] ?? m.listen_count }));
    if (msgsToPlay.length > 0) {
      speakUnread(msgsToPlay);
    }
  }, [messages, speakUnread, listenOverrides]);

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
  }, [messages, pending]);

  // Clear the pending optimistic message when the server echo arrives
  useEffect(() => {
    if (messages.length > 0 && pending) {
      setPending(null);
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
    setPending(content);

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

  // Ring 2 (H3, the gardener class): the human's label derives from the persona
  // registry (kind 'human' → capitalised name) — the literal 'Darron' made every
  // garden's human render as Darron (Casey's scour). Agent-role ladder cleanup =
  // deferred S4 (needs conversation_role on the personas API).
  const roleMap = useStore((st: any) => st.roleMap ?? {});
  const gardenerLabel = roleMap.human?.label ?? 'Human';
  const getRoleLabel = (role: string): string => {
    if (role === 'human') return gardenerLabel;
    if (role === 'supervisor') return 'Jim';
    if (role === 'leo') return 'Leo';
    if (role === 'casey') return 'Casey';
    if (role === 'tenshi') return 'Tenshi';
    return role;
  };

  const getRoleClass = (role: string): string => {
    if (role === 'human') return 'human';
    if (role === 'supervisor') return 'supervisor';
    if (role === 'leo') return 'leo';
    if (role === 'casey') return 'casey';
    if (role === 'tenshi') return 'tenshi';
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
                  {msg.role !== 'human' && (
                    // B5: the owner's read-state toggle — "just like email". The badge
                    // is now a button: ● unheard (click to mark heard), ○ heard (click
                    // to mark unheard — re-enters play-all-unread).
                    <button
                      className={`listen-badge${effectiveListenCount(msg) === 0 ? ' unread' : ' read'}`}
                      onClick={() => toggleReadState(msg)}
                      title={effectiveListenCount(msg) === 0
                        ? 'Not yet listened — click to mark heard'
                        : 'Heard — click to mark unheard'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
                    >
                      {effectiveListenCount(msg) === 0 ? '●' : '○'}
                    </button>
                  )}
                </div>
                <div
                  className="message-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              </div>
              </div>
            ))}
            {pending && (
              <div className="message-bubble human pending" style={{ opacity: 0.6 }}>
                <div className="message-header">
                  <span className="message-role">{getRoleLabel('human')}</span>
                  <span className="message-time">sending…</span>
                </div>
                <div
                  className="message-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(pending) }}
                />
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
          disabled={!messageInput.trim() || !!pending}
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
