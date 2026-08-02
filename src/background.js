importScripts("api-vault.js");

const DEFAULT_PROMPT = `Create an Anki card for exactly one selected word.

Term: {{word}}
Context: {{context}}
Target language: {{language}}

Return strict JSON only with this shape:
{
  "term": "the exact term",
  "reading": "pronunciation or reading if useful, otherwise empty",
  "partOfSpeech": "short part of speech",
  "translation": "short translation or meaning",
  "definition": "clear learner-friendly definition",
  "examples": [
    { "sentence": "natural example sentence", "translation": "translation of the sentence" }
  ],
  "mnemonic": "short memory hint if useful",
  "tags": ["language", "topic"]
}`;

const MAX_WORD_LENGTH = 80;
const DICTIONARY_API_BASE = "https://freedictionaryapi.com/api/v1";
const DICTIONARY_TIMEOUT_MS = 4500;
const DICTIONARY_CACHE_KEY = "dictionaryCacheV1";
const DICTIONARY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DICTIONARY_CACHE_LIMIT = 300;

const DEFAULT_SETTINGS = {
  activeProfileId: "openrouter-default",
  deckName: "Default",
  noteType: "Basic",
  frontField: "Front",
  backField: "Back",
  language: "auto",
  defaultTags: "ai-generated selected-word",
  autoCreateOnSelection: true,
  showFloatingButton: true,
  showDictionaryPopup: true,
  promptTemplate: DEFAULT_PROMPT,
  llmTimeoutSeconds: 45,
  ankiTimeoutSeconds: 8,
  customShortcut: "Ctrl+Shift+Y",
  contextCaptureMode: "words",
  contextWordsEachSide: 8,
  suppressEdgeMiniMenu: true,
  includeContextInCard: true,
  cardLayoutMode: "builder",
  frontTemplateFields: ["term", "reading"],
  backTemplateFields: ["translation", "definition", "examples", "context", "mnemonic", "source"]
};

const DEFAULT_PROFILE = {
  id: "openrouter-default",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "openai/gpt-4o-mini"
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "create-anki-card",
      title: "Create Anki card: \"%s\"",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "create-anki-card" || !info.selectionText) return;
  processSelectionFromTab({
    tab,
    fallbackWord: info.selectionText,
    fallbackContext: ""
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "create-card-from-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "read-selection" }, async (response) => {
    if (chrome.runtime.lastError) {
      notifyTab(tab.id, { type: "anki-card-error", error: "The extension cannot read this page. Reload the tab or use a regular web page." });
      return;
    }
    if (!response?.word) {
      notifyTab(tab.id, { type: "anki-card-error", error: "Select exactly one word. Sentences and multi-word phrases are captured only as context." });
      return;
    }
    try {
      const result = await processSelection({
        word: response.word,
        context: response.context || "",
        sourceUrl: tab.url || "",
        tabId: tab.id
      });
      notifyTab(tab.id, { type: "anki-card-result", result });
    } catch (error) {
      notifyTab(tab.id, { type: "anki-card-error", error: toUserMessage(error) });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "lookup-dictionary-word") {
    lookupDictionaryWord(message.word, message.language)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: toDictionaryUserMessage(error) }));
    return true;
  }

  if (message?.type === "process-selection") {
    processSelection({
      word: message.word,
      context: message.context || "",
      sourceUrl: message.sourceUrl || sender.tab?.url || "",
      tabId: sender.tab?.id,
      requestId: message.requestId || "",
      runtimeProgress: Boolean(message.runtimeProgress)
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }

  if (message?.type === "test-llm-profile") {
    const timeoutMs = secondsToMs(message.timeoutSeconds, DEFAULT_SETTINGS.llmTimeoutSeconds);
    testLlmProfile(message.profile, { ...DEFAULT_SETTINGS, ...message.settings }, timeoutMs)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }

  if (message?.type === "test-anki") {
    const timeoutMs = secondsToMs(message.settings?.ankiTimeoutSeconds, DEFAULT_SETTINGS.ankiTimeoutSeconds);
    validateAnkiTarget({ ...DEFAULT_SETTINGS, ...message.settings }, timeoutMs)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }

  if (message?.type === "get-defaults") {
    sendResponse({ settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE });
  }

  return false;
});

async function ensureDefaults() {
  const syncData = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const missingSettings = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (syncData[key] === undefined) missingSettings[key] = value;
  }
  if (Object.keys(missingSettings).length) {
    await chrome.storage.sync.set(missingSettings);
  }

  const localData = await chrome.storage.local.get(["apiProfiles", "apiProfilesVault"]);
  if (!localData.apiProfilesVault && (!Array.isArray(localData.apiProfiles) || localData.apiProfiles.length === 0)) {
    await chrome.storage.local.set({ apiProfiles: [DEFAULT_PROFILE] });
  }
}

async function getConfig() {
  await ensureDefaults();
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS)))
  };
  const apiProfiles = await ApiVault.loadProfiles([DEFAULT_PROFILE]);
  const profile = apiProfiles.find((item) => item.id === settings.activeProfileId) || apiProfiles[0];
  return { settings, profile: { ...DEFAULT_PROFILE, ...profile } };
}

async function processSelection(input) {
  const word = normalizeSelection(input.word);
  const context = normalizeContext(input.context);
  if (!word) throw new Error("Select exactly one word first. Sentences and multi-word phrases are used only as context.");

  const { settings, profile } = await getConfig();
  validateProfileShape(profile);

  const llmTimeoutMs = secondsToMs(settings.llmTimeoutSeconds, DEFAULT_SETTINGS.llmTimeoutSeconds);
  const ankiTimeoutMs = secondsToMs(settings.ankiTimeoutSeconds, DEFAULT_SETTINGS.ankiTimeoutSeconds);

  reportProgress(input, "Checking Anki settings...");
  await validateAnkiTarget(settings, ankiTimeoutMs);
  reportProgress(input, "Sending request to LLM...");
  const card = await generateCard({ word, context, settings, profile, timeoutMs: llmTimeoutMs });
  reportProgress(input, "Adding generated card to Anki...");
  const noteId = await addCardToAnki({ card, context, settings, sourceUrl: input.sourceUrl || "", timeoutMs: ankiTimeoutMs });
  return { noteId, card };
}

function normalizeSelection(value) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!isSingleWord(normalized)) return "";
  return normalized.slice(0, MAX_WORD_LENGTH);
}

function isSingleWord(value) {
  if (!value || value.length > MAX_WORD_LENGTH) return false;
  if (/\s/u.test(value)) return false;
  return /[\p{L}\p{N}]/u.test(value);
}

function normalizeContext(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

async function lookupDictionaryWord(inputWord, inputLanguage) {
  const word = normalizeSelection(inputWord);
  if (!word) throw new Error("Выделите ровно одно слово.");
  const language = normalizeDictionaryLanguage(inputLanguage);
  const cacheId = `${language}:${word.toLocaleLowerCase()}`;
  const cached = await getCachedDictionaryEntry(cacheId).catch((error) => {
    console.warn("Could not read the dictionary cache", error);
    return null;
  });
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DICTIONARY_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${DICTIONARY_API_BASE}/entries/${encodeURIComponent(language)}/${encodeURIComponent(word)}`, {
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Словарь отвечает слишком долго.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 404) throw new Error(`Слово «${word}» не найдено в словаре.`);
  if (response.status === 429) throw new Error("Лимит быстрого словаря временно исчерпан.");
  if (!response.ok) throw new Error(`Словарь временно недоступен (${response.status}).`);

  const result = normalizeDictionaryEntry(await response.json(), word, language);
  if (!result.meanings.length) throw new Error(`Для слова «${word}» не найдено короткое определение.`);
  cacheDictionaryEntry(cacheId, result).catch((error) => {
    console.warn("Could not update the dictionary cache", error);
  });
  return result;
}

function normalizeDictionaryEntry(payload, fallbackWord, language) {
  const candidates = [];
  const pronunciations = [];
  for (const [entryIndex, entry] of (Array.isArray(payload?.entries) ? payload.entries : []).entries()) {
    for (const pronunciation of Array.isArray(entry?.pronunciations) ? entry.pronunciations : []) {
      const text = normalizeDictionaryText(pronunciation?.text);
      if (text && !pronunciations.includes(text)) pronunciations.push(text);
    }
    collectDictionarySenses(entry?.senses, {
      partOfSpeech: normalizeDictionaryText(entry?.partOfSpeech),
      entryIndex,
      candidates
    });
  }

  const meanings = candidates
    .filter((item) => item.definition)
    .sort((left, right) => scoreDictionarySense(left) - scoreDictionarySense(right))
    .filter((item, index, all) => (
      all.findIndex((candidate) => candidate.definition.toLocaleLowerCase() === item.definition.toLocaleLowerCase()) === index
    ))
    .slice(0, 2)
    .map(({ partOfSpeech, definition }) => ({ partOfSpeech, definition }));

  const selectedDefinitions = new Set(meanings.map((item) => item.definition));
  const examples = candidates
    .sort((left, right) => (
      Number(selectedDefinitions.has(right.definition)) - Number(selectedDefinitions.has(left.definition))
      || scoreDictionarySense(left) - scoreDictionarySense(right)
    ))
    .flatMap((item) => item.examples)
    .filter((example, index, all) => all.indexOf(example) === index)
    .slice(0, 2);

  return {
    word: normalizeDictionaryText(payload?.word) || fallbackWord,
    language,
    pronunciation: pronunciations[0] || "",
    meanings,
    examples,
    sourceUrl: safeDictionarySourceUrl(payload?.source?.url),
    attribution: "FreeDictionaryAPI.com · Wiktionary · CC BY-SA"
  };
}

function collectDictionarySenses(senses, state, depth = 0) {
  if (!Array.isArray(senses) || depth > 2) return;
  for (const [senseIndex, sense] of senses.entries()) {
    const definition = normalizeDictionaryText(sense?.definition);
    if (definition) {
      state.candidates.push({
        partOfSpeech: state.partOfSpeech,
        definition,
        examples: (Array.isArray(sense?.examples) ? sense.examples : [])
          .map(normalizeDictionaryText)
          .filter(Boolean),
        tags: (Array.isArray(sense?.tags) ? sense.tags : [])
          .map((tag) => normalizeDictionaryText(tag).toLowerCase()),
        order: state.entryIndex * 20 + senseIndex,
        depth
      });
    }
    collectDictionarySenses(sense?.subsenses, state, depth + 1);
  }
}

function scoreDictionarySense(sense) {
  const wordCount = sense.definition.split(/\s+/u).length;
  const lengthPenalty = wordCount <= 18 ? wordCount : 18 + (wordCount - 18) * 3;
  const uncommonPenalty = sense.tags.some((tag) => /archaic|obsolete|rare|dated|historical/i.test(tag)) ? 120 : 0;
  return sense.order * 4 + sense.depth * 10 + lengthPenalty + uncommonPenalty;
}

function normalizeDictionaryText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizeDictionaryLanguage(value) {
  const aliases = {
    english: "en",
    german: "de",
    french: "fr",
    spanish: "es",
    italian: "it",
    portuguese: "pt",
    russian: "ru",
    japanese: "ja"
  };
  const normalized = String(value || "en").trim().toLowerCase();
  if (aliases[normalized]) return aliases[normalized];
  return /^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(normalized) ? normalized : "en";
}

function safeDictionarySourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "https://en.wiktionary.org/";
  } catch {
    return "https://en.wiktionary.org/";
  }
}

async function getCachedDictionaryEntry(cacheId) {
  const stored = await chrome.storage.local.get(DICTIONARY_CACHE_KEY);
  const entry = stored[DICTIONARY_CACHE_KEY]?.[cacheId];
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

async function cacheDictionaryEntry(cacheId, value) {
  const stored = await chrome.storage.local.get(DICTIONARY_CACHE_KEY);
  const cache = stored[DICTIONARY_CACHE_KEY] && typeof stored[DICTIONARY_CACHE_KEY] === "object"
    ? stored[DICTIONARY_CACHE_KEY]
    : {};
  cache[cacheId] = { value, expiresAt: Date.now() + DICTIONARY_CACHE_TTL_MS };
  const trimmedEntries = Object.entries(cache)
    .filter(([, entry]) => entry?.expiresAt > Date.now())
    .sort((left, right) => right[1].expiresAt - left[1].expiresAt)
    .slice(0, DICTIONARY_CACHE_LIMIT);
  await chrome.storage.local.set({ [DICTIONARY_CACHE_KEY]: Object.fromEntries(trimmedEntries) });
}

function toDictionaryUserMessage(error) {
  const message = String(error?.message || error || "Словарь временно недоступен.");
  if (/Failed to fetch/i.test(message)) return "Не удалось подключиться к быстрому словарю.";
  return message;
}

async function testLlmProfile(profileInput, settingsInput, timeoutMs) {
  const profile = { ...DEFAULT_PROFILE, ...profileInput };
  const settings = { ...DEFAULT_SETTINGS, ...settingsInput };
  validateProfileShape(profile);
  const startedAt = Date.now();
  const card = await generateCard({
    word: "example",
    context: "This is an example sentence for testing.",
    settings,
    profile,
    timeoutMs
  });
  return {
    model: profile.model,
    elapsedMs: Date.now() - startedAt,
    sample: `${card.term}: ${card.translation || card.definition}`.slice(0, 120)
  };
}

async function generateCard({ word, context, settings, profile, timeoutMs }) {
  const prompt = fillTemplate(resolvePromptTemplate(settings), {
    word,
    context,
    language: settings.language || "auto"
  });

  const requestBody = {
    model: profile.model,
    messages: [
      { role: "user", content: buildCardGenerationInstruction(prompt) }
    ],
    temperature: 0.1,
    max_tokens: 450
  };
  if (isOpenRouterProfile(profile)) {
    requestBody.reasoning = {
      effort: "none",
      exclude: true
    };
  }

  let response = await fetchWithTimeout(resolveChatEndpoint(profile.baseUrl), {
    method: "POST",
    headers: buildLlmHeaders(profile),
    body: JSON.stringify(requestBody)
  }, timeoutMs, "LLM card generation");

  if (response.status === 400 && requestBody.reasoning) {
    const details = await response.clone().text();
    if (/reasoning|effort/i.test(details)) {
      const { reasoning, ...bodyWithoutReasoning } = requestBody;
      response = await fetchWithTimeout(resolveChatEndpoint(profile.baseUrl), {
        method: "POST",
        headers: buildLlmHeaders(profile),
        body: JSON.stringify(bodyWithoutReasoning)
      }, timeoutMs, "LLM card generation");
    }
  }

  await assertLlmResponseOk(response);
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The LLM response did not contain a message.");

  return normalizeCard(parseJsonObject(content), word);
}

function resolvePromptTemplate(settings) {
  return settings.promptTemplate || DEFAULT_PROMPT;
}

function buildCardGenerationInstruction(prompt) {
  return [
    "You create concise language-learning flashcards.",
    "Return only a valid JSON object. Do not use markdown, comments, or code fences.",
    "Keep every text field short.",
    "",
    prompt
  ].join("\n");
}

function buildLlmHeaders(profile) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${profile.apiKey}`
  };
  if (isOpenRouterProfile(profile)) {
    headers["HTTP-Referer"] = "https://github.com/local/anki-ai-card-gen-openrouter";
    headers["X-Title"] = "Anki AI Card Gen";
  }
  return headers;
}

function isOpenRouterProfile(profile) {
  try {
    return new URL(resolveChatEndpoint(profile.baseUrl)).hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
}

async function assertLlmResponseOk(response) {
  if (response.ok) return;
  const details = await response.text();
  const readableDetails = details.slice(0, 260);
  if (response.status === 401 || response.status === 403) {
    throw new Error(`LLM API key was rejected (${response.status}). Check the active key and provider profile.`);
  }
  if (response.status === 404) {
    throw new Error(`LLM endpoint or model was not found (${response.status}). Check Base URL and model name.`);
  }
  if (response.status === 429) {
    throw new Error(`LLM rate limit or insufficient credits (${response.status}). ${readableDetails}`);
  }
  throw new Error(`LLM request failed (${response.status}): ${readableDetails}`);
}

function validateProfileShape(profile) {
  if (!profile?.apiKey?.trim()) {
    throw new Error("Add an LLM API key in the extension options first.");
  }
  if (!profile?.model?.trim()) {
    throw new Error("Set an LLM model in the active API profile.");
  }
  try {
    const url = new URL(resolveChatEndpoint(profile.baseUrl));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Bad protocol");
  } catch {
    throw new Error("Set a valid LLM Base URL in the active API profile.");
  }
}

function resolveChatEndpoint(baseUrl) {
  const cleanBase = String(baseUrl || DEFAULT_PROFILE.baseUrl).replace(/\/+$/, "");
  return cleanBase.endsWith("/chat/completions") ? cleanBase : `${cleanBase}/chat/completions`;
}

function fillTemplate(template, values) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

function parseJsonObject(content) {
  const withoutFence = String(content)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const jsonCandidate = extractJsonObject(withoutFence);
    if (jsonCandidate) {
      return JSON.parse(jsonCandidate);
    }
    throw new Error("The LLM returned invalid JSON. Adjust the prompt so it returns only the requested JSON object.");
  }
}

function extractJsonObject(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function normalizeCard(card, fallbackTerm) {
  const examples = Array.isArray(card.examples) ? card.examples : [];
  const tags = Array.isArray(card.tags) ? card.tags : [];
  return {
    term: String(card.term || fallbackTerm).trim(),
    reading: String(card.reading || "").trim(),
    partOfSpeech: String(card.partOfSpeech || "").trim(),
    translation: String(card.translation || "").trim(),
    definition: String(card.definition || "").trim(),
    examples: examples
      .map((example) => ({
        sentence: String(example?.sentence || "").trim(),
        translation: String(example?.translation || "").trim()
      }))
      .filter((example) => example.sentence || example.translation)
      .slice(0, 3),
    mnemonic: String(card.mnemonic || "").trim(),
    tags: tags.map((tag) => sanitizeTag(tag)).filter(Boolean).slice(0, 6)
  };
}

async function validateAnkiTarget(settings, timeoutMs) {
  const version = await callAnki("version", {}, timeoutMs);
  const decks = await callAnki("deckNames", {}, timeoutMs);
  if (!decks.includes(settings.deckName)) {
    throw new Error(`Anki deck "${settings.deckName}" was not found. Create it in Anki or change the deck name in options.`);
  }

  const models = await callAnki("modelNames", {}, timeoutMs);
  if (!models.includes(settings.noteType)) {
    throw new Error(`Anki note type "${settings.noteType}" was not found. Check the note type name in options.`);
  }

  const fields = await callAnki("modelFieldNames", { modelName: settings.noteType }, timeoutMs);
  const missingFields = [settings.frontField, settings.backField].filter((field) => !fields.includes(field));
  if (missingFields.length) {
    throw new Error(`Anki note type "${settings.noteType}" is missing fields: ${missingFields.join(", ")}.`);
  }

  return {
    version,
    deckName: settings.deckName,
    noteType: settings.noteType,
    fields
  };
}

async function addCardToAnki({ card, context, settings, sourceUrl, timeoutMs }) {
  const defaultTags = String(settings.defaultTags || "")
    .split(/\s+/)
    .map(sanitizeTag)
    .filter(Boolean);
  const fields = {
    [settings.frontField || "Front"]: buildFront(card, context, sourceUrl, settings),
    [settings.backField || "Back"]: buildBack(card, context, sourceUrl, settings)
  };

  return callAnki("addNote", {
    note: {
      deckName: settings.deckName || "Default",
      modelName: settings.noteType || "Basic",
      fields,
      tags: [...new Set([...defaultTags, ...card.tags])],
      options: {
        allowDuplicate: false,
        duplicateScope: "deck"
      }
    }
  }, timeoutMs);
}

function buildFront(card, context, sourceUrl, settings) {
  if (settings.cardLayoutMode === "builder") {
    return buildCardSide(card, context, sourceUrl, settings.frontTemplateFields, ["term"]);
  }
  return buildProFront(card);
}

function buildBack(card, context, sourceUrl, settings) {
  if (settings.cardLayoutMode === "builder") {
    return buildCardSide(card, context, sourceUrl, settings.backTemplateFields, ["translation", "definition"]);
  }
  return buildProBack(card, sourceUrl, settings.includeContextInCard ? context : "");
}

function buildProFront(card) {
  const reading = card.reading ? `<div class="reading">${escapeHtml(card.reading)}</div>` : "";
  return `<div class="term">${escapeHtml(card.term)}</div>${reading}`;
}

function buildProBack(card, sourceUrl, context) {
  const rows = [
    card.translation && `<p><b>Translation:</b> ${escapeHtml(card.translation)}</p>`,
    card.partOfSpeech && `<p><b>Part of speech:</b> ${escapeHtml(card.partOfSpeech)}</p>`,
    card.definition && `<p><b>Definition:</b> ${escapeHtml(card.definition)}</p>`,
    context && `<p><b>Context:</b><br><span class="context">${highlightTerm(context, card.term)}</span></p>`,
    card.examples.length && `<ul>${card.examples.map((example) => (
      `<li>${escapeHtml(example.sentence)}${example.translation ? `<br><small>${escapeHtml(example.translation)}</small>` : ""}</li>`
    )).join("")}</ul>`,
    card.mnemonic && `<p><b>Memory hint:</b> ${escapeHtml(card.mnemonic)}</p>`,
    sourceUrl && `<p><small>Source: ${escapeHtml(sourceUrl)}</small></p>`
  ].filter(Boolean);
  return rows.join("");
}

function buildCardSide(card, context, sourceUrl, configuredFields, fallbackFields) {
  const fieldIds = Array.isArray(configuredFields) && configuredFields.length ? configuredFields : fallbackFields;
  const rows = fieldIds
    .map((fieldId) => renderCardBlock(fieldId, card, context, sourceUrl))
    .filter(Boolean);
  if (rows.length) return rows.join("");
  return fallbackFields
    .map((fieldId) => renderCardBlock(fieldId, card, context, sourceUrl))
    .filter(Boolean)
    .join("") || `<div class="term">${escapeHtml(card.term)}</div>`;
}

function renderCardBlock(fieldId, card, context, sourceUrl) {
  const labels = {
    term: "Word",
    reading: "Reading",
    partOfSpeech: "Part of speech",
    translation: "Translation",
    definition: "Definition",
    examples: "Examples",
    context: "Context",
    mnemonic: "Memory hint",
    source: "Source"
  };

  if (fieldId === "term" && card.term) {
    return `<div class="term">${escapeHtml(card.term)}</div>`;
  }
  if (fieldId === "reading" && card.reading) {
    return `<div class="reading"><b>${labels.reading}:</b> ${escapeHtml(card.reading)}</div>`;
  }
  if (fieldId === "partOfSpeech" && card.partOfSpeech) {
    return `<p><b>${labels.partOfSpeech}:</b> ${escapeHtml(card.partOfSpeech)}</p>`;
  }
  if (fieldId === "translation" && card.translation) {
    return `<p><b>${labels.translation}:</b> ${escapeHtml(card.translation)}</p>`;
  }
  if (fieldId === "definition" && card.definition) {
    return `<p><b>${labels.definition}:</b> ${escapeHtml(card.definition)}</p>`;
  }
  if (fieldId === "examples" && card.examples.length) {
    return `<p><b>${labels.examples}:</b></p><ul>${card.examples.map((example) => (
      `<li>${escapeHtml(example.sentence)}${example.translation ? `<br><small>${escapeHtml(example.translation)}</small>` : ""}</li>`
    )).join("")}</ul>`;
  }
  if (fieldId === "context" && context) {
    return `<p><b>${labels.context}:</b><br><span class="context">${highlightTerm(context, card.term)}</span></p>`;
  }
  if (fieldId === "mnemonic" && card.mnemonic) {
    return `<p><b>${labels.mnemonic}:</b> ${escapeHtml(card.mnemonic)}</p>`;
  }
  if (fieldId === "source" && sourceUrl) {
    return `<p><small><b>${labels.source}:</b> ${escapeHtml(sourceUrl)}</small></p>`;
  }
  return "";
}

function highlightTerm(context, term) {
  const escapedContext = escapeHtml(context);
  const cleanTerm = String(term || "").trim();
  if (!cleanTerm) return escapedContext;
  const escapedTerm = escapeRegExp(escapeHtml(cleanTerm));
  return escapedContext.replace(new RegExp(`(${escapedTerm})`, "iu"), "<mark>$1</mark>");
}

async function callAnki(action, params = {}, timeoutMs = secondsToMs(DEFAULT_SETTINGS.ankiTimeoutSeconds)) {
  const response = await fetchWithTimeout("http://127.0.0.1:8765", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params })
  }, timeoutMs, "AnkiConnect");
  if (!response.ok) {
    throw new Error(`AnkiConnect request failed (${response.status}). Check that Anki is open and AnkiConnect is enabled.`);
  }

  const payload = await response.json();
  if (payload.error) throw new Error(`AnkiConnect: ${payload.error}`);
  return payload.result;
}

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds. Increase the timeout in options or try a faster model.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function secondsToMs(value, fallback = 30) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback * 1000;
  return Math.min(Math.max(seconds, 3), 180) * 1000;
}

function notifyTab(tabId, message) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function reportProgress(input, message) {
  notifyTab(input.tabId, { type: "anki-card-progress", message });
  if (input.runtimeProgress) {
    chrome.runtime.sendMessage({
      type: "anki-card-progress",
      requestId: input.requestId,
      message
    }).catch(() => {});
  }
  if (input.useActionBadge) setActionProgress(message);
}

function processSelectionFromTab({ tab, fallbackWord, fallbackContext }) {
  if (!tab?.id) {
    setActionBadge("...", "#4b5563", "Creating Anki card from selection...");
    processSelection({ word: fallbackWord, context: fallbackContext, sourceUrl: "", useActionBadge: true })
      .then((result) => showActionResult(`Added "${result.card.term}" to Anki.`, true))
      .catch((error) => showActionResult(toUserMessage(error), false));
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "read-selection" }, (response) => {
    const pageReadError = chrome.runtime.lastError;
    const useFallbackUi = Boolean(pageReadError);
    const word = pageReadError ? fallbackWord : response?.word || fallbackWord;
    const context = pageReadError ? fallbackContext : response?.context || fallbackContext;
    if (useFallbackUi) {
      setActionBadge("...", "#4b5563", "Creating Anki card from selection...");
    }
    processSelection({
      word,
      context,
      sourceUrl: tab.url || "",
      tabId: useFallbackUi ? undefined : tab.id,
      useActionBadge: useFallbackUi
    })
      .then((result) => {
        if (useFallbackUi) {
          showActionResult(`Added "${result.card.term}" to Anki.`, true);
        } else {
          notifyTab(tab.id, { type: "anki-card-result", result });
        }
      })
      .catch((error) => {
        if (useFallbackUi) {
          showActionResult(toUserMessage(error), false);
        } else {
          notifyTab(tab.id, { type: "anki-card-error", error: toUserMessage(error) });
        }
      });
  });
}

function setActionProgress(message) {
  if (/Anki settings/i.test(message)) {
    setActionBadge("ANKI", "#6b7280", message);
  } else if (/LLM/i.test(message)) {
    setActionBadge("LLM", "#2563eb", message);
  } else if (/Adding/i.test(message)) {
    setActionBadge("ADD", "#7c3aed", message);
  } else {
    setActionBadge("...", "#4b5563", message);
  }
}

function showActionResult(message, ok) {
  setActionBadge(ok ? "OK" : "ERR", ok ? "#15803d" : "#b91c1c", message);
  setTimeout(() => {
    setActionBadge("", "#4b5563", "Anki AI Card Gen");
  }, ok ? 5000 : 9000);
}

function setActionBadge(text, color, title) {
  safeActionCall("setBadgeText", { text });
  safeActionCall("setBadgeBackgroundColor", { color });
  if (title) safeActionCall("setTitle", { title });
}

function safeActionCall(method, args) {
  try {
    const result = chrome.action?.[method]?.(args);
    if (result?.catch) result.catch(() => {});
  } catch {
    // Some browser surfaces do not expose action updates while the service worker is waking up.
  }
}

function toUserMessage(error) {
  const message = String(error?.message || error || "Unknown error.");
  if (error?.name === "VaultLockedError") {
    return "Хранилище API-ключей заблокировано. Откройте настройки расширения и введите мастер-пароль.";
  }
  if (/Failed to fetch/i.test(message)) {
    return "Network request failed. Check internet access, provider Base URL, and that Anki is open for AnkiConnect.";
  }
  return message;
}

function sanitizeTag(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
