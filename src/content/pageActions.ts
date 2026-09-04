import { extractor } from "./contentScript";

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log(`[Recallish:PageActions]`, new Date().toISOString(), ...args);
  }
}

function logError(...args: unknown[]) {
  if (DEBUG) {
    console.error(`[Recallish:PageActions]`, new Date().toISOString(), ...args);
  }
}

function logWarn(...args: unknown[]) {
  if (DEBUG) {
    console.warn(`[Recallish:PageActions]`, new Date().toISOString(), ...args);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_SELECTION") {
    log("Received SAVE_SELECTION", { textLength: message.text?.length, url: message.url });
    const { text, url, title } = message;
    const content = `Selected text from ${title || "page"} (${url}):\n\n${text}`;

    chrome.runtime.sendMessage(
      {
        type: "CREATE_MEMORY",
        content,
        category: "misc",
        source: "extension:selection",
        explicit_signal: true,
      },
      (response) => {
        log("CREATE_MEMORY response for selection", response);
        sendResponse({ success: true, data: response });
      }
    );
    return true;
  }

  if (message.type === "SAVE_PAGE") {
    log("Received SAVE_PAGE", { url: message.url, title: message.title });
    const { url, title } = message;
    const content = `Saved page: ${title}\nURL: ${url}`;

    chrome.runtime.sendMessage(
      {
        type: "CREATE_MEMORY",
        content,
        category: "misc",
        source: "extension:page",
        explicit_signal: true,
      },
      (response) => {
        log("CREATE_MEMORY response for page", response);
        sendResponse({ success: true, data: response });
      }
    );
    return true;
  }

  if (message.type === "EXTRACT_CONVERSATION") {
    log("Received EXTRACT_CONVERSATION");
    const messages = extractor.getConversation();
    if (messages.length > 0) {
      const transcript = messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");

      log("Sending INGEST_CONVERSATION", { platform: extractor.getPlatformName(), messageCount: messages.length });
      chrome.runtime.sendMessage(
        {
          type: "INGEST_CONVERSATION",
          content: transcript,
          source: `extension:${extractor.getPlatformName()}`,
        },
        (response) => {
          log("INGEST_CONVERSATION response", response);
          sendResponse({ success: true, data: response });
        }
      );
    } else {
      logWarn("No conversation found on this page");
      sendResponse({ success: false, error: "No conversation found on this page" });
    }
    return true;
  }

  return false;
});
