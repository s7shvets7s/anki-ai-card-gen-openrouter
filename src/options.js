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
  ankiTimeoutSeconds: 8
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
  language: document.getElementById("language"),
  promptTemplate: document.getElementById("promptTemplate"),
  status: document.getElementById("status")
};

const buttons = {
  save: document.getElementById("saveButton"),
  newProfile: document.getElementById("newProfileButton"),
  deleteProfile: document.getElementById("deleteProfileButton"),
  testLlm: document.getElementById("testLlmButton"),
  testAnki: document.getElementById("testAnkiButton")
};

let apiProfiles = [];
let settings = { ...DEFAULT_SETTINGS };

document.addEventListener("DOMContentLoaded", load);
buttons.save.addEventListener("click", save);
buttons.newProfile.addEventListener("click", addProfile);
buttons.deleteProfile.addEventListener("click", deleteProfile);
buttons.testLlm.addEventListener("click", testLlm);
buttons.testAnki.addEventListener("click", testAnki);
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
  fields.language.value = settings.language;
  fields.promptTemplate.value = settings.promptTemplate;
  fields.llmTimeoutSeconds.value = settings.llmTimeoutSeconds;
  fields.ankiTimeoutSeconds.value = settings.ankiTimeoutSeconds;
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
    language: fields.language.value.trim() || "auto",
    promptTemplate: fields.promptTemplate.value.trim(),
    llmTimeoutSeconds: clampNumber(fields.llmTimeoutSeconds.value, 3, 180, 45),
    ankiTimeoutSeconds: clampNumber(fields.ankiTimeoutSeconds.value, 3, 60, 8)
  };
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
    setStatus("Проверяю LLM ключ и модель...");
    const response = await sendMessage({
      type: "test-llm-profile",
      profile: getActiveProfile(),
      timeoutSeconds: settings.llmTimeoutSeconds
    });
    if (!response?.ok) {
      setStatus(response?.error || "LLM API не ответил.");
      return;
    }
    setStatus(`LLM ключ работает. Модель: ${response.result.model}. Ответ за ${response.result.elapsedMs} мс.`);
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
