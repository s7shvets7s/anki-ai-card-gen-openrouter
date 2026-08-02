const DEFAULT_PROFILE = {
  id: "openrouter-default",
  name: "OpenRouter",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "openai/gpt-4o-mini"
};

const DEFAULT_SETTINGS = {
  activeProfileId: "openrouter-default",
  appLanguage: "auto",
  deckName: "Default",
  noteType: "Basic",
  frontField: "Front",
  backField: "Back",
  language: "auto",
  defaultTags: "ai-generated selected-word",
  autoCreateOnSelection: true,
  showFloatingButton: true,
  showDictionaryPopup: true,
  promptTemplate: "",
  llmTimeoutSeconds: 45,
  ankiTimeoutSeconds: 8,
  customShortcut: "Ctrl+Shift+Y",
  contextCaptureMode: "words",
  contextWordsEachSide: 8,
  suppressEdgeMiniMenu: true,
  includeContextInCard: true,
  cardLayoutMode: "builder",
  frontTemplateFields: ["term", "reading"],
  backTemplateFields: ["translation", "definition", "examples", "context", "mnemonic", "source"],
  siteAccessMode: "blocklist",
  siteRules: ""
};

const AUTOSAVE_DELAY_MS = 650;

const fields = {
  appLanguage: document.getElementById("appLanguage"),
  profileSelect: document.getElementById("profileSelect"),
  profileName: document.getElementById("profileName"),
  provider: document.getElementById("provider"),
  baseUrl: document.getElementById("baseUrl"),
  model: document.getElementById("model"),
  modelSuggestions: document.getElementById("modelSuggestions"),
  apiKey: document.getElementById("apiKey"),
  llmTimeoutSeconds: document.getElementById("llmTimeoutSeconds"),
  ankiTimeoutSeconds: document.getElementById("ankiTimeoutSeconds"),
  deckName: document.getElementById("deckName"),
  noteType: document.getElementById("noteType"),
  frontField: document.getElementById("frontField"),
  backField: document.getElementById("backField"),
  defaultTags: document.getElementById("defaultTags"),
  deckSuggestions: document.getElementById("deckSuggestions"),
  noteTypeSuggestions: document.getElementById("noteTypeSuggestions"),
  ankiFieldSuggestions: document.getElementById("ankiFieldSuggestions"),
  ankiMetadataStatus: document.getElementById("ankiMetadataStatus"),
  autoCreateOnSelection: document.getElementById("autoCreateOnSelection"),
  showFloatingButton: document.getElementById("showFloatingButton"),
  showDictionaryPopup: document.getElementById("showDictionaryPopup"),
  includeContextInCard: document.getElementById("includeContextInCard"),
  customShortcut: document.getElementById("customShortcut"),
  contextCaptureMode: document.getElementById("contextCaptureMode"),
  contextWordsEachSide: document.getElementById("contextWordsEachSide"),
  contextWordsValue: document.getElementById("contextWordsValue"),
  suppressEdgeMiniMenu: document.getElementById("suppressEdgeMiniMenu"),
  builderCardSection: document.getElementById("builderCardSection"),
  proCardSection: document.getElementById("proCardSection"),
  language: document.getElementById("language"),
  promptTemplate: document.getElementById("promptTemplate"),
  siteRules: document.getElementById("siteRules"),
  status: document.getElementById("status"),
  autosaveState: document.getElementById("autosaveState"),
  vaultStatus: document.getElementById("vaultStatus"),
  vaultPassphraseFields: document.getElementById("vaultPassphraseFields"),
  vaultPassphrase: document.getElementById("vaultPassphrase"),
  vaultPassphraseConfirm: document.getElementById("vaultPassphraseConfirm"),
  vaultConfirmLabel: document.getElementById("vaultConfirmLabel")
};

const buttons = {
  newProfile: document.getElementById("newProfileButton"),
  deleteProfile: document.getElementById("deleteProfileButton"),
  testLlm: document.getElementById("testLlmButton"),
  loadModels: document.getElementById("loadModelsButton"),
  testAnki: document.getElementById("testAnkiButton"),
  refreshAnki: document.getElementById("refreshAnkiButton"),
  recordShortcut: document.getElementById("recordShortcutButton"),
  enableVault: document.getElementById("enableVaultButton"),
  unlockVault: document.getElementById("unlockVaultButton"),
  lockVault: document.getElementById("lockVaultButton")
};

let apiProfiles = [];
let settings = { ...DEFAULT_SETTINGS };
let isRecordingShortcut = false;
let isLoaded = false;
let autosaveTimer = 0;
let vaultState = { enabled: false, locked: false, hasLegacyProfiles: false };
let i18n = ExtensionI18n.create("auto");

document.addEventListener("DOMContentLoaded", load);
buttons.newProfile.addEventListener("click", addProfile);
buttons.deleteProfile.addEventListener("click", deleteProfile);
buttons.testLlm.addEventListener("click", testLlm);
buttons.loadModels.addEventListener("click", loadModels);
buttons.testAnki.addEventListener("click", testAnki);
buttons.refreshAnki.addEventListener("click", () => refreshAnkiMetadata());
buttons.recordShortcut.addEventListener("click", startShortcutRecording);
buttons.enableVault.addEventListener("click", enableVault);
buttons.unlockVault.addEventListener("click", unlockVault);
buttons.lockVault.addEventListener("click", lockVault);
fields.contextWordsEachSide.addEventListener("input", updateContextControls);
fields.contextCaptureMode.addEventListener("change", updateContextControls);
fields.appLanguage.addEventListener("change", updateInterfaceLanguage);
fields.provider.addEventListener("change", applyProviderPreset);
fields.noteType.addEventListener("change", refreshAnkiFields);
for (const input of document.querySelectorAll("input[name='cardLayoutMode']")) {
  input.addEventListener("change", updateCardModeControls);
}
fields.profileSelect.addEventListener("change", () => {
  persistCurrentProfileInMemory();
  settings.activeProfileId = fields.profileSelect.value;
  renderProfile();
  scheduleAutosave();
});
document.addEventListener("input", handleAutosaveEvent);
document.addEventListener("change", handleAutosaveEvent);

async function load() {
  const defaults = await getDefaults();
  settings = {
    ...DEFAULT_SETTINGS,
    ...defaults.settings,
    ...(await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS)))
  };
  if (!settings.promptTemplate) settings.promptTemplate = defaults.settings.promptTemplate;

  vaultState = await ApiVault.getState();
  if (!vaultState.locked) {
    apiProfiles = await ApiVault.loadProfiles([{ ...DEFAULT_PROFILE, ...defaults.profile }]);
  }

  if (apiProfiles.length && !apiProfiles.some((profile) => profile.id === settings.activeProfileId)) {
    settings.activeProfileId = apiProfiles[0].id;
  }

  render();
  isLoaded = true;
  setAutosaveState(vaultState.locked ? localize("Ключи заблокированы", "Keys locked") : localize("Все изменения сохранены", "All changes saved"));
  refreshAnkiMetadata({ silent: true }).catch(() => {});
}

function getDefaults() {
  return sendMessage({ type: "get-defaults" })
    .then((response) => response || { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE });
}

function render() {
  i18n.setLocale(settings.appLanguage || "auto");
  fields.appLanguage.value = settings.appLanguage || "auto";
  renderProviderSelect();
  i18n.apply(document);
  renderProfileSelect();
  renderProfile();
  fields.deckName.value = settings.deckName;
  fields.noteType.value = settings.noteType;
  fields.frontField.value = settings.frontField;
  fields.backField.value = settings.backField;
  fields.defaultTags.value = settings.defaultTags;
  setRadioValue("siteAccessMode", settings.siteAccessMode === "allowlist" ? "allowlist" : "blocklist");
  fields.siteRules.value = settings.siteRules || "";
  fields.autoCreateOnSelection.checked = Boolean(settings.autoCreateOnSelection);
  fields.showFloatingButton.checked = Boolean(settings.showFloatingButton);
  fields.showDictionaryPopup.checked = Boolean(settings.showDictionaryPopup);
  fields.includeContextInCard.checked = Boolean(settings.includeContextInCard);
  fields.customShortcut.value = settings.customShortcut;
  fields.contextCaptureMode.value = settings.contextCaptureMode;
  fields.contextWordsEachSide.value = settings.contextWordsEachSide;
  fields.suppressEdgeMiniMenu.checked = Boolean(settings.suppressEdgeMiniMenu);
  setRadioValue("cardLayoutMode", settings.cardLayoutMode || "builder");
  setCheckedValues("front", settings.frontTemplateFields || DEFAULT_SETTINGS.frontTemplateFields);
  setCheckedValues("back", settings.backTemplateFields || DEFAULT_SETTINGS.backTemplateFields);
  fields.language.value = settings.language;
  fields.promptTemplate.value = settings.promptTemplate;
  fields.llmTimeoutSeconds.value = settings.llmTimeoutSeconds;
  fields.ankiTimeoutSeconds.value = settings.ankiTimeoutSeconds;
  updateContextControls();
  updateCardModeControls();
  renderVaultState();
}

function renderProfileSelect() {
  fields.profileSelect.innerHTML = "";
  if (!apiProfiles.length) {
    const option = document.createElement("option");
    option.textContent = localize("Хранилище заблокировано", "Vault locked");
    option.value = "";
    fields.profileSelect.appendChild(option);
    return;
  }
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
  if (!profile) {
    fields.profileName.value = "";
    fields.provider.value = "custom";
    fields.baseUrl.value = "";
    fields.model.value = "";
    fields.apiKey.value = "";
    return;
  }
  profile.provider = profile.provider || LlmProviders.detect(profile.baseUrl);
  fields.profileName.value = profile.name || "";
  fields.provider.value = profile.provider;
  fields.baseUrl.value = profile.baseUrl || "";
  fields.model.value = profile.model || "";
  fields.apiKey.value = profile.apiKey || "";
  renderModelSuggestions(profile.provider);
}

function renderProviderSelect() {
  const selected = fields.provider.value;
  fields.provider.replaceChildren(...LlmProviders.providers.map((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    return option;
  }));
  if (selected) fields.provider.value = selected;
}

function renderModelSuggestions(providerId) {
  const provider = LlmProviders.get(providerId);
  const models = Array.isArray(provider.models) ? provider.models : [provider.model].filter(Boolean);
  fields.modelSuggestions?.replaceChildren(...models.map((model) => {
    const option = document.createElement("option");
    option.value = model;
    return option;
  }));
}

function applyProviderPreset() {
  const profile = getActiveProfile();
  if (!profile) return;
  const previousProvider = LlmProviders.get(profile.provider || LlmProviders.detect(profile.baseUrl));
  const provider = LlmProviders.get(fields.provider.value);
  const canReplaceUrl = !fields.baseUrl.value.trim() || fields.baseUrl.value.trim() === previousProvider.baseUrl;
  const canReplaceModel = !fields.model.value.trim() || fields.model.value.trim() === previousProvider.model;
  profile.provider = provider.id;
  if (provider.id !== "custom" && canReplaceUrl) fields.baseUrl.value = provider.baseUrl;
  if (provider.id !== "custom" && canReplaceModel) fields.model.value = provider.model;
  renderModelSuggestions(provider.id);
  scheduleAutosave();
}

function getActiveProfile() {
  return apiProfiles.find((profile) => profile.id === settings.activeProfileId) || apiProfiles[0];
}

function persistCurrentProfileInMemory() {
  const profile = getActiveProfile();
  if (!profile) return;
  profile.name = fields.profileName.value.trim() || "Untitled profile";
  profile.provider = fields.provider.value || LlmProviders.detect(fields.baseUrl.value);
  profile.baseUrl = fields.baseUrl.value.trim();
  profile.model = fields.model.value.trim();
  profile.apiKey = fields.apiKey.value.trim();
}

function readSettingsFromForm() {
  if (!vaultState.locked) persistCurrentProfileInMemory();
  settings = {
    ...settings,
    activeProfileId: fields.profileSelect.value || settings.activeProfileId,
    appLanguage: fields.appLanguage.value || "auto",
    deckName: fields.deckName.value.trim() || "Default",
    noteType: fields.noteType.value.trim() || "Basic",
    frontField: fields.frontField.value.trim() || "Front",
    backField: fields.backField.value.trim() || "Back",
    defaultTags: fields.defaultTags.value.trim(),
    autoCreateOnSelection: fields.autoCreateOnSelection.checked,
    showFloatingButton: fields.showFloatingButton.checked,
    showDictionaryPopup: fields.showDictionaryPopup.checked,
    includeContextInCard: fields.includeContextInCard.checked,
    customShortcut: fields.customShortcut.value.trim() || "Ctrl+Shift+Y",
    contextCaptureMode: fields.contextCaptureMode.value === "sentence" ? "sentence" : "words",
    contextWordsEachSide: clampNumber(fields.contextWordsEachSide.value, 0, 40, 8),
    suppressEdgeMiniMenu: fields.suppressEdgeMiniMenu.checked,
    cardLayoutMode: getRadioValue("cardLayoutMode") === "pro" ? "pro" : "builder",
    frontTemplateFields: getCheckedValues("front", DEFAULT_SETTINGS.frontTemplateFields),
    backTemplateFields: getCheckedValues("back", DEFAULT_SETTINGS.backTemplateFields),
    language: fields.language.value.trim() || "auto",
    promptTemplate: fields.promptTemplate.value.trim(),
    llmTimeoutSeconds: clampNumber(fields.llmTimeoutSeconds.value, 3, 180, 45),
    ankiTimeoutSeconds: clampNumber(fields.ankiTimeoutSeconds.value, 3, 60, 8),
    siteAccessMode: getRadioValue("siteAccessMode") === "allowlist" ? "allowlist" : "blocklist",
    siteRules: SiteAccess.parseRules(fields.siteRules.value).slice(0, 300).join("\n").slice(0, 7000)
  };
}

function startShortcutRecording() {
  if (isRecordingShortcut) return;
  isRecordingShortcut = true;
  buttons.recordShortcut.textContent = localize("Нажмите...", "Press keys...");
  fields.customShortcut.value = localize("Нажмите сочетание", "Press a shortcut");
  setStatus(localize("Нажмите сочетание клавиш. Используйте Ctrl, Alt, Shift или Cmd плюс основную клавишу.", "Press a key combination using Ctrl, Alt, Shift, or Cmd plus a main key."));

  const onKeyDown = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      stopShortcutRecording();
      fields.customShortcut.value = settings.customShortcut || "Ctrl+Shift+Y";
      setStatus(localize("Запись сочетания отменена.", "Shortcut recording canceled."));
      return;
    }

    const shortcut = formatShortcut(event);
    if (!shortcut) {
      setStatus(localize("Добавьте хотя бы один модификатор: Ctrl, Alt, Shift или Cmd.", "Add at least one modifier: Ctrl, Alt, Shift, or Cmd."));
      return;
    }

    fields.customShortcut.value = shortcut;
    settings.customShortcut = shortcut;
    stopShortcutRecording();
    setStatus(localize(`Сочетание выбрано: ${shortcut}. Настройка сохраняется автоматически.`, `Shortcut selected: ${shortcut}. It is saved automatically.`));
    scheduleAutosave();
  };

  document.addEventListener("keydown", onKeyDown, true);
  startShortcutRecording.cleanup = () => document.removeEventListener("keydown", onKeyDown, true);
}

function stopShortcutRecording() {
  isRecordingShortcut = false;
  buttons.recordShortcut.textContent = i18n.t("record");
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

function handleAutosaveEvent(event) {
  if (!isLoaded || event.target === fields.profileSelect) return;
  if (event.target === fields.vaultPassphrase || event.target === fields.vaultPassphraseConfirm) return;
  scheduleAutosave();
}

function scheduleAutosave() {
  if (!isLoaded) return;
  window.clearTimeout(autosaveTimer);
  setAutosaveState(localize("Сохранение...", "Saving..."));
  autosaveTimer = window.setTimeout(() => {
    saveNow().catch((error) => {
      setAutosaveState(localize("Ошибка сохранения", "Save failed"), true);
      setStatus(error?.message || String(error));
    });
  }, AUTOSAVE_DELAY_MS);
}

async function flushAutosave() {
  window.clearTimeout(autosaveTimer);
  await saveNow();
}

async function saveNow() {
  readSettingsFromForm();
  await chrome.storage.sync.set(settings);
  if (!vaultState.locked && apiProfiles.length) {
    await ApiVault.saveProfiles(apiProfiles);
  }
  updateActiveProfileOption();
  setAutosaveState(vaultState.locked ? localize("Настройки сохранены, ключи заблокированы", "Settings saved, keys locked") : localize("Все изменения сохранены", "All changes saved"));
}

function addProfile() {
  persistCurrentProfileInMemory();
  const id = `profile-${Date.now()}`;
  apiProfiles.push({
    id,
    name: "New profile",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    model: "openai/gpt-4o-mini"
  });
  settings.activeProfileId = id;
  renderProfileSelect();
  renderProfile();
  setStatus(localize("Новый профиль создан. Изменения сохраняются автоматически.", "New profile created. Changes are saved automatically."));
  scheduleAutosave();
}

async function deleteProfile() {
  if (apiProfiles.length === 1) {
    setStatus(localize("Нельзя удалить единственный профиль.", "The only profile cannot be deleted."));
    return;
  }
  const activeId = settings.activeProfileId;
  apiProfiles = apiProfiles.filter((profile) => profile.id !== activeId);
  settings.activeProfileId = apiProfiles[0].id;
  renderProfileSelect();
  renderProfile();
  await saveNow();
  render();
  setStatus(localize("Профиль удален.", "Profile deleted."));
}

async function testLlm() {
  await flushAutosave();
  await withBusyButton(buttons.testLlm, localize("Проверяю...", "Testing..."), async () => {
    setStatus(localize("Проверяю генерацию карточки через LLM...", "Testing card generation through the LLM..."));
    const response = await sendMessage({
      type: "test-llm-profile",
      profile: getActiveProfile(),
      settings,
      timeoutSeconds: settings.llmTimeoutSeconds
    });
    if (!response?.ok) {
      setStatus(response?.error || localize("LLM генерация не ответила.", "LLM generation did not respond."));
      return;
    }
    setStatus(localize(
      `LLM генерация карточки работает. Модель: ${response.result.model}. Ответ за ${response.result.elapsedMs} мс. ${response.result.sample}`,
      `LLM card generation works. Model: ${response.result.model}. Response in ${response.result.elapsedMs} ms. ${response.result.sample}`
    ));
  });
}

async function loadModels() {
  await flushAutosave();
  await withBusyButton(buttons.loadModels, i18n.locale === "ru" ? "Загружаю..." : "Loading...", async () => {
    const response = await sendMessage({
      type: "get-llm-models",
      profile: getActiveProfile(),
      timeoutSeconds: settings.llmTimeoutSeconds
    });
    if (!response?.ok) {
      setStatus(response?.error || (i18n.locale === "ru" ? "Не удалось загрузить модели." : "Could not load models."));
      return;
    }
    fillDataList(fields.modelSuggestions, response.result.models);
    setStatus(i18n.locale === "ru"
      ? `Загружено моделей: ${response.result.models.length}. Выберите модель в выпадающем списке.`
      : `Loaded ${response.result.models.length} models. Choose one from the dropdown.`);
  });
}

async function testAnki() {
  await flushAutosave();
  await withBusyButton(buttons.testAnki, localize("Проверяю...", "Testing..."), async () => {
    setStatus(localize("Проверяю AnkiConnect, колоду, тип заметки и поля...", "Testing AnkiConnect, deck, note type, and fields..."));
    const response = await sendMessage({ type: "test-anki", settings });
    if (!response?.ok) {
      setStatus(response?.error || localize("AnkiConnect не ответил.", "AnkiConnect did not respond."));
      return;
    }
    setStatus(localize(`Anki готов. Версия API: ${response.result.version}. Колода: ${response.result.deckName}.`, `Anki is ready. API version: ${response.result.version}. Deck: ${response.result.deckName}.`));
  });
}

async function refreshAnkiMetadata({ silent = false } = {}) {
  if (!silent) await flushAutosave();
  const response = await sendMessage({
    type: "get-anki-metadata",
    noteType: fields.noteType.value.trim() || settings.noteType,
    timeoutSeconds: settings.ankiTimeoutSeconds
  });
  if (!response?.ok) {
    fields.ankiMetadataStatus.textContent = silent ? "" : (response?.error || localize("AnkiConnect не ответил.", "AnkiConnect did not respond."));
    if (!silent) setStatus(response?.error || localize("AnkiConnect не ответил.", "AnkiConnect did not respond."));
    return;
  }
  fillDataList(fields.deckSuggestions, response.result.decks);
  fillDataList(fields.noteTypeSuggestions, response.result.noteTypes);
  fillDataList(fields.ankiFieldSuggestions, response.result.fields);
  const localeRu = i18n.locale === "ru";
  const summary = localeRu
    ? `Загружено: ${response.result.decks.length} колод, ${response.result.noteTypes.length} типов заметок, ${response.result.fields.length} полей.`
    : `Loaded ${response.result.decks.length} decks, ${response.result.noteTypes.length} note types, and ${response.result.fields.length} fields.`;
  const warnings = [];
  if (!response.result.decks.includes(fields.deckName.value.trim())) {
    warnings.push(localeRu ? "Текущая колода не найдена: выберите ее из списка." : "The current deck was not found; choose one from the list.");
  }
  if (!response.result.noteTypes.includes(fields.noteType.value.trim())) {
    warnings.push(localeRu ? "Текущий тип заметки не найден: выберите его из списка." : "The current note type was not found; choose one from the list.");
  }
  fields.ankiMetadataStatus.textContent = [summary, ...warnings].join(" ");
}

async function refreshAnkiFields() {
  const noteType = fields.noteType.value.trim();
  if (!noteType) return;
  const response = await sendMessage({
    type: "get-anki-fields",
    noteType,
    timeoutSeconds: settings.ankiTimeoutSeconds
  });
  if (!response?.ok) return;
  fillDataList(fields.ankiFieldSuggestions, response.result.fields);
}

function fillDataList(list, values) {
  list.replaceChildren(...(Array.isArray(values) ? values : []).map((value) => {
    const option = document.createElement("option");
    option.value = value;
    return option;
  }));
}

function updateInterfaceLanguage() {
  settings.appLanguage = fields.appLanguage.value || "auto";
  i18n.setLocale(settings.appLanguage);
  i18n.apply(document);
  renderVaultState();
  setAutosaveState(vaultState.locked ? localize("Ключи заблокированы", "Keys locked") : localize("Все изменения сохранены", "All changes saved"));
  scheduleAutosave();
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
    renderVaultState();
  }
}

function setButtonsDisabled(disabled) {
  for (const button of Object.values(buttons)) {
    button.disabled = disabled;
  }
}

async function enableVault() {
  window.clearTimeout(autosaveTimer);
  const passphrase = fields.vaultPassphrase.value;
  if (passphrase !== fields.vaultPassphraseConfirm.value) {
    setStatus(localize("Мастер-пароли не совпадают.", "Master passwords do not match."));
    return;
  }
  await withBusyButton(buttons.enableVault, localize("Шифрую...", "Encrypting..."), async () => {
    readSettingsFromForm();
    await chrome.storage.sync.set(settings);
    await ApiVault.enable(apiProfiles, passphrase);
    vaultState = await ApiVault.getState();
    clearVaultInputs();
    renderVaultState();
    setStatus(localize("API-ключи зашифрованы. После перезапуска браузера потребуется мастер-пароль.", "API keys encrypted. The master password will be required after a browser restart."));
    setAutosaveState(localize("Ключи защищены", "Keys protected"));
  });
}

async function unlockVault() {
  window.clearTimeout(autosaveTimer);
  await withBusyButton(buttons.unlockVault, localize("Открываю...", "Unlocking..."), async () => {
    apiProfiles = await ApiVault.unlock(fields.vaultPassphrase.value);
    vaultState = await ApiVault.getState();
    if (!apiProfiles.some((profile) => profile.id === settings.activeProfileId)) {
      settings.activeProfileId = apiProfiles[0].id;
    }
    clearVaultInputs();
    renderProfileSelect();
    renderProfile();
    renderVaultState();
    setStatus(localize("Хранилище API-ключей разблокировано до закрытия браузера.", "The API key vault is unlocked until the browser closes."));
    setAutosaveState(localize("Все изменения сохранены", "All changes saved"));
  });
}

async function lockVault() {
  await flushAutosave();
  await ApiVault.lock();
  apiProfiles = [];
  vaultState = await ApiVault.getState();
  renderProfileSelect();
  renderProfile();
  renderVaultState();
  setStatus(localize("Хранилище API-ключей заблокировано.", "The API key vault is locked."));
  setAutosaveState(localize("Ключи заблокированы", "Keys locked"));
}

function renderVaultState() {
  const enabled = vaultState.enabled;
  const locked = vaultState.locked;
  fields.vaultPassphraseFields.hidden = enabled && !locked;
  fields.vaultPassphraseFields.classList.toggle("single", enabled);
  fields.vaultConfirmLabel.hidden = enabled;
  buttons.enableVault.hidden = enabled;
  buttons.unlockVault.hidden = !enabled || !locked;
  buttons.lockVault.hidden = !enabled || locked;

  if (!enabled) {
    fields.vaultStatus.textContent = localize("Сейчас ключи находятся только в локальном хранилище браузера, но еще не зашифрованы.", "Keys are currently stored only in local browser storage and are not encrypted yet.");
  } else if (locked) {
    fields.vaultStatus.textContent = localize("Зашифрованное хранилище заблокировано. Введите мастер-пароль, чтобы LLM снова был доступен.", "The encrypted vault is locked. Enter the master password to use the LLM again.");
  } else {
    fields.vaultStatus.textContent = localize("Ключи зашифрованы AES-GCM. Разблокировка действует до закрытия браузера.", "Keys are encrypted with AES-GCM. The vault remains unlocked until the browser closes.");
  }

  const profileControls = [
    fields.profileSelect,
    fields.profileName,
    fields.provider,
    fields.baseUrl,
    fields.model,
    fields.apiKey
  ];
  for (const control of profileControls) control.disabled = locked;
  buttons.newProfile.disabled = locked;
  buttons.deleteProfile.disabled = locked;
  buttons.testLlm.disabled = locked;
  buttons.loadModels.disabled = locked;
}

function clearVaultInputs() {
  fields.vaultPassphrase.value = "";
  fields.vaultPassphraseConfirm.value = "";
}

function updateActiveProfileOption() {
  const profile = getActiveProfile();
  const option = [...fields.profileSelect.options].find((item) => item.value === profile?.id);
  if (option) option.textContent = profile.name || profile.baseUrl || profile.id;
}

function setAutosaveState(message, isError = false) {
  fields.autosaveState.textContent = message;
  fields.autosaveState.dataset.error = String(isError);
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

function localize(ru, en) {
  return i18n.locale === "ru" ? ru : en;
}
