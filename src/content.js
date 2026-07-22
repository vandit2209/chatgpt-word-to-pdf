(() => {
  "use strict";

  if (globalThis.ChatArchive?.initialized) return;
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const state = {
    initialized: true,
    cache: new Map(),
    order: [],
    selecting: false,
    selected: new Set(),
    observer: null,
    busy: false,
    lastUrl: location.href,
    turnSelectionHandlers: new WeakMap()
  };

  const ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(36);
  }

  function title() {
    const documentName = document.title.replace(/\s*[|–-]\s*ChatGPT.*$/i, "").trim();
    if (documentName && documentName.toLowerCase() !== "chatgpt") return documentName;
    const heading = document.querySelector("main h1, main header h2");
    const raw = heading?.textContent?.trim();
    return raw && raw.toLowerCase() !== "chatgpt" ? raw : "ChatGPT conversation";
  }

  function safeFilename(value) {
    return (value || "ChatGPT conversation").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "ChatGPT conversation";
  }

  function roleFor(turn) {
    const role = turn.matches("[data-message-author-role]") ? turn.getAttribute("data-message-author-role") : turn.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");
    if (role === "user") return "user";
    return "assistant";
  }

  function findTurns() {
    const primary = [...document.querySelectorAll('main [data-testid^="conversation-turn-"], main article[data-testid*="conversation-turn"]')];
    if (primary.length) return primary.filter((node, index) => !primary.some((other, otherIndex) => otherIndex !== index && other.contains(node)));
    const roleNodes = [...document.querySelectorAll('main [data-message-author-role="user"], main [data-message-author-role="assistant"]')];
    return roleNodes.map((node) => node.closest("article") || node).filter((node, index, list) => list.indexOf(node) === index);
  }

  function contentFor(turn, role) {
    const roleRoot = turn.matches(`[data-message-author-role="${role}"]`) ? turn : turn.querySelector(`[data-message-author-role="${role}"]`);
    if (!roleRoot) return turn;
    if (role === "assistant") {
      return roleRoot.querySelector(".markdown, [class*='markdown'], [data-message-content], .prose") || roleRoot;
    }
    return roleRoot.querySelector(".whitespace-pre-wrap, [data-message-content], .prose") || roleRoot;
  }

  function keyFor(turn, role, content) {
    const explicit = turn.getAttribute("data-message-id") || turn.querySelector("[data-message-id]")?.getAttribute("data-message-id") || turn.getAttribute("data-testid");
    return explicit ? `${role}:${explicit}` : `${role}:${hash((content.textContent || "").trim().slice(0, 2000))}`;
  }

  function sanitize(source) {
    const clone = source.cloneNode(true);
    const sourceElements = [source, ...source.querySelectorAll("*")];
    const cloneElements = [clone, ...clone.querySelectorAll("*")];
    clone.querySelectorAll("base,script,style,link,meta,iframe,object,embed,template,noscript,button,input,textarea,select,form,.ca-single-export,.ca-select-box,[data-ca-remove],[contenteditable='true'][data-virtualkeyboard]").forEach((node) => node.remove());
    cloneElements.forEach((node, index) => {
      if (!(node instanceof Element)) return;
      [...node.attributes].forEach((attribute) => {
        if (/^on/i.test(attribute.name) || ["nonce", "srcdoc"].includes(attribute.name.toLowerCase())) node.removeAttribute(attribute.name);
      });
      if (node.tagName === "A" && node.getAttribute("href")) {
        try { node.setAttribute("href", new URL(node.getAttribute("href"), location.href).href); } catch { node.removeAttribute("href"); }
      }
      if (node.tagName === "IMG" && node.getAttribute("src")) {
        try { node.setAttribute("src", new URL(node.getAttribute("src"), location.href).href); } catch { /* Keep data/blob URLs. */ }
        node.removeAttribute("srcset");
        node.setAttribute("loading", "eager");
      }
      const original = sourceElements[index];
      if (node.tagName === "CANVAS" && original instanceof HTMLCanvasElement) {
        try {
          const image = document.createElement("img");
          image.src = original.toDataURL("image/png");
          image.alt = original.getAttribute("aria-label") || "Chart or generated graphic";
          node.replaceWith(image);
        } catch { node.replaceWith(document.createTextNode("[Canvas graphic]")); }
      }
      if (node.tagName?.toLowerCase() === "svg") {
        try {
          const image = document.createElement("img");
          const viewBox = node.getAttribute("viewBox")?.split(/\s+/).map(Number);
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(node))}`;
          image.alt = node.getAttribute("aria-label") || node.querySelector("title")?.textContent || "Vector graphic";
          if (viewBox?.length === 4) { image.width = viewBox[2]; image.height = viewBox[3]; }
          node.replaceWith(image);
        } catch { /* Leave the original SVG if serialization fails. */ }
      }
    });
    clone.querySelectorAll("[aria-hidden='true']").forEach((node) => {
      if (!node.closest(".katex") && !node.querySelector("math")) node.remove();
    });
    return clone.innerHTML || `<p>${escapeHtml(source.textContent || "")}</p>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function captureTurn(turn) {
    const role = roleFor(turn);
    const content = contentFor(turn, role);
    const text = (content.textContent || "").trim();
    if (!text && !content.querySelector("img,svg,canvas,table,math")) return null;
    const id = keyFor(turn, role, content);
    const message = { id, role, html: sanitize(content), text };
    state.cache.set(id, message);
    turn.dataset.caMessageKey = id;
    return message;
  }

  function captureVisible(order) {
    const messages = [];
    for (const turn of findTurns()) {
      const message = captureTurn(turn);
      if (!message) continue;
      messages.push(message);
      if (order && !order.includes(message.id)) order.push(message.id);
    }
    return messages;
  }

  function scrollContainer() {
    const turn = findTurns()[0];
    let node = turn?.parentElement || document.querySelector("main");
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 80) return node;
      node = node.parentElement;
    }
    const candidates = [...document.querySelectorAll("main div")].filter((item) => item.scrollHeight > item.clientHeight * 1.5 && /(auto|scroll)/.test(getComputedStyle(item).overflowY));
    return candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement;
  }

  async function loadConversation(onProgress = () => {}) {
    const scroller = scrollContainer();
    const originalTop = scroller === document.scrollingElement ? scrollY : scroller.scrollTop;
    const originalHeight = scroller.scrollHeight;
    const order = [];
    captureVisible();
    onProgress("Loading earlier messages…");

    let stable = 0;
    let previousHeight = 0;
    let previousCount = 0;
    for (let pass = 0; pass < 30 && stable < 3; pass += 1) {
      if (scroller === document.scrollingElement) scrollTo(0, 0); else scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await wait(pass < 3 ? 520 : 300);
      captureVisible();
      const height = scroller.scrollHeight;
      const count = state.cache.size;
      stable = height === previousHeight && count === previousCount ? stable + 1 : 0;
      previousHeight = height;
      previousCount = count;
    }

    onProgress("Collecting the conversation…");
    if (scroller === document.scrollingElement) scrollTo(0, 0); else scroller.scrollTop = 0;
    await wait(250);
    let bottomStable = 0;
    let lastPosition = -1;
    for (let pass = 0; pass < 260 && bottomStable < 3; pass += 1) {
      captureVisible(order);
      const position = scroller === document.scrollingElement ? scrollY : scroller.scrollTop;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const next = Math.min(max, position + Math.max(280, scroller.clientHeight * 0.72));
      if (scroller === document.scrollingElement) scrollTo(0, next); else scroller.scrollTop = next;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await wait(170);
      const current = scroller === document.scrollingElement ? scrollY : scroller.scrollTop;
      bottomStable = current >= max - 4 && current === lastPosition ? bottomStable + 1 : 0;
      lastPosition = current;
      if (pass % 8 === 0) onProgress(`Collected ${order.length || state.cache.size} messages…`);
    }
    captureVisible(order);

    const newMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const restore = originalHeight ? Math.min(newMax, originalTop * (scroller.scrollHeight / originalHeight)) : originalTop;
    if (scroller === document.scrollingElement) scrollTo(0, restore); else scroller.scrollTop = restore;
    const messages = order.map((id) => state.cache.get(id)).filter(Boolean);
    state.order = messages.map((message) => message.id);
    return messages;
  }

  function canvasContent() {
    const candidates = [
      ...document.querySelectorAll('[data-testid*="canvas" i] .ProseMirror, [data-testid*="canvas" i] [contenteditable="true"], [data-testid*="canvas" i] .markdown, [data-testid*="document" i] .ProseMirror, aside .ProseMirror, aside [contenteditable="true"], [role="dialog"] .ProseMirror, [role="dialog"] [contenteditable="true"], section[aria-label*="canvas" i] .ProseMirror')
    ];
    const editor = candidates
      .filter((node) => !node.closest("form") && !node.closest('[data-testid*="composer"]') && (node.textContent || "").trim())
      .sort((a, b) => (b.textContent || "").length - (a.textContent || "").length)[0];
    if (!editor) return null;
    return { id: `canvas:${hash(editor.textContent || "canvas")}`, role: "canvas", html: sanitize(editor), text: editor.textContent?.trim() || "" };
  }

  function messageActions(turn) {
    const role = roleFor(turn);
    if (role !== "assistant") return null;
    const buttons = [...turn.querySelectorAll("button")];
    const copy = buttons.find((button) => /copy/i.test(`${button.getAttribute("aria-label") || ""} ${button.getAttribute("data-testid") || ""}`));
    return copy?.parentElement || buttons.at(-1)?.parentElement || null;
  }

  function decorate() {
    if (state.lastUrl !== location.href) {
      state.lastUrl = location.href;
      state.cache.clear();
      state.order = [];
      if (state.selecting) stopSelection();
    }
    ensureLauncher();
    for (const turn of findTurns()) {
      const message = captureTurn(turn);
      if (!message) continue;
      if (message.role === "assistant" && !turn.querySelector(".ca-single-export")) {
        const actions = messageActions(turn);
        if (actions) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ca-single-export";
          button.dataset.caRemove = "true";
          button.setAttribute("aria-label", "Export this response to Word or PDF");
          button.title = "Export this response";
          button.innerHTML = ICON;
          button.addEventListener("click", (event) => { event.stopPropagation(); openExport({ scope: "single", ids: [message.id] }); });
          actions.append(button);
        }
      }
      if (state.selecting) attachCheckbox(turn, message.id);
    }
  }

  function ensureLauncher() {
    let root = document.querySelector("#chat-archive-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "chat-archive-root";
      root.dataset.caRemove = "true";
      root.innerHTML = `<div class="ca-launcher"><button type="button" class="ca-button" data-action="select" title="Select messages">${ICON}<span class="ca-label">Select</span></button><button type="button" class="ca-button ca-primary" data-action="export" title="Export conversation">${ICON}<span class="ca-label">Export</span></button></div>`;
      root.querySelector('[data-action="select"]').addEventListener("click", startSelection);
      root.querySelector('[data-action="export"]').addEventListener("click", () => openExport({ scope: canvasContent() ? "choose" : "all" }));
    }
    root.className = "ca-floating-controls";
    if (root.parentElement !== document.documentElement) document.documentElement.append(root);
    const nativeControl = [...document.querySelectorAll('button[data-testid="share-chat-button"], button[data-testid*="share" i], button[aria-label="Share" i], header button[aria-label*="share" i]')]
      .find((button) => !button.closest('article, [data-testid^="conversation-turn-"]'));
    const bounds = nativeControl?.getBoundingClientRect();
    const launcherWidth = root.querySelector(".ca-launcher")?.getBoundingClientRect().width || 190;
    let right = 200;
    if (bounds?.width && bounds.left > innerWidth * 0.55) right = innerWidth - bounds.left + 10;
    root.style.setProperty("--ca-launcher-right", `${Math.max(12, Math.min(Math.max(12, innerWidth - launcherWidth - 12), right))}px`);
  }

  function pageSeparated(messages, conversation = messages) {
    const included = new Set(messages.map((message) => message.id));
    const positions = new Map(conversation.map((message, index) => [message.id, index]));
    return messages.map((message, index) => {
      const position = positions.get(message.id);
      const previous = position > 0 ? conversation[position - 1] : null;
      const followsSelectedPrompt = message.role === "assistant" && previous?.role === "user" && included.has(previous.id);
      return { ...message, pageBreakBefore: index > 0 && !followsSelectedPrompt };
    });
  }

  function attachCheckbox(turn, id) {
    turn.classList.add("ca-message-selecting");
    let box = turn.querySelector(":scope > .ca-select-box");
    if (!box) {
      box = document.createElement("input");
      box.type = "checkbox";
      box.className = "ca-select-box";
      box.dataset.caRemove = "true";
      box.setAttribute("aria-label", `Select ${roleFor(turn)} message`);
      turn.prepend(box);
    }
    box.checked = state.selected.has(id);
    turn.classList.toggle("ca-message-selected", box.checked);
    if (!state.turnSelectionHandlers.has(turn)) {
      const handler = (event) => {
        if (!state.selecting || event.button !== 0) return;
        const selection = globalThis.getSelection?.();
        if (selection && !selection.isCollapsed && !event.target.matches(".ca-select-box")) return;
        event.preventDefault();
        event.stopPropagation();
        const messageId = turn.dataset.caMessageKey;
        if (!messageId) return;
        if (state.selected.has(messageId)) state.selected.delete(messageId); else state.selected.add(messageId);
        const checkbox = turn.querySelector(":scope > .ca-select-box");
        if (checkbox) checkbox.checked = state.selected.has(messageId);
        turn.classList.toggle("ca-message-selected", state.selected.has(messageId));
        updateSelectionBar();
      };
      turn.addEventListener("click", handler, true);
      state.turnSelectionHandlers.set(turn, handler);
    }
  }

  async function startSelection() {
    if (state.selecting || state.busy) return;
    state.selecting = true;
    toast("Loading the full conversation for selection…");
    await loadConversation(() => {});
    decorate();
    const bar = document.createElement("div");
    bar.className = "ca-selection-bar";
    bar.dataset.caRemove = "true";
    bar.innerHTML = `<span>0 selected</span><button type="button" class="ca-button" data-action="all">All</button><button type="button" class="ca-button" data-action="cancel">Cancel</button><button type="button" class="ca-button ca-primary" data-action="export" disabled>Export</button>`;
    bar.querySelector('[data-action="all"]').addEventListener("click", () => {
      captureVisible();
      state.cache.forEach((_message, id) => state.selected.add(id));
      decorate(); updateSelectionBar();
    });
    bar.querySelector('[data-action="cancel"]').addEventListener("click", stopSelection);
    bar.querySelector('[data-action="export"]').addEventListener("click", () => openExport({ scope: "selected", ids: [...state.selected] }));
    document.querySelector("#chat-archive-root").append(bar);
    updateSelectionBar();
  }

  function updateSelectionBar() {
    const bar = document.querySelector(".ca-selection-bar");
    if (!bar) return;
    bar.querySelector("span").textContent = `${state.selected.size} selected`;
    bar.querySelector('[data-action="export"]').disabled = state.selected.size === 0;
  }

  function stopSelection() {
    state.selecting = false;
    state.selected.clear();
    document.querySelector(".ca-selection-bar")?.remove();
    document.querySelectorAll(".ca-select-box").forEach((node) => node.remove());
    document.querySelectorAll(".ca-message-selecting").forEach((node) => node.classList.remove("ca-message-selecting", "ca-message-selected"));
  }

  function openExport(config) {
    if (state.busy) return;
    document.querySelector("#chat-archive-modal")?.remove();
    const hasCanvas = Boolean(canvasContent());
    const modal = document.createElement("div");
    modal.id = "chat-archive-modal";
    modal.dataset.caRemove = "true";
    modal.innerHTML = `<form class="ca-dialog" aria-label="Export ChatGPT conversation">
      <div class="ca-dialog-head"><h2>Export to Word or PDF</h2><button type="button" class="ca-close" aria-label="Close">×</button></div>
      <div class="ca-dialog-body">
        <label class="ca-field"><span>Document title</span><input class="ca-input" name="title" value="${escapeHtml(title())}" maxlength="140"></label>
        <fieldset class="ca-field" style="border:0;padding:0;margin:0"><legend class="ca-legend">Format</legend><div class="ca-format-grid">
          <label class="ca-format"><input type="radio" name="format" value="docx" checked><strong>Word document</strong><small>Editable .docx</small></label>
          <label class="ca-format"><input type="radio" name="format" value="pdf"><strong>PDF</strong><small>Print-quality PDF</small></label>
        </div></fieldset>
        ${config.scope === "all" || config.scope === "choose" ? `<fieldset class="ca-field" style="border:0;padding:0;margin:0"><legend class="ca-legend">Content</legend><div class="ca-radio-row"><label><input type="radio" name="content" value="all" checked> Prompts + responses</label><label><input type="radio" name="content" value="assistant"> Responses only</label>${hasCanvas ? `<label><input type="radio" name="content" value="canvas"> Open Canvas</label>` : ""}</div></fieldset>` : ""}
        <div class="ca-check-row"><label><input type="checkbox" name="images" checked> Include images</label><label><input type="checkbox" name="metadata" checked> Add export details</label></div>
        <div class="ca-progress" role="status"><span class="ca-spinner"></span><span>Preparing export…</span></div>
        <div class="ca-dialog-actions"><button type="button" class="ca-button ca-cancel">Cancel</button><button type="submit" class="ca-button ca-primary">Export</button></div>
      </div>
    </form>`;
    const close = () => { if (!state.busy) modal.remove(); };
    modal.querySelector(".ca-close").addEventListener("click", close);
    modal.querySelector(".ca-cancel").addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    modal.querySelector("form").addEventListener("submit", (event) => exportSubmit(event, modal, config));
    document.documentElement.append(modal);
    modal.querySelector('input[name="title"]').select();
  }

  async function exportSubmit(event, modal, config) {
    event.preventDefault();
    if (state.busy) return;
    const form = new FormData(event.currentTarget);
    const options = {
      title: String(form.get("title") || title()).trim() || "ChatGPT conversation",
      format: String(form.get("format") || "docx"),
      content: String(form.get("content") || config.scope),
      includeImages: form.has("images"),
      includeMetadata: form.has("metadata")
    };
    let printWindow = null;
    let printToken = null;
    if (options.format === "pdf") {
      printToken = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      printWindow = window.open(`${extensionApi.runtime.getURL("src/print.html")}#${encodeURIComponent(printToken)}`, "chat-archive-print");
    }
    state.busy = true;
    modal.querySelector(".ca-progress").classList.add("ca-visible");
    modal.querySelectorAll("button,input").forEach((node) => { node.disabled = true; });
    const status = modal.querySelector(".ca-progress span:last-child");
    try {
      let messages;
      let conversation;
      if (options.content === "canvas" || config.scope === "canvas") {
        const canvas = canvasContent();
        if (!canvas) throw new Error("No open ChatGPT Canvas was found.");
        messages = [canvas];
      } else if (config.scope === "single" || config.scope === "selected") {
        const visible = captureVisible();
        const orderedIds = [...state.order];
        for (const message of visible) if (!orderedIds.includes(message.id)) orderedIds.push(message.id);
        conversation = orderedIds.map((id) => state.cache.get(id)).filter(Boolean);
        const requested = new Set(config.ids);
        messages = conversation.filter((message) => requested.has(message.id));
      } else {
        conversation = await loadConversation((message) => { status.textContent = message; });
        messages = conversation;
      }
      if (options.content === "assistant") messages = messages.filter((message) => message.role === "assistant");
      if (!messages.length) throw new Error("No messages were found to export.");
      messages = pageSeparated(messages, conversation || messages);
      status.textContent = options.format === "docx" ? "Building Word document…" : "Building print document…";
      if (options.format === "docx") {
        const blob = await globalThis.ChatArchiveDocx.create(messages, options);
        download(blob, `${safeFilename(options.title)}.docx`);
        toast(`Exported ${messages.length} message${messages.length === 1 ? "" : "s"} to Word.`);
      } else {
        await printPdf(messages, options, printWindow, printToken);
      }
      modal.remove();
      if (config.scope === "selected") stopSelection();
    } catch (error) {
      printWindow?.close();
      const message = error instanceof Error ? error.message : String(error);
      toast(message, true);
      modal.querySelector(".ca-progress").classList.remove("ca-visible");
      modal.querySelectorAll("button,input").forEach((node) => { node.disabled = false; });
    } finally {
      state.busy = false;
    }
  }

  async function printPdf(messages, options, printWindow, printToken) {
    if (!printWindow) throw new Error("The print window was blocked. Allow pop-ups for ChatGPT and try again.");
    const prepared = [];
    for (const message of messages) {
      const template = document.createElement("template");
      template.innerHTML = message.html;
      const wrapper = document.createElement("div");
      wrapper.append(template.content);
      wrapper.querySelectorAll(".katex").forEach((node) => {
        const math = node.querySelector("math");
        if (math) node.replaceWith(math.cloneNode(true));
      });
      if (!options.includeImages) wrapper.querySelectorAll("img,svg,canvas").forEach((node) => node.remove());
      prepared.push(`<section class="message ${message.role}${message.pageBreakBefore ? " page-start" : ""}"><div class="message-role">${message.role === "user" ? "You" : message.role === "canvas" ? "Canvas" : "ChatGPT"}</div><div class="message-content">${wrapper.innerHTML}</div></section>`);
    }
    const metadata = options.includeMetadata ? `<div class="document-meta">Exported ${escapeHtml(new Date().toLocaleString())} · ${messages.length} message${messages.length === 1 ? "" : "s"}</div>` : "";
    const response = await extensionApi.runtime.sendMessage({
      type: "CHAT_ARCHIVE_STORE_PRINT",
      token: printToken,
      payload: {
        title: options.title,
        html: `<h1 class="document-title">${escapeHtml(options.title)}</h1>${metadata}${prepared.join("")}`
      }
    });
    if (!response?.ok) throw new Error("The print job could not be transferred to the print window.");
    toast("Print dialog opened. Choose “Save as PDF” as the destination.");
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function fetchImage(url) {
    if (url.startsWith("data:")) return url;
    if (url.startsWith("blob:")) {
      try { return blobToDataUrl(await (await fetch(url)).blob()); } catch { return null; }
    }
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) return blobToDataUrl(await response.blob());
    } catch { /* Background fetch can handle extension host permissions. */ }
    try {
      const response = await extensionApi.runtime.sendMessage({ type: "CHAT_ARCHIVE_FETCH_IMAGE", url });
      return response?.ok ? response.dataUrl : null;
    } catch { return null; }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlBytes(dataUrl) {
    const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) return null;
    const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { mime: match[1] || "application/octet-stream", bytes };
  }

  async function normalizeImage(dataUrl, sourceElement) {
    let dimensions = { width: Number(sourceElement.getAttribute("width")) || 0, height: Number(sourceElement.getAttribute("height")) || 0 };
    try {
      dimensions = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = reject;
        image.src = dataUrl;
      });
    } catch { /* Attribute dimensions are an adequate fallback. */ }
    let parsed = dataUrlBytes(dataUrl);
    if (!parsed) return null;
    const mime = parsed.mime.toLowerCase();
    let extension = mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : null;
    if (!extension) {
      try {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || dimensions.width || 1200;
        canvas.height = image.naturalHeight || dimensions.height || 800;
        canvas.getContext("2d").drawImage(image, 0, 0);
        parsed = dataUrlBytes(canvas.toDataURL("image/png"));
        extension = "png";
        dimensions = { width: canvas.width, height: canvas.height };
      } catch { return null; }
    }
    return { bytes: parsed.bytes, extension, width: dimensions.width, height: dimensions.height };
  }

  function toast(message, error = false) {
    document.querySelector(".ca-toast")?.remove();
    const node = document.createElement("div");
    node.className = `ca-toast${error ? " ca-error" : ""}`;
    node.textContent = message;
    document.documentElement.append(node);
    setTimeout(() => node.remove(), error ? 7000 : 4000);
  }

  extensionApi.runtime.onMessage.addListener((message) => {
    if (message?.type !== "CHAT_ARCHIVE_COMMAND") return;
    if (message.command === "export-all") openExport({ scope: canvasContent() ? "choose" : "all" });
    if (message.command === "select") startSelection();
    if (message.command === "export-canvas") openExport({ scope: "canvas" });
  });

  globalThis.ChatArchive = Object.assign(state, { fetchImage, normalizeImage, captureVisible, loadConversation, pageSeparated });
  decorate();
  state.observer = new MutationObserver(() => {
    clearTimeout(state.decorateTimer);
    state.decorateTimer = setTimeout(decorate, 180);
  });
  state.observer.observe(document.body, { childList: true, subtree: true });
  addEventListener("resize", ensureLauncher);
  addEventListener("popstate", () => { state.cache.clear(); state.order = []; state.selected.clear(); setTimeout(decorate, 300); });
})();
