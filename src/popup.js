const createButton = document.getElementById("createButton");
const readerButton = document.getElementById("readerButton");
const optionsButton = document.getElementById("optionsButton");
const statusNode = document.getElementById("status");

createButton.addEventListener("click", async () => {
  createButton.disabled = true;
  setStatus("Отправляю выделение...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Не нашел активную вкладку.");
    chrome.tabs.sendMessage(tab.id, { type: "create-card-from-current-selection" }, (response) => {
      createButton.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus("На этой вкладке расширение недоступно. Обновите страницу или откройте обычный сайт.");
        return;
      }
      if (!response?.ok) {
        setStatus(response?.error || "Не удалось прочитать выделение.");
        return;
      }
      setStatus("Запрос запущен. Результат появится на странице.");
    });
  } catch (error) {
    createButton.disabled = false;
    setStatus(error?.message || String(error));
  }
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

readerButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const readerUrl = new URL(chrome.runtime.getURL("src/pdf-reader.html"));
  if (isRemotePdfUrl(tab?.url, tab?.title)) readerUrl.searchParams.set("url", tab.url);
  await chrome.tabs.create({ url: readerUrl.href });
  window.close();
});

function isRemotePdfUrl(value, title = "") {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol)
      && (/\.pdf$/i.test(url.pathname) || /\.pdf(?:\s|$)/i.test(title));
  } catch {
    return false;
  }
}

function setStatus(message) {
  statusNode.textContent = message;
}
