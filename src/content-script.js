const ROOT_ID = "anki-ai-card-gen-root";
const MIN_SELECTION_LENGTH = 1;
const MAX_WORD_LENGTH = 80;
const AUTO_DELAY_MS = 850;
const UI_TIMEOUT_GRACE_MS = 10000;

let root;
let button;
let toast;
let dictionaryPanel;
let dictionaryWord;
let dictionaryPronunciation;
let dictionaryMeanings;
let dictionaryExamples;
let dictionaryExamplesSection;
let dictionaryStatus;
let dictionarySource;
let lastSelection = "";
let lastAutoSelection = "";
let autoTimer;
let requestTimer;
let dictionaryTimer;
let dictionaryRequestId = 0;
let isProcessing = false;
let currentStage = "idle";
let settings = {
  autoCreateOnSelection: true,
  showFloatingButton: true,
  showDictionaryPopup: true,
  customShortcut: "Ctrl+Shift+Y",
  contextCaptureMode: "words",
  contextWordsEachSide: 8,
  llmTimeoutSeconds: 45,
  ankiTimeoutSeconds: 8,
  siteAccessMode: "blocklist",
  siteRules: ""
};

init();

function init() {
  createUi();
  loadSettings();
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", hideSelectionUi, { passive: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, change] of Object.entries(changes)) {
      settings[key] = change.newValue;
    }
    if (changes.showDictionaryPopup && !settings.showDictionaryPopup) hideDictionaryPanel();
    if (changes.siteAccessMode || changes.siteRules) {
      hideSelectionUi();
      clearTimeout(autoTimer);
    }
  });
}

function loadSettings() {
  chrome.storage.sync.get([
    "autoCreateOnSelection",
    "showFloatingButton",
    "showDictionaryPopup",
    "customShortcut",
    "contextCaptureMode",
    "contextWordsEachSide",
    "llmTimeoutSeconds",
    "ankiTimeoutSeconds",
    "siteAccessMode",
    "siteRules"
  ], (values) => {
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
    .anki-button {
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
    .anki-button:hover { background: #272d36; }
    .dictionary-panel {
      position: fixed;
      z-index: 2147483646;
      display: none;
      width: min(360px, calc(100vw - 16px));
      max-height: min(390px, calc(100vh - 16px));
      overflow: auto;
      border: 1px solid rgba(20, 25, 36, .16);
      border-radius: 8px;
      color: #1d2524;
      background: #fffef9;
      box-shadow: 0 14px 38px rgba(0, 0, 0, .24);
      font-size: 13px;
      line-height: 1.42;
    }
    .dictionary-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      padding: 13px 14px 9px;
      border-bottom: 1px solid #e5e1d8;
    }
    .dictionary-title {
      min-width: 0;
    }
    .dictionary-word {
      display: block;
      overflow-wrap: anywhere;
      font-size: 18px;
      font-weight: 780;
      line-height: 1.2;
    }
    .dictionary-pronunciation {
      display: block;
      margin-top: 3px;
      color: #68716e;
      font-size: 12px;
    }
    .dictionary-close {
      width: 26px;
      height: 26px;
      border: 0;
      border-radius: 5px;
      color: #56605d;
      background: transparent;
      font: 700 15px/1 system-ui, sans-serif;
      cursor: pointer;
    }
    .dictionary-close:hover { background: #efede7; }
    .dictionary-body {
      padding: 11px 14px 12px;
    }
    .dictionary-status {
      margin: 0;
      color: #68716e;
    }
    .dictionary-status[data-tone="error"] { color: #8b3039; }
    .dictionary-meaning + .dictionary-meaning {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #ebe7df;
    }
    .dictionary-pos {
      margin-bottom: 3px;
      color: #1d6a58;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .dictionary-definition {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .dictionary-examples {
      margin-top: 11px;
      padding-top: 9px;
      border-top: 1px solid #ebe7df;
    }
    .dictionary-examples-label {
      margin: 0 0 5px;
      color: #68716e;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .dictionary-examples ol {
      margin: 0;
      padding-left: 19px;
    }
    .dictionary-examples li + li { margin-top: 4px; }
    .dictionary-source {
      display: inline-block;
      margin-top: 10px;
      color: #536b64;
      font-size: 10px;
      text-decoration: none;
    }
    .dictionary-source:hover { text-decoration: underline; }
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
  button.className = "anki-button";
  button.textContent = "+ Anki";
  button.title = "Create an Anki card from the selection";
  dictionaryPanel = document.createElement("aside");
  dictionaryPanel.className = "dictionary-panel";
  dictionaryPanel.setAttribute("role", "dialog");
  dictionaryPanel.setAttribute("aria-label", "Quick dictionary definition");
  const dictionaryHeader = document.createElement("div");
  dictionaryHeader.className = "dictionary-header";
  const dictionaryTitle = document.createElement("div");
  dictionaryTitle.className = "dictionary-title";
  dictionaryWord = document.createElement("strong");
  dictionaryWord.className = "dictionary-word";
  dictionaryPronunciation = document.createElement("span");
  dictionaryPronunciation.className = "dictionary-pronunciation";
  dictionaryTitle.append(dictionaryWord, dictionaryPronunciation);
  const dictionaryClose = document.createElement("button");
  dictionaryClose.type = "button";
  dictionaryClose.className = "dictionary-close";
  dictionaryClose.textContent = "x";
  dictionaryClose.title = "Close definition";
  dictionaryClose.setAttribute("aria-label", "Close definition");
  dictionaryHeader.append(dictionaryTitle, dictionaryClose);
  const dictionaryBody = document.createElement("div");
  dictionaryBody.className = "dictionary-body";
  dictionaryStatus = document.createElement("p");
  dictionaryStatus.className = "dictionary-status";
  dictionaryStatus.setAttribute("role", "status");
  dictionaryMeanings = document.createElement("div");
  dictionaryExamplesSection = document.createElement("div");
  dictionaryExamplesSection.className = "dictionary-examples";
  const examplesLabel = document.createElement("p");
  examplesLabel.className = "dictionary-examples-label";
  examplesLabel.textContent = "Examples";
  dictionaryExamples = document.createElement("ol");
  dictionaryExamplesSection.append(examplesLabel, dictionaryExamples);
  dictionarySource = document.createElement("a");
  dictionarySource.className = "dictionary-source";
  dictionarySource.target = "_blank";
  dictionarySource.rel = "noreferrer";
  dictionaryBody.append(dictionaryStatus, dictionaryMeanings, dictionaryExamplesSection, dictionarySource);
  dictionaryPanel.append(dictionaryHeader, dictionaryBody);
  toast = document.createElement("div");
  toast.className = "toast";
  shadow.append(style, button, dictionaryPanel, toast);
  document.documentElement.appendChild(root);

  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => processCurrentSelection());
  dictionaryPanel.addEventListener("mousedown", (event) => event.preventDefault());
  dictionaryClose.addEventListener("click", hideDictionaryPanel);
}

function onSelectionChange() {
  if (!isCurrentSiteAllowed()) {
    hideSelectionUi();
    return;
  }
  clearTimeout(autoTimer);
  window.setTimeout(() => {
    const selection = readSelection();
    lastSelection = selection.word;
    if (!selection.word) {
      hideSelectionUi();
      return;
    }

    if (settings.showFloatingButton) showButton(selection.rect);
    if (settings.showDictionaryPopup) scheduleDictionaryLookup(selection);
    else hideDictionaryPanel();
    if (settings.autoCreateOnSelection && selection.word !== lastAutoSelection) {
      autoTimer = window.setTimeout(() => {
        lastAutoSelection = selection.word;
        processSelection(selection.word, selection.context);
      }, AUTO_DELAY_MS);
    }
  }, 80);
}

function onKeyDown(event) {
  if (!isCurrentSiteAllowed()) return;
  if (!matchesShortcut(event, settings.customShortcut)) return;

  const selection = readSelection();
  if (!selection.word) {
    if (!isEditableElement(document.activeElement)) {
      event.preventDefault();
      showToast("Select exactly one word. Sentences are captured only as context.", "error");
    }
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  processSelection(selection.word, selection.context);
}

function readSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { word: "", context: "", rect: null };

  const rawText = selection.toString().replace(/\s+/g, " ").trim();
  const selectedWord = normalizeSelectedWord(rawText);
  if (!isUsableSelection(selectedWord)) return { word: "", context: "", rect: null };

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const context = getContext(range, rawText);
  return { word: selectedWord, context, rect };
}

function isUsableSelection(text) {
  if (text.length < MIN_SELECTION_LENGTH || text.length > MAX_WORD_LENGTH) return false;
  if (/\s/u.test(text)) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

function normalizeSelectedWord(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function getContext(range, selectedText) {
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
  const snapshot = getRangeTextSnapshot(element, range);
  const source = snapshot.text || element?.innerText || element?.textContent || selectedText;
  const index = snapshot.start >= 0
    ? snapshot.start
    : source.toLowerCase().indexOf(selectedText.toLowerCase());
  if (index < 0) return normalizeContextText(source).slice(0, 700);

  if (settings.contextCaptureMode === "sentence") {
    return getSentenceContext(source, index, snapshot.end > index ? snapshot.end - index : selectedText.length);
  }

  return getWordWindowContext(
    source,
    index,
    snapshot.end > index ? snapshot.end - index : selectedText.length,
    clampNumber(settings.contextWordsEachSide, 0, 40, 8)
  );
}

function getRangeTextSnapshot(rootElement, range) {
  const fallback = { text: "", start: -1, end: -1 };
  if (!rootElement) return fallback;

  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
  let text = "";
  let start = -1;
  let end = -1;
  let node = walker.nextNode();

  while (node) {
    if (node === range.startContainer) start = text.length + range.startOffset;
    if (node === range.endContainer) end = text.length + range.endOffset;
    text += node.textContent || "";
    node = walker.nextNode();
  }

  return { text, start, end };
}

function getWordWindowContext(text, selectedStart, selectedLength, wordsEachSide) {
  const selectedEnd = selectedStart + selectedLength;
  const tokens = [...text.matchAll(/\S+/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length
  }));
  const firstSelectedToken = tokens.findIndex((token) => token.start <= selectedStart && token.end > selectedStart);
  const lastSelectedToken = tokens.findIndex((token) => token.start < selectedEnd && token.end >= selectedEnd);
  if (firstSelectedToken < 0 || lastSelectedToken < 0) {
    const start = Math.max(0, selectedStart - 220);
    const end = Math.min(text.length, selectedEnd + 220);
    return normalizeContextText(text.slice(start, end));
  }

  const startToken = Math.max(0, firstSelectedToken - wordsEachSide);
  const endToken = Math.min(tokens.length - 1, lastSelectedToken + wordsEachSide);
  return normalizeContextText(text.slice(tokens[startToken].start, tokens[endToken].end));
}

function getSentenceContext(text, selectedStart, selectedLength) {
  const selectedEnd = selectedStart + selectedLength;
  const leftBoundary = findLeftSentenceBoundary(text, selectedStart);
  const rightBoundary = findRightSentenceBoundary(text, selectedEnd);
  return normalizeContextText(text.slice(leftBoundary, rightBoundary));
}

function findLeftSentenceBoundary(text, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (/[.!?。！？…]/u.test(text[i])) {
      let start = i + 1;
      while (text[start] === " ") start += 1;
      return start;
    }
  }
  return 0;
}

function findRightSentenceBoundary(text, index) {
  for (let i = index; i < text.length; i += 1) {
    if (/[.!?。！？…]/u.test(text[i])) return i + 1;
  }
  return text.length;
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

function hideSelectionUi() {
  hideButton();
  hideDictionaryPanel();
}

function scheduleDictionaryLookup(selection) {
  if (!isCurrentSiteAllowed()) return;
  window.clearTimeout(dictionaryTimer);
  const requestId = ++dictionaryRequestId;
  showDictionaryLoading(selection.word, selection.rect);
  dictionaryTimer = window.setTimeout(() => {
    chrome.runtime.sendMessage({
      type: "lookup-dictionary-word",
      word: selection.word,
      language: "en"
    }, (response) => {
      if (requestId !== dictionaryRequestId) return;
      if (chrome.runtime.lastError) {
        showDictionaryError(chrome.runtime.lastError.message, selection.rect);
        return;
      }
      if (!response?.ok) {
        showDictionaryError(response?.error || "Definition not found.", selection.rect);
        return;
      }
      renderDictionaryResult(response.result, selection.rect);
    });
  }, 180);
}

function showDictionaryLoading(word, rect) {
  dictionaryWord.textContent = word;
  dictionaryPronunciation.textContent = "";
  dictionaryMeanings.replaceChildren();
  dictionaryExamples.replaceChildren();
  dictionaryExamplesSection.hidden = true;
  dictionarySource.hidden = true;
  dictionaryStatus.hidden = false;
  dictionaryStatus.dataset.tone = "info";
  dictionaryStatus.textContent = "Looking up...";
  showDictionaryPanel(rect);
}

function showDictionaryError(message, rect) {
  dictionaryMeanings.replaceChildren();
  dictionaryExamples.replaceChildren();
  dictionaryExamplesSection.hidden = true;
  dictionarySource.hidden = true;
  dictionaryStatus.hidden = false;
  dictionaryStatus.dataset.tone = "error";
  dictionaryStatus.textContent = message;
  showDictionaryPanel(rect);
}

function renderDictionaryResult(result, rect) {
  dictionaryWord.textContent = result.word;
  dictionaryPronunciation.textContent = result.pronunciation || "";
  dictionaryStatus.hidden = true;
  dictionaryMeanings.replaceChildren(...result.meanings.slice(0, 2).map((meaning) => {
    const block = document.createElement("div");
    block.className = "dictionary-meaning";
    if (meaning.partOfSpeech) {
      const partOfSpeech = document.createElement("div");
      partOfSpeech.className = "dictionary-pos";
      partOfSpeech.textContent = meaning.partOfSpeech;
      block.appendChild(partOfSpeech);
    }
    const definition = document.createElement("p");
    definition.className = "dictionary-definition";
    definition.textContent = meaning.definition;
    block.appendChild(definition);
    return block;
  }));
  dictionaryExamples.replaceChildren(...result.examples.slice(0, 2).map((example) => {
    const item = document.createElement("li");
    item.textContent = example;
    return item;
  }));
  dictionaryExamplesSection.hidden = result.examples.length === 0;
  dictionarySource.href = result.sourceUrl || "https://en.wiktionary.org/";
  dictionarySource.textContent = result.attribution || "FreeDictionaryAPI.com · Wiktionary · CC BY-SA";
  dictionarySource.hidden = false;
  showDictionaryPanel(rect);
}

function showDictionaryPanel(rect) {
  if (!rect) return;
  dictionaryPanel.style.display = "block";
  dictionaryPanel.style.visibility = "hidden";
  window.requestAnimationFrame(() => {
    const panelRect = dictionaryPanel.getBoundingClientRect();
    const left = Math.min(window.innerWidth - panelRect.width - 8, Math.max(8, rect.left));
    const below = rect.bottom + 10;
    const above = rect.top - panelRect.height - 10;
    const top = below + panelRect.height <= window.innerHeight - 8 ? below : Math.max(8, above);
    dictionaryPanel.style.left = `${left}px`;
    dictionaryPanel.style.top = `${top}px`;
    dictionaryPanel.style.visibility = "visible";
  });
}

function hideDictionaryPanel() {
  window.clearTimeout(dictionaryTimer);
  dictionaryRequestId += 1;
  if (dictionaryPanel) dictionaryPanel.style.display = "none";
}

function processCurrentSelection() {
  if (!isCurrentSiteAllowed()) {
    showToast("The extension is disabled on this site.", "info");
    return;
  }
  const selection = readSelection();
  if (!selection.word) {
    showToast("Select exactly one word. Sentences are captured only as context.", "error");
    return;
  }
  processSelection(selection.word, selection.context);
}

function matchesShortcut(event, shortcut) {
  const expected = parseShortcut(shortcut);
  if (!expected.key) return false;
  return event.ctrlKey === expected.ctrl
    && event.altKey === expected.alt
    && event.shiftKey === expected.shift
    && event.metaKey === expected.meta
    && normalizeKey(event.key) === expected.key;
}

function parseShortcut(shortcut) {
  const result = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const part of String(shortcut || "").split("+")) {
    const normalized = part.trim().toLowerCase();
    if (normalized === "ctrl" || normalized === "control") result.ctrl = true;
    else if (normalized === "alt" || normalized === "option") result.alt = true;
    else if (normalized === "shift") result.shift = true;
    else if (normalized === "meta" || normalized === "cmd" || normalized === "command") result.meta = true;
    else if (normalized) result.key = normalizeKey(part);
  }
  return result;
}

function normalizeKey(key) {
  const aliases = {
    " ": "Space",
    "esc": "Escape",
    "escape": "Escape",
    "return": "Enter",
    "arrowup": "ArrowUp",
    "arrowdown": "ArrowDown",
    "arrowleft": "ArrowLeft",
    "arrowright": "ArrowRight"
  };
  const raw = String(key || "").trim();
  const lower = raw.toLowerCase();
  if (aliases[lower]) return aliases[lower];
  if (raw.length === 1) return raw.toUpperCase();
  return raw;
}

function isEditableElement(element) {
  if (!element) return false;
  const tagName = element.tagName?.toLowerCase();
  return element.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function normalizeContextText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function processSelection(word, context) {
  if (!isCurrentSiteAllowed()) {
    showToast("The extension is disabled on this site.", "info");
    return;
  }
  if (isProcessing) {
    showToast("A card request is already running. Wait for it to finish.", "info", 4200);
    return;
  }

  isProcessing = true;
  currentStage = "starting";
  hideButton();
  showToast(`Creating Anki card for "${word}"... LLM responses can take a while.`, "info", 0);
  requestTimer = window.setTimeout(() => {
    isProcessing = false;
    showToast(`No response yet while ${currentStage}. Increase timeouts or check this stage in options.`, "error", 9000);
  }, getUiRequestTimeoutMs());

  chrome.runtime.sendMessage({ type: "process-selection", word, context }, (response) => {
    window.clearTimeout(requestTimer);
    isProcessing = false;
    currentStage = "idle";
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

function getUiRequestTimeoutMs() {
  const llmMs = clampNumber(settings.llmTimeoutSeconds, 3, 180, 45) * 1000;
  const ankiMs = clampNumber(settings.ankiTimeoutSeconds, 3, 60, 8) * 1000;
  return llmMs + ankiMs * 6 + UI_TIMEOUT_GRACE_MS;
}

function isCurrentSiteAllowed() {
  return SiteAccess.isAllowed(location.href, settings.siteAccessMode, settings.siteRules);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "read-selection") {
    if (!isCurrentSiteAllowed()) {
      sendResponse({ word: "", context: "", blocked: true });
      return true;
    }
    sendResponse(readSelection());
    return true;
  }

  if (message?.type === "create-card-from-current-selection") {
    if (!isCurrentSiteAllowed()) {
      sendResponse({ ok: false, error: "The extension is disabled on this site." });
      return true;
    }
    const selection = readSelection();
    if (!selection.word) {
      sendResponse({ ok: false, error: "Select exactly one word. Sentences are captured only as context." });
      return true;
    }
    processSelection(selection.word, selection.context);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "anki-card-result") {
    showToast(`Added "${message.result.card.term}" to Anki.`, "success");
  }

  if (message?.type === "anki-card-progress") {
    currentStage = message.message || "working";
    showToast(message.message || "Working...", "info", 0);
  }

  if (message?.type === "anki-card-error") {
    showToast(message.error || "Could not create the card.", "error");
  }

  return false;
});
