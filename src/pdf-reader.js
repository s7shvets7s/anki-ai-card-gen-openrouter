installPdfJsPolyfills();

const { GlobalWorkerOptions, TextLayer, getDocument } = await import("../vendor/pdfjs/pdf.min.mjs");

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker-wrapper.mjs");

const MIN_WORD_LENGTH = 1;
const MAX_WORD_LENGTH = 80;
const UI_TIMEOUT_GRACE_MS = 10000;
const ZOOM_STEP = 0.15;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;
const READER_SESSION_KEY = "pdfReaderSession";
const READER_DB_NAME = "anki-ai-pdf-reader";
const READER_DB_VERSION = 1;
const READER_DOCUMENT_STORE = "documents";
const LAST_LOCAL_PDF_KEY = "last-local-pdf";
const SESSION_SAVE_DELAY_MS = 350;

const elements = {
  openFileButton: document.getElementById("openFileButton"),
  emptyOpenButton: document.getElementById("emptyOpenButton"),
  fileInput: document.getElementById("fileInput"),
  documentName: document.getElementById("documentName"),
  previousPageButton: document.getElementById("previousPageButton"),
  nextPageButton: document.getElementById("nextPageButton"),
  pageNumber: document.getElementById("pageNumber"),
  pageCount: document.getElementById("pageCount"),
  zoomOutButton: document.getElementById("zoomOutButton"),
  zoomInButton: document.getElementById("zoomInButton"),
  fitWidthButton: document.getElementById("fitWidthButton"),
  edgeMenuToggle: document.getElementById("edgeMenuToggle"),
  settingsButton: document.getElementById("settingsButton"),
  readerViewport: document.getElementById("readerViewport"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
  loadingText: document.getElementById("loadingText"),
  pageArea: document.getElementById("pageArea"),
  pagesContainer: document.getElementById("pagesContainer"),
  dictionaryPanel: document.getElementById("dictionaryPanel"),
  dictionaryWord: document.getElementById("dictionaryWord"),
  dictionaryPronunciation: document.getElementById("dictionaryPronunciation"),
  dictionaryMeanings: document.getElementById("dictionaryMeanings"),
  dictionaryExamplesSection: document.getElementById("dictionaryExamplesSection"),
  dictionaryExamples: document.getElementById("dictionaryExamples"),
  dictionaryStatus: document.getElementById("dictionaryStatus"),
  dictionarySource: document.getElementById("dictionarySource"),
  dictionaryCloseButton: document.getElementById("dictionaryCloseButton"),
  ankiButton: document.getElementById("ankiButton"),
  toast: document.getElementById("toast"),
  dropOverlay: document.getElementById("dropOverlay")
};

let pdfDocument = null;
let loadingTask = null;
let pageObserver = null;
let pageViews = new Map();
let layoutGeneration = 0;
let firstPageSize = { width: 612, height: 792 };
let pageNumber = 1;
let scale = 1;
let fitWidth = true;
let settings = {
  customShortcut: "Ctrl+Shift+Y",
  contextCaptureMode: "words",
  contextWordsEachSide: 8,
  suppressEdgeMiniMenu: true,
  showFloatingButton: true,
  showDictionaryPopup: true,
  autoCreateOnSelection: false,
  llmTimeoutSeconds: 45,
  ankiTimeoutSeconds: 8
};
let currentSource = "";
let currentBook = null;
let isProcessing = false;
let currentRequestId = "";
let requestTimer = 0;
let autoTimer = 0;
let scrollTimer = 0;
let readerTabId = null;
let wheelZoomTimer = 0;
let pendingWheelScale = null;
let sessionSaveTimer = 0;
let dictionaryTimer = 0;
let dictionaryRequestId = 0;

initialize();

async function initialize() {
  bindEvents();
  lockReaderInterfaceZoom();
  settings = { ...settings, ...(await chrome.storage.sync.get(Object.keys(settings))) };
  elements.edgeMenuToggle.checked = Boolean(settings.suppressEdgeMiniMenu);
  updateControls();

  const sourceUrl = new URLSearchParams(location.search).get("url");
  const savedSession = await getSavedReaderSession();
  if (sourceUrl && /^https?:/i.test(sourceUrl)) {
    const savedPosition = savedSession?.sourceType === "remote" && savedSession.url === sourceUrl
      ? savedSession
      : null;
    await openRemotePdf(sourceUrl, savedPosition);
  } else if (savedSession) {
    await restoreReaderSession(savedSession);
  }
}

function bindEvents() {
  elements.openFileButton.addEventListener("click", chooseFile);
  elements.emptyOpenButton.addEventListener("click", chooseFile);
  elements.fileInput.addEventListener("change", () => {
    const [file] = elements.fileInput.files || [];
    if (file) openLocalPdf(file);
  });
  elements.previousPageButton.addEventListener("click", () => changePage(pageNumber - 1));
  elements.nextPageButton.addEventListener("click", () => changePage(pageNumber + 1));
  elements.pageNumber.addEventListener("change", () => changePage(Number(elements.pageNumber.value)));
  elements.zoomOutButton.addEventListener("click", () => changeZoom(scale - ZOOM_STEP));
  elements.zoomInButton.addEventListener("click", () => changeZoom(scale + ZOOM_STEP));
  elements.fitWidthButton.addEventListener("click", () => {
    window.clearTimeout(wheelZoomTimer);
    pendingWheelScale = null;
    fitWidth = true;
    rebuildPageLayout();
  });
  elements.edgeMenuToggle.addEventListener("change", async () => {
    settings.suppressEdgeMiniMenu = elements.edgeMenuToggle.checked;
    await chrome.storage.sync.set({ suppressEdgeMiniMenu: settings.suppressEdgeMiniMenu });
  });
  elements.settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.ankiButton.addEventListener("mousedown", (event) => event.preventDefault());
  elements.ankiButton.addEventListener("click", processCurrentSelection);
  elements.dictionaryPanel.addEventListener("mousedown", (event) => event.preventDefault());
  elements.dictionaryCloseButton.addEventListener("click", hideDictionaryPanel);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("mouseup", suppressEdgeMiniMenu, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("wheel", onWheelZoom, { capture: true, passive: false });
  elements.readerViewport.addEventListener("scroll", onReaderScroll, { passive: true });
  window.addEventListener("resize", debounce(() => {
    if (pdfDocument && fitWidth) rebuildPageLayout();
  }, 180));
  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.tabs.onZoomChange.addListener(onBrowserZoomChange);
  window.addEventListener("unload", () => {
    chrome.tabs.onZoomChange.removeListener(onBrowserZoomChange);
    saveReaderSession();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveReaderSession();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of Object.keys(settings)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
    elements.edgeMenuToggle.checked = Boolean(settings.suppressEdgeMiniMenu);
    if (changes.showDictionaryPopup && !settings.showDictionaryPopup) hideDictionaryPanel();
  });
}

function suppressEdgeMiniMenu(event) {
  if (!settings.suppressEdgeMiniMenu || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target?.closest?.(".textLayer")) return;
  event.preventDefault();
  event.stopPropagation();
}

function chooseFile() {
  elements.fileInput.value = "";
  elements.fileInput.click();
}

async function openLocalPdf(file) {
  if (!isPdfFile(file)) {
    showToast("Выберите файл PDF.", "error");
    return;
  }
  currentBook = null;
  currentSource = file.name;
  const opened = await loadPdf({ data: new Uint8Array(await file.arrayBuffer()) }, file.name);
  if (!opened) return;

  try {
    await saveLastLocalPdf(file);
    currentBook = {
      sourceType: "local",
      name: file.name,
      size: file.size,
      lastModified: file.lastModified || 0
    };
    await saveReaderSession();
  } catch (error) {
    console.error("Could not remember the local PDF", error);
    showToast("PDF открыт, но Edge не смог сохранить его для следующего запуска.", "error", 8000);
  }
}

async function openRemotePdf(url, savedPosition = null) {
  currentBook = null;
  currentSource = url;
  const pathName = new URL(url).pathname.split("/").pop() || "document.pdf";
  let name = pathName;
  try {
    name = decodeURIComponent(pathName);
  } catch {
    // Keep the encoded filename when the URL contains malformed escape sequences.
  }
  const opened = await loadPdf({ url }, name, savedPosition);
  if (!opened) return;
  currentBook = { sourceType: "remote", name, url };
  deleteLastLocalPdf().catch((error) => {
    console.error("Could not remove the previous local PDF", error);
  });
  await saveReaderSession();
}

async function loadPdf(source, name, savedPosition = null) {
  showReaderState("loading", `Открываю ${name}...`);
  try {
    clearPageLayout();
    if (loadingTask) await loadingTask.destroy().catch(() => {});
    pdfDocument = null;
    loadingTask = getDocument({
      ...source,
      cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"),
      wasmUrl: chrome.runtime.getURL("vendor/pdfjs/wasm/")
    });
    pdfDocument = await loadingTask.promise;
    pageNumber = clamp(Math.round(Number(savedPosition?.page) || 1), 1, pdfDocument.numPages);
    fitWidth = true;
    elements.documentName.textContent = name;
    elements.documentName.title = currentSource;
    elements.pageCount.textContent = String(pdfDocument.numPages);
    elements.pageNumber.max = String(pdfDocument.numPages);
    showReaderState("page");
    await rebuildPageLayout(false, normalizePageRatio(savedPosition?.pageRatio));
    updateControls();
    return true;
  } catch (error) {
    pdfDocument = null;
    currentBook = null;
    showReaderState("empty");
    showToast(formatPdfError(error), "error", 9000);
    updateControls();
    return false;
  }
}

async function rebuildPageLayout(preservePage = true, restoredPageRatio = 0) {
  if (!pdfDocument) return;
  const generation = ++layoutGeneration;
  const anchorPage = pageNumber;
  const anchorRatio = preservePage ? getPageAnchorRatio(anchorPage) : restoredPageRatio;
  hideSelectionUi();
  disconnectPageObserver();
  for (const view of pageViews.values()) cancelPageRender(view);

  const firstPage = await pdfDocument.getPage(1);
  if (generation !== layoutGeneration) return;
  const baseViewport = firstPage.getViewport({ scale: 1 });
  firstPageSize = { width: baseViewport.width, height: baseViewport.height };
  if (fitWidth) {
    const horizontalPadding = elements.readerViewport.clientWidth <= 860 ? 36 : 96;
    const available = Math.max(280, elements.readerViewport.clientWidth - horizontalPadding);
    scale = clamp(available / baseViewport.width, MIN_SCALE, MAX_SCALE);
  }

  pageViews = new Map();
  elements.pagesContainer.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (let number = 1; number <= pdfDocument.numPages; number += 1) {
    const view = createPageView(number);
    pageViews.set(number, view);
    fragment.appendChild(view.element);
  }
  elements.pagesContainer.appendChild(fragment);
  pageNumber = clamp(anchorPage, 1, pdfDocument.numPages);
  elements.pageNumber.value = String(pageNumber);
  scrollToPage(pageNumber, false, anchorRatio);
  setupPageObserver();
  updateControls();
  const currentView = pageViews.get(pageNumber);
  if (currentView) renderPage(currentView);
}

function changePage(nextPage) {
  if (!pdfDocument) return;
  const normalized = clamp(Math.round(nextPage || 1), 1, pdfDocument.numPages);
  pageNumber = normalized;
  elements.pageNumber.value = String(pageNumber);
  scrollToPage(pageNumber, true);
  const view = pageViews.get(pageNumber);
  if (view) renderPage(view);
  updateControls();
  scheduleReaderSessionSave();
}

function changeZoom(nextScale) {
  if (!pdfDocument) return;
  window.clearTimeout(wheelZoomTimer);
  pendingWheelScale = null;
  fitWidth = false;
  scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  rebuildPageLayout();
}

function createPageView(number) {
  const element = document.createElement("section");
  element.className = "page-shell";
  element.dataset.pageNumber = String(number);
  element.setAttribute("aria-label", `Страница ${number}`);

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";
  canvas.width = 1;
  canvas.height = 1;
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const placeholder = document.createElement("div");
  placeholder.className = "page-placeholder";
  placeholder.textContent = `Страница ${number}`;

  element.append(canvas, textLayer, placeholder);
  setPageDimensions(element, firstPageSize.width * scale, firstPageSize.height * scale, scale);
  return {
    number,
    element,
    canvas,
    textLayer,
    placeholder,
    renderingTask: null,
    textLayerTask: null,
    renderingScale: null,
    renderedScale: null,
    token: 0
  };
}

function setupPageObserver() {
  pageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const number = Number(entry.target.dataset.pageNumber);
      const view = pageViews.get(number);
      if (view) renderPage(view);
    }
  }, {
    root: elements.readerViewport,
    rootMargin: "900px 0px",
    threshold: 0.01
  });
  for (const view of pageViews.values()) pageObserver.observe(view.element);
}

async function renderPage(view) {
  if (!pdfDocument || view.renderedScale === scale || view.renderingScale === scale) return;
  const generation = layoutGeneration;
  const token = ++view.token;
  view.renderingScale = scale;
  view.placeholder.hidden = false;

  try {
    const page = await pdfDocument.getPage(view.number);
    if (generation !== layoutGeneration || token !== view.token) return;
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const context = view.canvas.getContext("2d", { alpha: false });
    setPageDimensions(view.element, viewport.width, viewport.height, viewport.scale);
    view.canvas.width = Math.floor(viewport.width * outputScale);
    view.canvas.height = Math.floor(viewport.height * outputScale);
    view.canvas.style.width = `${Math.floor(viewport.width)}px`;
    view.canvas.style.height = `${Math.floor(viewport.height)}px`;
    view.textLayer.replaceChildren();

    const renderingTask = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    });
    view.renderingTask = renderingTask;
    const textContent = await page.getTextContent();
    if (generation !== layoutGeneration || token !== view.token) {
      await renderingTask.promise.catch(() => {});
      return;
    }
    view.textLayerTask = new TextLayer({
      textContentSource: textContent,
      container: view.textLayer,
      viewport
    });
    await Promise.all([renderingTask.promise, view.textLayerTask.render()]);
    if (generation !== layoutGeneration || token !== view.token) return;
    view.renderedScale = scale;
    view.placeholder.hidden = true;
  } catch (error) {
    if (error?.name !== "RenderingCancelledException" && error?.name !== "AbortException") {
      view.placeholder.textContent = `Не удалось отрисовать страницу ${view.number}`;
      showToast(`Ошибка на странице ${view.number}: ${error?.message || error}`, "error", 8000);
    }
  } finally {
    if (token === view.token) view.renderingScale = null;
  }
}

function setPageDimensions(element, width, height, viewportScale) {
  element.style.setProperty("--total-scale-factor", String(viewportScale));
  element.style.width = `${Math.floor(width)}px`;
  element.style.height = `${Math.floor(height)}px`;
}

function scrollToPage(number, smooth, anchorRatio = 0) {
  const view = pageViews.get(number);
  if (!view) return;
  const focusOffset = anchorRatio > 0 ? Math.min(180, elements.readerViewport.clientHeight * 0.3) : 18;
  const top = view.element.offsetTop + view.element.offsetHeight * anchorRatio - focusOffset;
  elements.readerViewport.scrollTo({
    top: Math.max(0, top),
    behavior: smooth ? "smooth" : "auto"
  });
}

function getPageAnchorRatio(number) {
  const view = pageViews.get(number);
  if (!view?.element.offsetHeight) return 0;
  const focusOffset = Math.min(180, elements.readerViewport.clientHeight * 0.3);
  const position = elements.readerViewport.scrollTop + focusOffset - view.element.offsetTop;
  return clamp(position / view.element.offsetHeight, 0, 1);
}

function onReaderScroll() {
  hideSelectionUi();
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    updateCurrentPageFromScroll();
    releaseDistantPages();
    scheduleReaderSessionSave();
  }, 70);
}

function updateCurrentPageFromScroll() {
  if (!pdfDocument || !pageViews.size) return;
  const focusY = elements.readerViewport.scrollTop
    + Math.min(180, elements.readerViewport.clientHeight * 0.3);
  let low = 1;
  let high = pdfDocument.numPages;
  let closestNumber = pageNumber;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const view = pageViews.get(middle);
    if (!view) break;
    const top = view.element.offsetTop;
    const bottom = top + view.element.offsetHeight;
    closestNumber = middle;
    if (focusY < top) {
      high = middle - 1;
    } else if (focusY > bottom) {
      low = middle + 1;
    } else {
      break;
    }
  }
  if (closestNumber !== pageNumber) {
    pageNumber = closestNumber;
    elements.pageNumber.value = String(pageNumber);
    updateControls();
  }
}

function releaseDistantPages() {
  for (const view of pageViews.values()) {
    if (view.renderedScale === null) continue;
    if (Math.abs(view.number - pageNumber) > 6) releasePage(view);
  }
}

function releasePage(view) {
  cancelPageRender(view);
  view.canvas.width = 1;
  view.canvas.height = 1;
  view.canvas.style.width = "1px";
  view.canvas.style.height = "1px";
  view.textLayer.replaceChildren();
  view.placeholder.textContent = `Страница ${view.number}`;
  view.placeholder.hidden = false;
  view.renderedScale = null;
}

function cancelPageRender(view) {
  view.token += 1;
  view.renderingTask?.cancel();
  view.textLayerTask?.cancel();
  view.renderingTask = null;
  view.textLayerTask = null;
  view.renderingScale = null;
}

function disconnectPageObserver() {
  pageObserver?.disconnect();
  pageObserver = null;
}

function clearPageLayout() {
  layoutGeneration += 1;
  disconnectPageObserver();
  for (const view of pageViews.values()) cancelPageRender(view);
  pageViews.clear();
  elements.pagesContainer.replaceChildren();
}

function updateControls() {
  const ready = Boolean(pdfDocument);
  elements.previousPageButton.disabled = !ready || pageNumber <= 1;
  elements.nextPageButton.disabled = !ready || pageNumber >= pdfDocument.numPages;
  elements.pageNumber.disabled = !ready;
  elements.zoomOutButton.disabled = !ready || scale <= MIN_SCALE;
  elements.zoomInButton.disabled = !ready || scale >= MAX_SCALE;
  elements.fitWidthButton.disabled = !ready;
  elements.fitWidthButton.textContent = fitWidth ? "По ширине" : `${Math.round(scale * 100)}%`;
}

function onSelectionChange() {
  window.clearTimeout(autoTimer);
  const selection = readSelection();
  if (!selection.word) {
    hideSelectionUi();
    return;
  }
  if (settings.showFloatingButton) showAnkiButton(selection.rect);
  if (settings.showDictionaryPopup) scheduleDictionaryLookup(selection);
  else hideDictionaryPanel();
  if (settings.autoCreateOnSelection) {
    autoTimer = window.setTimeout(() => processSelection(selection), 650);
  }
}

function readSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return emptySelection();
  const range = selection.getRangeAt(0);
  const rangeElement = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  const textLayer = rangeElement?.closest?.(".textLayer");
  if (!textLayer || !elements.pagesContainer.contains(textLayer)) return emptySelection();

  const rawText = selection.toString().replace(/\s+/g, " ").trim();
  const word = normalizeSelectedWord(rawText);
  if (!isUsableSelection(word)) return emptySelection();
  const snapshot = getRangeTextSnapshot(textLayer, range);
  const context = getContext(snapshot, rawText);
  return { word, context, rect: range.getBoundingClientRect() };
}

function emptySelection() {
  return { word: "", context: "", rect: null };
}

function normalizeSelectedWord(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function isUsableSelection(text) {
  return text.length >= MIN_WORD_LENGTH
    && text.length <= MAX_WORD_LENGTH
    && !/\s/u.test(text)
    && /[\p{L}\p{N}]/u.test(text);
}

function getRangeTextSnapshot(rootElement, range) {
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
  let text = "";
  let start = -1;
  let end = -1;
  let node = walker.nextNode();
  while (node) {
    if (text && !/\s$/u.test(text)) text += " ";
    if (node === range.startContainer) start = text.length + range.startOffset;
    if (node === range.endContainer) end = text.length + range.endOffset;
    text += node.textContent || "";
    node = walker.nextNode();
  }
  return { text, start, end };
}

function getContext(snapshot, selectedText) {
  const source = snapshot.text || selectedText;
  const start = snapshot.start >= 0
    ? snapshot.start
    : source.toLowerCase().indexOf(selectedText.toLowerCase());
  if (start < 0) return normalizeContext(source).slice(0, 700);
  const selectedLength = snapshot.end > start ? snapshot.end - start : selectedText.length;
  if (settings.contextCaptureMode === "sentence") {
    return getSentenceContext(source, start, selectedLength);
  }
  const configuredWords = Number(settings.contextWordsEachSide);
  const wordsEachSide = Number.isFinite(configuredWords) ? clamp(configuredWords, 0, 40) : 8;
  return getWordWindowContext(source, start, selectedLength, wordsEachSide);
}

function getWordWindowContext(text, selectedStart, selectedLength, wordsEachSide) {
  const selectedEnd = selectedStart + selectedLength;
  const tokens = [...text.matchAll(/\S+/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }));
  const first = tokens.findIndex((token) => token.start <= selectedStart && token.end > selectedStart);
  const last = tokens.findIndex((token) => token.start < selectedEnd && token.end >= selectedEnd);
  if (first < 0 || last < 0) {
    return normalizeContext(text.slice(Math.max(0, selectedStart - 220), selectedEnd + 220));
  }
  const from = Math.max(0, first - wordsEachSide);
  const to = Math.min(tokens.length - 1, last + wordsEachSide);
  return normalizeContext(text.slice(tokens[from].start, tokens[to].end));
}

function getSentenceContext(text, selectedStart, selectedLength) {
  const punctuation = /[.!?。！？…]/u;
  let from = 0;
  let to = text.length;
  for (let index = selectedStart - 1; index >= 0; index -= 1) {
    if (punctuation.test(text[index])) {
      from = index + 1;
      break;
    }
  }
  for (let index = selectedStart + selectedLength; index < text.length; index += 1) {
    if (punctuation.test(text[index])) {
      to = index + 1;
      break;
    }
  }
  return normalizeContext(text.slice(from, to));
}

function normalizeContext(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function showAnkiButton(rect) {
  if (!rect || rect.width === 0 || rect.height === 0) return;
  elements.ankiButton.hidden = false;
  const top = Math.max(64, rect.top - 44);
  const left = Math.min(window.innerWidth - 92, Math.max(8, rect.left));
  elements.ankiButton.style.top = `${top}px`;
  elements.ankiButton.style.left = `${left}px`;
}

function hideAnkiButton() {
  elements.ankiButton.hidden = true;
}

function hideSelectionUi() {
  hideAnkiButton();
  hideDictionaryPanel();
}

function scheduleDictionaryLookup(selection) {
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
  elements.dictionaryWord.textContent = word;
  elements.dictionaryPronunciation.textContent = "";
  elements.dictionaryMeanings.replaceChildren();
  elements.dictionaryExamples.replaceChildren();
  elements.dictionaryExamplesSection.hidden = true;
  elements.dictionarySource.hidden = true;
  elements.dictionaryStatus.hidden = false;
  elements.dictionaryStatus.dataset.tone = "info";
  elements.dictionaryStatus.textContent = "Looking up...";
  showDictionaryPanel(rect);
}

function showDictionaryError(message, rect) {
  elements.dictionaryMeanings.replaceChildren();
  elements.dictionaryExamples.replaceChildren();
  elements.dictionaryExamplesSection.hidden = true;
  elements.dictionarySource.hidden = true;
  elements.dictionaryStatus.hidden = false;
  elements.dictionaryStatus.dataset.tone = "error";
  elements.dictionaryStatus.textContent = message;
  showDictionaryPanel(rect);
}

function renderDictionaryResult(result, rect) {
  elements.dictionaryWord.textContent = result.word;
  elements.dictionaryPronunciation.textContent = result.pronunciation || "";
  elements.dictionaryStatus.hidden = true;
  elements.dictionaryMeanings.replaceChildren(...result.meanings.slice(0, 2).map((meaning) => {
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
  elements.dictionaryExamples.replaceChildren(...result.examples.slice(0, 2).map((example) => {
    const item = document.createElement("li");
    item.textContent = example;
    return item;
  }));
  elements.dictionaryExamplesSection.hidden = result.examples.length === 0;
  elements.dictionarySource.href = result.sourceUrl || "https://en.wiktionary.org/";
  elements.dictionarySource.textContent = result.attribution || "FreeDictionaryAPI.com · Wiktionary · CC BY-SA";
  elements.dictionarySource.hidden = false;
  showDictionaryPanel(rect);
}

function showDictionaryPanel(rect) {
  if (!rect) return;
  elements.dictionaryPanel.hidden = false;
  elements.dictionaryPanel.style.visibility = "hidden";
  window.requestAnimationFrame(() => {
    const panelRect = elements.dictionaryPanel.getBoundingClientRect();
    const left = Math.min(window.innerWidth - panelRect.width - 8, Math.max(8, rect.left));
    const below = rect.bottom + 10;
    const above = rect.top - panelRect.height - 10;
    const top = below + panelRect.height <= window.innerHeight - 8 ? below : Math.max(64, above);
    elements.dictionaryPanel.style.left = `${left}px`;
    elements.dictionaryPanel.style.top = `${top}px`;
    elements.dictionaryPanel.style.visibility = "visible";
  });
}

function hideDictionaryPanel() {
  window.clearTimeout(dictionaryTimer);
  dictionaryRequestId += 1;
  elements.dictionaryPanel.hidden = true;
}

function processCurrentSelection() {
  window.clearTimeout(autoTimer);
  const selection = readSelection();
  if (!selection.word) {
    showToast("Выделите ровно одно слово. Предложение используется только как контекст.", "error");
    return;
  }
  processSelection(selection);
}

function processSelection(selection) {
  window.clearTimeout(autoTimer);
  if (isProcessing) {
    showToast("Предыдущая карточка еще создается.", "info");
    return;
  }
  isProcessing = true;
  currentRequestId = crypto.randomUUID();
  hideAnkiButton();
  showToast(`Создаю карточку для «${selection.word}»...`, "info", 0);
  requestTimer = window.setTimeout(() => {
    isProcessing = false;
    showToast("Ответ занимает слишком много времени. Увеличьте таймаут LLM в настройках или выберите более быструю модель.", "error", 10000);
  }, getUiRequestTimeoutMs());

  chrome.runtime.sendMessage({
    type: "process-selection",
    word: selection.word,
    context: selection.context,
    sourceUrl: currentSource,
    requestId: currentRequestId,
    runtimeProgress: true
  }, (response) => {
    window.clearTimeout(requestTimer);
    isProcessing = false;
    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message, "error", 9000);
      return;
    }
    if (!response?.ok) {
      showToast(response?.error || "Не удалось создать карточку.", "error", 9000);
      return;
    }
    showToast(`«${response.result.card.term}» добавлено в Anki.`, "success");
  });
}

function onRuntimeMessage(message) {
  if (message?.type !== "anki-card-progress" || message.requestId !== currentRequestId) return false;
  showToast(localizeProgress(message.message), "info", 0);
  return false;
}

function localizeProgress(message) {
  if (/Checking Anki/i.test(message)) return "Проверяю AnkiConnect и настройки колоды...";
  if (/Sending request to LLM/i.test(message)) return "LLM создает карточку. Это может занять некоторое время...";
  if (/Adding generated card/i.test(message)) return "Добавляю готовую карточку в Anki...";
  return message || "Обработка...";
}

function onKeyDown(event) {
  if (handleDocumentZoomShortcut(event)) return;
  if (!matchesShortcut(event, settings.customShortcut)) return;
  const selection = readSelection();
  if (!selection.word) {
    event.preventDefault();
    showToast("Выделите ровно одно слово.", "error");
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  processSelection(selection);
}

function handleDocumentZoomShortcut(event) {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return false;
  const key = event.key;
  if (!["+", "=", "-", "_", "0"].includes(key)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!pdfDocument) return true;
  if (key === "0") {
    window.clearTimeout(wheelZoomTimer);
    pendingWheelScale = null;
    fitWidth = true;
    rebuildPageLayout();
  } else if (key === "+" || key === "=") {
    changeZoom(scale + ZOOM_STEP);
  } else {
    changeZoom(scale - ZOOM_STEP);
  }
  return true;
}

function onWheelZoom(event) {
  if ((!event.ctrlKey && !event.metaKey) || !pdfDocument) return;
  event.preventDefault();
  event.stopPropagation();
  const baseScale = pendingWheelScale ?? scale;
  pendingWheelScale = clamp(baseScale + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), MIN_SCALE, MAX_SCALE);
  window.clearTimeout(wheelZoomTimer);
  wheelZoomTimer = window.setTimeout(() => {
    const nextScale = pendingWheelScale;
    pendingWheelScale = null;
    fitWidth = false;
    scale = nextScale;
    rebuildPageLayout();
  }, 70);
}

function lockReaderInterfaceZoom() {
  chrome.tabs.getCurrent((tab) => {
    if (chrome.runtime.lastError || !tab?.id) return;
    readerTabId = tab.id;
    resetBrowserZoom();
  });
}

function onBrowserZoomChange(details) {
  if (details.tabId !== readerTabId || Math.abs(details.newZoomFactor - 1) < 0.001) return;
  resetBrowserZoom();
}

function resetBrowserZoom() {
  if (!readerTabId) return;
  chrome.tabs.setZoomSettings(readerTabId, { mode: "manual", scope: "per-tab" }, () => {
    if (chrome.runtime.lastError) return;
    chrome.tabs.setZoom(readerTabId, 1, () => {
      void chrome.runtime.lastError;
    });
  });
}

function matchesShortcut(event, shortcut) {
  const expected = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const part of String(shortcut || "").split("+")) {
    const value = part.trim().toLowerCase();
    if (value === "ctrl" || value === "control") expected.ctrl = true;
    else if (value === "alt" || value === "option") expected.alt = true;
    else if (value === "shift") expected.shift = true;
    else if (value === "meta" || value === "cmd" || value === "command") expected.meta = true;
    else if (value) expected.key = normalizeKey(part);
  }
  return Boolean(expected.key)
    && event.ctrlKey === expected.ctrl
    && event.altKey === expected.alt
    && event.shiftKey === expected.shift
    && event.metaKey === expected.meta
    && normalizeKey(event.key) === expected.key;
}

function normalizeKey(key) {
  const raw = String(key || "").trim();
  if (raw === " ") return "Space";
  if (raw.length === 1) return raw.toUpperCase();
  return raw;
}

function showReaderState(state, loadingMessage = "Открываю PDF...") {
  elements.emptyState.hidden = state !== "empty";
  elements.loadingState.hidden = state !== "loading";
  elements.pageArea.hidden = state !== "page";
  elements.loadingText.textContent = loadingMessage;
}

function showToast(message, tone = "info", timeout = 5200) {
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  if (timeout > 0) {
    showToast.timer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, timeout);
  }
}

function getUiRequestTimeoutMs() {
  const llmMs = clamp(Number(settings.llmTimeoutSeconds) || 45, 3, 180) * 1000;
  const ankiMs = clamp(Number(settings.ankiTimeoutSeconds) || 8, 3, 60) * 1000;
  return llmMs + ankiMs * 6 + UI_TIMEOUT_GRACE_MS;
}

function onDragEnter(event) {
  event.preventDefault();
  elements.dropOverlay.hidden = false;
}

function onDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function onDragLeave(event) {
  if (event.relatedTarget) return;
  elements.dropOverlay.hidden = true;
}

function onDrop(event) {
  event.preventDefault();
  elements.dropOverlay.hidden = true;
  const [file] = event.dataTransfer.files || [];
  if (file) openLocalPdf(file);
}

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function restoreReaderSession(session) {
  if (session.sourceType === "remote" && /^https?:/i.test(session.url || "")) {
    await openRemotePdf(session.url, session);
    return;
  }
  if (session.sourceType !== "local") return;

  showReaderState("loading", `Восстанавливаю ${session.name || "последний PDF"}...`);
  try {
    const record = await getLastLocalPdf();
    if (!record?.file) throw new Error("Сохраненный файл не найден");
    currentBook = null;
    currentSource = record.name || session.name || "document.pdf";
    const data = new Uint8Array(await record.file.arrayBuffer());
    const opened = await loadPdf({ data }, currentSource, session);
    if (!opened) {
      await chrome.storage.local.remove(READER_SESSION_KEY);
      return;
    }
    currentBook = {
      sourceType: "local",
      name: currentSource,
      size: record.size || record.file.size || 0,
      lastModified: record.lastModified || 0
    };
    await saveReaderSession();
  } catch (error) {
    console.error("Could not restore the last local PDF", error);
    await chrome.storage.local.remove(READER_SESSION_KEY);
    showReaderState("empty");
    showToast("Не удалось восстановить последний PDF. Откройте файл заново.", "error", 8000);
  }
}

async function getSavedReaderSession() {
  try {
    const stored = await chrome.storage.local.get(READER_SESSION_KEY);
    const session = stored[READER_SESSION_KEY];
    if (!session || !["local", "remote"].includes(session.sourceType)) return null;
    return session;
  } catch (error) {
    console.error("Could not read the PDF reader session", error);
    return null;
  }
}

function scheduleReaderSessionSave() {
  if (!pdfDocument || !currentBook) return;
  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(saveReaderSession, SESSION_SAVE_DELAY_MS);
}

async function saveReaderSession() {
  if (!pdfDocument || !currentBook) return;
  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = 0;
  const activeBook = currentBook;
  const session = {
    ...activeBook,
    page: clamp(pageNumber, 1, pdfDocument.numPages),
    pageRatio: normalizePageRatio(getPageAnchorRatio(pageNumber)),
    updatedAt: Date.now()
  };
  try {
    if (currentBook !== activeBook) return;
    await chrome.storage.local.set({ [READER_SESSION_KEY]: session });
  } catch (error) {
    console.error("Could not save the PDF reader position", error);
  }
}

function saveLastLocalPdf(file) {
  return withReaderDocumentStore("readwrite", (store) => store.put({
    id: LAST_LOCAL_PDF_KEY,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified || 0,
    file
  }));
}

function getLastLocalPdf() {
  return withReaderDocumentStore("readonly", (store) => store.get(LAST_LOCAL_PDF_KEY));
}

function deleteLastLocalPdf() {
  return withReaderDocumentStore("readwrite", (store) => store.delete(LAST_LOCAL_PDF_KEY));
}

function withReaderDocumentStore(mode, operation) {
  return openReaderDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(READER_DOCUMENT_STORE, mode);
    let result;
    let request;
    try {
      request = operation(transaction.objectStore(READER_DOCUMENT_STORE));
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    request.onsuccess = () => {
      result = request.result;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error("IndexedDB transaction was aborted"));
    };
    transaction.onerror = () => {
      // The abort handler reports the final transaction error.
    };
  }));
}

function openReaderDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(READER_DB_NAME, READER_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(READER_DOCUMENT_STORE)) {
        database.createObjectStore(READER_DOCUMENT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB"));
  });
}

function normalizePageRatio(value) {
  const ratio = Number(value);
  return Number.isFinite(ratio) ? clamp(ratio, 0, 1) : 0;
}

function formatPdfError(error) {
  const message = String(error?.message || error || "Неизвестная ошибка");
  if (/Missing PDF|Invalid PDF/i.test(message)) return "Файл не похож на корректный PDF.";
  if (/password/i.test(message)) return "PDF защищен паролем. Эта версия reader пока не открывает такие файлы.";
  if (/Failed to fetch|network/i.test(message)) return "Не удалось загрузить PDF по ссылке. Откройте его через кнопку выбора файла.";
  return `Не удалось открыть PDF: ${message}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function debounce(callback, delay) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

function installPdfJsPolyfills() {
  if (typeof Promise.withResolvers !== "function") {
    Promise.withResolvers = function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    };
  }

  if (typeof URL.parse !== "function") {
    URL.parse = function parse(value, base) {
      try {
        return new URL(value, base);
      } catch {
        return null;
      }
    };
  }

  if (typeof AbortSignal.any !== "function") {
    AbortSignal.any = function any(signals) {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort(signal.reason);
          break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    };
  }
}
