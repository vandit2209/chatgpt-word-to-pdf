const extensionApi = globalThis.browser ?? globalThis.chrome;
const token = decodeURIComponent(location.hash.slice(1));
const status = document.querySelector("#print-status");
const root = document.querySelector("#document-root");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function receivePayload() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await extensionApi.runtime.sendMessage({ type: "CHAT_ARCHIVE_GET_PRINT", token });
    if (response?.payload) return response.payload;
    await wait(250);
  }
  throw new Error("The print job expired. Please start the export again.");
}

async function start() {
  try {
    const payload = await receivePayload();
    document.title = payload.title;
    root.innerHTML = payload.html;
    status.remove();
    await Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    })));
    await wait(300);
    window.focus();
    window.print();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add("print-error");
  }
}

addEventListener("afterprint", () => window.close(), { once: true });
start();
