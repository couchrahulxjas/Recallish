export interface MemoryRecord {
  id: string;
  content: string;
  metadata: {
    category?: string;
    importance_score?: number;
    source?: string;
    updated_at?: string;
    superseded_by?: string;
    explicit_signal?: boolean;
    access_count?: number;
    last_accessed_at?: string;
    created_at?: string;
  };
  similarity?: number;
  combined_score?: number;
}

export interface Stats {
  total_count: number;
  avg_importance: number;
  top_categories: Record<string, number>;
  storage_size_bytes: number;
}

export interface CreateMemoryRequest {
  content: string;
  category?: string;
  source?: string;
  explicit_signal?: boolean;
}

export interface UpdateMemoryRequest {
  content?: string;
  importance_override?: number;
}

export interface SearchRequest {
  query: string;
  top_k?: number;
  include_superseded?: boolean;
}

export interface IngestionResult {
  conversation_id: string;
  saved_memories: unknown[];
  updated?: boolean;
  duplicate?: boolean;
}

export interface RecentConversation {
  id: string;
  source: string;
  created_at: string;
  content: string;
  conversation_id?: string;
}

export interface SummarizeResult {
  lines: string[];
  structured?: {
    title?: string;
    content_type?: string;
    summary?: string | string[];
    key_points?: string[];
    important_details?: string[];
    action_items?: string[];
    decisions?: string[];
    memory_candidates?: string[];
  } | null;
  content_type?: string | null;
  error?: string | null;
}

class ApiService {
  private static instance: ApiService;

  static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  private async sendMessage<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response.success) {
          reject(new Error(response.error || "Unknown error"));
          return;
        }
        resolve(response.data as T);
      });
    });
  }

  async healthCheck(): Promise<{ ok: boolean; service: string }> {
    return this.sendMessage("HEALTH_CHECK");
  }

  async getStats(): Promise<Stats> {
    return this.sendMessage("GET_STATS");
  }

  async listMemories(filters?: {
    category?: string;
    min_importance?: number;
    from_date?: string;
    to_date?: string;
    include_superseded?: boolean;
  }): Promise<MemoryRecord[]> {
    return this.sendMessage("LIST_MEMORIES", filters || {});
  }

  async searchMemories(query: string, top_k = 8, include_superseded = false): Promise<MemoryRecord[]> {
    return this.sendMessage("SEARCH_MEMORIES", { query, top_k, include_superseded });
  }

  async createMemory(request: CreateMemoryRequest): Promise<{ id: string; superseded: boolean; superseded_id?: string }> {
    return this.sendMessage("CREATE_MEMORY", { ...request });
  }

  async updateMemory(id: string, request: UpdateMemoryRequest): Promise<{ id: string; updated: boolean }> {
    return this.sendMessage("UPDATE_MEMORY", { id, ...request });
  }

  async deleteMemory(id: string): Promise<{ id: string; deleted: boolean }> {
    return this.sendMessage("DELETE_MEMORY", { id });
  }

  async ingestConversation(
    content: string,
    source = "extension",
    conversationId?: string,
    contentHash?: string,
  ): Promise<IngestionResult> {
    return this.sendMessage("INGEST_CONVERSATION", {
      content,
      source,
      conversation_id: conversationId,
      content_hash: contentHash,
    });
  }

  async getRecentConversations(limit = 2): Promise<RecentConversation[]> {
    return this.sendMessage("GET_RECENT_CONVERSATIONS", { limit });
  }

  async summarizeContent(label: string, chunks: string[], content_type?: string, max_lines = 8): Promise<SummarizeResult> {
    return this.sendMessage("SUMMARIZE", {
      label,
      chunks,
      content_type,
      max_lines,
    });
  }

  async transferChat(targetPlatform: string): Promise<{
    targetPlatform: string;
    targetUrl?: string;
    messageCount?: number;
  }> {
    return this.sendMessage("CHAT_TRANSFER", { targetPlatform });
  }

  async applyDecay(): Promise<{ decayed: number }> {
    return this.sendMessage("APPLY_DECAY");
  }
}

export const api = ApiService.getInstance();