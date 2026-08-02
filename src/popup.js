const createButton = document.getElementById("createButton");
const readerButton = document.getElementById("readerButton");
const siteToggleButton = document.getElementById("siteToggleButton");
const optionsButton = document.getElementById("optionsButton");
const statusNode = document.getElementById("status");
const siteStateNode = document.getElementById("siteState");

let activeTab = null;
let siteSettings = { appLanguage: "auto", siteAccessMode: "blocklist", siteRules: "" };
let siteRule = "";
let siteAllowed = true;
const i18n = ExtensionI18n.create("auto");

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  siteSettings = { ...siteSettings, ...(await chrome.storage.sync.get(Object.keys(siteSettings))) };
  i18n.setLocale(siteSettings.appLanguage);
  i18n.apply(document);
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  siteRule = SiteAccess.getSiteRule(activeTab?.url || "");
  renderSiteAccess();
}

createButton.addEventListener("click", async () => {
  createButton.disabled = true;
  setStatus(localize("Отправляю выделение...", "Sending selection..."));
  try {
    if (!activeTab?.id) throw new Error(localize("Не нашел активную вкладку.", "Could not find the active tab."));
    chrome.tabs.sendMessage(activeTab.id, { type: "create-card-from-current-selection" }, (response) => {
      createButton.disabled = !siteAllowed;
      if (chrome.runtime.lastError) {
        setStatus(localize("На этой вкладке расширение недоступно. Обновите страницу или откройте обычный сайт.", "The extension is unavailable on this tab. Reload it or open a regular website."));
        return;
      }
      if (!response?.ok) {
        setStatus(response?.error || localize("Не удалось прочитать выделение.", "Could not read the selection."));
        return;
      }
      setStatus(localize("Запрос запущен. Результат появится на странице.", "Request started. The result will appear on the page."));
    });
  } catch (error) {
    createButton.disabled = !siteAllowed;
    setStatus(error?.message || String(error));
  }
});

siteToggleButton.addEventListener("click", async () => {
  if (!siteRule) return;
  let rules = SiteAccess.parseRules(siteSettings.siteRules);
  if (siteAllowed) {
    if (siteSettings.siteAccessMode === "allowlist") {
      rules = rules.filter((rule) => !SiteAccess.matchesRule(activeTab.url, rule));
    } else if (!rules.includes(siteRule)) {
      rules.push(siteRule);
    }
  } else if (siteSettings.siteAccessMode === "allowlist") {
    if (!rules.includes(siteRule)) rules.push(siteRule);
  } else {
    rules = rules.filter((rule) => !SiteAccess.matchesRule(activeTab.url, rule));
  }
  siteSettings.siteRules = rules.join("\n");
  await chrome.storage.sync.set({ siteRules: siteSettings.siteRules });
  renderSiteAccess();
});

optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

readerButton.addEventListener("click", async () => {
  const readerUrl = new URL(chrome.runtime.getURL("src/pdf-reader.html"));
  if (isRemotePdfUrl(activeTab?.url, activeTab?.title)) readerUrl.searchParams.set("url", activeTab.url);
  await chrome.tabs.create({ url: readerUrl.href });
  window.close();
});

function renderSiteAccess() {
  if (!siteRule) {
    siteAllowed = true;
    siteStateNode.textContent = i18n.t("unavailableSite");
    siteStateNode.dataset.blocked = "false";
    siteToggleButton.hidden = true;
    createButton.disabled = false;
    return;
  }
  siteAllowed = SiteAccess.isAllowed(activeTab.url, siteSettings.siteAccessMode, siteSettings.siteRules);
  siteStateNode.textContent = i18n.t(siteAllowed ? "siteAllowed" : "siteBlocked");
  siteStateNode.dataset.blocked = String(!siteAllowed);
  siteToggleButton.hidden = false;
  siteToggleButton.textContent = i18n.t(siteAllowed ? "disableSite" : "enableSite");
  createButton.disabled = !siteAllowed;
}

function isRemotePdfUrl(value, title = "") {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && (/\.pdf$/i.test(url.pathname) || /\.pdf(?:\s|$)/i.test(title));
  } catch {
    return false;
  }
}

function localize(ru, en) {
  return i18n.locale === "ru" ? ru : en;
}

function setStatus(message) {
  statusNode.textContent = message;
}
