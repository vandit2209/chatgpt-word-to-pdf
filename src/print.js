const extensionApi = globalThis.browser ?? globalThis.chrome;
const token = decodeURIComponent(location.hash.slice(1));
const status = document.querySelector("#print-status");
const statusTitle = document.querySelector("#print-status-title");
const statusDetail = document.querySelector("#print-status-detail");
const statusStage = document.querySelector("#print-status-stage");
const pageCount = document.querySelector("#print-page-count");
const progress = document.querySelector(".print-progress");
const progressBar = document.querySelector("#print-progress-bar");
const root = document.querySelector("#document-root");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const nextFrame = () => Promise.race([
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  wait(120)
]);

function updateStatus(percent, title, detail, stage, pages) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  progress.setAttribute("aria-valuenow", String(value));
  progressBar.style.width = `${value}%`;
  if (title) statusTitle.textContent = title;
  if (detail) statusDetail.textContent = detail;
  if (stage) statusStage.textContent = stage;
  if (pages) pageCount.textContent = pages;
}

async function receivePayload() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await extensionApi.runtime.sendMessage({ type: "CHAT_ARCHIVE_GET_PRINT", token });
    if (response?.payload) return response.payload;
    if (attempt && attempt % 8 === 0) {
      updateStatus(Math.min(20, 5 + attempt / 8), "Preparing your PDF", "Still waiting for the conversation data…", "Transferring content");
    }
    await wait(250);
  }
  throw new Error("The print job expired. Please start the export again.");
}

async function loadImages() {
  const images = [...document.images];
  if (!images.length) {
    updateStatus(72, "Rendering document", "No images need to be loaded.", "Content rendered");
    return;
  }
  let completed = 0;
  const imageFinished = () => {
    completed += 1;
    const percent = 45 + (completed / images.length) * 27;
    updateStatus(percent, "Loading images", `${completed} of ${images.length} images processed`, "Rendering media");
  };
  await Promise.all(images.map((image) => {
    if (image.complete) {
      imageFinished();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => { imageFinished(); resolve(); };
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    });
  }));
}

function estimatePages() {
  const printablePageHeight = (259 / 25.4) * 96;
  const starts = [0, ...[...root.querySelectorAll(":scope > .message.page-start")].map((node) => node.offsetTop)]
    .filter((value, index, list) => value >= 0 && list.indexOf(value) === index)
    .sort((a, b) => a - b);
  const contentHeight = Math.max(root.scrollHeight, root.getBoundingClientRect().height);
  let pages = 0;
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : contentHeight;
    pages += Math.max(1, Math.ceil(Math.max(0, end - starts[index]) / printablePageHeight));
  }
  return Math.max(1, pages);
}

async function start() {
  try {
    updateStatus(5, "Preparing your PDF", "Waiting for the conversation data…", "Transferring content");
    const payload = await receivePayload();
    document.title = payload.title;
    const messages = Number(payload.messageCount) || 0;
    updateStatus(28, "Conversation received", messages ? `${messages} message${messages === 1 ? "" : "s"} ready to render` : "Building the print document…", "Creating layout");
    root.innerHTML = payload.html;
    await nextFrame();
    updateStatus(42, "Rendering document", "Laying out text, tables, and equations…", "Rendering content");
    await loadImages();
    updateStatus(80, "Finalizing document", "Loading fonts and applying page breaks…", "Final layout");
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, wait(500)]);
    await nextFrame();
    updateStatus(92, "Calculating pages", "Measuring the completed A4 print layout…", "Counting pages");
    await wait(120);
    const pages = estimatePages();
    const pageLabel = `${pages} estimated page${pages === 1 ? "" : "s"} ready`;
    document.title = `${payload.title} — ${pages} page${pages === 1 ? "" : "s"}`;
    status.classList.add("print-ready");
    document.body.classList.remove("print-preparing");
    updateStatus(100, "PDF ready to print", "Opening your browser’s print dialog…", "Rendering complete", pageLabel);
    await wait(650);
    window.focus();
    window.print();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus(100, "Couldn’t prepare the PDF", message, "Export stopped", "No pages rendered");
    document.body.classList.remove("print-preparing");
    status.classList.add("print-error");
  }
}

addEventListener("afterprint", () => window.close(), { once: true });
start();
