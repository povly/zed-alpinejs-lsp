# AGENTS.md

> Этот файл — структурная карта проекта для AI-агентов. Обновляйте при значимых изменениях структуры. Подробное содержание находится в `.ai-factory/DESCRIPTION.md` и `.ai-factory/ARCHITECTURE.md`.

## Обзор проекта

Языковой сервер Alpine.js для редактора Zed — гибридное Wasm-расширение на Rust + TypeScript, предоставляющее hover, go-to-definition и completion для директив Alpine в HTML и Blade.

## Технологический стек

- **Язык (обёртка):** Rust 2021 (`zed_extension_api 0.7.0`)
- **Язык (LSP-сервер):** TypeScript 5.5+ (strict)
- **Рантайм:** Node.js 18+
- **LSP:** `vscode-languageserver` 9 / `vscode-languageserver-textdocument` 1
- **БД / ORM / фреймворк:** не используются

## Структура проекта

```
.
├── Cargo.toml              # Манифест Rust (cdylib, zed_extension_api)
├── Cargo.lock              # Лок зависимостей Rust
├── extension.toml          # Манифест расширения Zed (id, language_servers, languages)
├── src/
│   └── lib.rs              # Rust-обёртка: include_str!(), npm-install, запуск node --stdio
├── server/
│   ├── package.json        # Зависимости TS-сервера + скрипты build/dev
│   ├── tsconfig.json       # strict, ES2022, CommonJS, declaration, sourcemap
│   ├── src/                # Исходники TypeScript
│   │   ├── index.ts        # Точка входа LSP-сервера (createConnection)
│   │   ├── server.ts       # AlpineLanguageServer — hover/definition/completion
│   │   ├── extractor.ts    # Парсер Alpine-атрибутов + Alpine.data()/store() extractor
│   │   ├── workspace.ts    # WorkspaceIndex — сканер воркспейса, индекс символов
│   │   ├── xdata.ts        # Парсер inline x-data объектных литералов
│   │   └── data.ts         # База магических свойств и директив
│   └── dist/               # Скомпилированный JS (коммичируется, встраивается в WASM)
├── test/
│   └── test.js             # Юнит-тесты на node:assert (extractor + xdata)
├── opencode.json           # Конфигурация AI-агента (MCP-серверы)
├── .ai-factory.json        # Состояние AI Factory (установленные навыки)
└── .opencode/skills/       # Локальные навыки AI Factory
```

## Ключевые точки входа

| Файл | Назначение |
|------|------------|
| `extension.toml` | Манифест расширения Zed — id `alpinejs-lsp`, language_server `alpine-language-server`, языки Blade/HTML |
| `src/lib.rs` | Точка входа Rust — `AlpineExtension` реализует `zed::Extension`, поставляет JS и запускает сервер |
| `server/src/index.ts` | Точка входа LSP — создаёт `createConnection(ProposedFeatures.all)` и запускает `AlpineLanguageServer` |
| `server/src/server.ts` | Главный класс LSP-сервера (404 строки) — `onInitialize`, `onCompletion`, `onHover`, `onDefinition` |
| `server/src/data.ts` | Статическая база знаний — `MAGIC_PROPERTIES`, `DIRECTIVES`, `MODIFIERS` |
| `server/tsconfig.json` | Конфигурация компилятора TypeScript (strict, outDir dist, rootDir src) |

## Документация

| Документ | Путь | Описание |
|----------|------|----------|
| README (EN) | `README.md` | Project landing page — features, quick install, links to docs |
| README (RU) | `README.ru.md` | Русская версия README |
| Getting Started | `docs/getting-started.md` | Installation, first use, verification |
| Features | `docs/features.md` | Hover, go-to-definition, completions, workspace indexer |
| Architecture | `docs/architecture.md` | Hybrid Rust + TS design, module structure, data flow |
| Development | `docs/development.md` | Build, test, iterate as dev extension, CI pipeline |
| LICENSE | `LICENSE` | Текст лицензии MIT |

## Файлы контекста для AI

| Файл | Назначение |
|------|------------|
| `AGENTS.md` | Этот файл — структурная карта проекта для агентов |
| `.ai-factory/DESCRIPTION.md` | Подробная спецификация проекта (стек, функции, нефункциональные требования) |
| `.ai-factory/ARCHITECTURE.md` | Архитектурные guidelines (паттерн, правила зависимостей, примеры кода) |
| `.ai-factory/rules/base.md` | Автодетектированные конвенции кода (именование, ошибки, логирование) |
| `.ai-factory/config.yaml` | Конфигурация AI Factory (язык, пути, git-настройки) |

## Правила для агентов

- **Декомпозиция shell-команд:** не объединять связанные шаги через `&&` когда важна читаемость результата каждого
  - Неправильно: `cargo build --release && extension install`
  - Правильно: сначала `cargo build --release`, затем `extension install` отдельной командой
- **Сборка перед коммитом:** пересобирать `server/dist/` через `npm run build` в `server/` после изменений TS — dist коммичится и встраивается в WASM
- **Разделение языков:** бизнес-логика только в TypeScript; Rust только поставка и запуск. Не переносить логику парсинга в Rust
- **Тестирование после изменений extractor/xdata:** запускать `node test/test.js`, ожидать `Failed: 0`
