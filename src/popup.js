const createButton = document.getElementById("createButton");
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

function setStatus(message) {
  statusNode.textContent = message;
}
