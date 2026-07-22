(() => {
  "use strict";

  const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const encoder = new TextEncoder();

  function esc(value) {
    return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255]);
  }

  function u32(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
  }

  function joinBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  class StoreZip {
    constructor() { this.files = []; }
    add(path, content) {
      const data = typeof content === "string" ? encoder.encode(content) : content;
      this.files.push({ path, name: encoder.encode(path), data, crc: crc32(data) });
    }
    build() {
      const locals = [];
      const centrals = [];
      let offset = 0;
      for (const file of this.files) {
        const local = joinBytes([
          u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(file.crc),
          u32(file.data.length), u32(file.data.length), u16(file.name.length), u16(0), file.name, file.data
        ]);
        locals.push(local);
        centrals.push(joinBytes([
          u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(file.crc),
          u32(file.data.length), u32(file.data.length), u16(file.name.length), u16(0), u16(0), u16(0), u16(0),
          u32(0), u32(offset), file.name
        ]));
        offset += local.length;
      }
      const central = joinBytes(centrals);
      const end = joinBytes([
        u32(0x06054b50), u16(0), u16(0), u16(this.files.length), u16(this.files.length),
        u32(central.length), u32(offset), u16(0)
      ]);
      return joinBytes([...locals, central, end]);
    }
  }

  function run(text, props = "") {
    if (!text) return "";
    const parts = String(text).split("\n");
    return parts.map((part, index) => `${index ? "<w:br/>" : ""}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>`).join("");
  }

  function mathText(node) {
    return run(node.textContent || "", "<w:rFonts w:ascii=\"Cambria Math\" w:hAnsi=\"Cambria Math\"/>");
  }

  function mathNode(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return `<m:r><m:t>${esc(node.nodeValue)}</m:t></m:r>`;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const children = () => [...node.childNodes].map(mathNode).join("");
    const tag = node.localName?.toLowerCase();
    if (["math", "mrow", "semantics", "annotation", "annotation-xml"].includes(tag)) {
      if (tag?.startsWith("annotation")) return "";
      return children();
    }
    if (["mi", "mn", "mo", "mtext", "ms", "mspace"].includes(tag)) return `<m:r><m:t>${esc(node.textContent || (tag === "mspace" ? " " : ""))}</m:t></m:r>`;
    const elements = [...node.children];
    if (tag === "mfrac") return `<m:f><m:num>${mathNode(elements[0])}</m:num><m:den>${mathNode(elements[1])}</m:den></m:f>`;
    if (tag === "msup") return `<m:sSup><m:e>${mathNode(elements[0])}</m:e><m:sup>${mathNode(elements[1])}</m:sup></m:sSup>`;
    if (tag === "msub") return `<m:sSub><m:e>${mathNode(elements[0])}</m:e><m:sub>${mathNode(elements[1])}</m:sub></m:sSub>`;
    if (tag === "msubsup") return `<m:sSubSup><m:e>${mathNode(elements[0])}</m:e><m:sub>${mathNode(elements[1])}</m:sub><m:sup>${mathNode(elements[2])}</m:sup></m:sSubSup>`;
    if (tag === "msqrt") return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:e>${children()}</m:e></m:rad>`;
    if (tag === "mroot") return `<m:rad><m:deg>${mathNode(elements[1])}</m:deg><m:e>${mathNode(elements[0])}</m:e></m:rad>`;
    if (tag === "mover") return `<m:limUpp><m:e>${mathNode(elements[0])}</m:e><m:lim>${mathNode(elements[1])}</m:lim></m:limUpp>`;
    if (tag === "munder") return `<m:limLow><m:e>${mathNode(elements[0])}</m:e><m:lim>${mathNode(elements[1])}</m:lim></m:limLow>`;
    if (tag === "munderover") return `<m:limUpp><m:e><m:limLow><m:e>${mathNode(elements[0])}</m:e><m:lim>${mathNode(elements[1])}</m:lim></m:limLow></m:e><m:lim>${mathNode(elements[2])}</m:lim></m:limUpp>`;
    if (tag === "mfenced") {
      const begin = esc(node.getAttribute("open") || "(");
      const end = esc(node.getAttribute("close") || ")");
      return `<m:d><m:dPr><m:begChr m:val="${begin}"/><m:endChr m:val="${end}"/></m:dPr><m:e>${children()}</m:e></m:d>`;
    }
    if (tag === "mtable") {
      const rows = [...node.children].map((row) => `<m:mr>${[...row.children].map((cell) => `<m:e>${[...cell.childNodes].map(mathNode).join("")}</m:e>`).join("")}</m:mr>`).join("");
      return `<m:m>${rows}</m:m>`;
    }
    if (tag === "menclose") return `<m:borderBox><m:e>${children()}</m:e></m:borderBox>`;
    return children() || `<m:r><m:t>${esc(node.textContent || "")}</m:t></m:r>`;
  }

  function safeUrl(url) {
    try { const parsed = new URL(url, location.href); return /^(https?:|mailto:)/.test(parsed.protocol) ? parsed.href : ""; } catch { return ""; }
  }

  class DocumentBuilder {
    constructor(messages, options) {
      this.messages = messages;
      this.options = options;
      this.relationships = [];
      this.media = [];
      this.relIndex = 1;
      this.imageIndex = 1;
      this.drawingIndex = 1;
      this.hyperlinks = new Map();
    }

    async prepareImages(doc) {
      const images = [...doc.querySelectorAll("img")];
      let cursor = 0;
      const worker = async () => {
        while (cursor < images.length) {
          const img = images[cursor++];
          try {
            const source = img.getAttribute("src");
            if (!source || !this.options.includeImages) { img.remove(); continue; }
            const fetched = await globalThis.ChatArchive.fetchImage(source);
            if (!fetched) continue;
            const parsed = await globalThis.ChatArchive.normalizeImage(fetched, img);
            if (!parsed) continue;
            const id = `image-${this.imageIndex++}`;
            const relId = `rId${this.relIndex++}`;
            this.media.push({ id, relId, ...parsed });
            this.relationships.push({ id: relId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", target: `media/${id}.${parsed.extension}` });
            img.dataset.caMediaId = id;
          } catch { /* Image remains as alt text if it cannot be embedded. */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, Math.max(1, images.length)) }, () => worker()));
    }

    hyperlink(url) {
      const target = safeUrl(url);
      if (!target) return null;
      if (this.hyperlinks.has(target)) return this.hyperlinks.get(target);
      const id = `rId${this.relIndex++}`;
      this.hyperlinks.set(target, id);
      this.relationships.push({ id, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", target, external: true });
      return id;
    }

    inline(node, inherited = {}) {
      if (node.nodeType === Node.TEXT_NODE) return run(node.nodeValue, this.runProps(inherited));
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toLowerCase();
      if (node.classList.contains("katex")) {
        const math = node.querySelector("math");
        return math ? `<m:oMath>${mathNode(math)}</m:oMath>` : mathText(node);
      }
      if (tag === "math") return `<m:oMath>${mathNode(node)}</m:oMath>`;
      if (tag === "br") return "<w:r><w:br/></w:r>";
      if (tag === "img") return this.image(node, false);
      const style = {
        ...inherited,
        bold: inherited.bold || ["strong", "b"].includes(tag),
        italic: inherited.italic || ["em", "i"].includes(tag),
        underline: inherited.underline || tag === "u",
        strike: inherited.strike || ["s", "del", "strike"].includes(tag),
        code: inherited.code || tag === "code",
        sup: tag === "sup" ? "superscript" : inherited.sup,
        sub: tag === "sub" ? "subscript" : inherited.sub
      };
      const content = [...node.childNodes].map((child) => this.inline(child, style)).join("");
      if (tag === "a") {
        const id = this.hyperlink(node.getAttribute("href"));
        return id ? `<w:hyperlink r:id="${id}" w:history="1">${content}</w:hyperlink>` : content;
      }
      return content;
    }

    runProps(style) {
      return [
        style.bold ? "<w:b/>" : "", style.italic ? "<w:i/>" : "", style.underline ? "<w:u w:val=\"single\"/>" : "",
        style.strike ? "<w:strike/>" : "", style.code ? "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/><w:shd w:fill=\"F0F3F1\"/>" : "",
        style.sup ? `<w:vertAlign w:val="${style.sup}"/>` : "", style.sub ? `<w:vertAlign w:val="${style.sub}"/>` : ""
      ].join("");
    }

    image(node, block = true) {
      const item = this.media.find((media) => media.id === node.dataset.caMediaId);
      if (!item) return run(node.getAttribute("alt") || "[Image]");
      const maxWidthPx = 624;
      const width = Math.max(24, Math.min(maxWidthPx, item.width || Number(node.getAttribute("width")) || maxWidthPx));
      const height = Math.max(18, Math.round(width * ((item.height || Number(node.getAttribute("height")) || width * 0.65) / (item.width || Number(node.getAttribute("width")) || width))));
      const cx = Math.round(width * 9525);
      const cy = Math.round(height * 9525);
      const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${this.drawingIndex++}" name="${esc(node.getAttribute("alt") || "Image")}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${esc(item.id)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${item.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      return block ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${drawing}</w:p>` : drawing;
    }

    paragraph(node, style = "", prefix = "") {
      const body = [...node.childNodes].map((child) => this.inline(child)).join("");
      if (!body && !prefix) return "";
      const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
      return `<w:p>${properties}${prefix ? run(prefix) : ""}${body}</w:p>`;
    }

    table(node) {
      const rows = [...node.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr")];
      const body = rows.map((row) => `<w:tr>${[...row.children].filter((cell) => /^(TD|TH)$/.test(cell.tagName)).map((cell) => {
        const fill = cell.tagName === "TH" ? "<w:shd w:fill=\"EAF1ED\"/>" : "";
        const blocks = this.blocks(cell) || this.paragraph(cell);
        return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${fill}</w:tcPr>${blocks || "<w:p/>"}</w:tc>`;
      }).join("")}</w:tr>`).join("");
      return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/></w:tblPr>${body}</w:tbl>`;
    }

    blocks(root, depth = 0) {
      let xml = "";
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.nodeValue.trim()) xml += `<w:p>${run(node.nodeValue.trim())}</w:p>`;
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) xml += this.paragraph(node, `Heading${Math.min(3, Number(tag[1]))}`);
        else if (tag === "p") xml += this.paragraph(node);
        else if (tag === "pre") xml += `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${run(node.textContent.replace(/\n$/, ""), "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/><w:sz w:val=\"18\"/>")}</w:p>`;
        else if (tag === "blockquote") xml += `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${[...node.childNodes].map((child) => this.inline(child, { italic: true })).join("")}</w:p>`;
        else if (tag === "table") xml += this.table(node);
        else if (["ul", "ol"].includes(tag)) {
          [...node.children].filter((child) => child.tagName === "LI").forEach((item, index) => {
            const marker = tag === "ol" ? `${index + 1}. ` : "• ";
            const inlineNodes = [...item.childNodes].filter((child) => !(child.nodeType === Node.ELEMENT_NODE && ["UL", "OL"].includes(child.tagName)));
            xml += `<w:p><w:pPr><w:ind w:left="${360 + depth * 280}" w:hanging="240"/></w:pPr>${run(marker)}${inlineNodes.map((child) => this.inline(child)).join("")}</w:p>`;
            [...item.children].filter((child) => ["UL", "OL"].includes(child.tagName)).forEach((child) => { xml += this.blocks({ childNodes: [child] }, depth + 1); });
          });
        } else if (tag === "img") xml += this.image(node);
        else if (tag === "figure") xml += this.blocks(node, depth);
        else if (tag === "hr") xml += "<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:color=\"D8DFDB\"/></w:pBdr></w:pPr></w:p>";
        else if (tag === "math" || node.classList.contains("katex-display")) {
          const math = tag === "math" ? node : node.querySelector("math");
          xml += math ? `<m:oMathPara><m:oMath>${mathNode(math)}</m:oMath></m:oMathPara>` : this.paragraph(node);
        } else {
          const hasBlock = [...node.children].some((child) => /^(P|DIV|SECTION|ARTICLE|H[1-6]|UL|OL|TABLE|PRE|BLOCKQUOTE|FIGURE|HR)$/.test(child.tagName));
          xml += hasBlock ? this.blocks(node, depth) : this.paragraph(node);
        }
      }
      return xml;
    }

    async build() {
      const container = document.createElement("div");
      const messageNodes = [];
      for (const message of this.messages) {
        const template = document.createElement("template");
        template.innerHTML = message.html;
        const wrapper = document.createElement("section");
        wrapper.dataset.role = message.role;
        wrapper.append(template.content);
        container.append(wrapper);
        messageNodes.push({ message, wrapper });
      }
      await this.prepareImages(container);
      let body = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(this.options.title)}</w:p>`;
      if (this.options.includeMetadata) body += `<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${run(`Exported ${new Date().toLocaleString()} · ${this.messages.length} message${this.messages.length === 1 ? "" : "s"}`)}</w:p>`;
      for (const { message, wrapper } of messageNodes) {
        const role = message.role === "user" ? "You" : message.role === "canvas" ? "Canvas" : "ChatGPT";
        body += `<w:p><w:pPr><w:pStyle w:val="MessageRole"/></w:pPr>${run(role)}</w:p>${this.blocks(wrapper)}`;
      }
      body += `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="900" w:bottom="1080" w:left="900" w:header="420" w:footer="420" w:gutter="0"/></w:sectPr>`;

      const zip = new StoreZip();
      zip.add("[Content_Types].xml", this.contentTypes());
      zip.add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
      zip.add("docProps/core.xml", this.coreProps());
      zip.add("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Chat Archive</Application></Properties>`);
      zip.add("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`);
      zip.add("word/styles.xml", this.styles());
      zip.add("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${NS}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><m:mathPr><m:mathFont m:val="Cambria Math"/></m:mathPr></w:settings>`);
      zip.add("word/_rels/document.xml.rels", this.documentRels());
      this.media.forEach((media) => zip.add(`word/media/${media.id}.${media.extension}`, media.bytes));
      return new Blob([zip.build()], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    }

    contentTypes() {
      const extensions = [...new Set(this.media.map((media) => media.extension))];
      const imageTypes = extensions.map((ext) => `<Default Extension="${ext}" ContentType="${ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`}"/>`).join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
    }

    coreProps() {
      const now = new Date().toISOString();
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(this.options.title)}</dc:title><dc:creator>Chat Archive</dc:creator><cp:lastModifiedBy>Chat Archive</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    }

    documentRels() {
      const relationships = this.relationships.map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${esc(rel.target)}"${rel.external ? ' TargetMode="External"' : ""}/>`).join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${relationships}</Relationships>`;
    }

    styles() {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/><w:color w:val="17211C"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="330" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:rPr><w:b/><w:sz w:val="42"/><w:color w:val="101814"/></w:rPr><w:pPr><w:spacing w:after="80"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="66716B"/><w:sz w:val="18"/></w:rPr><w:pPr><w:spacing w:after="360"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D8DFDB" w:space="10"/></w:pBdr></w:pPr></w:style>${[1,2,3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${320 - n * 30}" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="121A16"/><w:sz w:val="${34 - n * 4}"/></w:rPr></w:style>`).join("")}<w:style w:type="paragraph" w:styleId="MessageRole"><w:name w:val="Message role"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="80"/></w:pPr><w:rPr><w:b/><w:caps/><w:color w:val="147B59"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code block"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="180"/><w:ind w:left="180" w:right="180"/><w:shd w:fill="F4F6F5"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="14" w:color="9FC5B5" w:space="8"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="435149"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFC9C3"/><w:left w:val="single" w:sz="4" w:color="BFC9C3"/><w:bottom w:val="single" w:sz="4" w:color="BFC9C3"/><w:right w:val="single" w:sz="4" w:color="BFC9C3"/><w:insideH w:val="single" w:sz="4" w:color="BFC9C3"/><w:insideV w:val="single" w:sz="4" w:color="BFC9C3"/></w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
    }
  }

  globalThis.ChatArchiveDocx = {
    async create(messages, options) {
      return new DocumentBuilder(messages, options).build();
    }
  };
})();
