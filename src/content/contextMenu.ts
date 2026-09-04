chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "recall-save-selection",
    title: "Save to Recallish Memory",
    contexts: ["selection"],
    documentUrlPatterns: ["<all_urls>"],
  });

  chrome.contextMenus.create({
    id: "recall-save-page",
    title: "Save Page to Recallish Memory",
    contexts: ["page"],
    documentUrlPatterns: ["<all_urls>"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "recall-save-selection" && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: "SAVE_SELECTION",
      text: info.selectionText,
      url: tab.url,
      title: tab.title,
    });
  }

  if (info.menuItemId === "recall-save-page" && tab.url && tab.title) {
    chrome.tabs.sendMessage(tab.id, {
      type: "SAVE_PAGE",
      url: tab.url,
      title: tab.title,
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SAVE_SELECTION_RESULT") {
    console.log("[Recallish] Selection saved:", message.data);
  }
  if (message.type === "SAVE_PAGE_RESULT") {
    console.log("[Recallish] Page saved:", message.data);
  }
});
