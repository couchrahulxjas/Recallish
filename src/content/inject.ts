import { PlatformConfig } from "./platforms";

function findInputElement(selectors: string[]): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function dispatchInputEvents(el: HTMLElement): void {
  const events: Event[] = [
    new InputEvent("beforeinput", { bubbles: true, composed: true, inputType: "insertText", data: null }),
    new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: null }),
    new KeyboardEvent("keyup", { bubbles: true, key: " " }),
    new Event("change", { bubbles: true }),
  ];
  for (const evt of events) {
    el.dispatchEvent(evt);
  }
}

// Sets the value of a controlled <textarea>/<input> using React/Vue's native
// value setter so the framework re-renders with the new text.
function setControlledInput(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto =
    el.tagName.toLowerCase() === "textarea"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(el, text);
  dispatchInputEvents(el);
}

function isEditableInput(el: HTMLElement | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "textarea" || (tag === "input" && el.getAttribute("type") !== "button" && el.getAttribute("type") !== "submit");
}

// Inserts text into a contenteditable composer (ChatGPT, Claude, Gemini, Grok
// use ProseMirror-style editors). We clear and rewrite the content, then fire
// the composition + input events they rely on to enable the send button.
function setContentEditable(el: HTMLElement, text: string): void {
  el.focus();
  (el as HTMLElement).textContent = "";
  const node = document.createTextNode(text);
  el.appendChild(node);

  el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: text }));
  el.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: text }));
  dispatchInputEvents(el);
  el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));

  // Move the caret to the end and scroll it into view.
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.scrollIntoView({ block: "center" });
}

export function injectText(
  platform: PlatformConfig,
  text: string,
): { ok: boolean; error?: string } {
  if (!text || !text.trim()) {
    return { ok: false, error: "Nothing to inject." };
  }

  const el = findInputElement([platform.selectors.inputElement]);
  if (!el) {
    return { ok: false, error: `Chat input not found. Is the ${platform.name} page loaded and ready?` };
  }

  try {
    if (isEditableInput(el)) {
      setControlledInput(el, text);
      el.focus();
    } else {
      setContentEditable(el, text);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to inject into the chat input.",
    };
  }
}
