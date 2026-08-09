[← Architecture](architecture.md) · [Back to README](../README.md)

# Development

How to build, test, and iterate on the Alpine.js LSP extension.

## Prerequisites

- [Rust](https://rustup.rs) stable toolchain (for compiling the extension wrapper)
- [Node.js](https://nodejs.org) 18+ (for the TypeScript LSP server)
- [Zed editor](https://zed.dev) (for testing as a dev extension)

## First-Time Setup

```bash
# Install TypeScript dependencies
cd server
npm install
cd ..
```

This installs `typescript`, `@types/node`, `vscode-languageserver`, and `vscode-languageserver-textdocument` into `server/node_modules/`.

## Build Commands

### Build the TypeScript server

```bash
cd server
npm run build    # tsc — compiles src/*.ts to dist/*.js
```

Output goes to `server/dist/` (`.js`, `.d.ts`, `.js.map`). This directory is committed because its contents are embedded into the Rust binary via `include_str!()`.

### Watch mode (during development)

```bash
cd server
npm run dev      # tsc --watch — recompiles on every TS change
```

### Verify the Rust wrapper compiles

```bash
cargo check      # fast — checks types without producing the .wasm
cargo clippy --all-targets -- -D warnings   # lint
cargo fmt --check                            # formatting check
```

> You do **not** normally run `cargo build --release` manually — Zed does that when you install a dev extension. Use `cargo check` for fast compile verification during development.

## Running Tests

```bash
# From the project root
node test/test.js
```

The test suite covers the TypeScript logic of the LSP server using `node:assert`. It requires `server/dist/*.js` to exist (the tests import the compiled modules), so **always run `npm run build` in `server/` first** after changing TypeScript source.

### Test structure

| File | Purpose |
|------|---------|
| `test/test.js` | All test suites — extractor, xdata, WorkspaceIndex, LSP handlers, integration |
| `test/helpers.js` | Test harness — `createTestServer()` builds an `AlpineLanguageServer` with a mock LSP `Connection`, `loadDocument()` populates the server's `attrCache` + workspace index and patches `documents.get()` |

The suites are grouped by module:

- **`extractAlpineAttrs` / `findAttrAtOffset` / `parseXData` / `isAlpineAttr`** — pure-function unit tests for the parsers.
- **`real-world patterns`** — regression tests for Blade/Alpine edge cases.
- **`WorkspaceIndex`** — unit tests for `indexDocument`, `lookup`, `resolveScope`, `getPosition`/`getEndPosition`, `removeDocument`.
- **`WorkspaceIndex.scanWorkspace`** — filesystem integration: creates a temp directory, indexes fixtures, verifies `SKIP_DIRS` (e.g. `node_modules`) and extension filtering.
- **`AlpineLanguageServer.onCompletion` / `onHover` / `onDefinition`** — LSP handler tests using the mock-Connection harness. Private handlers are invoked via bracket notation (`server['onCompletion'](params)`).
- **`Integration: full pipeline`** — cross-document scenarios: registration in one file consumed by another, hover/definition/completion across the workspace index.

### Verbose output

For debug-level logging (helper internals, per-test diagnostics):

```bash
LOG_LEVEL=debug node test/test.js
```

### Expected output

```
==================================================================
Passed: 74  Failed: 0  Total: 74
```

Exit code is non-zero if any test fails.

## Iterating as a Dev Extension

The standard development loop:

1. **Start watch mode** in one terminal:
   ```bash
   cd server
   npm run dev
   ```
2. **In Zed**, install the extension once:
   - Command palette → `zed: install dev extension`
   - Select the project root directory
3. **On every change** (TS or Rust):
   - Command palette → `zed: reinstall dev extension`
   - Zed recompiles Rust → Wasm and reloads the JS server
4. **Open a test file** (`.html` or `.blade.php` with Alpine directives) and verify hover/completion/definition work.

> For pure TypeScript changes, you can sometimes skip the full reinstall — Zed reads `server/dist/*.js` from disk. Use `zed: developer -> reload extensions` for a lighter reload.

## Release Build

When preparing a publishable version (or verifying the full pipeline):

```bash
# 1. Rebuild the TypeScript server FIRST
cd server
npm run build
cd ..

# 2. Then compile Rust (embeds the freshly-built JS)
cargo build --release
```

> **Critical ordering:** always `npm run build` **before** `cargo build --release`. The Rust binary embeds `server/dist/*.js` at compile time via `include_str!()`. If you rebuild Rust without rebuilding TypeScript first, stale JavaScript gets baked into the Wasm.

The release artifact is `extension.wasm` (gitignored — produced by Zed's `extension build` or the release toolchain).

## CI Pipeline

GitHub Actions workflows live in [`.github/workflows/`](../.github/workflows/). Four independent workflows run on push to `main` and on pull requests:

| Workflow | Purpose |
|----------|---------|
| [lint.yml](../.github/workflows/lint.yml) | `cargo fmt --check`, `cargo clippy -D warnings`, `tsc` strict typecheck |
| [tests.yml](../.github/workflows/tests.yml) | `node test/test.js` on Node 18, 20, 22 (matrix) |
| [build.yml](../.github/workflows/build.yml) | Full `npm run build` + `cargo check --release` pipeline |
| [security.yml](../.github/workflows/security.yml) | `npm audit` + `cargo audit` (weekly schedule + on PR) |

All workflows use `concurrency` groups to cancel superseded runs and run with `permissions: contents: read`.

## Project Conventions

Key conventions enforced by the codebase (see [.ai-factory/rules/base.md](../.ai-factory/rules/base.md) for the full list):

- **Rust** — `snake_case` for functions/variables; string-error propagation via `.map_err(|e| format!(...))?`
- **TypeScript** — `camelCase` for functions/variables, `PascalCase` for classes/interfaces/types, `UPPER_SNAKE_CASE` for static data arrays
- **Logging** — only `connection.console.info/error` (never `console.log` — it breaks the LSP stdio protocol)
- **Error handling** — guard clauses and early returns with safe defaults (`[]`, `null`)
- **Parsing** — regex-based with keyword filtering; add regression tests for every new edge case

## See Also

- [Architecture](architecture.md) — module structure and dependency rules
- [Getting Started](getting-started.md) — end-user installation
