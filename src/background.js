const extensionApi = globalThis.browser ?? globalThis.chrome;
const printJobs = new Map();

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHAT_ARCHIVE_STORE_PRINT") {
    printJobs.set(message.token, message.payload);
    setTimeout(() => printJobs.delete(message.token), 120_000);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "CHAT_ARCHIVE_GET_PRINT") {
    const payload = printJobs.get(message.token) || null;
    if (payload) printJobs.delete(message.token);
    sendResponse({ ok: true, payload });
    return false;
  }

  if (message?.type !== "CHAT_ARCHIVE_FETCH_IMAGE") return false;

  (async () => {
    try {
      const url = new URL(message.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported image URL");

      const response = await fetch(url.href, { credentials: "include" });
      if (!response.ok) throw new Error(`Image request failed (${response.status})`);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      sendResponse({ ok: true, dataUrl: `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}` });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();

  return true;
});
