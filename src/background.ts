const API_BASE = "http://127.0.0.1:8765";

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log(`[Recallish:Background]`, new Date().toISOString(), ...args);
  }
}

function logError(...args: unknown[]) {
  if (DEBUG) {
    console.error(`[Recallish:Background]`, new Date().toISOString(), ...args);
  }
}

function logWarn(...args: unknown[]) {
  if (DEBUG) {
    console.warn(`[Recallish:Background]`, new Date().toISOString(), ...args);
  }
}

interface MemoryRecord {
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

interface Stats {
  total_count: number;
  avg_importance: number;
  top_categories: Record<string, number>;
  storage_size_bytes: number;
}

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

interface SearchRequest {
  query: string;
  top_k: number;
  include_superseded?: boolean;
}

interface CreateMemoryRequest {
  content: string;
  category?: string;
  source?: string;
  explicit_signal?: boolean;
  importance_override?: number;
  supersedes?: string;
}

interface SaveSelectionRequest {
  text: string;
  url?: string;
  title?: string;
}

interface SavePageRequest {
  url: string;
  title: string;
}

interface UpdateMemoryRequest {
  content?: string;
  importance_override?: number;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const startTime = Date.now();
  
  log(`API Request: ${options.method || "GET"} ${endpoint}`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      logError(`API Error (${duration}ms): ${options.method || "GET"} ${endpoint} - ${response.status}`, error);
      throw new Error(error.error || `API error: ${response.status}`);
    }

    const data = await response.json();
    log(`API Success (${duration}ms): ${options.method || "GET"} ${endpoint}`);
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    logError(`API Failed (${duration}ms): ${options.method || "GET"} ${endpoint}`, error);
    throw error;
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "recall-save-selection",
      title: "Save to Recallish Memory",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "recall-save-page",
      title: "Save Page to Recallish Memory",
      contexts: ["page"],
    });
  });

  if (details.reason === "install") {
    chrome.storage.local.set({ apiBase: API_BASE });
    console.log("Recallish extension installed");
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "recall-save-selection" && info.selectionText) {
      const content = `Selected text from ${tab?.title || "page"} (${tab?.url}):\n\n${info.selectionText}`;
      log("Context menu: saving selection");
      await fetchApi<CreateMemoryRequest>("/api/memories", {
        method: "POST",
        body: JSON.stringify({
          content,
          category: "misc",
          source: "extension:selection",
          explicit_signal: true,
        }),
      });
      log("Saved selection to memory");
    } else if (info.menuItemId === "recall-save-page" && tab?.url) {
      const content = `Saved page: ${tab?.title}\nURL: ${tab?.url}`;
      log("Context menu: saving page");
      await fetchApi<CreateMemoryRequest>("/api/memories", {
        method: "POST",
        body: JSON.stringify({
          content,
          category: "misc",
          source: "extension:page",
          explicit_signal: true,
        }),
      });
      log("Saved page to memory");
    }
  } catch (error) {
    logError("Context menu save failed", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const msgType = message.type;
    log(`Message received: ${msgType}`, { sender: sender?.tab?.url || sender?.id, data: message });
    
    try {
      switch (msgType) {
        case "GET_STATS": {
          log("Handling GET_STATS");
          const stats = await fetchApi<Stats>("/api/stats");
          log("GET_STATS response", stats);
          sendResponse({ success: true, data: stats });
          break;
        }
        case "LIST_MEMORIES": {
          log("Handling LIST_MEMORIES", { filters: message });
          const params = new URLSearchParams();
          if (message.category) params.append("category", message.category);
          if (message.min_importance !== undefined) params.append("min_importance", String(message.min_importance));
          if (message.from_date) params.append("from_date", message.from_date);
          if (message.to_date) params.append("to_date", message.to_date);
          if (message.include_superseded) params.append("include_superseded", "true");

          const memories = await fetchApi<MemoryRecord[]>(`/api/memories?${params.toString()}`);
          log(`LIST_MEMORIES returned ${memories.length} memories`);
          sendResponse({ success: true, data: memories });
          break;
        }
        case "SEARCH_MEMORIES": {
          log("Handling SEARCH_MEMORIES", { query: message.query, top_k: message.top_k });
          const request: SearchRequest = {
            query: message.query,
            top_k: message.top_k ?? 8,
            include_superseded: message.include_superseded ?? false,
          };
          const memories = await fetchApi<MemoryRecord[]>("/api/search", {
            method: "POST",
            body: JSON.stringify(request),
          });
          log(`SEARCH_MEMORIES returned ${memories.length} results`);
          sendResponse({ success: true, data: memories });
          break;
        }
        case "CREATE_MEMORY": {
          log("Handling CREATE_MEMORY", { contentLength: message.content?.length, category: message.category });
          const request: CreateMemoryRequest = {
            content: message.content,
            category: message.category,
            source: message.source ?? "extension",
            explicit_signal: message.explicit_signal ?? true,
          };
          const result = await fetchApi<{ id: string; superseded: boolean; superseded_id?: string }>("/api/memories", {
            method: "POST",
            body: JSON.stringify(request),
          });
          log("CREATE_MEMORY result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "UPDATE_MEMORY": {
          log("Handling UPDATE_MEMORY", { id: message.id, hasContent: !!message.content, hasImportance: !!message.importance_override });
          const request: UpdateMemoryRequest = {
            content: message.content,
            importance_override: message.importance_override,
          };
          const result = await fetchApi<{ id: string; updated: boolean }>(`/api/memories/${message.id}`, {
            method: "PATCH",
            body: JSON.stringify(request),
          });
          log("UPDATE_MEMORY result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "DELETE_MEMORY": {
          log("Handling DELETE_MEMORY", { id: message.id });
          const result = await fetchApi<{ id: string; deleted: boolean }>(`/api/memories/${message.id}`, {
            method: "DELETE",
          });
          log("DELETE_MEMORY result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "INGEST_CONVERSATION": {
          log("Handling INGEST_CONVERSATION", { contentLength: message.content?.length, source: message.source });
          const body: Record<string, unknown> = {
            content: message.content,
            source: message.source ?? "extension",
          };
          if (message["conversation_id"]) body["conversation_id"] = message["conversation_id"];
          if (message["content_hash"]) body["content_hash"] = message["content_hash"];
          const result = await fetchApi<{ conversation_id: string; saved_memories: unknown[] }>("/api/conversations", {
            method: "POST",
            body: JSON.stringify(body),
          });
          log("INGEST_CONVERSATION result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "GET_RECENT_CONVERSATIONS": {
          log("Handling GET_RECENT_CONVERSATIONS", { limit: message.limit });
          const limit = message.limit ?? 2;
          const records = await fetchApi<Record<string, unknown>[]>(`/api/conversations/recent?limit=${limit}`);
          log(`GET_RECENT_CONVERSATIONS returned ${records.length} records`);
          sendResponse({ success: true, data: records });
          break;
        }
        case "SUMMARIZE": {
          log("Handling SUMMARIZE", { label: message.label, chunks: message.chunks?.length });
          const label = String(message.label ?? "topic");
          const chunks = Array.isArray(message.chunks) ? message.chunks.map(String) : [];
          const payload: Record<string, unknown> = { label, chunks };
          if (message["max_lines"]) payload["max_lines"] = message["max_lines"];
          if (message["content_type"]) payload["content_type"] = message["content_type"];
          const result = await fetchApi<Record<string, unknown>>("/api/summarize", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          log("SUMMARIZE result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "CHAT_TRANSFER": {
          log("Handling CHAT_TRANSFER", { targetPlatform: message.targetPlatform });
          const result = await handleChatTransfer(message);
          sendResponse(result);
          break;
        }
        case "SAVE_SELECTION": {
          log("Handling SAVE_SELECTION", { textLength: message.text?.length, url: message.url });
          const { text, url, title } = message as SaveSelectionRequest;
          const content = `Selected text from ${title || "page"} (${url}):\n\n${text}`;
          const result = await fetchApi<{ id: string; superseded: boolean; superseded_id?: string }>("/api/memories", {
            method: "POST",
            body: JSON.stringify({
              content,
              category: "misc",
              source: "extension:selection",
              explicit_signal: true,
            }),
          });
          log("SAVE_SELECTION result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "SAVE_PAGE": {
          log("Handling SAVE_PAGE", { url: message.url, title: message.title });
          const { url, title } = message as SavePageRequest;
          const content = `Saved page: ${title}\nURL: ${url}`;
          const result = await fetchApi<{ id: string; superseded: boolean; superseded_id?: string }>("/api/memories", {
            method: "POST",
            body: JSON.stringify({
              content,
              category: "misc",
              source: "extension:page",
              explicit_signal: true,
            }),
          });
          log("SAVE_PAGE result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "APPLY_DECAY": {
          log("Handling APPLY_DECAY");
          const result = await fetchApi<{ decayed: number }>("/api/decay", { method: "POST" });
          log("APPLY_DECAY result", result);
          sendResponse({ success: true, data: result });
          break;
        }
        case "HEALTH_CHECK": {
          log("Handling HEALTH_CHECK");
          const health = await fetchApi<{ ok: boolean; service: string }>("/api/health");
          log("HEALTH_CHECK result", health);
          sendResponse({ success: true, data: health });
          break;
        }
        default:
          logWarn("Unknown message type", msgType);
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (error) {
      logError(`Message handler error for ${msgType}:`, error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();

  return true;
});

// ---------------------------------------------------------------------------
// Cross-AI-chat transfer helpers
// ---------------------------------------------------------------------------

// Maps a target platform id to host patterns so we can discover open tabs that
// host that AI chat. Matches the manifest's host_permissions / content scripts.
const PLATFORM_URL_PATTERNS: Record<string, RegExp> = {
  chatgpt: /(^|\.)(chat\.openai\.com|chatgpt\.com)(\/|$)/i,
  claude: /(^|\.)claude\.ai(\/|$)/i,
  gemini: /(^|\.)(gemini\.google\.com|bard\.google\.com)(\/|$)/i,
  deepseek: /(^|\.)chat\.deepseek\.com(\/|$)/i,
  qwen: /(^|\.)(chat\.qwen\.ai|chat\.qwenlm\.ai|tongyi\.aliyun\.com)(\/|$)/i,
  cursor: /(^|\.)(cursor\.com|cursor\.sh)(\/|$)/i,
  grok: /(^|\.)(grok\.com|(x\.com|twitter\.com)\/i\/grok)(\/|$)/i,
  perplexity: /(^|\.)perplexity\.ai(\/|$)/i,
};

const PLATFORM_URLS: Record<string, string> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
  grok: "https://grok.com/",
  perplexity: "https://www.perplexity.ai/",
};

function formatTransferText(
  conversationText: string,
  sourcePlatform: string,
): string {
  const sourceLine = sourcePlatform && sourcePlatform !== "unknown"
    ? `(Continued from ${sourcePlatform})`
    : "";
  return [
    sourceLine,
    "Please review the conversation below, and continue from where it left off. If it ends with a question, answer it. Otherwise respond naturally as the next assistant message.",
    "",
    "--- BEGIN CONVERSATION ---",
    conversationText.trim(),
    "--- END CONVERSATION ---",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function findTargetTab(
  targetPattern: RegExp,
  excludeTabId?: number,
): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      const match = tabs.find(
        (tab) =>
          tab.id !== undefined &&
          tab.id !== excludeTabId &&
          !!tab.url &&
          targetPattern.test(tab.url),
      );
      resolve(match || null);
    });
  });
}

function createTargetTab(url: string): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: true }, (tab) => resolve(tab || null));
  });
}

function waitForTabReady(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToTab<T>(tabId: number, payload: Record<string, unknown>): Promise<T> {
  const send = (): Promise<{ response?: T; error?: string }> => new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ response: response as T });
    });
  });

  const firstAttempt = await send();
  if (firstAttempt.response !== undefined || !/receiving end does not exist|could not establish connection/i.test(firstAttempt.error || "")) {
    return firstAttempt.response as T;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      chrome.scripting.executeScript({ target: { tabId }, files: ["contentScript.js"] }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
    const retry = await send();
    return (retry.response || { success: false, error: retry.error || firstAttempt.error }) as T;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : firstAttempt.error,
    } as T;
  }
}

async function summarizeForTransfer(label: string, transcript: string): Promise<string | null> {
  if (transcript.length <= 12000) return null;

  try {
    const result = await fetchApi<{
      structured?: { title?: string; summary?: string; key_points?: string[]; action_items?: string[]; decisions?: string[] } | null;
      lines?: string[];
    }>("/api/summarize", {
      method: "POST",
      body: JSON.stringify({ label, chunks: [transcript], content_type: "conversation", max_lines: 12 }),
    });
    const structured = result.structured;
    if (structured?.summary?.trim()) {
      const sections = [structured.summary];
      for (const [heading, values] of [
        ["Key points", structured.key_points],
        ["Action items", structured.action_items],
        ["Decisions", structured.decisions],
      ] as const) {
        if (values?.length) sections.push(`${heading}:\n${values.map((value) => `- ${value}`).join("\n")}`);
      }
      return sections.join("\n\n");
    }
    return result.lines?.length ? result.lines.join("\n") : null;
  } catch (error) {
    logWarn("Transfer summarization failed; using the full transcript", error);
    return null;
  }
}

async function injectWithRetry(tabId: number, text: string): Promise<{ success: boolean; error?: string }> {
  let lastResult: { success: boolean; error?: string } = { success: false };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    lastResult = await sendToTab<{ success: boolean; error?: string }>(tabId, {
      type: "INJECT_CONVERSATION",
      text,
    });
    if (lastResult.success) return lastResult;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lastResult;
}

async function handleChatTransfer(message: Record<string, unknown>) {
  const targetPlatform = String(message["targetPlatform"] ?? "").toLowerCase();
  const targetPattern = PLATFORM_URL_PATTERNS[targetPlatform];
  if (!targetPattern) {
    return { success: false, error: `Unknown destination platform "${targetPlatform}".` };
  }

  // 1. Read the conversation from the active tab (the source AI chat).
  const [activeTab] = await new Promise<chrome.tabs.Tab[]>((resolve) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs)),
  );
  if (!activeTab?.id) {
    return { success: false, error: "No active tab found." };
  }

  const sourceConversation = await sendToTab<{
    success: boolean;
    data?: ConversationMessage[];
    platform?: string;
    error?: string;
  }>(activeTab.id, { type: "GET_CONVERSATION" });
  const messages: ConversationMessage[] = Array.isArray(sourceConversation?.data)
    ? sourceConversation.data
    : [];
  if (messages.length === 0) {
    return {
      success: false,
      error: sourceConversation?.error
        ? `Could not read the conversation: ${sourceConversation.error}`
        : "No conversation found on the current tab. Open a ChatGPT, Claude, Gemini or supported AI chat first.",
    };
  }

  const sourcePlatformRaw = String(sourceConversation?.platform ?? "unknown");
  const sourcePlatform = sourcePlatformRaw.toLowerCase();
  if (targetPlatform === sourcePlatform && activeTab.url
      && targetPattern.test(activeTab.url)) {
    return { success: false, error: "This tab is already on the destination AI. Open another chat or pick a different destination." };
  }

  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  const summarizedTranscript = await summarizeForTransfer(
    `Conversation transfer from ${sourcePlatformRaw}`,
    transcript,
  );
  const transferText = formatTransferText(summarizedTranscript || transcript, sourcePlatformRaw);

  // 2. Find an open tab that hosts the destination AI and inject there.
  let targetTab = await findTargetTab(targetPattern, activeTab.id);
  let createdTargetTab = false;
  if (!targetTab?.id) {
    const targetUrl = PLATFORM_URLS[targetPlatform];
    if (!targetUrl) {
      return { success: false, error: `No launch URL configured for ${targetPlatform}.` };
    }
    targetTab = await createTargetTab(targetUrl);
    createdTargetTab = true;
  }
  if (!targetTab?.id) {
    return { success: false, error: `Could not open ${targetPlatform}.` };
  }

  if (createdTargetTab) {
    await waitForTabReady(targetTab.id);
  }

  const injectResult = await injectWithRetry(targetTab.id, transferText);
  if (!injectResult?.success) {
    return {
      success: false,
      error: injectResult?.error || `Failed to inject into ${targetPlatform}. Make sure its page is fully loaded.`,
    };
  }

  // Focus the destination tab so the user can review and hit Send.
  chrome.tabs.update(targetTab.id, { active: true, highlighted: true });

  return {
    success: true,
    data: {
      targetPlatform,
      targetUrl: targetTab.url,
      messageCount: messages.length,
    },
  };
}

export {};