import { useState, useEffect, useRef } from 'react';
import { formatTimeSince } from '../../utils';
import type { ConversationThread, SearchResult } from '../../types';

interface ThreadListPanelProps {
  threads: ConversationThread[];
  periods: Record<string, { count: number; label: string; conversations: ConversationThread[] }>;
  selectedId: string | null;
  selectedPeriod: string;
  onSelectThread: (id: string) => void;
  onPeriodChange: (period: string) => void;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  searchResults: SearchResult[] | null;
  accentColor?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function ThreadListPanel({
  threads,
  periods,
  selectedId,
  selectedPeriod,
  onSelectThread,
  onPeriodChange,
  onSearch,
  onClearSearch,
  searchResults,
  accentColor = 'var(--blue)',
  searchPlaceholder = 'Search conversations...',
  emptyMessage = 'No conversations yet',
}: ThreadListPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef<number | null>(null);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.trim()) {
      searchTimeoutRef.current = window.setTimeout(() => {
        onSearch(searchQuery.trim());
      }, 300);
    } else {
      onClearSearch();
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, onSearch, onClearSearch]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    onClearSearch();
  };

  const isUnread = (thread: ConversationThread): boolean => {
    const lastRead = localStorage.getItem(`lastRead:${thread.id}`);
    if (!lastRead) return true;
    return new Date(thread.updated_at) > new Date(lastRead);
  };


  const renderThreadItem = (thread: ConversationThread) => {
    const unread = isUnread(thread);
    const isSelected = thread.id === selectedId;

    return (
      <div
        key={thread.id}
        className={`thread-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelectThread(thread.id)}
        style={{ padding: '10px 12px', cursor: 'pointer', position: 'relative' }}
      >
        {unread && <div className="unread-dot" style={{ backgroundColor: accentColor, position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: '50%' }}></div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, flex: 1, minWidth: 0 }}>{thread.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatTimeSince(thread.updated_at)}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span className={`status-badge status-${thread.status.toLowerCase()}`} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>
            {thread.status}
          </span>
          {thread.participants && (
            <span style={{ opacity: 0.7 }}>{thread.participants.split(',').map((p: string) => p.trim()).join(' · ')}</span>
          )}
          <span>{thread.message_count} msg{thread.message_count !== 1 ? 's' : ''}</span>
        </div>
      </div>
    );
  };

  const renderSearchResult = (result: SearchResult) => {
    return (
      <div
        key={result.conversation_id}
        className="search-result-card"
        onClick={() => {
          onSelectThread(result.conversation_id);
          handleClearSearch();
        }}
      >
        <div className="search-result-header">
          <div className="search-result-title">{result.conversation_title}</div>
          <span className={`status-badge status-${result.conversation_status.toLowerCase()}`}>
            {result.conversation_status}
          </span>
        </div>

        {result.matched_message && (
          <div className="search-result-message">
            <div className="search-result-role">
              {result.matched_message.role}
            </div>
            <div
              className="search-result-snippet"
              dangerouslySetInnerHTML={{ __html: result.matched_message.snippet }}
            />
            <div className="search-result-time">
              {formatTimeSince(result.matched_message.created_at)}
            </div>
          </div>
        )}

        <div className="search-result-created">
          Thread created {formatTimeSince(result.created_at)}
        </div>
      </div>
    );
  };

  // Calculate period counts
  const periodCounts: Record<string, number> = {};
  Object.entries(periods).forEach(([key, value]) => {
    periodCounts[key] = value.count;
  });

  // Get current list to display
  const currentList = selectedPeriod === 'all'
    ? threads
    : (periods[selectedPeriod]?.conversations || []);

  return (
    <div className="thread-list-panel">
      {/* Period Filter Bar */}
      <div className="period-filter-bar">
        <button
          className={`period-btn ${selectedPeriod === 'all' ? 'active' : ''}`}
          onClick={() => onPeriodChange('all')}
          style={selectedPeriod === 'all' ? { backgroundColor: accentColor } : undefined}
        >
          All ({threads.length})
        </button>
        <button
          className={`period-btn ${selectedPeriod === 'today' ? 'active' : ''}`}
          onClick={() => onPeriodChange('today')}
          style={selectedPeriod === 'today' ? { backgroundColor: accentColor } : undefined}
        >
          Today ({periodCounts['today'] || 0})
        </button>
        <button
          className={`period-btn ${selectedPeriod === 'this_week' ? 'active' : ''}`}
          onClick={() => onPeriodChange('this_week')}
          style={selectedPeriod === 'this_week' ? { backgroundColor: accentColor } : undefined}
        >
          This Week ({periodCounts['this_week'] || 0})
        </button>
        <button
          className={`period-btn ${selectedPeriod === 'last_week' ? 'active' : ''}`}
          onClick={() => onPeriodChange('last_week')}
          style={selectedPeriod === 'last_week' ? { backgroundColor: accentColor } : undefined}
        >
          Last Week ({periodCounts['last_week'] || 0})
        </button>
        <button
          className={`period-btn ${selectedPeriod === 'this_month' ? 'active' : ''}`}
          onClick={() => onPeriodChange('this_month')}
          style={selectedPeriod === 'this_month' ? { backgroundColor: accentColor } : undefined}
        >
          This Month ({periodCounts['this_month'] || 0})
        </button>
        <button
          className={`period-btn ${selectedPeriod === 'older' ? 'active' : ''}`}
          onClick={() => onPeriodChange('older')}
          style={selectedPeriod === 'older' ? { backgroundColor: accentColor } : undefined}
        >
          Older ({periodCounts['older'] || 0})
        </button>
      </div>

      {/* Search Input */}
      <div className="search-box">
        <input
          type="text"
          className="search-input"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={handleSearchChange}
        />
        {searchQuery && (
          <button className="clear-search-btn" onClick={handleClearSearch}>
            ✕
          </button>
        )}
      </div>

      {/* Thread List or Search Results */}
      <div className="thread-list-container">
        {searchResults !== null ? (
          // Show search results
          searchResults.length > 0 ? (
            searchResults.map(renderSearchResult)
          ) : (
            <div className="empty-state">No results found for "{searchQuery}"</div>
          )
        ) : (
          // Show thread list
          currentList.length > 0 ? (
            currentList.map(renderThreadItem)
          ) : (
            <div className="empty-state">{emptyMessage}</div>
          )
        )}
      </div>
    </div>
  );
}
