const ROOT_ID = "anki-ai-card-gen-root";
const MIN_SELECTION_LENGTH = 1;
const MAX_SELECTION_LENGTH = 160;
const AUTO_DELAY_MS = 850;
const UI_REQUEST_TIMEOUT_MS = 70000;

let root;
let button;
let toast;
let lastSelection = "";
let lastAutoSelection = "";
let autoTimer;
let requestTimer;
let isProcessing = false;
let settings = {
  autoCreateOnSelection: true,
  showFloatingButton: true
};

init();

function init() {
  createUi();
  loadSettings();
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("scroll", hideButton, { passive: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, change] of Object.entries(changes)) {
      settings[key] = change.newValue;
    }
  });
}

function loadSettings() {
  chrome.storage.sync.get(["autoCreateOnSelection", "showFloatingButton"], (values) => {
    settings = { ...settings, ...values };
  });
}

function createUi() {
  root = document.getElementById(ROOT_ID);
  if (root) return;

  root = document.createElement("div");
  root.id = ROOT_ID;
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button {
      position: fixed;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 6px;
      height: 34px;
      padding: 0 11px;
      border: 1px solid rgba(20, 25, 36, .18);
      border-radius: 8px;
      color: #f7f3e8;
      background: #171b22;
      box-shadow: 0 10px 26px rgba(0, 0, 0, .22);
      font-size: 13px;
      font-weight: 650;
      letter-spacing: 0;
      cursor: pointer;
    }
    button:hover { background: #272d36; }
    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      display: none;
      max-width: min(360px, calc(100vw - 36px));
      padding: 12px 14px;
      border: 1px solid rgba(20, 25, 36, .14);
      border-radius: 8px;
      color: #f8f5ec;
      background: #171b22;
      box-shadow: 0 12px 30px rgba(0, 0, 0, .26);
      font-size: 13px;
      line-height: 1.35;
    }
    .toast[data-tone="error"] { background: #5c1f26; }
    .toast[data-tone="success"] { background: #143f34; }
  `;
  button = document.createElement("button");
  button.type = "button";
  button.textContent = "+ Anki";
  button.title = "Create an Anki card from the selection";
  toast = document.createElement("div");
  toast.className = "toast";
  shadow.append(style, button, toast);
  document.documentElement.appendChild(root);

  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => processCurrentSelection());
}

function onSelectionChange() {
  clearTimeout(autoTimer);
  window.setTimeout(() => {
    const selection = readSelection();
    lastSelection = selection.word;
    if (!selection.word) {
      hideButton();
      return;
    }

    if (settings.showFloatingButton) showButton(selection.rect);
    if (settings.autoCreateOnSelection && selection.word !== lastAutoSelection) {
      autoTimer = window.setTimeout(() => {
        lastAutoSelection = selection.word;
        processSelection(selection.word, selection.context);
      }, AUTO_DELAY_MS);
    }
  }, 80);
}

function readSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { word: "", context: "", rect: null };

  const rawText = selection.toString().replace(/\s+/g, " ").trim();
  if (!isUsableSelection(rawText)) return { word: "", context: "", rect: null };

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const context = getContext(range, rawText);
  return { word: rawText.slice(0, MAX_SELECTION_LENGTH), context, rect };
}

function isUsableSelection(text) {
  if (text.length < MIN_SELECTION_LENGTH || text.length > MAX_SELECTION_LENGTH) return false;
  if (/[\r\n]/.test(text)) return false;
  if (text.split(/\s+/).length > 6) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

function getContext(range, selectedText) {
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
  const source = element?.innerText || element?.textContent || selectedText;
  const normalized = source.replace(/\s+/g, " ").trim();
  const index = normalized.toLowerCase().indexOf(selectedText.toLowerCase());
  if (index < 0) return normalized.slice(0, 500);
  const start = Math.max(0, index - 220);
  const end = Math.min(normalized.length, index + selectedText.length + 220);
  return normalized.slice(start, end);
}

function showButton(rect) {
  if (!rect || rect.width === 0 || rect.height === 0) return;
  const top = Math.max(8, rect.top - 42);
  const left = Math.min(window.innerWidth - 84, Math.max(8, rect.left));
  button.style.top = `${top}px`;
  button.style.left = `${left}px`;
  button.style.display = "inline-flex";
}

function hideButton() {
  if (button) button.style.display = "none";
}

function processCurrentSelection() {
  const selection = readSelection();
  if (!selection.word) {
    showToast("Select a word first.", "error");
    return;
  }
  processSelection(selection.word, selection.context);
}

function processSelection(word, context) {
  if (isProcessing) {
    showToast("A card request is already running. Wait for it to finish.", "info", 4200);
    return;
  }

  isProcessing = true;
  hideButton();
  showToast(`Creating Anki card for "${word}"... LLM responses can take a while.`, "info", 0);
  requestTimer = window.setTimeout(() => {
    isProcessing = false;
    showToast("The extension did not receive a response in time. Check the LLM timeout in options and try a faster model.", "error", 9000);
  }, UI_REQUEST_TIMEOUT_MS);

  chrome.runtime.sendMessage({ type: "process-selection", word, context }, (response) => {
    window.clearTimeout(requestTimer);
    isProcessing = false;
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message, "error");
      return;
    }
    if (!response?.ok) {
      showToast(response?.error || "Could not create the card.", "error");
      return;
    }
    showToast(`Added "${response.result.card.term}" to Anki.`, "success");
  });
}

function showToast(message, tone = "info", timeout = 4200) {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.style.display = "block";
  if (timeout > 0) {
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.style.display = "none";
    }, timeout);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "read-selection") {
    sendResponse(readSelection());
    return true;
  }

  if (message?.type === "create-card-from-current-selection") {
    const selection = readSelection();
    if (!selection.word) {
      sendResponse({ ok: false, error: "Select a word first." });
      return true;
    }
    processSelection(selection.word, selection.context);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "anki-card-result") {
    showToast(`Added "${message.result.card.term}" to Anki.`, "success");
  }

  if (message?.type === "anki-card-error") {
    showToast(message.error || "Could not create the card.", "error");
  }

  return false;
});
