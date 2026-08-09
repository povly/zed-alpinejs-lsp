[← Features](features.md) · [Back to README](../README.md) · [Development →](development.md)

# Architecture

Alpine.js LSP is a hybrid Zed extension: a thin Rust wrapper compiles to WebAssembly and ships a Node.js language server built in TypeScript.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Zed editor                                                 │
│    │                                                        │
│    │  zed: install dev extension                            │
│    │  (Zed compiles src/lib.rs → extension.wasm)            │
│    ▼                                                        │
│  extension.wasm  (Rust, cdylib)                             │
│    │                                                        │
│    │  On install:                                           │
│    │    1. Extracts server/dist/*.js to disk                │
│    │    2. zed::npm_install_package() for LSP deps          │
│    │                                                        │
│    │  On language server start:                             │
│    │    Spawns: node server/dist/index.js --stdio           │
│    ▼                                                        │
│  Node.js LSP Server  (TypeScript, compiled to dist/)        │
│    │                                                        │
│    │  LSP JSON-RPC over stdio                               │
│    │  Handles: onInitialize, onHover, onDefinition,         │
│    │           onCompletion                                 │
│    ▼                                                        │
│  Workspace files  (.html, .blade.php, .js, .ts, …)          │
└─────────────────────────────────────────────────────────────┘
```

## The Rust Wrapper (`src/lib.rs`)

79 lines. Responsibilities:

1. **Embeds the TypeScript build output** at compile time via `include_str!()`:
   ```rust
   const SERVER_FILES: &[(&str, &str)] = &[
       ("server/dist/index.js", include_str!("../server/dist/index.js")),
       ("server/dist/server.js", include_str!("../server/dist/server.js")),
       // ... extractor.js, workspace.js, xdata.js, data.js
   ];
   ```
2. **Installs on first language server request** — writes the embedded JS files to disk and runs `zed::npm_install_package()` for `vscode-languageserver` and `vscode-languageserver-textdocument`.
3. **Launches the server** — `node server/dist/index.js --stdio`.

> The Rust side contains no parsing or LSP logic. It is purely a delivery and lifecycle wrapper.

## The TypeScript LSP Server (`server/src/`)

Six modules organized by technical responsibility:

| Module | Role | Depends on |
|--------|------|------------|
| `index.ts` | Entry point — creates `createConnection` and `AlpineLanguageServer` | `server.ts` |
| `server.ts` | **Protocol layer** — LSP handlers (`onHover`, `onDefinition`, `onCompletion`), attribute cache, scope resolution | `extractor.ts`, `workspace.ts`, `xdata.ts`, `data.ts` |
| `extractor.ts` | **Parsing** — regex-based Alpine attribute parser + `Alpine.data()` / `Alpine.store()` registration extractor | _(leaf — no project imports)_ |
| `xdata.ts` | **Parsing** — inline `x-data="{ ... }"` object literal member parser (methods, properties, getters) | _(leaf — no project imports)_ |
| `workspace.ts` | **Indexing** — filesystem scanner, in-memory symbol index, scope resolution | `extractor.ts`, `xdata.ts` |
| `data.ts` | **Static data** — `MAGIC_PROPERTIES`, `DIRECTIVES`, `MODIFIERS` knowledge base | _(leaf — no project imports)_ |

### Dependency direction

```
index.ts
  └─ server.ts (protocol)
       ├─ workspace.ts (indexing)
       │    ├─ extractor.ts (parsing)
       │    └─ xdata.ts (parsing)
       └─ data.ts (static knowledge)
```

Inner modules never import outer modules. `extractor.ts`, `xdata.ts`, and `data.ts` are pure leaf modules with no project-internal imports — this keeps them trivially unit-testable.

## How a Hover Request Flows

```
1. User hovers over a word in an Alpine attribute
2. Zed sends textDocument/hover → server.ts:onHover(params)
3. server.ts:
   a. Looks up the cached AlpineAttr[] for the document
   b. Finds the attribute at the cursor offset (findAttrAtOffset)
   c. Extracts the word at the cursor (getWordAtOffset)
   d. Checks MAGIC_PROPERTIES (data.ts) for a magic property match
      → returns signature + documentation
   e. Else checks the local x-data scope members (parseXData)
      → returns member hover
   f. Else checks the workspace index (workspace.lookup)
      → returns cross-file definition hover
4. Hover result sent back to Zed, rendered inline
```

## Workspace Indexing Lifecycle

1. **`onInitialize`** — `workspace.scanWorkspace(rootPath)` walks the project tree (depth ≤ 10, skipping `node_modules`, `vendor`, `dist`, etc.).
2. For each file with a matching extension, `extractDefinitions()`:
   - Calls `extractAlpineAttrs()` → finds inline `x-data="{...}"`
   - Calls `extractAlpineData()` / `extractAlpineStore()` → finds `Alpine.data(...)` / `Alpine.store(...)` registrations
   - Calls `parseXData()` on each object literal → extracts member names + offsets
3. Results stored in `WorkspaceIndex.fileDefs` (`Map<uri, WorkspaceDef[]>`) and cross-referenced into `nameIndex`, `dataRegistrations`, `storeRegistrations`.
4. **On every `onDidChangeContent`** — the changed document is re-indexed (`indexDocument`) and the name indexes are rebuilt (full rebuild, not incremental).
5. Hover/definition/completion query these indexes via `lookup(name)`, `lookupAlpineData(name)`, `lookupAlpineStore(name)`.

## Parsing Approach

The extractors (`extractor.ts`, `xdata.ts`) use **regular expressions with keyword filtering**, not a full JavaScript AST parser. This is a deliberate trade-off:

- **Pro:** fast, zero-dependency, handles 95% of real-world Alpine patterns
- **Con:** cannot handle exotic syntax (computed keys via `[]`, spread `{...x}`, etc.)
- **Mitigation:** every edge case discovered gets a regression test in `test/test.js`

For the full architecture guidelines (dependency rules, anti-patterns, code examples) see [.ai-factory/ARCHITECTURE.md](../.ai-factory/ARCHITECTURE.md).

## See Also

- [Features](features.md) — what the parser and indexer enable
- [Development](development.md) — how to modify the parser or add new features
- [Getting Started](getting-started.md) — end-user setup
