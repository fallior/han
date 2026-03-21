/**
 * Shared type definitions for the admin UI
 */

export interface ConversationThread {
  id: string;
  title: string;
  status: 'open' | 'resolved' | 'archived';
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at?: string;
  metadata?: Record<string, any>;
}

// Alias for backwards compatibility
export type Conversation = ConversationThread;

export interface SearchResult {
  id: string;
  thread_id: string;
  title: string;
  snippet: string;
  relevance: number;
}

export interface Message {
  id: string;
  thread_id: string;
  author: string;
  role: string;
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
}
