import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

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
      continue;
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

function removeHtmlComments(htmlContent) {
  let output = "";
  let cursor = 0;

  while (cursor < htmlContent.length) {
    const commentStart = htmlContent.indexOf("<!--", cursor);
    if (commentStart === -1) {
      output += htmlContent.slice(cursor);
      break;
    }

    output += htmlContent.slice(cursor, commentStart);
    const commentEnd = htmlContent.indexOf("-->", commentStart + 4);
    const end = commentEnd === -1 ? htmlContent.length : commentEnd + 3;
    output += htmlContent.slice(commentStart, end).replace(/[^\n]/g, "");
    cursor = end;
  }

  return output;
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
    const match = lines[index].match(/^([ \t]*)!!!\s*([a-z]+)(?:\s+(.*))?\s*$/i);

    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const indentation = match[1];
    const type = match[2].toLowerCase();
    const title = match[3]?.trim() || type;
    const indentationColumns = [...indentation].reduce(
      (columns, character) => columns + (character === "\t" ? 4 : 1),
      0
    );
    const body = [];
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      const leadingWhitespace = line.match(/^[ \t]*/)[0];
      const leadingColumns = [...leadingWhitespace].reduce(
        (columns, character) => columns + (character === "\t" ? 4 : 1),
        0
      );

      if (line.trim() === "" || leadingColumns >= indentationColumns + 4) {
        let columnsToRemove = indentationColumns + 4;
        let charactersToRemove = 0;
        for (const character of leadingWhitespace) {
          const characterColumns = character === "\t" ? 4 : 1;
          if (columnsToRemove < characterColumns) {
            break;
          }
          columnsToRemove -= characterColumns;
          charactersToRemove += 1;
          if (columnsToRemove === 0) {
            break;
          }
        }

        body.push(line.trim() === "" ? "" : `${indentation}${line.slice(charactersToRemove)}`);
        index += 1;
        continue;
      }
      break;
    }

    output.push(`${indentation}<div class="admonition ${escapeHtml(type)}">`);
    output.push(`${indentation}<p class="admonition-title">${escapeHtml(title)}</p>`);
    output.push("");
    output.push(...body);
    output.push("");
    output.push(`${indentation}</div>`);
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

async function embedLocalImages(htmlContent, sourceDir) {
  const imageTags = [...htmlContent.matchAll(/<img\b[^>]*>/gi)];
  const mimeTypes = {
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp"
  };
  const replacements = await Promise.all(imageTags.map(async ([tag]) => {
    const sourceMatch = tag.match(/\bsrc="([^"]*)"/i);
    if (!sourceMatch) {
      return tag;
    }

    const source = sourceMatch[1]
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(source)) {
      return tag;
    }

    try {
      const baseUrl = pathToFileURL(`${sourceDir}${path.sep}`);
      const imagePath = fileURLToPath(new URL(source, baseUrl));
      const image = await fs.readFile(imagePath);
      const mimeType = mimeTypes[path.extname(imagePath).toLowerCase()];
      if (!mimeType) {
        return tag;
      }

      return tag.replace(sourceMatch[0], `src="data:${mimeType};base64,${image.toString("base64")}"`);
    } catch {
      return tag;
    }
  }));

  let result = htmlContent;
  for (let index = 0; index < imageTags.length; index += 1) {
    result = result.replace(imageTags[index][0], replacements[index]);
  }
  return result;
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function buildHtmlPage({ title, htmlContent, headings }) {
  const tocHeadings = headings.filter((item) => item.level === 2 || item.level === 3);
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
      --text-strong: #1d3d36;
      --mark-bg: #fbe7a1;
      color-scheme: light dark;
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

    .toc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      margin-bottom: 0.8rem;
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

    .toc-toggle {
      border: 1px solid var(--line);
      background: var(--panel);
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

    .toc-row {
      display: flex;
      align-items: flex-start;
      gap: 0.15rem;
    }

    .toc-row a {
      flex: 1;
      min-width: 0;
    }

    .toc-expand {
      flex-shrink: 0;
      width: 1.6rem;
      height: 1.6rem;
      margin-top: 0.35rem;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-soft);
      cursor: pointer;
    }

    .toc-expand:hover {
      background: var(--accent-soft);
      color: #1d3d36;
    }

    .toc-expand svg {
      transition: transform 180ms ease;
    }

    .toc-item.open > .toc-row .toc-expand svg {
      transform: rotate(90deg);
    }

    .toc-expand-spacer {
      flex-shrink: 0;
      width: 1.6rem;
    }

    .toc-sublist {
      list-style: none;
      margin: 0.1rem 0 0.35rem 1.75rem;
      padding: 0 0 0 0.45rem;
      border-left: 2px solid var(--line);
      display: none;
      gap: 0.1rem;
    }

    .toc-item.open > .toc-sublist {
      display: grid;
    }

    .toc-list a.level-2.active {
      font-weight: 700;
    }

    .toc-list a.level-3 {
      padding: 0.25rem 0.5rem;
      color: var(--text-soft);
      font-size: 0.88rem;
      line-height: 1.4;
    }

    .toc-list a.level-3.active {
      color: #1d3d36;
      box-shadow: inset 3px 0 0 var(--accent);
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
      scroll-margin-top: 1rem;
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

    .article img {
      max-width: 100%;
      height: auto;
    }

    .admonition img {
      display: block;
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

    .admonition.tip .admonition-title::before,
    .admonition.success .admonition-title::before,
    .admonition.solution .admonition-title::before {
      background: #528344;
    }

    .admonition.tip .admonition-title::before { content: "✦"; }
    .admonition.success .admonition-title::before,
    .admonition.solution .admonition-title::before { content: "✓"; }

    .admonition.warning .admonition-title::before,
    .admonition.caution .admonition-title::before,
    .admonition.attention .admonition-title::before {
      content: "⚠";
      border-radius: 4px;
      background: transparent;
      color: #c47720;
      font-size: 1.1em;
    }

    .admonition.important .admonition-title::before { content: "!"; background: #8058a5; }
    .admonition.danger .admonition-title::before,
    .admonition.failure .admonition-title::before { content: "×"; background: #b64c48; }
    .admonition.question .admonition-title::before { content: "?"; background: #4b82c5; }
    .admonition.bug .admonition-title::before { content: "⚙"; background: #a75d39; }
    .admonition.example .admonition-title::before { content: "◇"; background: #697c8a; }
    .admonition.quote .admonition-title::before { content: "“"; background: #697c8a; }
    .admonition.abstract .admonition-title::before { content: "▧"; background: #697c8a; }
    .admonition.todo .admonition-title::before { content: "□"; background: #697c8a; }
    .admonition.seealso .admonition-title::before { content: "↗"; background: #4b82c5; }
    .admonition.deprecated .admonition-title::before { content: "⌛"; background: #697c8a; }
    .admonition.security .admonition-title::before { content: "◆"; background: #8058a5; }
    .admonition.exercise .admonition-title::before { content: "✎"; background: #4b82c5; }

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

    .admonition.tip {
      background: #f3f7e8;
      border-color: #cbdca3;
    }

    .admonition.success,
    .admonition.solution {
      background: #edf7ed;
      border-color: #b8d9b8;
    }

    .admonition.caution,
    .admonition.attention {
      background: var(--warn-bg);
      border-color: #f0c98d;
    }

    .admonition.important,
    .admonition.security {
      background: #f3effa;
      border-color: #d2c4e8;
    }

    .admonition.danger,
    .admonition.failure {
      background: #fff0ef;
      border-color: #e7b6b1;
    }

    .admonition.question,
    .admonition.seealso,
    .admonition.exercise {
      background: #eef5fb;
      border-color: #bfd1e3;
    }

    .admonition.bug {
      background: #fff2eb;
      border-color: #e8c2a8;
    }

    .admonition.example,
    .admonition.quote,
    .admonition.abstract,
    .admonition.todo,
    .admonition.deprecated {
      background: #f4f3f1;
      border-color: #d8d4cc;
    }

    table {
      border-collapse: collapse;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: var(--panel);
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
      background: var(--panel);
      color: inherit;
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

    .page [id] {
      scroll-margin-top: 1rem;
    }

    .page [tabindex="-1"]:focus {
      outline: none;
    }

    .toc-close {
      display: none;
      border: 0;
      border-radius: 8px;
      padding: 0.3rem;
      background: transparent;
      color: var(--text-soft);
      cursor: pointer;
    }

    .toc-close:hover {
      background: var(--accent-soft);
      color: var(--text-strong);
    }

    .toc-search {
      position: relative;
      margin-bottom: 0.7rem;
    }

    .toc-search input {
      width: 100%;
      padding: 0.45rem 2rem;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--bg-soft);
      color: var(--text-main);
      font: 0.92rem "Atkinson Hyperlegible", "Segoe UI", sans-serif;
    }

    .toc-search input:focus {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }

    .toc-search-icon,
    .toc-search-key {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-soft);
      pointer-events: none;
    }

    .toc-search-icon {
      left: 0.65rem;
    }

    .toc-search-key {
      right: 0.55rem;
      padding: 0 0.3rem;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: var(--panel);
      font: 0.75rem "Cascadia Mono", "Consolas", monospace;
    }

    .toc-search input:focus ~ .toc-search-key,
    .toc-search input:not(:placeholder-shown) ~ .toc-search-key {
      display: none;
    }

    .toc-empty {
      margin: 0.2rem 0.55rem;
      color: var(--text-soft);
      font: italic 0.9rem "Atkinson Hyperlegible", "Segoe UI", sans-serif;
    }

    .toc-list mark {
      background: var(--mark-bg);
      color: inherit;
      border-radius: 3px;
      padding: 0 1px;
    }

    .reading-progress {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 40;
      pointer-events: none;
    }

    .reading-progress span {
      display: block;
      height: 100%;
      width: 0;
      background: linear-gradient(90deg, #739f95, var(--accent));
      transition: width 120ms linear;
    }

    .toc-fab {
      display: none;
      position: fixed;
      left: 1rem;
      bottom: 1.25rem;
      z-index: 10;
      align-items: center;
      gap: 0.4rem;
      padding: 0.6rem 0.95rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--text-main);
      box-shadow: var(--shadow);
      font: 600 0.95rem "Atkinson Hyperlegible", "Segoe UI", sans-serif;
      cursor: pointer;
    }

    .toc-backdrop {
      display: none;
    }

    .resume {
      position: fixed;
      left: 50%;
      bottom: 1.25rem;
      z-index: 20;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 0.5rem 0.8rem;
      width: max-content;
      max-width: min(760px, calc(100% - 2rem));
      padding: 0.6rem 0.7rem 0.6rem 1rem;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18);
      font: 0.95rem "Atkinson Hyperlegible", "Segoe UI", sans-serif;
      transform: translateX(-50%);
      animation: resumeIn 220ms ease;
    }

    .resume[hidden] {
      display: none;
    }

    @keyframes resumeIn {
      from { opacity: 0; transform: translate(-50%, 8px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }

    .resume-actions {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .resume-go {
      border: 0;
      border-radius: 8px;
      padding: 0.4rem 0.85rem;
      background: var(--accent);
      color: #fff;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .resume-close {
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--text-soft);
      font-size: 1.3rem;
      line-height: 1;
      cursor: pointer;
    }

    .resume-close:hover {
      background: var(--accent-soft);
    }

    @media (min-width: 981px) {
      .shell.toc-collapsed {
        grid-template-columns: 54px minmax(0, 1fr);
      }

      .shell.toc-collapsed .toc {
        padding: 0.6rem 0.35rem;
      }

      .shell.toc-collapsed .toc-header {
        margin-bottom: 0;
        justify-content: center;
      }

      .shell.toc-collapsed .toc h2,
      .shell.toc-collapsed .toc-toggle-text,
      .shell.toc-collapsed .toc-search,
      .shell.toc-collapsed .toc-empty,
      .shell.toc-collapsed .toc-list {
        display: none;
      }
    }

    @media (max-width: 980px) {
      .shell {
        grid-template-columns: minmax(0, 1fr);
      }

      .toc {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 30;
        width: min(86vw, 340px);
        max-height: none;
        border-radius: 0 var(--radius) var(--radius) 0;
        transform: translateX(-105%);
        visibility: hidden;
        transition: transform 220ms ease, visibility 0s linear 220ms;
      }

      body.toc-drawer-open .toc {
        transform: none;
        visibility: visible;
        transition: transform 220ms ease;
      }

      body.toc-drawer-open {
        overflow: hidden;
      }

      .toc-toggle,
      .toc-search-key {
        display: none;
      }

      .toc-close {
        display: inline-grid;
        place-items: center;
      }

      .toc-fab {
        display: inline-flex;
      }

      .toc-backdrop {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 25;
        background: rgba(20, 28, 26, 0.4);
        opacity: 0;
        pointer-events: none;
        transition: opacity 220ms ease;
      }

      body.toc-drawer-open .toc-backdrop {
        opacity: 1;
        pointer-events: auto;
      }

      .resume {
        bottom: 4.6rem;
      }

      .article,
      .page-header {
        padding-left: 0.95rem;
        padding-right: 0.95rem;
      }
    }

    @media screen and (prefers-color-scheme: dark) {
      :root {
        --bg-main: #151a19;
        --bg-soft: #1a201f;
        --panel: #1d2423;
        --text-main: #dbe3e0;
        --text-soft: #9fb0ab;
        --text-strong: #eaf4f0;
        --line: #33403d;
        --accent: #7fb0a4;
        --accent-soft: #263a35;
        --code-bg: #182021;
        --note-bg: #1b2637;
        --warn-bg: #322818;
        --info-bg: #1a2d29;
        --mark-bg: #5e4f1d;
        --shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      }

      body {
        background:
          radial-gradient(1200px 500px at -10% -10%, #1e2422 0%, transparent 65%),
          radial-gradient(900px 420px at 110% -5%, #192623 0%, transparent 62%),
          var(--bg-main);
      }

      .toc-toggle:hover,
      .toc-expand:hover,
      .toc-list a:hover,
      .toc-list a.active,
      .toc-list a.level-3.active {
        color: var(--text-strong);
      }

      .progress {
        background: #2a3230;
      }

      h1, h2, h3, h4 {
        color: #e3ebe8;
      }

      h2 {
        background: linear-gradient(90deg, #22302c, transparent);
      }

      .page h3 {
        border-top-color: #3d5a52;
        border-bottom-color: #2c3b37;
        background: linear-gradient(90deg, #1f2c29, transparent);
        color: #9fd0c3;
      }

      h4 {
        border-left-color: #3d5a52;
        color: #b5cbc5;
      }

      a {
        color: #8cc9b9;
      }

      pre,
      .code-frame {
        border-color: #2e3a3d;
      }

      .code-header {
        background: #222b2d;
        color: #b4c3c8;
      }

      .code-file {
        color: #8d9ea3;
      }

      .copy-code {
        border-color: #3b4a4e;
        background: #1e2526;
        color: #9fd0c3;
      }

      .line-numbers {
        border-right-color: #2e3a3d;
        color: #6c7c80;
        background: #1c2324;
      }

      :not(pre) > code {
        background: #263032;
        border-color: #34403f;
      }

      .hljs-comment,
      .hljs-quote { color: #8494a0; }
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-built_in { color: #d49bd0; }
      .hljs-string,
      .hljs-title,
      .hljs-section,
      .hljs-attribute { color: #7fc8a9; }
      .hljs-number,
      .hljs-literal,
      .hljs-variable { color: #e5a07a; }
      .hljs-name,
      .hljs-tag { color: #85b5e6; }

      .admonition.info { border-color: #2f5a50; }
      .admonition.note { border-color: #34507a; }
      .admonition.warning,
      .admonition.caution,
      .admonition.attention { border-color: #6b5228; }
      .admonition.tip { background: #232a1b; border-color: #4d5e2c; }
      .admonition.success,
      .admonition.solution { background: #1c2b1c; border-color: #3c5e3c; }
      .admonition.important,
      .admonition.security { background: #262135; border-color: #4a3f66; }
      .admonition.danger,
      .admonition.failure { background: #321f1f; border-color: #6e3a36; }
      .admonition.question,
      .admonition.seealso,
      .admonition.exercise { background: #1c2733; border-color: #3b5168; }
      .admonition.bug { background: #32241b; border-color: #6b4a33; }
      .admonition.example,
      .admonition.quote,
      .admonition.abstract,
      .admonition.todo,
      .admonition.deprecated { background: #232321; border-color: #3f3d39; }

      .back-to-top,
      .resume-go {
        color: #10201c;
      }

      .toc-backdrop {
        background: rgba(0, 0, 0, 0.55);
      }

      .resume {
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
      }
    }

    @media print {
      :root {
        color-scheme: light;
      }

      @page {
        margin: 1.6cm 1.4cm;
      }

      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body {
        background: #fff;
        font-size: 11pt;
        line-height: 1.5;
      }

      .reading-progress,
      .toc,
      .toc-fab,
      .toc-backdrop,
      .resume,
      .progress,
      .pager,
      .back-to-top,
      .copy-code,
      .line-numbers {
        display: none !important;
      }

      .shell {
        display: block;
        width: auto;
        margin: 0;
      }

      .panel {
        border: 0;
        border-radius: 0;
        box-shadow: none;
        background: none;
      }

      .content-wrap,
      .code-body {
        overflow: visible;
      }

      .article,
      .page-header {
        padding: 0;
      }

      .article {
        min-height: 0;
      }

      .page {
        display: block !important;
        animation: none;
      }

      .page + .page {
        break-before: page;
      }

      h1, h2, h3, h4 {
        break-after: avoid;
      }

      .code-frame,
      .admonition,
      img,
      tr {
        break-inside: avoid;
      }

      pre {
        overflow: visible;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    }
  </style>
</head>
<body>
  <div class="reading-progress" aria-hidden="true"><span id="reading-progress"></span></div>
  <div class="shell">
    <aside id="toc-panel" class="panel toc" aria-label="Índice del tema">
      <div class="toc-header">
        <h2>Navegación</h2>
        <button id="toc-toggle" class="toc-toggle" type="button" aria-expanded="true" aria-controls="toc-desktop" title="Ocultar índice">
          <svg class="toc-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M16 15l-3-3 3-3"/></svg>
          <span class="toc-toggle-text">Ocultar índice</span>
        </button>
        <button id="toc-close" class="toc-close" type="button" aria-label="Cerrar índice" title="Cerrar índice">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="toc-search">
        <svg class="toc-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="toc-search" type="search" placeholder="Buscar en el índice" aria-label="Buscar en el índice" autocomplete="off" spellcheck="false" />
        <kbd class="toc-search-key" aria-hidden="true">/</kbd>
      </div>
      <p id="toc-empty" class="toc-empty" hidden>Sin resultados</p>
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
  <button id="toc-fab" class="toc-fab" type="button" aria-controls="toc-panel" aria-expanded="false">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
    <span>Índice</span>
  </button>
  <div id="toc-backdrop" class="toc-backdrop"></div>
  <div id="resume" class="resume" role="status" hidden>
    <span class="resume-text">Continuar donde lo dejaste: <strong id="resume-where"></strong></span>
    <span class="resume-actions">
      <button id="resume-go" class="resume-go" type="button">Continuar</button>
      <button id="resume-close" class="resume-close" type="button" aria-label="Descartar" title="Descartar">×</button>
    </span>
  </div>
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

    const chevronIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

    function createTocLink(heading) {
      const link = document.createElement("a");
      link.href = "#" + heading.slug;
      link.textContent = heading.title;
      link.dataset.slug = heading.slug;
      link.dataset.title = heading.title;
      link.classList.add("level-" + heading.level);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        releaseSidebarPin();
        closeDrawer(false);
        goToSlug(heading.slug, true);
      });
      return link;
    }

    function setTocItemOpen(item, open) {
      item.classList.toggle("open", open);
      const button = item.querySelector(":scope > .toc-row > .toc-expand");
      if (button) {
        button.setAttribute("aria-expanded", String(open));
        button.title = open ? "Contraer apartados" : "Desplegar apartados";
      }
    }

    function renderToc(target) {
      target.innerHTML = "";
      let currentItem = null;

      headings.forEach((heading) => {
        if (heading.level === 3 && currentItem) {
          let sublist = currentItem.querySelector(":scope > .toc-sublist");
          if (!sublist) {
            sublist = document.createElement("ul");
            sublist.className = "toc-sublist";
            currentItem.appendChild(sublist);

            const spacer = currentItem.querySelector(":scope > .toc-row > .toc-expand-spacer");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "toc-expand";
            button.innerHTML = chevronIcon;
            const item = currentItem;
            button.addEventListener("click", () => {
              setTocItemOpen(item, !item.classList.contains("open"));
            });
            spacer.replaceWith(button);
            setTocItemOpen(item, false);
          }

          const li = document.createElement("li");
          li.appendChild(createTocLink(heading));
          sublist.appendChild(li);
          return;
        }

        const li = document.createElement("li");
        li.className = "toc-item";
        li.dataset.slug = heading.slug;
        const row = document.createElement("div");
        row.className = "toc-row";
        const spacer = document.createElement("span");
        spacer.className = "toc-expand-spacer";
        row.append(spacer, createTocLink(heading));
        li.appendChild(row);
        target.appendChild(li);
        if (heading.level === 2) {
          currentItem = li;
        }
      });
    }

    // ---- Buscador del índice ----

    const tocSearch = document.getElementById("toc-search");
    const tocEmpty = document.getElementById("toc-empty");

    // Pasa a minúsculas y quita tildes, guardando para cada carácter
    // normalizado su posición en el texto original (para resaltar).
    function foldText(text) {
      let folded = "";
      const map = [];
      for (let index = 0; index < text.length; index += 1) {
        const piece = text[index].normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
        for (let k = 0; k < piece.length; k += 1) {
          folded += piece[k];
          map.push(index);
        }
      }
      return { folded, map };
    }

    function highlightLink(link, query) {
      const title = link.dataset.title;
      link.textContent = title;
      if (!query) {
        return false;
      }
      const { folded, map } = foldText(title);
      const position = folded.indexOf(query);
      if (position < 0) {
        return false;
      }
      const start = map[position];
      const end = map[position + query.length - 1] + 1;
      const mark = document.createElement("mark");
      mark.textContent = title.slice(start, end);
      link.textContent = "";
      link.append(title.slice(0, start), mark, title.slice(end));
      return true;
    }

    function currentTocQuery() {
      return tocSearch ? foldText(tocSearch.value.trim()).folded : "";
    }

    function applyTocFilter() {
      const query = currentTocQuery();
      tocDesktop.classList.toggle("filtering", query !== "");
      let visible = 0;

      tocDesktop.querySelectorAll(":scope > .toc-item").forEach((item) => {
        const sectionMatch = highlightLink(item.querySelector(":scope > .toc-row > a"), query);
        let subMatches = 0;
        item.querySelectorAll(":scope > .toc-sublist > li").forEach((sub) => {
          const match = highlightLink(sub.querySelector("a"), query);
          if (match) {
            subMatches += 1;
          }
          sub.hidden = Boolean(query) && !match && !sectionMatch;
        });
        item.hidden = Boolean(query) && !sectionMatch && subMatches === 0;
        if (!item.hidden) {
          visible += 1;
        }
        if (query) {
          setTocItemOpen(item, subMatches > 0);
        }
      });

      if (tocEmpty) {
        tocEmpty.hidden = !query || visible > 0;
      }
      if (!query) {
        syncTocOpenState();
      }
    }

    if (tocSearch) {
      tocSearch.addEventListener("input", applyTocFilter);
      tocSearch.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const links = Array.from(tocDesktop.querySelectorAll("a"));
          const first = links.find((link) => link.querySelector("mark")) ||
            links.find((link) => link.offsetParent !== null);
          if (first) {
            first.click();
          }
        } else if (event.key === "Escape") {
          if (tocSearch.value) {
            event.stopPropagation();
            tocSearch.value = "";
            applyTocFilter();
          } else {
            tocSearch.blur();
          }
        }
      });
    }

    // ---- URL e historial ----
    // Cada cambio de sección crea una entrada en el historial (el botón "atrás"
    // vuelve a la sección anterior). Dentro de una sección solo se reemplaza el #.

    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }

    let activeSubSlug = null;
    let pendingHash = null;

    function writeHistory(slug, push) {
      const url = slug ? "#" + slug : location.pathname + location.search;
      try {
        if (push) {
          history.pushState({ scrollY: 0 }, "", url);
        } else {
          history.replaceState(Object.assign({}, history.state), "", url);
        }
      } catch {
        // Algunos navegadores limitan el número de llamadas; no es crítico.
      }
    }

    // Si se escribe el # en la URL antes de que termine la carga, el navegador
    // desplaza la página hasta ese ancla al completarla. Se aplaza hasta después.
    function setHash(slug) {
      pendingHash = slug;
      if (document.readyState === "complete") {
        applyPendingHash();
      }
    }

    function applyPendingHash() {
      if (pendingHash && location.hash !== "#" + pendingHash) {
        writeHistory(pendingHash, false);
      }
      pendingHash = null;
    }

    function rememberScrollInHistory() {
      try {
        history.replaceState(Object.assign({}, history.state, { scrollY: window.scrollY }), "", location.href);
      } catch {
        // Ignorado: solo sirve para restaurar el scroll al volver atrás.
      }
    }

    window.addEventListener("load", () => {
      window.setTimeout(applyPendingHash, 0);
    });

    function revealInToc(link) {
      const panel = document.getElementById("toc-panel");
      if (!panel || panel.scrollHeight <= panel.clientHeight) {
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const margin = 24;
      if (linkRect.top < panelRect.top + margin) {
        panel.scrollTop -= panelRect.top + margin - linkRect.top;
      } else if (linkRect.bottom > panelRect.bottom - margin) {
        panel.scrollTop += linkRect.bottom - (panelRect.bottom - margin);
      }
    }

    function updateActiveSubsection() {
      const activePage = pages[currentPage];
      if (!activePage) {
        return;
      }

      const threshold = Math.min(window.innerHeight * 0.3, 160);
      let current = null;
      activePage.querySelectorAll("h3[id]").forEach((heading) => {
        if (heading.getBoundingClientRect().top <= threshold) {
          current = heading;
        }
      });

      const slug = current ? current.id : null;
      if (slug === activeSubSlug) {
        return;
      }
      activeSubSlug = slug;

      document.querySelectorAll(".toc-list a.level-3.active").forEach((item) => {
        item.classList.remove("active");
      });
      if (slug) {
        document.querySelectorAll('.toc-list a.level-3[data-slug="' + slug + '"]').forEach((item) => {
          item.classList.add("active");
          revealInToc(item);
        });
      }

      const sectionHeading = activePage.querySelector("h2[id], h1[id]");
      const hashSlug = slug || (sectionHeading ? sectionHeading.id : null);
      if (hashSlug) {
        setHash(hashSlug);
      }
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

    function syncTocOpenState() {
      const activePage = pages[currentPage];
      const sectionHeading = activePage ? activePage.querySelector("h2[id]") : null;
      tocDesktop.querySelectorAll(":scope > .toc-item").forEach((item) => {
        setTocItemOpen(item, Boolean(sectionHeading) && item.dataset.slug === sectionHeading.id);
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

      document.querySelectorAll(".toc-list a.active").forEach((item) => {
        item.classList.remove("active");
      });

      activeSubSlug = null;
      if (currentTocQuery()) {
        applyTocFilter();
      } else {
        syncTocOpenState();
      }

      const activeHeading = pages[index].querySelector("h2[id], h3[id], h1[id]");
      if (activeHeading) {
        const activeSlug = activeHeading.id;
        document.querySelectorAll('.toc-list a[data-slug="' + activeSlug + '"]').forEach((item) => {
          item.classList.add("active");
          revealInToc(item);
        });
        setHash(activeSlug);
      }
    }

    // ---- Barra de progreso: secciones completadas + lo leído de la actual ----

    const readingBar = document.getElementById("reading-progress");

    function updateProgress() {
      const page = pages[currentPage];
      if (!page) {
        return;
      }
      const start = page.getBoundingClientRect().top + window.scrollY;
      const end = start + page.offsetHeight - window.innerHeight;
      const fraction = end <= start ? 1 : Math.min(1, Math.max(0, (window.scrollY - start) / (end - start)));
      const percent = ((currentPage + fraction) / pages.length) * 100;
      progressBar.style.width = percent + "%";
      if (readingBar) {
        readingBar.style.width = percent + "%";
      }
    }

    // ---- Navegación ----

    function showPage(index) {
      const bounded = Math.max(0, Math.min(index, pages.length - 1));
      currentPage = bounded;
      pages.forEach((page, pageIndex) => {
        page.classList.toggle("active", pageIndex === bounded);
      });
      refreshControls(bounded);
      updateActiveSubsection();
      updateProgress();
      return bounded;
    }

    function decodeSlug(hash) {
      const raw = (hash || "").replace(/^#/, "");
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }

    function pageIndexOf(element) {
      return element ? pages.findIndex((page) => page.contains(element)) : -1;
    }

    function findTarget(slug) {
      if (!slug) {
        return null;
      }
      const element = document.getElementById(slug);
      return pageIndexOf(element) >= 0 ? element : null;
    }

    function sectionSlug(index) {
      const heading = pages[index].querySelector("h2[id], h3[id], h1[id]");
      return heading ? heading.id : null;
    }

    function isSectionStart(target, index) {
      return target === pages[index].querySelector("h2[id]");
    }

    // El título de sección lleva al principio de la página; cualquier otro
    // destino (###, ####, anclas del contenido) se desplaza hasta él.
    function scrollToTarget(target, index, smooth) {
      if (isSectionStart(target, index)) {
        window.scrollTo({ top: 0, behavior: "instant" });
      } else {
        target.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "start" });
      }
    }

    function beforeNavigation(index, slug) {
      hideResume();
      const changesSection = index !== currentPage;
      if (changesSection) {
        rememberScrollInHistory();
      }
      writeHistory(slug, changesSection);
    }

    function goToPage(index) {
      const bounded = Math.max(0, Math.min(index, pages.length - 1));
      if (bounded === currentPage) {
        return;
      }
      beforeNavigation(bounded, sectionSlug(bounded));
      showPage(bounded);
      window.scrollTo({ top: 0, behavior: "instant" });
      saveProgressSoon();
    }

    function goToSlug(slug, smooth) {
      const target = findTarget(slug);
      if (!target) {
        return false;
      }
      const index = pageIndexOf(target);
      beforeNavigation(index, slug);
      showPage(index);
      scrollToTarget(target, index, smooth);
      saveProgressSoon();
      return true;
    }

    buildPages();
    enhanceCodeBlocks();
    renderToc(tocDesktop);

    let currentPage = 0;

    prevButtons.forEach((button) => {
      button.title = "Sección anterior (←)";
      button.addEventListener("click", () => {
        goToPage(currentPage - 1);
      });
    });

    nextButtons.forEach((button) => {
      button.title = "Sección siguiente (→)";
      button.addEventListener("click", () => {
        goToPage(currentPage + 1);
      });
    });

    // Botones atrás/adelante del navegador y cambios manuales del # en la URL.
    // Las entradas creadas por esta página llevan estado; un # editado a mano no.
    let lastPopWasTraversal = false;

    window.addEventListener("popstate", (event) => {
      lastPopWasTraversal = event.state !== null;
      hideResume();
      const target = findTarget(decodeSlug(location.hash));
      const index = target ? pageIndexOf(target) : 0;
      showPage(index);
      const savedScroll = event.state && typeof event.state.scrollY === "number" ? event.state.scrollY : 0;
      if (savedScroll > 0) {
        window.scrollTo({ top: savedScroll, behavior: "instant" });
      } else if (target) {
        scrollToTarget(target, index, false);
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    });

    // Al editar el # a mano, el navegador hace su propio salto al ancla después
    // de "popstate"; se recoloca para que una sección se abra desde arriba.
    window.addEventListener("hashchange", () => {
      if (lastPopWasTraversal) {
        lastPopWasTraversal = false;
        return;
      }
      const target = findTarget(decodeSlug(location.hash));
      if (target) {
        const index = pageIndexOf(target);
        if (index !== currentPage) {
          showPage(index);
        }
        scrollToTarget(target, index, false);
      }
    });

    // Enlaces internos del contenido ([texto](#otro-apartado)).
    article.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || event.defaultPrevented || event.button !== 0 ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      const slug = decodeSlug(link.getAttribute("href"));
      if (findTarget(slug)) {
        event.preventDefault();
        goToSlug(slug, true);
      }
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

    // Comportamiento del panel lateral:
    // - Empieza abierto y se cierra solo al hacer scroll hacia abajo.
    // - Si se abre con el botón, queda fijado: el scroll ya no lo cierra.
    // - Al pulsar un enlace del índice se libera y vuelve a cerrarse con el scroll.
    let isCollapsed = false;
    let sidebarPinned = false;
    let suppressAutoOpen = false;
    let pageLoaded = false;
    let scrollBaseline = null;

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
        setSidebarCollapsed(!isCollapsed);
        sidebarPinned = !isCollapsed;
        suppressAutoOpen = isCollapsed;
        scrollBaseline = null;
      });
    }

    function releaseSidebarPin() {
      sidebarPinned = false;
      scrollBaseline = null;
    }

    window.addEventListener("load", () => {
      // Se espera a que el navegador termine de colocar la página (p. ej. al
      // abrir un enlace con #) para que ese desplazamiento no cierre el panel.
      window.setTimeout(() => {
        pageLoaded = true;
        scrollBaseline = window.scrollY;
      }, 50);
    });

    function handleScroll() {
      updateBackToTop();
      updateActiveSubsection();

      const scrollY = window.scrollY;

      if (!pageLoaded || sidebarPinned) {
        return;
      }

      if (scrollBaseline !== null) {
        if (Math.abs(scrollY - scrollBaseline) <= 60) {
          return;
        }
        scrollBaseline = null;
      }

      if (scrollY > 120) {
        suppressAutoOpen = false;
        if (!isCollapsed) {
          setSidebarCollapsed(true);
        }
      } else if (scrollY <= 40 && isCollapsed && !suppressAutoOpen) {
        setSidebarCollapsed(false);
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    let scrollStateTimer = null;

    function afterScroll() {
      updateProgress();
      window.clearTimeout(scrollStateTimer);
      scrollStateTimer = window.setTimeout(() => {
        if (pageLoaded) {
          rememberScrollInHistory();
        }
        saveProgress();
      }, 250);
    }

    window.addEventListener("scroll", afterScroll, { passive: true });
    window.addEventListener("resize", updateProgress, { passive: true });

    // ---- Índice en móvil (panel deslizante) ----

    const mobileQuery = window.matchMedia("(max-width: 980px)");
    const tocFab = document.getElementById("toc-fab");
    const tocClose = document.getElementById("toc-close");
    const tocBackdrop = document.getElementById("toc-backdrop");
    let drawerOpen = false;

    function openDrawer(withSearch) {
      drawerOpen = true;
      document.body.classList.add("toc-drawer-open");
      if (tocFab) {
        tocFab.setAttribute("aria-expanded", "true");
      }
      window.requestAnimationFrame(() => {
        const active = tocDesktop.querySelector("a.level-3.active") || tocDesktop.querySelector("a.active");
        if (active) {
          revealInToc(active);
        }
        const focusTarget = withSearch && tocSearch ? tocSearch : tocClose;
        if (focusTarget) {
          focusTarget.focus({ preventScroll: true });
        }
      });
    }

    function closeDrawer(returnFocus) {
      if (!drawerOpen) {
        return;
      }
      drawerOpen = false;
      document.body.classList.remove("toc-drawer-open");
      if (tocFab) {
        tocFab.setAttribute("aria-expanded", "false");
        if (returnFocus) {
          tocFab.focus({ preventScroll: true });
        }
      }
    }

    if (tocFab) {
      tocFab.addEventListener("click", () => openDrawer(false));
    }
    if (tocClose) {
      tocClose.addEventListener("click", () => closeDrawer(true));
    }
    if (tocBackdrop) {
      tocBackdrop.addEventListener("click", () => closeDrawer(true));
    }
    mobileQuery.addEventListener("change", (event) => {
      if (!event.matches) {
        closeDrawer(false);
      }
    });

    function focusTocSearch() {
      if (mobileQuery.matches) {
        openDrawer(true);
        return;
      }
      if (isCollapsed) {
        setSidebarCollapsed(false);
        sidebarPinned = true;
        suppressAutoOpen = false;
      }
      if (tocSearch) {
        tocSearch.focus({ preventScroll: true });
        tocSearch.select();
      }
    }

    // ---- Atajos de teclado: ← → cambian de sección, / busca en el índice ----

    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.key === "Escape" && drawerOpen) {
        closeDrawer(true);
        return;
      }
      const element = event.target;
      const typing = element instanceof HTMLElement &&
        (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
      if (typing) {
        return;
      }
      if (event.key === "ArrowLeft" && !event.shiftKey) {
        event.preventDefault();
        goToPage(currentPage - 1);
      } else if (event.key === "ArrowRight" && !event.shiftKey) {
        event.preventDefault();
        goToPage(currentPage + 1);
      } else if (event.key === "/") {
        event.preventDefault();
        focusTocSearch();
      }
    });

    // ---- Recordar dónde se quedó la lectura ----

    const storageKey = "markdown2coursebook:" + location.pathname;
    const resumeBox = document.getElementById("resume");
    const resumeWhere = document.getElementById("resume-where");
    let resumeVisible = false;
    let resumeTimer = null;

    function saveProgress() {
      if (!pageLoaded || resumeVisible) {
        return;
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          slug: sectionSlug(currentPage),
          scrollY: Math.round(window.scrollY),
          time: Date.now()
        }));
      } catch {
        // Sin almacenamiento disponible (modo privado, file:// bloqueado...).
      }
    }

    function saveProgressSoon() {
      window.setTimeout(saveProgress, 300);
    }

    window.addEventListener("pagehide", saveProgress);

    function readSavedProgress() {
      try {
        return JSON.parse(localStorage.getItem(storageKey) || "null");
      } catch {
        return null;
      }
    }

    function hideResume() {
      if (!resumeVisible) {
        return;
      }
      resumeVisible = false;
      window.clearTimeout(resumeTimer);
      if (resumeBox) {
        resumeBox.hidden = true;
      }
    }

    function offerResume() {
      const saved = readSavedProgress();
      const target = saved ? findTarget(saved.slug) : null;
      if (!target || !resumeBox) {
        return;
      }
      const index = pageIndexOf(target);
      const savedScroll = Math.max(0, Number(saved.scrollY) || 0);
      if (index === 0 && savedScroll < 400) {
        return;
      }

      const heading = headings.find((item) => item.slug === saved.slug);
      resumeWhere.textContent = heading ? heading.title : target.textContent;
      resumeVisible = true;
      resumeBox.hidden = false;

      document.getElementById("resume-go").onclick = () => {
        beforeNavigation(index, saved.slug);
        showPage(index);
        window.scrollTo({ top: savedScroll, behavior: "instant" });
        saveProgressSoon();
      };
      document.getElementById("resume-close").onclick = () => {
        hideResume();
        saveProgress();
      };
      resumeTimer = window.setTimeout(() => {
        hideResume();
      }, 20000);
    }

    // ---- Estado inicial ----

    const initialTarget = findTarget(decodeSlug(location.hash));
    if (initialTarget) {
      const index = pageIndexOf(initialTarget);
      showPage(index);
      if (isSectionStart(initialTarget, index)) {
        // Se quita el # hasta que termine la carga para que el navegador no
        // baje hasta el título: una sección se abre desde arriba.
        try {
          history.replaceState(history.state, "", location.pathname + location.search);
        } catch {
          // Sin consecuencias: solo afectaría a la posición inicial.
        }
        setHash(initialTarget.id);
        window.scrollTo(0, 0);
      } else {
        initialTarget.scrollIntoView({ block: "start" });
      }
    } else {
      showPage(0);
      if (!location.hash) {
        offerResume();
      }
    }
    handleScroll();
  </script>
</body>
</html>`;
}

export async function transformFile(filePath, outDir, rootDir) {
  const { html } = await renderMarkdownToHtml(filePath);

  const relativePath = path.relative(rootDir, filePath);
  const outputPath = path.join(outDir, relativePath).replace(/\.md$/i, ".html");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, "utf8");

  return outputPath;
}

/**
 * Renderiza un Markdown a HTML.
 */
async function renderMarkdownToHtml(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const cleanedSource = preprocessAdmonitions(removeIndexBlock(source));

  const headings = [];
  const renderer = createMarkdownRenderer(headings);
  const renderedContent = removeHtmlComments(attachCodeFilenames(renderer.render(cleanedSource)));
  const htmlContent = await embedLocalImages(renderedContent, path.dirname(filePath));

  const fallbackTitle = path.basename(filePath);
  const html = buildHtmlPage({ title: fallbackTitle, htmlContent, headings });
  const title = headings.find((item) => item.level === 1)?.title || fallbackTitle;

  return { html, title, headings };
}

export {
  buildHtmlPage,
  createMarkdownRenderer,
  preprocessAdmonitions,
  removeIndexBlock,
  attachCodeFilenames
};

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
    outputs.push(await transformFile(filePath, outDir, rootDir));
  }

  console.log(`Generated ${outputs.length} file(s):`);
  outputs.forEach((outFile) => console.log(`- ${path.relative(rootDir, outFile)}`));
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
