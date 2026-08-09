# Alpine.js LSP

[English](README.md) | [Русский](README.ru.md)

A language server for [Alpine.js](https://alpinejs.dev/) in the [Zed editor](https://zed.dev) — hover documentation, go-to-definition, and completions for Alpine directives across HTML and Blade files.

## Features

### Hover Documentation

Hover over any Alpine directive or magic property to see inline documentation:

| Directive | Hover |
|---|---|
| `x-data` | Declares a new Alpine component scope |
| `x-show` | Toggles `display:none` based on expression truthiness |
| `@click` / `x-on:click` | Attaches an event listener |
| `$el`, `$refs`, `$store`, `$dispatch` | Magic property signatures and docs |

### Go-to-Definition

Jump from a component reference to its definition — even across files:

- `x-data="mainMap"` → jumps to `Alpine.data('mainMap', ...)` in `index.js`
- `@click="selectTab()"` → jumps to the method definition inside `Alpine.data('tabs', ...)`
- `x-data="{ open: false }"` → jumps to the property inside inline `x-data`

### Completions

- **Magic properties** — type `$` inside any Alpine attribute to get `$el`, `$refs`, `$store`, `$dispatch`, etc.
- **Scope members** — type `.` to see methods and properties from the current `x-data` scope
- **Cross-file members** — workspace-registered `Alpine.data()` and `Alpine.store()` members appear in completions

### Workspace Indexer

On startup, the server scans the entire workspace for:

- `Alpine.data('name', () => ({ ... }))` registrations
- `Alpine.store('name', { ... })` registrations
- Inline `x-data="{ ... }"` declarations

All symbols are indexed and available for hover, definition, and completion — across all HTML and Blade files.

## Installation

### From Zed Marketplace (pending approval)

Search for "alpine" in `zed: extensions` and install.

### Manual / Dev Extension

```bash
git clone https://github.com/povly/zed-alpinejs-lsp.git
cd zed-alpinejs-lsp
```

In Zed, open `zed: install dev extension` and point it to the cloned directory.

> Requires Node.js 18+ installed on your system.

## Supported Languages

- **Blade** (`.blade.php`)
- **HTML** (`.html`, `.htm`)

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, first use, verification |
| [Features](docs/features.md) | Hover, go-to-definition, completions, workspace indexer |
| [Architecture](docs/architecture.md) | Hybrid Rust + TypeScript design, module structure, data flow |
| [Development](docs/development.md) | Build, test, iterate as dev extension, CI pipeline |

## How It Works

The extension ships a Node.js language server bundled inside a Rust/WASM Zed extension wrapper.

```
extension.wasm (Rust)
  ├── Bundles server/dist/*.js via include_str!()
  ├── On install: extracts JS files + runs npm install
  └── Launches: node server/dist/index.js --stdio

Node.js LSP Server
  ├── index.js     — entry point, LSP protocol
  ├── server.js    — hover, definition, completion handlers
  ├── workspace.js — workspace scanner & symbol index
  ├── extractor.js — Alpine attribute parser
  ├── xdata.js     — inline x-data member parser
  └── data.js      — magic properties & directives database
```

For a deeper dive see [Architecture](docs/architecture.md).

## License

[MIT](LICENSE)
