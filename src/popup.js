const extensionApi = globalThis.browser ?? globalThis.chrome;
const status = document.querySelector("#status");

async function send(command) {
  status.textContent = "Opening exporter…";
  try {
    const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
      throw new Error("Open a ChatGPT conversation first.");
    }
    await extensionApi.tabs.sendMessage(tab.id, { type: "CHAT_ARCHIVE_COMMAND", command });
    window.close();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

document.querySelector("#export").addEventListener("click", () => send("export-all"));
document.querySelector("#select").addEventListener("click", () => send("select"));
document.querySelector("#canvas").addEventListener("click", () => send("export-canvas"));
