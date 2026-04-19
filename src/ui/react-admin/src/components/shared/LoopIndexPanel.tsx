/**
 * LoopIndexPanel — Full-screen scrollable loop index for voice playback
 * Phase 1b, S127. Bottom-stacked (newest at bottom, like chat).
 * Checkbox multi-select, inline tag editing, play controls.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../api';
import { timeSince } from '../../utils';

interface Loop {
  id: string;
  conversation_id: string;
  loop_number: number;
  human_message_id: string;
  tag: string | null;
  message_count: number;
  unlistened_count: number;
  all_listened: boolean;
  created_at: string;
}

interface LoopIndexPanelProps {
  conversationId: string;
  conversationTitle: string;
  onClose: () => void;
  onPlayMessages: (messageIds: string[]) => void;
  onScrollToMessage: (messageId: string) => void;
}

export function LoopIndexPanel({
  conversationId,
  conversationTitle,
  onClose,
  onPlayMessages,
  onScrollToMessage,
}: LoopIndexPanelProps) {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const lastShiftClickRef = useRef<number | null>(null);

  // Load loops
  const loadLoops = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/voice/loops/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setLoops(data.loops || []);
      }
    } catch { /* best effort */ }
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    loadLoops();
  }, [loadLoops]);

  // Scroll to bottom on load (newest at bottom)
  useEffect(() => {
    if (!loading && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [loading, loops.length]);

  // Toggle selection
  const toggleSelect = (loopId: string, idx: number, shiftKey: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);

      if (shiftKey && lastShiftClickRef.current !== null) {
        // Range select
        const start = Math.min(lastShiftClickRef.current, idx);
        const end = Math.max(lastShiftClickRef.current, idx);
        for (let i = start; i <= end; i++) {
          next.add(loops[i].id);
        }
      } else {
        if (next.has(loopId)) {
          next.delete(loopId);
        } else {
          next.add(loopId);
        }
      }

      lastShiftClickRef.current = idx;
      return next;
    });
  };

  // Play selected loops
  const playSelected = async () => {
    const selectedLoops = loops.filter(l => selected.has(l.id));
    if (selectedLoops.length === 0) return;

    const allMessages: string[] = [];
    for (const loop of selectedLoops) {
      try {
        const res = await apiFetch(`/api/voice/loops/${conversationId}/${loop.id}/messages`);
        if (res.ok) {
          const data = await res.json();
          allMessages.push(...(data.messages || []).map((m: any) => m.id));
        }
      } catch { /* skip */ }
    }

    if (allMessages.length > 0) {
      onPlayMessages(allMessages);
      onClose();
    }
  };

  // Play all unread
  const playAllUnread = async () => {
    const unreadLoops = loops.filter(l => !l.all_listened && l.message_count > 0);
    if (unreadLoops.length === 0) return;

    const allMessages: string[] = [];
    for (const loop of unreadLoops) {
      try {
        const res = await apiFetch(`/api/voice/loops/${conversationId}/${loop.id}/messages`);
        if (res.ok) {
          const data = await res.json();
          const unread = (data.messages || []).filter((m: any) => (m.listen_count || 0) === 0);
          allMessages.push(...unread.map((m: any) => m.id));
        }
      } catch { /* skip */ }
    }

    if (allMessages.length > 0) {
      onPlayMessages(allMessages);
      onClose();
    }
  };

  // Play range (contiguous selection from first to last selected)
  const playRange = async () => {
    if (selected.size < 2) return;
    const selectedIndices = loops
      .map((l, idx) => selected.has(l.id) ? idx : -1)
      .filter(i => i >= 0);
    const minIdx = Math.min(...selectedIndices);
    const maxIdx = Math.max(...selectedIndices);
    const rangeLoops = loops.slice(minIdx, maxIdx + 1);

    const allMessages: string[] = [];
    for (const loop of rangeLoops) {
      try {
        const res = await apiFetch(`/api/voice/loops/${conversationId}/${loop.id}/messages`);
        if (res.ok) {
          const data = await res.json();
          allMessages.push(...(data.messages || []).map((m: any) => m.id));
        }
      } catch { /* skip */ }
    }

    if (allMessages.length > 0) {
      onPlayMessages(allMessages);
      onClose();
    }
  };

  // Inline tag edit
  const startEditTag = (loop: Loop) => {
    setEditingTag(loop.id);
    setEditTagValue(loop.tag || '');
  };

  const saveTag = async (loopId: string) => {
    try {
      await apiFetch(`/api/voice/loops/${loopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: editTagValue })
      });
      setLoops(prev => prev.map(l =>
        l.id === loopId ? { ...l, tag: editTagValue } : l
      ));
    } catch { /* best effort */ }
    setEditingTag(null);
  };

  // Play a single loop
  const playSingleLoop = async (loop: Loop) => {
    try {
      const res = await apiFetch(`/api/voice/loops/${conversationId}/${loop.id}/messages`);
      if (res.ok) {
        const data = await res.json();
        const msgIds = (data.messages || []).map((m: any) => m.id);
        if (msgIds.length > 0) {
          onPlayMessages(msgIds);
          onClose();
        }
      }
    } catch { /* skip */ }
  };

  const totalUnread = loops.reduce((sum, l) => sum + l.unlistened_count, 0);

  return (
    <div className="loop-index-overlay">
      <div className="loop-index-panel">
        <div className="loop-index-header">
          <h3>Loop Index</h3>
          <span className="loop-index-meta">{conversationTitle} · {loops.length} loops</span>
          <button className="loop-index-close" onClick={onClose}>✕</button>
        </div>

        <div className="loop-index-list" ref={listRef}>
          {loading ? (
            <div className="loop-index-loading">Loading loops...</div>
          ) : loops.length === 0 ? (
            <div className="loop-index-empty">No loops yet — post a message to start one</div>
          ) : (
            loops.map((loop, idx) => (
              <div
                key={loop.id}
                className={`loop-index-row${selected.has(loop.id) ? ' selected' : ''}${!loop.all_listened && loop.message_count > 0 ? ' has-unread' : ''}`}
              >
                <input
                  type="checkbox"
                  className="loop-checkbox"
                  checked={selected.has(loop.id)}
                  onChange={(e) => toggleSelect(loop.id, idx, (e.nativeEvent as MouseEvent).shiftKey)}
                />
                <span className="loop-number">#{loop.loop_number}</span>
                <span
                  className="loop-status"
                  title={loop.all_listened ? 'All listened' : `${loop.unlistened_count} unlistened`}
                >
                  {loop.message_count === 0 ? '○' : loop.all_listened ? '●' : '◐'}
                </span>
                <span className="loop-time">{timeSince(loop.created_at)}</span>
                {editingTag === loop.id ? (
                  <input
                    className="loop-tag-edit"
                    value={editTagValue}
                    onChange={(e) => setEditTagValue(e.target.value)}
                    onBlur={() => saveTag(loop.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTag(loop.id); if (e.key === 'Escape') setEditingTag(null); }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="loop-tag"
                    onClick={() => startEditTag(loop)}
                    title="Click to edit tag"
                  >
                    {loop.tag || '(untagged)'}
                  </span>
                )}
                <span className="loop-msg-count">{loop.message_count} msg{loop.message_count !== 1 ? 's' : ''}</span>
                <button
                  className="loop-play-btn"
                  onClick={() => playSingleLoop(loop)}
                  title="Play this loop"
                  disabled={loop.message_count === 0}
                >
                  ▶
                </button>
                <button
                  className="loop-nav-btn"
                  onClick={() => { onScrollToMessage(loop.human_message_id); onClose(); }}
                  title="Go to this loop in conversation"
                >
                  ↗
                </button>
              </div>
            ))
          )}
        </div>

        <div className="loop-index-actions">
          <button
            onClick={playSelected}
            disabled={selected.size === 0}
            className="loop-action-btn"
          >
            Play Selected ({selected.size})
          </button>
          <button
            onClick={playAllUnread}
            disabled={totalUnread === 0}
            className="loop-action-btn primary"
          >
            Play All Unread ({totalUnread})
          </button>
          <button
            onClick={playRange}
            disabled={selected.size < 2}
            className="loop-action-btn"
            title="Play all loops between the first and last selected"
          >
            Play Range
          </button>
        </div>
      </div>
    </div>
  );
}
