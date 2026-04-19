/**
 * Shared type definitions for the admin UI
 * Note: Some types are intentionally flexible (any) to allow for gradual migration
 */

export interface ConversationThread {
  id: string;
  title: string;
  status: 'open' | 'resolved' | 'archived';
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at?: string;
  participants?: any;
  summary?: any;
  topics?: any;
  metadata?: Record<string, any>;
}

// Alias for backwards compatibility
export type Conversation = ConversationThread;

export interface SearchResult {
  id: string;
  thread_id: string;
  conversation_id: string;
  title: string;
  conversation_title: string;
  conversation_status: 'open' | 'resolved' | 'archived';
  snippet: string;
  matched_message?: any;
  relevance: number;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  listen_count?: number;
  metadata?: Record<string, any>;
}
