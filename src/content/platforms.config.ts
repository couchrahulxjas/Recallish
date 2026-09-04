import { PlatformConfig } from "./platforms";
import { injectText as sharedInject } from "./inject";

export const PLATFORMS: PlatformConfig[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    urlPatterns: ["*://chat.openai.com/*", "*://chatgpt.com/*"],
    selectors: {
      conversationContainer: '[data-testid="conversation-panel"], main',
      messageElements: '[data-message-author-role]',
      userMessage: '[data-message-author-role="user"]',
      assistantMessage: '[data-message-author-role="assistant"]',
      messageContent: ".markdown, .prose, [data-message-content]",
      inputElement: '#prompt-textarea, textarea[data-testid="prompt-textarea"], form textarea',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(".markdown, .prose, [data-message-content]");
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("chatgpt", text),
  },
  {
    id: "claude",
    name: "Claude",
    urlPatterns: ["*://claude.ai/*", "*://claude.ai/chat/*"],
    selectors: {
      conversationContainer: ".conversation-container, main",
      messageElements: ".message, [data-testid*='message']",
      userMessage: ".user-message, [data-is-user='true']",
      assistantMessage: ".assistant-message, [data-is-user='false']",
      messageContent: ".message-content, .markdown, prose",
      inputElement: '[contenteditable="true"], .ProseMirror, .ql-editor, textarea',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(".message-content, .markdown, .prose");
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("claude", text),
  },
  {
    id: "gemini",
    name: "Gemini",
    urlPatterns: ["*://gemini.google.com/*", "*://bard.google.com/*"],
    selectors: {
      conversationContainer: ".conversation-container, main",
      messageElements: ".message, [data-turn-id]",
      userMessage: ".user-message, [data-author='user']",
      assistantMessage: ".model-message, [data-author='model']",
      messageContent: ".message-content, .markdown",
      inputElement: 'rich-textarea div[contenteditable="true"], rich-textarea, [contenteditable="true"]',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(".message-content, .markdown");
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("gemini", text),
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    urlPatterns: ["*://chat.deepseek.com/*"],
    selectors: {
      conversationContainer: "main, .chat-container, [class*='conversation']",
      messageElements: ".message, [data-message-id], [class*='message']",
      userMessage: ".user-message, [data-role='user'], [class*='user-message']",
      assistantMessage: ".assistant-message, [data-role='assistant'], [class*='assistant-message'], .think, .ds-md",
      messageContent: ".message-content, .markdown, .ds-markdown, [class*='markdown']",
      inputElement: 'textarea#chat-input, textarea[data-testid*="chat-input"], div[contenteditable="true"]',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(
        ".message-content, .markdown, .ds-markdown, [class*='markdown']",
      );
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("deepseek", text),
  },
  {
    id: "qwen",
    name: "Qwen",
    urlPatterns: ["*://chat.qwen.ai/*", "*://chat.qwenlm.ai/*", "*://tongyi.aliyun.com/*"],
    selectors: {
      conversationContainer: "main, .conversation-container, [class*='chat']",
      messageElements: ".message, [data-message-id], [class*='message']",
      userMessage: ".user-message, [data-role='user'], [class*='user']",
      assistantMessage: ".assistant-message, [data-role='assistant'], [class*='assistant'], .tw-chat-bubble",
      messageContent: ".message-content, .markdown, .tw-markdown, [class*='markdown']",
      inputElement: 'textarea, div[contenteditable="true"]',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(
        ".message-content, .markdown, .tw-markdown, [class*='markdown']",
      );
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("qwen", text),
  },
  {
    id: "cursor",
    name: "Cursor",
    urlPatterns: ["*://cursor.com/*", "*://*.cursor.sh/*"],
    selectors: {
      conversationContainer: ".chat-history, .conversation-view",
      messageElements: ".message, [data-message-id]",
      userMessage: ".user-message, [data-role='user']",
      assistantMessage: ".assistant-message, [data-role='assistant']",
      messageContent: ".message-content, .markdown",
      inputElement: 'textarea, div[contenteditable="true"]',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(".message-content, .markdown");
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("cursor", text),
  },
  {
    id: "grok",
    name: "Grok",
    urlPatterns: ["*://grok.com/*", "*://x.com/i/grok/*"],
    selectors: {
      conversationContainer: "main, [class*='chat'], [data-testid*='chat']",
      messageElements: "[class*='message'], [data-testid*='message'], [class*='bubble']",
      userMessage: "[data-testid*='user'], [class*='user']",
      assistantMessage: "[data-testid*='assistant'], [data-testid*='model'], [class*='assistant']",
      messageContent: "[class*='markdown'], [class*='content'], [data-testid*='message']",
      inputElement: 'div[contenteditable="true"], textarea',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(
        "[class*='markdown'], [class*='content'], [data-testid*='message']",
      );
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("grok", text),
  },
  {
    id: "perplexity",
    name: "Perplexity",
    urlPatterns: ["*://perplexity.ai/*", "*://www.perplexity.ai/*"],
    selectors: {
      conversationContainer: "main, [class*='thread'], [class*='conversation']",
      messageElements: "[class*='message'], [data-testid*='message']",
      userMessage: "[data-testid*='user'], [class*='user']",
      assistantMessage: "[data-testid*='assistant'], [data-testid*='model'], [class*='assistant']",
      messageContent: "[class*='markdown'], [class*='prose'], [class*='content']",
      inputElement: 'textarea, div[contenteditable="true"], [contenteditable="true"]',
    },
    extractText: (element: Element) => {
      const contentEl = element.querySelector(
        "[class*='markdown'], [class*='prose'], [class*='content']",
      );
      return contentEl?.textContent?.trim() || element.textContent?.trim() || "";
    },
    injectText: (text) => injectFor("perplexity", text),
  },
];

function injectFor(id: string, text: string): boolean {
  const platform = getPlatformById(id);
  if (!platform) return false;
  return sharedInject(platform, text).ok;
}

export function getPlatformForUrl(url: string): PlatformConfig | undefined {
  return PLATFORMS.find((p) =>
    p.urlPatterns.some((pattern) => matchPattern(pattern, url))
  );
}

export function getPlatformById(id: string): PlatformConfig | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

function matchPattern(pattern: string, url: string): boolean {
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(url);
}
