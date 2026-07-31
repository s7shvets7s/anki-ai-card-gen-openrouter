const DEFAULT_PROMPT = `Create an Anki card for the selected term.

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
  promptTemplate: DEFAULT_PROMPT,
  llmTimeoutSeconds: 45,
  ankiTimeoutSeconds: 8
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
  processSelection({
    word: info.selectionText,
    context: "",
    sourceUrl: tab?.url || ""
  })
    .then((result) => notifyTab(tab?.id, { type: "anki-card-result", result }))
    .catch((error) => notifyTab(tab?.id, { type: "anki-card-error", error: toUserMessage(error) }));
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
      notifyTab(tab.id, { type: "anki-card-error", error: "No text selected." });
      return;
    }
    try {
      const result = await processSelection({
        word: response.word,
        context: response.context || "",
        sourceUrl: tab.url || ""
      });
      notifyTab(tab.id, { type: "anki-card-result", result });
    } catch (error) {
      notifyTab(tab.id, { type: "anki-card-error", error: toUserMessage(error) });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "process-selection") {
    processSelection({
      word: message.word,
      context: message.context || "",
      sourceUrl: sender.tab?.url || ""
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }

  if (message?.type === "test-llm-profile") {
    const timeoutMs = secondsToMs(message.timeoutSeconds, DEFAULT_SETTINGS.llmTimeoutSeconds);
    testLlmProfile(message.profile, timeoutMs)
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

  const localData = await chrome.storage.local.get(["apiProfiles"]);
  if (!Array.isArray(localData.apiProfiles) || localData.apiProfiles.length === 0) {
    await chrome.storage.local.set({ apiProfiles: [DEFAULT_PROFILE] });
  }
}

async function getConfig() {
  await ensureDefaults();
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS)))
  };
  const { apiProfiles = [DEFAULT_PROFILE] } = await chrome.storage.local.get(["apiProfiles"]);
  const profile = apiProfiles.find((item) => item.id === settings.activeProfileId) || apiProfiles[0];
  return { settings, profile: { ...DEFAULT_PROFILE, ...profile } };
}

async function processSelection(input) {
  const word = normalizeSelection(input.word);
  if (!word) throw new Error("Select a word or short phrase first.");

  const { settings, profile } = await getConfig();
  validateProfileShape(profile);

  const llmTimeoutMs = secondsToMs(settings.llmTimeoutSeconds, DEFAULT_SETTINGS.llmTimeoutSeconds);
  const ankiTimeoutMs = secondsToMs(settings.ankiTimeoutSeconds, DEFAULT_SETTINGS.ankiTimeoutSeconds);

  await validateAnkiTarget(settings, ankiTimeoutMs);
  const card = await generateCard({ word, context: input.context || "", settings, profile, timeoutMs: llmTimeoutMs });
  const noteId = await addCardToAnki({ card, settings, sourceUrl: input.sourceUrl || "", timeoutMs: ankiTimeoutMs });
  return { noteId, card };
}

function normalizeSelection(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

async function testLlmProfile(profileInput, timeoutMs) {
  const profile = { ...DEFAULT_PROFILE, ...profileInput };
  validateProfileShape(profile);
  const startedAt = Date.now();
  const response = await fetchWithTimeout(resolveChatEndpoint(profile.baseUrl), {
    method: "POST",
    headers: buildLlmHeaders(profile),
    body: JSON.stringify({
      model: profile.model,
      messages: [
        {
          role: "user",
          content: "Reply with exactly: OK"
        }
      ],
      temperature: 0,
      max_tokens: 8
    })
  }, timeoutMs, "LLM API test");

  await assertLlmResponseOk(response);
  const json = await response.json();
  const content = String(json?.choices?.[0]?.message?.content || "").trim();
  if (!content) throw new Error("LLM key looks accepted, but the model returned an empty message.");
  return {
    model: profile.model,
    elapsedMs: Date.now() - startedAt,
    sample: content.slice(0, 80)
  };
}

async function generateCard({ word, context, settings, profile, timeoutMs }) {
  const prompt = fillTemplate(settings.promptTemplate || DEFAULT_PROMPT, {
    word,
    context,
    language: settings.language || "auto"
  });

  const requestBody = {
    model: profile.model,
    messages: [
      {
        role: "system",
        content: "You create concise language-learning flashcards. Return valid JSON and no markdown."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.25
  };

  let response = await fetchWithTimeout(resolveChatEndpoint(profile.baseUrl), {
    method: "POST",
    headers: buildLlmHeaders(profile),
    body: JSON.stringify({ ...requestBody, response_format: { type: "json_object" } })
  }, timeoutMs, "LLM card generation");

  if (response.status === 400) {
    const details = await response.clone().text();
    if (/response_format|json_object/i.test(details)) {
      response = await fetchWithTimeout(resolveChatEndpoint(profile.baseUrl), {
        method: "POST",
        headers: buildLlmHeaders(profile),
        body: JSON.stringify(requestBody)
      }, timeoutMs, "LLM card generation");
    }
  }

  await assertLlmResponseOk(response);
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The LLM response did not contain a message.");

  return normalizeCard(parseJsonObject(content), word);
}

function buildLlmHeaders(profile) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${profile.apiKey}`,
    "HTTP-Referer": "https://github.com/local/anki-ai-card-gen-openrouter",
    "X-Title": "Anki AI Card Gen"
  };
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
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("The LLM returned invalid JSON. Adjust the prompt so it returns only the requested JSON object.");
  }
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

async function addCardToAnki({ card, settings, sourceUrl, timeoutMs }) {
  const defaultTags = String(settings.defaultTags || "")
    .split(/\s+/)
    .map(sanitizeTag)
    .filter(Boolean);
  const fields = {
    [settings.frontField || "Front"]: buildFront(card),
    [settings.backField || "Back"]: buildBack(card, sourceUrl)
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

function buildFront(card) {
  const reading = card.reading ? `<div class="reading">${escapeHtml(card.reading)}</div>` : "";
  return `<div class="term">${escapeHtml(card.term)}</div>${reading}`;
}

function buildBack(card, sourceUrl) {
  const rows = [
    card.translation && `<p><b>Meaning:</b> ${escapeHtml(card.translation)}</p>`,
    card.partOfSpeech && `<p><b>Part of speech:</b> ${escapeHtml(card.partOfSpeech)}</p>`,
    card.definition && `<p>${escapeHtml(card.definition)}</p>`,
    card.examples.length && `<ul>${card.examples.map((example) => (
      `<li>${escapeHtml(example.sentence)}${example.translation ? `<br><small>${escapeHtml(example.translation)}</small>` : ""}</li>`
    )).join("")}</ul>`,
    card.mnemonic && `<p><b>Memory hint:</b> ${escapeHtml(card.mnemonic)}</p>`,
    sourceUrl && `<p><small>Source: ${escapeHtml(sourceUrl)}</small></p>`
  ].filter(Boolean);
  return rows.join("");
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

function toUserMessage(error) {
  const message = String(error?.message || error || "Unknown error.");
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
