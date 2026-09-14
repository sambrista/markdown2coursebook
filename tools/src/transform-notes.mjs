import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import fg from "fast-glob";
import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function parseArgs(argv) {
  const options = {
    input: [],
    out: "out"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) {
      options.input.push(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--out" && argv[i + 1]) {
      options.out = argv[i + 1];
      i += 1;
    }
  }

  if (options.input.length === 0) {
    options.input = ["UT */teoria.md"];
  }

  return options;
}

function removeIndexBlock(markdownSource) {
  return markdownSource.replace(/##\s+Índice\s*\n+\[\[toc\]\]\s*\n*/i, "");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function preprocessAdmonitions(markdownSource) {
  const lines = markdownSource.replace(/\r\n?/g, "\n").split("\n");
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^!!!\s*([a-z]+)(?:\s+(.*))?\s*$/i);

    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const type = match[1].toLowerCase();
    const title = match[2]?.trim() || type;
    const body = [];
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      if (line === "" || line.startsWith("    ") || line.startsWith("\t")) {
        body.push(line.startsWith("    ") ? line.slice(4) : line.replace(/^\t/, ""));
        index += 1;
        continue;
      }
      break;
    }

    output.push(`<div class="admonition ${escapeHtml(type)}">`);
    output.push(`<p class="admonition-title">${escapeHtml(title)}</p>`);
    output.push("");
    output.push(...body);
    output.push("");
    output.push("</div>");
    output.push("");
    index -= 1;
  }

  return output.join("\n");
}

function createMarkdownRenderer(headings) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(code, { language: lang }).value;
        return `<pre data-language=\"${escapeHtml(lang)}\"><code class=\"hljs language-${escapeHtml(lang)}\">${highlighted}</code></pre>`;
      }

      const fallback = md.utils.escapeHtml(code);
      return `<pre data-language=\"text\"><code class=\"hljs\">${fallback}</code></pre>`;
    }
  });

  md.use(markdownItAnchor, {
    slugify,
    callback(token, info) {
      headings.push({
        level: Number(token.tag.replace("h", "")),
        title: info.title,
        slug: info.slug
      });
    }
  });

  return md;
}

function attachCodeFilenames(htmlContent) {
  return htmlContent.replace(
    /<p><strong><code>([^<]+)<\/code><\/strong><\/p>\s*(<pre\b[^>]*>)/g,
    (_, filename, preStart) => {
      return `<${preStart.slice(1, -1)} data-filename=\"${filename}\">`;
    }
  );
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function buildHtmlPage({ title, htmlContent, headings }) {
  const tocHeadings = headings.filter((item) => item.level === 2);
  const documentHeading = headings.find((item) => item.level === 1);
  const contentWithoutDocumentHeading = htmlContent.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, "");
  const headingsJson = escapeJsonForHtml(tocHeadings);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(documentHeading?.title || title)}</title>
  <style>
    :root {
      --bg-main: #f4f1ea;
      --bg-soft: #fbfaf7;
      --panel: #fffdf9;
      --text-main: #2d3a38;
      --text-soft: #506462;
      --line: #d9d3c5;
      --accent: #5a7d75;
      --accent-soft: #e7f0ec;
      --code-bg: #f3f5f7;
      --note-bg: #e8f1ff;
      --warn-bg: #fff3df;
      --info-bg: #e8f7f3;
      --radius: 14px;
      --shadow: 0 10px 30px rgba(45, 58, 56, 0.08);
      --sidebar-w: 310px;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--text-main);
      background:
        radial-gradient(1200px 500px at -10% -10%, #ebe7de 0%, transparent 65%),
        radial-gradient(900px 420px at 110% -5%, #e4ede9 0%, transparent 62%),
        var(--bg-main);
      font-family: "Source Serif 4", "Book Antiqua", Palatino, "Palatino Linotype", serif;
      line-height: 1.7;
    }

    .shell {
      display: grid;
      grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
      gap: 1.2rem;
      width: min(1400px, 100% - 2rem);
      margin: 1rem auto 2rem;
      align-items: start;
      transition: grid-template-columns 250ms ease;
    }

    .shell.toc-collapsed {
      grid-template-columns: 54px minmax(0, 1fr);
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .toc {
      position: sticky;
      top: 1rem;
      max-height: calc(100vh - 2rem);
      overflow: hidden auto;
      padding: 0.9rem;
      transition: padding 250ms ease;
    }

    .shell.toc-collapsed .toc {
      padding: 0.6rem 0.35rem;
    }

    .toc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      margin-bottom: 0.8rem;
    }

    .shell.toc-collapsed .toc-header {
      margin-bottom: 0;
      justify-content: center;
    }

    .toc h2 {
      margin: 0;
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-soft);
      font-family: "Atkinson Hyperlegible", "Segoe UI", sans-serif;
      white-space: nowrap;
    }

    .shell.toc-collapsed .toc h2 {
      display: none;
    }

    .toc-toggle {
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 8px;
      padding: 0.3rem 0.55rem;
      cursor: pointer;
      font-family: "Atkinson Hyperlegible", "Segoe UI", sans-serif;
      font-size: 0.85rem;
      color: var(--text-soft);
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      flex-shrink: 0;
      transition: background 150ms ease, color 150ms ease;
    }

    .toc-toggle:hover {
      background: var(--accent-soft);
      color: #1d3d36;
    }

    .toc-toggle-icon {
      flex-shrink: 0;
      display: block;
    }

    .shell.toc-collapsed .toc-toggle-text {
      display: none;
    }

    .shell.toc-collapsed .toc-list {
      display: none;
    }

    .toc-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.25rem;
    }

    .toc-list a {
      width: 100%;
      text-align: left;
      color: var(--text-main);
      padding: 0.4rem 0.55rem;
      border-radius: 8px;
      display: block;
      text-decoration: none;
      font-family: "Atkinson Hyperlegible", "Segoe UI", sans-serif;
      font-size: 0.95rem;
    }

    .toc-list a:hover,
    .toc-list a.active {
      background: var(--accent-soft);
      color: #1d3d36;
    }

    .toc-list a.level-3 {
      padding-left: 1.2rem;
      color: var(--text-soft);
      font-size: 0.9rem;
    }

    .content-wrap {
      padding: 0;
      overflow: hidden;
    }

    .progress {
      height: 6px;
      background: #ebe6da;
      position: relative;
    }

    .progress span {
      display: block;
      height: 100%;
      width: 0;
      background: linear-gradient(90deg, #739f95, var(--accent));
      transition: width 180ms ease;
    }

    .article {
      padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 1rem;
      min-height: 70vh;
    }

    .page-header {
      padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 0;
    }

    .page-header h1 {
      margin: 0;
    }

    .page {
      display: none;
      animation: fadeIn 200ms ease;
    }

    .page.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    h1, h2, h3, h4 {
      line-height: 1.25;
      color: #223130;
    }

    h1 {
      font-size: clamp(1.8rem, 4vw, 2.5rem);
      margin-top: 0.2rem;
      padding-bottom: 0.45rem;
      border-bottom: 1px solid var(--line);
    }

    h2 {
      font-size: clamp(1.35rem, 2.4vw, 1.8rem);
      margin-top: 0.8rem;
      background: linear-gradient(90deg, #f2f7f5, transparent);
      border-left: 4px solid var(--accent);
      padding: 0.45rem 0.7rem;
      border-radius: 8px;
    }

    h3 { font-size: clamp(1.15rem, 2vw, 1.35rem); }

    .page h3 {
      margin-top: 2.4rem;
      padding: 0.65rem 0.8rem 0.5rem;
      border-top: 2px solid #b8cec7;
      border-bottom: 1px solid #d9e4df;
      background: linear-gradient(90deg, #f1f7f4, transparent);
      color: #315b53;
    }

    h4 {
      font-size: 1.05rem;
      margin-top: 1.8rem;
      padding-left: 0.7rem;
      border-left: 3px solid #b8cec7;
      color: #48635e;
    }

    p, li {
      font-size: clamp(1rem, 1.2vw, 1.06rem);
      max-width: none;
    }

    a {
      color: #2e6f62;
    }

    pre {
      background: var(--code-bg);
      border: 1px solid #d7dee3;
      border-radius: 10px;
      padding: 0.8rem;
      overflow: auto;
      width: 100%;
      max-width: none;
    }

    .code-frame {
      width: 100%;
      margin: 1rem 0;
      border: 1px solid #d7dee3;
      border-radius: 10px;
      overflow: hidden;
      background: var(--code-bg);
    }

    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-height: 2.35rem;
      padding: 0.4rem 0.65rem;
      background: #e8edf0;
      color: #40545b;
      font-family: "Atkinson Hyperlegible", "Segoe UI", sans-serif;
      font-size: 0.86rem;
    }

    .code-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.55rem;
      min-width: 0;
    }

    .code-language {
      font-weight: 700;
    }

    .code-file {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #687a80;
    }

    .copy-code {
      flex: 0 0 auto;
      border: 1px solid #c1cdd1;
      border-radius: 7px;
      padding: 0.25rem 0.55rem;
      background: #fff;
      color: #2e5e56;
      cursor: pointer;
      font: inherit;
    }

    .copy-code:hover {
      background: var(--accent-soft);
    }

    .code-frame pre {
      margin: 0;
      border: 0;
      border-radius: 0;
      min-width: 0;
      flex: 1;
    }

    .code-body {
      display: flex;
      align-items: stretch;
      overflow: hidden;
    }

    .line-numbers {
      flex: 0 0 3.2rem;
      padding: 0.8rem 0.65rem 0.8rem 0.4rem;
      border-right: 1px solid #d7dee3;
      color: #8a989d;
      background: #e9eef0;
      font: inherit;
      line-height: inherit;
      text-align: right;
      user-select: none;
      pointer-events: none;
      white-space: pre;
    }

    code {
      font-family: "Cascadia Mono", "Consolas", monospace;
    }

    :not(pre) > code {
      background: #eef2f4;
      border-radius: 6px;
      padding: 0.15rem 0.35rem;
      border: 1px solid #d8e1e7;
    }

    .admonition {
      border-radius: 12px;
      padding: 0.7rem 0.9rem;
      margin: 1rem 0;
      border: 1px solid transparent;
      width: 100%;
      max-width: none;
    }

    .admonition-title {
      margin-top: 0;
      font-weight: 700;
      font-family: "Atkinson Hyperlegible", "Segoe UI", sans-serif;
    }

    .admonition-title::before {
      display: inline-grid;
      place-items: center;
      width: 1.35em;
      height: 1.35em;
      margin-right: 0.45rem;
      border-radius: 50%;
      color: white;
      font-size: 0.8em;
      font-weight: 700;
      vertical-align: -0.1em;
      content: "i";
      background: #3e8c7d;
    }

    .admonition.note .admonition-title::before {
      content: "▤";
      border-radius: 4px;
      background: #4b82c5;
    }

    .admonition.warning .admonition-title::before {
      content: "⚠";
      border-radius: 4px;
      background: transparent;
      color: #c47720;
      font-size: 1.1em;
    }

    .hljs-comment,
    .hljs-quote { color: #71808a; font-style: italic; }
    .hljs-keyword,
    .hljs-selector-tag,
    .hljs-built_in { color: #8b4d83; }
    .hljs-string,
    .hljs-title,
    .hljs-section,
    .hljs-attribute { color: #287b69; }
    .hljs-number,
    .hljs-literal,
    .hljs-variable { color: #b05b3b; }
    .hljs-name,
    .hljs-tag { color: #376c9b; }

    .admonition.info {
      background: var(--info-bg);
      border-color: #b7ddd2;
    }

    .admonition.note {
      background: var(--note-bg);
      border-color: #b8d1f6;
    }

    .admonition.warning {
      background: var(--warn-bg);
      border-color: #f0c98d;
    }

    table {
      border-collapse: collapse;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
      margin: 1rem 0;
    }

    th, td {
      border: 1px solid var(--line);
      padding: 0.5rem 0.65rem;
      text-align: left;
    }

    .pager {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 0.6rem;
      border-top: 1px solid var(--line);
      padding: 0.9rem 1rem;
      background: var(--bg-soft);
      font-family: "Atkinson Hyperlegible", "Segoe UI", sans-serif;
    }

    .pager-top {
      border-top: 0;
      border-bottom: 1px solid var(--line);
    }

    .pager button,
    .pager select {
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 10px;
      padding: 0.45rem 0.7rem;
      font: inherit;
    }

    .pager button {
      cursor: pointer;
      min-width: 110px;
    }

    .pager button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .back-to-top {
      position: fixed;
      right: 1.25rem;
      bottom: 1.25rem;
      z-index: 10;
      width: 2.8rem;
      height: 2.8rem;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: var(--accent);
      color: white;
      box-shadow: var(--shadow);
      cursor: pointer;
      font-size: 1.35rem;
      line-height: 1;
    }

    .back-to-top[hidden] {
      display: none;
    }

    .muted {
      color: var(--text-soft);
      font-size: 0.95rem;
    }

    @media (max-width: 980px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .toc {
        display: none;
      }

      .article,
      .page-header {
        padding-left: 0.95rem;
        padding-right: 0.95rem;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside id="toc-panel" class="panel toc" aria-label="Índice del tema">
      <div class="toc-header">
        <h2>Navegación</h2>
        <button id="toc-toggle" class="toc-toggle" type="button" aria-expanded="true" aria-controls="toc-desktop" title="Ocultar índice">
          <svg class="toc-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M16 15l-3-3 3-3"/></svg>
          <span class="toc-toggle-text">Ocultar índice</span>
        </button>
      </div>
      <ul id="toc-desktop" class="toc-list"></ul>
    </aside>

    <main class="panel content-wrap">
      <header class="page-header">
        <h1 id="${documentHeading?.slug || "document-title"}">${escapeHtml(documentHeading?.title || title)}</h1>
      </header>
      <div class="progress" aria-hidden="true"><span id="progress-bar"></span></div>
      <div class="pager pager-top" aria-label="Navegación entre páginas">
        <button class="prev-btn" data-pager="prev" type="button">Anterior</button>
        <span class="page-state muted">1 / 1</span>
        <button class="next-btn" data-pager="next" type="button">Siguiente</button>
      </div>
      <article id="article-root" class="article markdown-body">
        ${contentWithoutDocumentHeading}
      </article>
      <footer class="pager pager-bottom" aria-label="Navegación entre páginas">
        <button class="prev-btn" data-pager="prev" type="button">Anterior</button>
        <span class="page-state muted">1 / 1</span>
        <button class="next-btn" data-pager="next" type="button">Siguiente</button>
      </footer>
    </main>
  </div>
  <button id="back-to-top" class="back-to-top" type="button" aria-label="Subir al principio" title="Subir al principio" hidden>↑</button>

  <script>
    const headings = ${headingsJson};
    const article = document.getElementById("article-root");
    const progressBar = document.getElementById("progress-bar");
    const pageStates = document.querySelectorAll(".page-state");
    const prevButtons = document.querySelectorAll('[data-pager="prev"]');
    const nextButtons = document.querySelectorAll('[data-pager="next"]');
    const tocDesktop = document.getElementById("toc-desktop");
    const backToTop = document.getElementById("back-to-top");

    const pages = [];

    function buildPages() {
      const h1 = article.querySelector(":scope > h1");
      if (h1) {
        h1.remove();
      }

      const children = Array.from(article.children);
      const h2Indexes = [];

      children.forEach((node, index) => {
        if (node.tagName === "H2") {
          h2Indexes.push(index);
        }
      });

      const groups = [];

      if (h2Indexes.length === 0) {
        groups.push(children);
      } else {
        const intro = children.slice(0, h2Indexes[0]);
        if (intro.length > 0) {
          groups.push(intro);
        }

        for (let i = 0; i < h2Indexes.length; i += 1) {
          const start = h2Indexes[i];
          const end = h2Indexes[i + 1] ?? children.length;
          groups.push(children.slice(start, end));
        }
      }

      groups.forEach((nodes, index) => {
        const section = document.createElement("section");
        section.className = "page";
        section.dataset.page = String(index);

        nodes.forEach((node) => section.appendChild(node));
        pages.push(section);
      });

      article.innerHTML = "";
      pages.forEach((page) => article.appendChild(page));
    }

    function renderToc(target) {
      target.innerHTML = "";

      headings.forEach((heading) => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = "#" + heading.slug;
        link.textContent = heading.title;
        link.dataset.slug = heading.slug;
        link.classList.add("level-" + heading.level);
        link.addEventListener("click", (event) => {
          event.preventDefault();
          jumpToSlug(heading.slug);
        });
        li.appendChild(link);
        target.appendChild(li);
      });
    }

    function languageLabel(language) {
      const labels = {
        css: "CSS",
        html: "HTML",
        javascript: "JavaScript",
        js: "JavaScript",
        json: "JSON",
        php: "PHP",
        text: "Texto plano",
        none: "Texto plano",
        typescript: "TypeScript",
        ts: "TypeScript"
      };

      return labels[language.toLowerCase()] || language.toUpperCase();
    }

    async function copyCode(text) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }

    function enhanceCodeBlocks() {
      article.querySelectorAll("pre").forEach((pre) => {
        const code = pre.querySelector("code");
        if (!code || pre.parentElement.classList.contains("code-frame")) {
          return;
        }

        const frame = document.createElement("div");
        frame.className = "code-frame";

        const header = document.createElement("div");
        header.className = "code-header";

        const meta = document.createElement("div");
        meta.className = "code-meta";

        const language = document.createElement("span");
        language.className = "code-language";
        language.textContent = languageLabel(pre.dataset.language || "text");
        meta.appendChild(language);

        if (pre.dataset.filename) {
          const filename = document.createElement("span");
          filename.className = "code-file";
          filename.textContent = pre.dataset.filename;
          meta.appendChild(filename);
        }

        const copyButton = document.createElement("button");
        copyButton.className = "copy-code";
        copyButton.type = "button";
        copyButton.textContent = "Copiar";
        copyButton.addEventListener("click", async () => {
          await copyCode(code.textContent);
          copyButton.textContent = "Copiado";
          window.setTimeout(() => {
            copyButton.textContent = "Copiar";
          }, 1400);
        });

        header.append(meta, copyButton);
        const codeBody = document.createElement("div");
        codeBody.className = "code-body";

        const lineNumbers = document.createElement("div");
        lineNumbers.className = "line-numbers";
        lineNumbers.setAttribute("aria-hidden", "true");
        const codeText = code.textContent.endsWith("\\n") ? code.textContent.slice(0, -1) : code.textContent;
        const lineCount = codeText.split("\\n").length;
        lineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\\n");

        pre.parentNode.insertBefore(frame, pre);
        frame.append(header, codeBody);
        codeBody.append(lineNumbers, pre);
      });
    }

    function refreshControls(index) {
      const total = pages.length;
      pageStates.forEach((state) => {
        state.textContent = (index + 1) + " / " + total;
      });
      prevButtons.forEach((button) => {
        button.disabled = index <= 0;
      });
      nextButtons.forEach((button) => {
        button.disabled = index >= total - 1;
      });
      progressBar.style.width = (((index + 1) / total) * 100) + "%";

      document.querySelectorAll(".toc-list a.active").forEach((item) => {
        item.classList.remove("active");
      });

      const activePage = pages[index];
      const activeHeading = activePage.querySelector("h2[id], h3[id], h1[id]");
      if (activeHeading) {
        const activeSlug = activeHeading.id;
        document.querySelectorAll('.toc-list a[data-slug="' + activeSlug + '"]').forEach((item) => {
          item.classList.add("active");
        });
        if (location.hash !== "#" + activeSlug) {
          history.replaceState(null, "", "#" + activeSlug);
        }
      }
    }

    function showPage(index) {
      const bounded = Math.max(0, Math.min(index, pages.length - 1));
      pages.forEach((page, pageIndex) => {
        page.classList.toggle("active", pageIndex === bounded);
      });
      refreshControls(bounded);
      return bounded;
    }

    function jumpToSlug(slug) {
      const targetPageIndex = pages.findIndex((page) => {
        return page.querySelector("#" + CSS.escape(slug));
      });

      if (targetPageIndex >= 0) {
        currentPage = showPage(targetPageIndex);
      }
    }

    buildPages();
    enhanceCodeBlocks();
    renderToc(tocDesktop);

    let currentPage = 0;

    prevButtons.forEach((button) => {
      button.addEventListener("click", () => {
        currentPage = showPage(currentPage - 1);
      });
    });

    nextButtons.forEach((button) => {
      button.addEventListener("click", () => {
        currentPage = showPage(currentPage + 1);
      });
    });


    function updateBackToTop() {
      backToTop.hidden = window.scrollY < 480;
    }

    backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const shell = document.querySelector(".shell");
    const tocToggle = document.getElementById("toc-toggle");
    const tocToggleIcon = tocToggle ? tocToggle.querySelector(".toc-toggle-icon") : null;
    const tocToggleText = tocToggle ? tocToggle.querySelector(".toc-toggle-text") : null;

    let isCollapsed = false;
    let manualToggleScrollY = null;

    function setSidebarCollapsed(collapsed) {
      isCollapsed = collapsed;
      if (shell) {
        shell.classList.toggle("toc-collapsed", collapsed);
      }
      if (tocToggle) {
        tocToggle.setAttribute("aria-expanded", String(!collapsed));
        if (collapsed) {
          tocToggle.title = "Mostrar índice";
          if (tocToggleIcon) {
            tocToggleIcon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M13 9l3 3-3 3"/>';
          }
          if (tocToggleText) {
            tocToggleText.textContent = "Mostrar índice";
          }
        } else {
          tocToggle.title = "Ocultar índice";
          if (tocToggleIcon) {
            tocToggleIcon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M16 15l-3-3 3-3"/>';
          }
          if (tocToggleText) {
            tocToggleText.textContent = "Ocultar índice";
          }
        }
      }
    }

    if (tocToggle) {
      tocToggle.addEventListener("click", () => {
        manualToggleScrollY = window.scrollY;
        setSidebarCollapsed(!isCollapsed);
      });
    }

    function handleScroll() {
      updateBackToTop();

      const scrollY = window.scrollY;

      if (manualToggleScrollY !== null && Math.abs(scrollY - manualToggleScrollY) > 60) {
        manualToggleScrollY = null;
      }

      if (manualToggleScrollY === null) {
        if (scrollY > 120) {
          if (!isCollapsed) {
            setSidebarCollapsed(true);
          }
        } else if (scrollY <= 40) {
          if (isCollapsed) {
            setSidebarCollapsed(false);
          }
        }
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    const hashSlug = location.hash.replace(/^#/, "");
    if (hashSlug) {
      jumpToSlug(hashSlug);
    } else {
      currentPage = showPage(0);
    }

    if (!hashSlug) {
      showPage(0);
    }
  </script>
</body>
</html>`;
}

export async function transformFile(filePath, outDir, rootDir) {
  const source = await fs.readFile(filePath, "utf8");
  const cleanedSource = preprocessAdmonitions(removeIndexBlock(source));

  const headings = [];
  const renderer = createMarkdownRenderer(headings);
  const htmlContent = attachCodeFilenames(renderer.render(cleanedSource));

  const title = path.basename(filePath);
  const finalHtml = buildHtmlPage({ title, htmlContent, headings });

  const relativePath = path.relative(rootDir, filePath);
  const outputPath = path.join(outDir, relativePath).replace(/\.md$/i, ".html");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, finalHtml, "utf8");

  return outputPath;
}

export { buildHtmlPage, createMarkdownRenderer, preprocessAdmonitions, removeIndexBlock, attachCodeFilenames };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const outDir = path.resolve(rootDir, args.out);

  const files = await fg(args.input, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    unique: true
  });

  if (files.length === 0) {
    console.error("No input files matched the provided patterns.");
    process.exitCode = 1;
    return;
  }

  const outputs = [];
  for (const filePath of files) {
    const outFile = await transformFile(filePath, outDir, rootDir);
    outputs.push(path.relative(rootDir, outFile));
  }

  console.log(`Generated ${outputs.length} HTML file(s):`);
  outputs.forEach((outFile) => console.log(`- ${outFile}`));
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
