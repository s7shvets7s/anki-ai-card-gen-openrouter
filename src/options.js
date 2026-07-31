const DEFAULT_PROFILE = {
  id: "openrouter-default",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "openai/gpt-4o-mini"
};

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
  promptTemplate: "",
  llmTimeoutSeconds: 45,
  ankiTimeoutSeconds: 8,
  customShortcut: "Ctrl+Shift+Y",
  contextCaptureMode: "words",
  contextWordsEachSide: 8,
  includeContextInCard: true,
  cardLayoutMode: "builder",
  frontTemplateFields: ["term", "reading"],
  backTemplateFields: ["translation", "definition", "examples", "context", "mnemonic", "source"]
};

const fields = {
  profileSelect: document.getElementById("profileSelect"),
  profileName: document.getElementById("profileName"),
  baseUrl: document.getElementById("baseUrl"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  llmTimeoutSeconds: document.getElementById("llmTimeoutSeconds"),
  ankiTimeoutSeconds: document.getElementById("ankiTimeoutSeconds"),
  deckName: document.getElementById("deckName"),
  noteType: document.getElementById("noteType"),
  frontField: document.getElementById("frontField"),
  backField: document.getElementById("backField"),
  defaultTags: document.getElementById("defaultTags"),
  autoCreateOnSelection: document.getElementById("autoCreateOnSelection"),
  showFloatingButton: document.getElementById("showFloatingButton"),
  includeContextInCard: document.getElementById("includeContextInCard"),
  customShortcut: document.getElementById("customShortcut"),
  contextCaptureMode: document.getElementById("contextCaptureMode"),
  contextWordsEachSide: document.getElementById("contextWordsEachSide"),
  contextWordsValue: document.getElementById("contextWordsValue"),
  builderCardSection: document.getElementById("builderCardSection"),
  proCardSection: document.getElementById("proCardSection"),
  language: document.getElementById("language"),
  promptTemplate: document.getElementById("promptTemplate"),
  status: document.getElementById("status")
};

const buttons = {
  save: document.getElementById("saveButton"),
  newProfile: document.getElementById("newProfileButton"),
  deleteProfile: document.getElementById("deleteProfileButton"),
  testLlm: document.getElementById("testLlmButton"),
  testAnki: document.getElementById("testAnkiButton"),
  recordShortcut: document.getElementById("recordShortcutButton")
};

let apiProfiles = [];
let settings = { ...DEFAULT_SETTINGS };
let isRecordingShortcut = false;

document.addEventListener("DOMContentLoaded", load);
buttons.save.addEventListener("click", save);
buttons.newProfile.addEventListener("click", addProfile);
buttons.deleteProfile.addEventListener("click", deleteProfile);
buttons.testLlm.addEventListener("click", testLlm);
buttons.testAnki.addEventListener("click", testAnki);
buttons.recordShortcut.addEventListener("click", startShortcutRecording);
fields.contextWordsEachSide.addEventListener("input", updateContextControls);
fields.contextCaptureMode.addEventListener("change", updateContextControls);
for (const input of document.querySelectorAll("input[name='cardLayoutMode']")) {
  input.addEventListener("change", updateCardModeControls);
}
fields.profileSelect.addEventListener("change", () => {
  persistCurrentProfileInMemory();
  settings.activeProfileId = fields.profileSelect.value;
  renderProfile();
});

async function load() {
  const defaults = await getDefaults();
  settings = {
    ...DEFAULT_SETTINGS,
    ...defaults.settings,
    ...(await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS)))
  };
  if (!settings.promptTemplate) settings.promptTemplate = defaults.settings.promptTemplate;

  const local = await chrome.storage.local.get(["apiProfiles"]);
  apiProfiles = Array.isArray(local.apiProfiles) && local.apiProfiles.length
    ? local.apiProfiles
    : [{ ...DEFAULT_PROFILE, ...defaults.profile }];

  if (!apiProfiles.some((profile) => profile.id === settings.activeProfileId)) {
    settings.activeProfileId = apiProfiles[0].id;
  }

  render();
}

function getDefaults() {
  return sendMessage({ type: "get-defaults" })
    .then((response) => response || { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE });
}

function render() {
  renderProfileSelect();
  renderProfile();
  fields.deckName.value = settings.deckName;
  fields.noteType.value = settings.noteType;
  fields.frontField.value = settings.frontField;
  fields.backField.value = settings.backField;
  fields.defaultTags.value = settings.defaultTags;
  fields.autoCreateOnSelection.checked = Boolean(settings.autoCreateOnSelection);
  fields.showFloatingButton.checked = Boolean(settings.showFloatingButton);
  fields.includeContextInCard.checked = Boolean(settings.includeContextInCard);
  fields.customShortcut.value = settings.customShortcut;
  fields.contextCaptureMode.value = settings.contextCaptureMode;
  fields.contextWordsEachSide.value = settings.contextWordsEachSide;
  setRadioValue("cardLayoutMode", settings.cardLayoutMode || "builder");
  setCheckedValues("front", settings.frontTemplateFields || DEFAULT_SETTINGS.frontTemplateFields);
  setCheckedValues("back", settings.backTemplateFields || DEFAULT_SETTINGS.backTemplateFields);
  fields.language.value = settings.language;
  fields.promptTemplate.value = settings.promptTemplate;
  fields.llmTimeoutSeconds.value = settings.llmTimeoutSeconds;
  fields.ankiTimeoutSeconds.value = settings.ankiTimeoutSeconds;
  updateContextControls();
  updateCardModeControls();
}

function renderProfileSelect() {
  fields.profileSelect.innerHTML = "";
  for (const profile of apiProfiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name || profile.baseUrl || profile.id;
    fields.profileSelect.appendChild(option);
  }
  fields.profileSelect.value = settings.activeProfileId;
}

function renderProfile() {
  const profile = getActiveProfile();
  fields.profileName.value = profile.name || "";
  fields.baseUrl.value = profile.baseUrl || "";
  fields.model.value = profile.model || "";
  fields.apiKey.value = profile.apiKey || "";
}

function getActiveProfile() {
  return apiProfiles.find((profile) => profile.id === settings.activeProfileId) || apiProfiles[0];
}

function persistCurrentProfileInMemory() {
  const profile = getActiveProfile();
  if (!profile) return;
  profile.name = fields.profileName.value.trim() || "Untitled profile";
  profile.baseUrl = fields.baseUrl.value.trim();
  profile.model = fields.model.value.trim();
  profile.apiKey = fields.apiKey.value.trim();
}

function readSettingsFromForm() {
  persistCurrentProfileInMemory();
  settings = {
    ...settings,
    activeProfileId: fields.profileSelect.value,
    deckName: fields.deckName.value.trim() || "Default",
    noteType: fields.noteType.value.trim() || "Basic",
    frontField: fields.frontField.value.trim() || "Front",
    backField: fields.backField.value.trim() || "Back",
    defaultTags: fields.defaultTags.value.trim(),
    autoCreateOnSelection: fields.autoCreateOnSelection.checked,
    showFloatingButton: fields.showFloatingButton.checked,
    includeContextInCard: fields.includeContextInCard.checked,
    customShortcut: fields.customShortcut.value.trim() || "Ctrl+Shift+Y",
    contextCaptureMode: fields.contextCaptureMode.value === "sentence" ? "sentence" : "words",
    contextWordsEachSide: clampNumber(fields.contextWordsEachSide.value, 0, 40, 8),
    cardLayoutMode: getRadioValue("cardLayoutMode") === "pro" ? "pro" : "builder",
    frontTemplateFields: getCheckedValues("front", DEFAULT_SETTINGS.frontTemplateFields),
    backTemplateFields: getCheckedValues("back", DEFAULT_SETTINGS.backTemplateFields),
    language: fields.language.value.trim() || "auto",
    promptTemplate: fields.promptTemplate.value.trim(),
    llmTimeoutSeconds: clampNumber(fields.llmTimeoutSeconds.value, 3, 180, 45),
    ankiTimeoutSeconds: clampNumber(fields.ankiTimeoutSeconds.value, 3, 60, 8)
  };
}

function startShortcutRecording() {
  if (isRecordingShortcut) return;
  isRecordingShortcut = true;
  buttons.recordShortcut.textContent = "Нажмите...";
  fields.customShortcut.value = "Нажмите сочетание";
  setStatus("Нажмите сочетание клавиш. Используйте Ctrl, Alt, Shift или Cmd плюс основную клавишу.");

  const onKeyDown = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      stopShortcutRecording();
      fields.customShortcut.value = settings.customShortcut || "Ctrl+Shift+Y";
      setStatus("Запись сочетания отменена.");
      return;
    }

    const shortcut = formatShortcut(event);
    if (!shortcut) {
      setStatus("Добавьте хотя бы один модификатор: Ctrl, Alt, Shift или Cmd.");
      return;
    }

    fields.customShortcut.value = shortcut;
    settings.customShortcut = shortcut;
    stopShortcutRecording();
    setStatus(`Сочетание выбрано: ${shortcut}. Нажмите "Сохранить".`);
  };

  document.addEventListener("keydown", onKeyDown, true);
  startShortcutRecording.cleanup = () => document.removeEventListener("keydown", onKeyDown, true);
}

function stopShortcutRecording() {
  isRecordingShortcut = false;
  buttons.recordShortcut.textContent = "Записать";
  if (startShortcutRecording.cleanup) startShortcutRecording.cleanup();
}

function formatShortcut(event) {
  const key = normalizeKey(event.key);
  if (!key || ["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  if (!modifiers.length) return "";
  return [...modifiers, key].join("+");
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

function updateContextControls() {
  const words = clampNumber(fields.contextWordsEachSide.value, 0, 40, 8);
  fields.contextWordsValue.textContent = String(words);
  fields.contextWordsEachSide.disabled = fields.contextCaptureMode.value === "sentence";
}

function updateCardModeControls() {
  const mode = getRadioValue("cardLayoutMode") || "builder";
  fields.builderCardSection.hidden = mode !== "builder";
  fields.proCardSection.hidden = mode !== "pro";
}

function getRadioValue(name) {
  return document.querySelector(`input[name='${name}']:checked`)?.value || "";
}

function setRadioValue(name, value) {
  const input = document.querySelector(`input[name='${name}'][value='${value}']`);
  if (input) input.checked = true;
}

function getCheckedValues(side, fallback) {
  const values = [...document.querySelectorAll(`.card-fields[data-side='${side}'] input:checked`)]
    .map((input) => input.value);
  return values.length ? values : fallback;
}

function setCheckedValues(side, values) {
  const selected = new Set(Array.isArray(values) ? values : []);
  for (const input of document.querySelectorAll(`.card-fields[data-side='${side}'] input`)) {
    input.checked = selected.has(input.value);
  }
}

async function save() {
  readSettingsFromForm();
  await chrome.storage.sync.set(settings);
  await chrome.storage.local.set({ apiProfiles });
  renderProfileSelect();
  setStatus("Настройки сохранены.");
}

function addProfile() {
  persistCurrentProfileInMemory();
  const id = `profile-${Date.now()}`;
  apiProfiles.push({
    id,
    name: "New profile",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    model: "openai/gpt-4o-mini"
  });
  settings.activeProfileId = id;
  renderProfileSelect();
  renderProfile();
  setStatus("Новый профиль создан. Добавьте ключ и сохраните.");
}

async function deleteProfile() {
  if (apiProfiles.length === 1) {
    setStatus("Нельзя удалить единственный профиль.");
    return;
  }
  const activeId = settings.activeProfileId;
  apiProfiles = apiProfiles.filter((profile) => profile.id !== activeId);
  settings.activeProfileId = apiProfiles[0].id;
  await chrome.storage.sync.set(settings);
  await chrome.storage.local.set({ apiProfiles });
  render();
  setStatus("Профиль удален.");
}

async function testLlm() {
  readSettingsFromForm();
  await withBusyButton(buttons.testLlm, "Проверяю...", async () => {
    setStatus("Проверяю генерацию карточки через LLM...");
    const response = await sendMessage({
      type: "test-llm-profile",
      profile: getActiveProfile(),
      settings,
      timeoutSeconds: settings.llmTimeoutSeconds
    });
    if (!response?.ok) {
      setStatus(response?.error || "LLM генерация не ответила.");
      return;
    }
    setStatus(`LLM генерация карточки работает. Модель: ${response.result.model}. Ответ за ${response.result.elapsedMs} мс. ${response.result.sample}`);
  });
}

async function testAnki() {
  readSettingsFromForm();
  await withBusyButton(buttons.testAnki, "Проверяю...", async () => {
    setStatus("Проверяю AnkiConnect, колоду, note type и поля...");
    const response = await sendMessage({ type: "test-anki", settings });
    if (!response?.ok) {
      setStatus(response?.error || "AnkiConnect не ответил.");
      return;
    }
    setStatus(`Anki готов. Версия API: ${response.result.version}. Колода: ${response.result.deckName}.`);
  });
}

async function withBusyButton(button, busyText, task) {
  const originalText = button.textContent;
  setButtonsDisabled(true);
  button.textContent = busyText;
  try {
    await task();
  } catch (error) {
    setStatus(error?.message || String(error));
  } finally {
    button.textContent = originalText;
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  for (const button of Object.values(buttons)) {
    button.disabled = disabled;
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function setStatus(message) {
  fields.status.textContent = message;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    fields.status.textContent = "";
  }, 9000);
}
