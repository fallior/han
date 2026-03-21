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
  participants?: string[];
  summary?: {
    type: string;
    request?: string;
    status?: string;
  };
  topics?: string[];
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
  matched_message?: {
    author: string;
    content: string;
    created_at: string;
  };
  relevance: number;
  created_at: string;
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
