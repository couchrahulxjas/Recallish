import { PLATFORMS, getPlatformForUrl } from "./platforms.config";
import { ConversationMessage, PlatformConfig } from "./platforms";
import { injectText as sharedInject } from "./inject";

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log(`[Recallish:ContentScript]`, new Date().toISOString(), ...args);
  }
}

function logError(...args: unknown[]) {
  if (DEBUG) {
    console.error(`[Recallish:ContentScript]`, new Date().toISOString(), ...args);
  }
}

function logWarn(...args: unknown[]) {
  if (DEBUG) {
    console.warn(`[Recallish:ContentScript]`, new Date().toISOString(), ...args);
  }
}

class ConversationExtractor {
  private platform: PlatformConfig | null = null;
  private observer: MutationObserver | null = null;
  private lastExtractedHash = "";
  private onConversationChange: ((messages: ConversationMessage[]) => void) | null = null;
  private sentCount = 0;
  private captureEnabled = true;
  private conversationId = "";
  private nextConversationId = 1;
  private lastFullTranscript = "";
  private lastContentHash = "";

  init() {
    this.platform = getPlatformForUrl(window.location.href) || null;
    if (!this.platform) {
      log("No platform detected for URL:", window.location.href);
      return;
    }

    log(`Detected platform: ${this.platform.name}`);
    this.conversationId = this.newConversationId();
    this.onChange((messages) => this.autoCapture(messages));
    window.addEventListener("beforeunload", () => this.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flush();
    });
    this.startObserving();
  }

  private newConversationId(): string {
    // Stable per-tab conversation id. Plain numbers keep messages compact;
    // combined with the platform origin on the backend this is unique enough
    // to upsert the same conversation without clobbering another platform's.
    const id = `${this.platform?.name || "unknown"}-conv-${this.nextConversationId}`;
    this.nextConversationId += 1;
    return id;
  }

  enableCapture(enabled: boolean) {
    this.captureEnabled = enabled;
    log(`Auto-capture ${enabled ? "enabled" : "disabled"}`);
  }

  isCaptureEnabled(): boolean {
    return this.captureEnabled;
  }

  private autoCapture(messages: ConversationMessage[]) {
    if (!this.captureEnabled) return;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    if (!transcript.trim()) return;

    // Detect a brand-new conversation in the same tab. A fresh conversation
    // changes the very first message. Message edits / regenerations keep the
    // first message intact, so they stay on the same conversation id and the
    // backend updates the record in place instead of spawning a duplicate.
    if (this.lastFullTranscript) {
      const firstOld = this.lastFullTranscript.split("\n\n")[0];
      const firstNew = transcript.split("\n\n")[0];
      if (firstOld !== firstNew) {
        log("Detected a new conversation, rotating conversation id");
        this.conversationId = this.newConversationId();
      }
    }

    this.sendFull(transcript);
  }

  private sendFull(transcript: string) {
    const contentHash = this.hashText(transcript);

    log("Auto-sending INGEST_CONVERSATION", {
      platform: this.getPlatformName(),
      messageCount: this.sentCount + 1,
      transcriptLength: transcript.length,
      conversationId: this.conversationId,
      duplicate: contentHash === this.lastContentHash,
    });

    chrome.runtime.sendMessage(
      {
        type: "INGEST_CONVERSATION",
        content: transcript,
        content_hash: contentHash,
        conversation_id: this.conversationId,
        source: `extension:${this.getPlatformName()}`,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          logWarn("Auto-capture message failed", chrome.runtime.lastError.message);
          return;
        }
        if (!response?.success) {
          logWarn("Auto-capture rejected by backend", response?.error);
          return;
        }
        this.lastContentHash = contentHash;
        this.lastFullTranscript = transcript;
        this.sentCount = 1;
        log(`Auto-capture recorded conversation ${this.conversationId}`);
      },
    );
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return String(hash);
  }

  private flush() {
    const messages = this.extractConversation();
    if (messages.length > 0) {
      log(`Flushing ${messages.length} message(s)`);
      this.autoCapture(messages);
    }
  }

  private startObserving() {
    if (!this.platform) return;

    const container = document.querySelector(this.platform.selectors.conversationContainer);
    if (!container) {
      logWarn("Conversation container not found, retrying in 1s...");
      setTimeout(() => this.startObserving(), 1000);
      return;
    }

    log("Found conversation container, starting observation");
    this.extractAndNotify();

    this.observer = new MutationObserver((mutations) => {
      const hasRelevantChanges = mutations.some(
        (m) => m.type === "childList" && m.addedNodes.length > 0,
      );
      if (hasRelevantChanges) {
        log("Detected DOM changes, debouncing extraction");
        this.debouncedExtract();
      }
    });

    this.observer.observe(container, { childList: true, subtree: true });
  }

  private debouncedExtract = this.debounce(() => this.extractAndNotify(), 500);

  private debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
    let timeoutId: ReturnType<typeof setTimeout>;
    return ((...args: unknown[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    }) as T;
  }

  private extractAndNotify() {
    const messages = this.extractConversation();
    const hash = this.hashMessages(messages);

    if (hash !== this.lastExtractedHash && messages.length > 0) {
      log(`Conversation changed: ${messages.length} messages`);
      this.lastExtractedHash = hash;
      this.onConversationChange?.(messages);
    }
  }

  private extractConversation(): ConversationMessage[] {
    if (!this.platform) return [];

    const messageElements = document.querySelectorAll(this.platform.selectors.messageElements);
    const messages: ConversationMessage[] = [];

    messageElements.forEach((el) => {
      const isUser = el.matches(this.platform!.selectors.userMessage);
      const isAssistant = el.matches(this.platform!.selectors.assistantMessage);

      if (!isUser && !isAssistant) return;

      const content = this.platform!.extractText(el);
      if (!content || content.length < 10) return;

      messages.push({
        role: isUser ? "user" : "assistant",
        content,
        timestamp: Date.now(),
      });
    });

    log(`Extracted ${messages.length} messages from ${messageElements.length} elements`);
    return messages;
  }

  private hashMessages(messages: ConversationMessage[]): string {
    return messages.map((m) => `${m.role}:${m.content.slice(0, 50)}`).join("|");
  }

  onChange(callback: (messages: ConversationMessage[]) => void) {
    this.onConversationChange = callback;
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    this.onConversationChange = null;
  }

  getSentCount(): number {
    return this.sentCount;
  }

  resetSentCount() {
    this.sentCount = 0;
    this.lastExtractedHash = "";
    this.lastContentHash = "";
    this.lastFullTranscript = "";
    log("Reset sent count");
  }

  getConversation(): ConversationMessage[] {
    return this.extractConversation();
  }

  getConversationId(): string {
    return this.conversationId;
  }

  getHash(text: string): string {
    return this.hashText(text);
  }

  getPlatformName(): string {
    return this.platform?.name || "unknown";
  }
}

const extractor = new ConversationExtractor();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => extractor.init());
} else {
  extractor.init();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_CONVERSATION") {
    log("Received GET_CONVERSATION message");
    const messages = extractor.getConversation();
    log(`Returning ${messages.length} messages`);
    sendResponse({ success: true, data: messages, platform: extractor.getPlatformName() });
    return true;
  }
  if (message.type === "SET_CAPTURE") {
    log("Received SET_CAPTURE", { enabled: message.enabled });
    extractor.enableCapture(!!message.enabled);
    sendResponse({ success: true, data: { enabled: extractor.isCaptureEnabled() } });
    return true;
  }
  if (message.type === "GET_STATUS") {
    sendResponse({
      success: true,
      data: {
        platform: extractor.getPlatformName(),
        sentCount: extractor.getSentCount(),
        captureEnabled: extractor.isCaptureEnabled(),
      },
    });
    return true;
  }
  if (message.type === "EXTRACT_AND_SEND") {
    log("Received EXTRACT_AND_SEND message");
    const messages = extractor.getConversation();
    if (messages.length > 0) {
      const transcript = messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");

      log("Sending INGEST_CONVERSATION to background", {
        platform: extractor.getPlatformName(),
        transcriptLength: transcript.length,
      });
      chrome.runtime.sendMessage({
        type: "INGEST_CONVERSATION",
        content: transcript,
        content_hash: extractor.getHash(transcript),
        conversation_id: extractor.getConversationId(),
        source: `extension:${extractor.getPlatformName()}`,
      });
    } else {
      logWarn("No conversation found to send");
    }
    sendResponse({ success: true, count: messages.length });
    return true;
  }
  if (message.type === "GET_PLATFORM") {
    sendResponse({ success: true, data: { platform: extractor.getPlatformName() } });
    return true;
  }
  if (message.type === "INJECT_CONVERSATION") {
    log("Received INJECT_CONVERSATION message");
    const platform = getPlatformForUrl(window.location.href);
    if (!platform) {
      sendResponse({ success: false, error: "Unsupported page. Cannot inject here." });
      return true;
    }
    const text = String(message.text ?? "");
    if (!text.trim()) {
      sendResponse({ success: false, error: "Nothing to inject." });
      return true;
    }
    const result = sharedInject(platform, text);
    log("INJECT_CONVERSATION result", result);
    if (!result.ok) {
      sendResponse({ success: false, error: result.error || "Failed to inject." });
      return true;
    }
    sendResponse({ success: true, data: { platform: platform.name } });
    return true;
  }
  return false;
});

export { extractor };
