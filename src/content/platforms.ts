export interface PlatformDetector {
  name: string;
  match: (url: string) => boolean;
  extractConversation: () => ConversationMessage[];
  observeChanges: (callback: (messages: ConversationMessage[]) => void) => () => void;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

export interface PlatformConfig {
  id: string;
  name: string;
  urlPatterns: string[];
  selectors: {
    conversationContainer: string;
    messageElements: string;
    userMessage: string;
    assistantMessage: string;
    messageContent: string;
    // Input element used to accept a transferred conversation.
    inputElement: string;
  };
  extractText: (element: Element) => string;
  // Insert raw text into the chat composer. Handles both <textarea>/<input>
  // and contenteditable composer elements, dispatching the events the target
  // app listens for so the "Send" button becomes active.
  injectText: (text: string) => boolean;
}
