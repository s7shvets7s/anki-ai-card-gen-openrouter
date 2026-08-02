(function initExtensionI18n(globalScope) {
  const ru = {
    browserExtension: "Расширение для браузера",
    language: "Язык интерфейса",
    languageAuto: "Как в браузере",
    languageRu: "Русский",
    languageEn: "English",
    llmApi: "LLM API",
    apiSecurity: "Защита API-ключей",
    masterPassword: "Мастер-пароль",
    repeatMasterPassword: "Повторите мастер-пароль",
    encryptKeys: "Зашифровать ключи",
    unlock: "Разблокировать",
    lock: "Заблокировать",
    keyProfile: "Профиль ключа",
    profileName: "Название профиля",
    provider: "Провайдер",
    baseUrl: "Base URL",
    model: "Модель",
    apiKey: "API-ключ",
    llmTimeout: "Таймаут LLM, сек.",
    ankiTimeout: "Таймаут AnkiConnect, сек.",
    testLlm: "Проверить генерацию LLM",
    loadModels: "Загрузить модели",
    newProfile: "Новый профиль",
    deleteProfile: "Удалить профиль",
    anki: "Anki",
    deck: "Колода",
    noteType: "Тип заметки",
    frontField: "Поле Front",
    backField: "Поле Back",
    tags: "Теги",
    refreshAnki: "Загрузить списки из Anki",
    testAnki: "Проверить настройки Anki",
    cardMode: "Режим карточки",
    builderMode: "Builder: чекбоксы",
    proMode: "Pro: prompt / JSON",
    word: "Слово",
    reading: "Чтение",
    partOfSpeech: "Часть речи",
    translation: "Перевод",
    definition: "Определение",
    examples: "Примеры",
    context: "Контекст",
    mnemonic: "Мнемоника",
    sourceUrl: "URL источника",
    behavior: "Поведение",
    autoCreate: "Автоматически создавать карточку после выделения слова",
    showButton: "Показывать кнопку рядом с выделением",
    showDictionary: "Показывать быстрое одноязычное определение",
    includeContext: "В Pro-режиме добавлять контекст выделения в карточку",
    suppressEdge: "Скрывать системное мини-меню Edge в PDF Reader",
    shortcut: "Сочетание клавиш",
    record: "Записать",
    contextCapture: "Захват контекста",
    wordsAround: "Слова слева/справа",
    untilPunctuation: "До пунктуации",
    targetLanguage: "Язык карточки",
    siteAccess: "Доступ на сайтах",
    blocklist: "Работать везде, кроме списка",
    allowlist: "Работать только на сайтах из списка",
    siteList: "Сайты, по одному на строку",
    siteHint: "Поддерживаются example.com, *.example.com и example.com/path/*. Поддомены учитываются автоматически.",
    quickDictionaryHint: "Пилотный режим English → English работает без LLM: до двух коротких значений и двух примеров. Во внешний словарь отправляется только выделенное слово.",
    edgeHint: "Если Edge показывает свое меню, отключите Show mini menu when selecting text в edge://settings/appearance.",
    builderHint: "LLM возвращает полный JSON, а чекбоксы определяют блоки Front и Back.",
    proHint: "Доступны переменные {{word}}, {{context}} и {{language}}.",
    popupIntro: "Выделите ровно одно слово. Текст рядом будет добавлен как контекст.",
    createSelection: "Создать из выделения",
    openReader: "Открыть PDF Reader",
    openSettings: "Открыть настройки",
    disableSite: "Отключить на этом сайте",
    enableSite: "Разрешить на этом сайте",
    unavailableSite: "Для этой вкладки правила сайтов неприменимы.",
    siteBlocked: "Расширение отключено на этом сайте.",
    siteAllowed: "Расширение работает на этом сайте."
  };

  const en = {
    browserExtension: "Browser extension", language: "Interface language", languageAuto: "Use browser language", languageRu: "Русский", languageEn: "English",
    llmApi: "LLM API", apiSecurity: "API key protection", masterPassword: "Master password", repeatMasterPassword: "Repeat master password",
    encryptKeys: "Encrypt keys", unlock: "Unlock", lock: "Lock", keyProfile: "Key profile", profileName: "Profile name", provider: "Provider",
    baseUrl: "Base URL", model: "Model", apiKey: "API key", llmTimeout: "LLM timeout, sec.", ankiTimeout: "AnkiConnect timeout, sec.",
    testLlm: "Test LLM generation", loadModels: "Load models", newProfile: "New profile", deleteProfile: "Delete profile", anki: "Anki", deck: "Deck", noteType: "Note type",
    frontField: "Front field", backField: "Back field", tags: "Tags", refreshAnki: "Load lists from Anki", testAnki: "Test Anki settings",
    cardMode: "Card mode", builderMode: "Builder: checkboxes", proMode: "Pro: prompt / JSON", word: "Word", reading: "Reading",
    partOfSpeech: "Part of speech", translation: "Translation", definition: "Definition", examples: "Examples", context: "Context",
    mnemonic: "Mnemonic", sourceUrl: "Source URL", behavior: "Behavior", autoCreate: "Automatically create a card after selecting a word",
    showButton: "Show a button next to the selection", showDictionary: "Show a quick monolingual definition",
    includeContext: "Include selection context in Pro mode", suppressEdge: "Hide the Edge mini menu in PDF Reader", shortcut: "Keyboard shortcut",
    record: "Record", contextCapture: "Context capture", wordsAround: "Words on each side", untilPunctuation: "Up to punctuation",
    targetLanguage: "Card language", siteAccess: "Site access", blocklist: "Work everywhere except listed sites", allowlist: "Work only on listed sites",
    siteList: "Sites, one per line", siteHint: "Supports example.com, *.example.com, and example.com/path/*. Subdomains are included automatically.",
    quickDictionaryHint: "The English → English pilot works without an LLM and shows up to two short meanings and two examples. Only the selected word is sent to the dictionary.",
    edgeHint: "If Edge still shows its menu, disable Show mini menu when selecting text in edge://settings/appearance.",
    builderHint: "The LLM returns full JSON; the checkboxes choose which blocks appear on Front and Back.",
    proHint: "Available variables: {{word}}, {{context}}, and {{language}}.", popupIntro: "Select exactly one word. Nearby text will be added as context.",
    createSelection: "Create from selection", openReader: "Open PDF Reader", openSettings: "Open settings", disableSite: "Disable on this site",
    enableSite: "Allow on this site", unavailableSite: "Site rules do not apply to this tab.", siteBlocked: "The extension is disabled on this site.",
    siteAllowed: "The extension is enabled on this site."
  };

  function resolveLocale(setting = "auto") {
    if (setting === "ru" || setting === "en") return setting;
    const browserLanguage = globalScope.chrome?.i18n?.getUILanguage?.() || navigator.language || "en";
    return browserLanguage.toLowerCase().startsWith("ru") ? "ru" : "en";
  }

  function create(setting = "auto") {
    let locale = resolveLocale(setting);
    return {
      get locale() { return locale; },
      setLocale(value) { locale = resolveLocale(value); },
      t(key) { return (locale === "ru" ? ru : en)[key] || en[key] || key; },
      apply(root = document) {
        root.documentElement?.setAttribute("lang", locale);
        for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = this.t(node.dataset.i18n);
        for (const node of root.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = this.t(node.dataset.i18nPlaceholder);
      }
    };
  }

  globalScope.ExtensionI18n = Object.freeze({ create, resolveLocale });
})(globalThis);
