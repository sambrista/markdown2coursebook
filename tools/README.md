# Notes Transformer

CLI tool to transform theory markdown files into calm, paginated HTML notes.

## Features

- Converts markdown notes to static HTML.
- Removes the `## Índice + [[toc]]` source block and builds a dual quick navigation (desktop sidebar + mobile collapsible).
- Paginates the document internally by H2 sections (single HTML file).
- Adds section picker, next/previous controls, and reading progress bar.
- Preserves admonitions (`!!! info`, `!!! note`, `!!! warning`) and syntax highlighting.

## Install

```bash
npm install
```

## Usage

Default mode (all `UT */teoria.md`):

```bash
npm run build
```

Custom input/output:

```bash
node src/transform-notes.mjs --input "UT 1/teoria.md" --input "UT 2/teoria.md" --out out
```

The tool mirrors source paths in output and changes `.md` to `.html`.
