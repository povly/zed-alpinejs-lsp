[Back to README](../README.md) · [Features →](features.md)

# Getting Started

## Prerequisites

- [Zed editor](https://zed.dev) (stable or preview)
- [Node.js](https://nodejs.org) 18+ installed on your system and available on `PATH`
  - Zed launches the language server via `node server/dist/index.js --stdio`, so Node must be reachable from the editor's environment

> On macOS, install Node via the official installer or `brew install node`. On Linux, use your distribution's package manager or [nvm](https://github.com/nvm-sh/nvm).

## Installation

### Option A — Zed Marketplace (pending approval)

Once published, search for "alpine" in `zed: extensions` and install:

1. Open the extensions page (`cmd-shift-x` / `ctrl-shift-x`)
2. Search `alpine`
3. Click **Install** on "Alpine.js LSP"

### Option B — Dev Extension (manual / from source)

For development or pre-release use:

```bash
git clone https://github.com/povly/zed-alpinejs-lsp.git
cd zed-alpinejs-lsp
```

Then in Zed:

1. Run the command palette → `zed: install dev extension`
2. Select the cloned directory
3. Zed compiles the Rust → Wasm automatically and registers the language server

> Dev extensions live in your local Zed config and update on every `zed: reinstall dev extension`.

## First Use

Open any `.html` or `.blade.php` file containing Alpine directives:

```html
<!-- example.html -->
<div x-data="{ open: false }">
  <button @click="open = !open">Toggle</button>
  <span x-show="open" x-transition>Hello Alpine!</span>
</div>
```

Try these interactions:

| Action | Expected result |
|--------|-----------------|
| Hover over `x-data` | Hover card: "Declares a new Alpine component scope." |
| Hover over `x-show` | Hover card: "Toggles `display:none` based on expression truthiness." |
| Type `$` inside any Alpine attribute | Completions: `$el`, `$refs`, `$store`, `$dispatch`, … |
| Type `.` after a scope name | Completions: local members of the `x-data` scope |

## Verify It Works

1. Open a Blade/HTML file with Alpine directives
2. Check the Zed status bar — "Alpine Language Server" should appear for `.html` / `.blade.php` files
3. Trigger a completion (type `$` inside `@click="..."`) — magic property suggestions should appear

If nothing happens:

- Run `zed: language server logs` and look for `Alpine Language Server` entries
- Confirm Node.js is on `PATH` (`which node` from a terminal)
- For dev extensions: run `zed: reinstall dev extension` after changing source

## Next Steps

- [Features](features.md) — detailed examples of hover, go-to-definition, and completions
- [Architecture](architecture.md) — how the hybrid Rust + TypeScript extension works
- [Development](development.md) — how to build, test, and iterate on this extension

## See Also

- [Features](features.md) — capability reference with concrete examples
- [Development](development.md) — local setup and iteration loop
