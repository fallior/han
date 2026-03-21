// @ts-nocheck
import { useEffect, useState, useMemo } from 'react';
import { useWorkshopStore } from '../../store/workshopStore';
import { apiClient } from '../../lib/api';
import type { GroupedThreadsResponse, ConversationThread } from '../../lib/api';

type Period = 'all' | 'today' | 'this_week' | 'last_week' | 'this_month' | 'older';

interface PeriodFilter {
  key: Period;
  label: string;
}

const PERIOD_FILTERS: PeriodFilter[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'older', label: 'Older' },
];

function timeSince(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

function hasUnread(conversationId: number, updatedAt: string): boolean {
  const key = `lastRead:${conversationId}`;
  const lastReadStr = localStorage.getItem(key);
  if (!lastReadStr) return true;

  const lastRead = new Date(lastReadStr);
  const updated = new Date(updatedAt);
  return updated > lastRead;
}

function markAsRead(conversationId: number): void {
  const key = `lastRead:${conversationId}`;
  localStorage.setItem(key, new Date().toISOString());
}

export function ThreadList() {
  const {
    nestedTab,
    workshopPeriod,
    workshopShowArchived,
    selectedThreadId,
    setWorkshopPeriod,
    setWorkshopShowArchived,
    selectThread,
  } = useWorkshopStore();

  const [groupedData, setGroupedData] = useState<GroupedThreadsResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationThread[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchDebounce, setSearchDebounce] = useState<NodeJS.Timeout | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch grouped threads when nestedTab or showArchived changes
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      if (!nestedTab) return;

      setLoading(true);
      try {
        const data = await apiClient.fetchGroupedThreads(nestedTab, workshopShowArchived);
        if (!cancelled) {
          setGroupedData(data);
        }
      } catch (err) {
        console.error('Failed to fetch threads:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [nestedTab, workshopShowArchived]);

  // Debounced search
  useEffect(() => {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
    }

    if (!searchQuery.trim()) {
      setIsSearching(false);
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      if (!nestedTab) return;

      setIsSearching(true);
      try {
        const results = await apiClient.searchThreads(searchQuery, nestedTab);
        setSearchResults(results);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      }
    }, 300);

    setSearchDebounce(timeout);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [searchQuery, nestedTab]);

  // Get threads to display
  const displayThreads = useMemo(() => {
    if (isSearching || searchQuery.trim()) {
      return searchResults;
    }

    if (!groupedData) return [];

    if (workshopPeriod === 'all') {
      return [
        ...(groupedData.today || []),
        ...(groupedData.this_week || []),
        ...(groupedData.last_week || []),
        ...(groupedData.this_month || []),
        ...(groupedData.older || []),
      ];
    }

    return groupedData[workshopPeriod] || [];
  }, [groupedData, workshopPeriod, isSearching, searchQuery, searchResults]);

  // Get period counts
  const periodCounts = useMemo(() => {
    if (!groupedData) return {};

    return {
      all:
        (groupedData.today?.length || 0) +
        (groupedData.this_week?.length || 0) +
        (groupedData.last_week?.length || 0) +
        (groupedData.this_month?.length || 0) +
        (groupedData.older?.length || 0),
      today: groupedData.today?.length || 0,
      this_week: groupedData.this_week?.length || 0,
      last_week: groupedData.last_week?.length || 0,
      this_month: groupedData.this_month?.length || 0,
      older: groupedData.older?.length || 0,
    };
  }, [groupedData]);

  const handleThreadClick = (threadId: number) => {
    if (!nestedTab) return;
    selectThread(nestedTab, threadId);
    markAsRead(threadId);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setIsSearching(false);
    setSearchResults([]);
  };

  return (
    <div className="workshop-thread-list" style={{ width: '280px', display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-card)', borderRight: '1px solid var(--color-border)' }}>
      {/* Period filter bar */}
      <div style={{ padding: '12px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {PERIOD_FILTERS.map((filter) => {
            const count = periodCounts[filter.key] || 0;
            const isActive = workshopPeriod === filter.key;

            return (
              <button
                key={filter.key}
                onClick={() => setWorkshopPeriod(filter.key)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                  backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
                  color: isActive ? 'var(--color-primary-fg)' : 'var(--color-fg)',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {filter.label}
                {count > 0 && (
                  <span
                    style={{
                      backgroundColor: isActive ? 'var(--color-primary-fg)' : 'var(--color-muted)',
                      color: isActive ? 'var(--color-primary)' : 'var(--color-muted-fg)',
                      borderRadius: '8px',
                      padding: '0 5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      minWidth: '18px',
                      textAlign: 'center',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Archive toggle */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <button
          onClick={() => setWorkshopShowArchived(!workshopShowArchived)}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '6px',
            border: workshopShowArchived ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
            backgroundColor: workshopShowArchived ? 'var(--color-primary)' : 'transparent',
            color: workshopShowArchived ? 'var(--color-primary-fg)' : 'var(--color-fg)',
            fontSize: '13px',
            fontWeight: workshopShowArchived ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          {workshopShowArchived ? '✓ Show All (including archived)' : 'View All'}
        </button>
      </div>

      {/* Search bar */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ position: 'relative', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search threads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-fg)',
              fontSize: '13px',
            }}
          />
          {searchQuery.trim() && (
            <button
              onClick={handleClearSearch}
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
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {loading && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-muted-fg)', fontSize: '13px' }}>
            Loading threads...
          </div>
        )}

        {!loading && displayThreads.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-muted-fg)', fontSize: '13px' }}>
            {searchQuery.trim() ? 'No threads found' : 'No threads in this period'}
          </div>
        )}

        {!loading && displayThreads.map((thread) => {
          const isActive = selectedThreadId === thread.id;
          const unread = hasUnread(thread.id, thread.updated_at);

          return (
            <div
              key={thread.id}
              onClick={() => handleThreadClick(thread.id)}
              style={{
                padding: '10px',
                marginBottom: '6px',
                borderRadius: '8px',
                border: isActive ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                backgroundColor: isActive ? 'var(--color-muted)' : 'var(--color-bg)',
                cursor: 'pointer',
                opacity: thread.archived ? 0.55 : 1,
                boxShadow: isActive ? '0 2px 8px rgba(59, 130, 246, 0.3)' : 'none',
                position: 'relative',
              }}
            >
              {/* Unread dot */}
              {unread && (
                <div
                  style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-primary)',
                  }}
                />
              )}

              {/* Title */}
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px', paddingRight: unread ? '16px' : '0' }}>
                {thread.title}
              </div>

              {/* Time + status + archived */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--color-muted-fg)' }}>
                <span>{timeSince(thread.updated_at)}</span>

                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: thread.status === 'resolved' ? 'var(--color-success)' : 'var(--color-warning)',
                    color: 'var(--color-bg)',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  {thread.status === 'resolved' ? 'Resolved' : 'Open'}
                </span>

                {thread.archived && (
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--color-muted)',
                      color: 'var(--color-muted-fg)',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Archived
                  </span>
                )}

                {thread.message_count > 0 && (
                  <span>
                    {thread.message_count} {thread.message_count === 1 ? 'message' : 'messages'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
