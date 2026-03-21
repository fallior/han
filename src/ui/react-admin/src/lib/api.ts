/**
 * API client for HAN admin interface
 * Handles authentication, error handling, and API calls
 */

// ============================================================================
// Types
// ============================================================================

export interface GroupedThread {
  period: string;
  threads: Thread[];
}

export interface Thread {
  id: string;
  title: string;
  discussion_type: string;
  status: 'open' | 'resolved';
  archived: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  unread_count: number;
  last_message?: {
    role: string;
    preview: string;
    created_at: string;
  };
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
}

export interface ThreadDetail extends Thread {
  messages: Message[];
}

export interface CreateThreadRequest {
  title: string;
  discussion_type: string;
}

export interface PostMessageRequest {
  content: string;
  role: string;
}

export interface JemmaStatus {
  status: 'idle' | 'processing' | 'error';
  current_task?: string;
  last_activity?: string;
}

export interface SearchResult {
  threads: Thread[];
  total: number;
}

// ============================================================================
// Configuration
// ============================================================================

const TOKEN_KEY = 'han-auth-token';

export const API_BASE = '';

/**
 * Custom event dispatched on 401 responses
 * Listeners can use this to redirect to login or clear auth state
 */
export const AUTH_FAILED_EVENT = 'han-auth-failed';

/**
 * Get API base URL
 * Returns empty string (same-origin) for production
 * In dev mode, Vite proxy handles /api routes
 */
export function getApiBase(): string {
  return API_BASE;
}

// ============================================================================
// Core fetch wrapper
// ============================================================================

/**
 * Fetch wrapper that automatically injects bearer token authentication.
 * Handles 401 responses by clearing token and triggering re-authentication.
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY);

  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized - clear token and dispatch event
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new CustomEvent(AUTH_FAILED_EVENT));
    throw new Error('Authentication required');
  }

  return response;
}

/**
 * JSON fetch helper
 */
async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API error ${response.status}: ${errorText || response.statusText}`
    );
  }

  return response.json();
}

// ============================================================================
// Workshop API functions
// ============================================================================

/**
 * Fetch grouped threads by discussion type
 */
export async function fetchGroupedThreads(
  type: string,
  includeArchived: boolean
): Promise<GroupedThread[]> {
  const params = new URLSearchParams({
    type,
    include_archived: includeArchived.toString(),
  });

  return fetchJSON<GroupedThread[]>(
    `/api/conversations/grouped?${params.toString()}`
  );
}

/**
 * Fetch single thread with all messages
 */
export async function fetchThread(id: string): Promise<ThreadDetail> {
  return fetchJSON<ThreadDetail>(`/api/conversations/${id}`);
}

/**
 * Create new conversation thread
 */
export async function createThread(
  title: string,
  discussionType: string
): Promise<ThreadDetail> {
  return fetchJSON<ThreadDetail>('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, discussion_type: discussionType }),
  });
}

/**
 * Post message to thread
 */
export async function postMessage(
  threadId: string,
  content: string,
  role: string
): Promise<Message> {
  return fetchJSON<Message>(`/api/conversations/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, role }),
  });
}

/**
 * Resolve thread (mark as complete)
 */
export async function resolveThread(id: string): Promise<void> {
  await apiFetch(`/api/conversations/${id}/resolve`, { method: 'POST' });
}

/**
 * Reopen resolved thread
 */
export async function reopenThread(id: string): Promise<void> {
  await apiFetch(`/api/conversations/${id}/reopen`, { method: 'POST' });
}

/**
 * Archive thread
 */
export async function archiveThread(id: string): Promise<void> {
  await apiFetch(`/api/conversations/${id}/archive`, { method: 'POST' });
}

/**
 * Unarchive thread
 */
export async function unarchiveThread(id: string): Promise<void> {
  await apiFetch(`/api/conversations/${id}/unarchive`, { method: 'POST' });
}

/**
 * Search threads by query
 */
export async function searchThreads(
  query: string,
  type: string,
  limit: number = 50
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: query,
    type,
    limit: limit.toString(),
  });

  return fetchJSON<SearchResult>(
    `/api/conversations/search?${params.toString()}`
  );
}

/**
 * Fetch Jemma dispatcher status
 */
export async function fetchJemmaStatus(): Promise<JemmaStatus> {
  return fetchJSON<JemmaStatus>('/api/jemma/status');
}

/**
 * Update thread title
 */
export async function updateThreadTitle(
  id: string,
  title: string
): Promise<void> {
  await apiFetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}
