# Alpine.js LSP для Zed

## Обзор

Языковой сервер (Language Server) для [Alpine.js](https://alpinejs.dev/), интегрированный в редактор [Zed](https://zed.dev) как Wasm-расширение. Предоставляет hover-документацию, переход к определению (go-to-definition) и автодополнение для директив Alpine (`x-data`, `@click`, `:class` и др.), магических свойств (`$el`, `$refs`, `$store`, `$dispatch`) и членов области видимости компонента — в HTML- и Blade-файлах.

Архитектура гибридная: минимальная Rust-обёртка (Zed Extension API, компилируется в Wasm) встроенными в бинарлыми строками поставляет JavaScript-сервер, который запускается под Node.js через `--stdio`.

## Ключевые функции

- **Hover-документация** — встроенные описания директив Alpine и сигнатуры магических свойств прямо в редакторе
- **Go-to-definition** — переход от ссылки к определению: внутри `x-data`, к регистрации `Alpine.data()`/`Alpine.store()`, в т.ч.跨-файлово
- **Автодополнения** — магические свойства по триггеру `$`, члены скоупа по `.`, кросс-файловые регистрации из индекса воркспейса
- **Индексатор воркспейса** — при инициализации сканирует весь проект на `Alpine.data(...)`, `Alpine.store(...)` и инлайн `x-data="{...}"`; все символы доступны для hover/definition/completion
- **Поддержка Blade** — корректная обработка `@json()`, `Js::from()`, `{{ }}` в связке Alpine + Laravel Blade

## Технологический стек

- **Язык (обёртка):** Rust 2021 edition (`zed_extension_api 0.7.0`, `crate-type = ["cdylib"]`)
- **Язык (LSP-сервер):** TypeScript 5.5+ (strict mode, ES2022, CommonJS)
- **Рантайм:** Node.js 18+
- **LSP-протокол:** `vscode-languageserver` 9 / `vscode-languageserver-textdocument` 1
- **Тестирование:** встроенный test-runner на `node:assert` (без внешних фреймворков)
- **Сборка TS:** `tsc` (декларации + sourcemaps)
- **Сборка Rust:** `cargo build --release` → `extension.wasm` (через toolchain Zed)
- **БД / ORM / фреймворк:** не используются

## Структура проекта

```
src/lib.rs              # Rust-обёртка расширения Zed (79 строк)
server/src/index.ts     # Точка входа LSP-сервера
server/src/server.ts    # AlpineLanguageServer — обработчики hover/definition/completion
server/src/extractor.ts # Парсер Alpine-атрибутов + Alpine.data()/store() extractor
server/src/workspace.ts # WorkspaceIndex — сканер воркспейса и индекс символов
server/src/xdata.ts     # Парсер inline x-data объектных литералов
server/src/data.ts      # База магических свойств и директив
server/dist/            # Скомпилированный JS (коммичируется, встраивается include_str!())
test/test.js            # Юнит-тесты extractor + xdata
```

## Архитектурные заметки

- **Поставка JS:** `server/dist/*.js` коммитятся в репозиторий и встраиваются в Rust-бинар через `include_str!("../server/dist/*.js")`. При установке расширения файлы распаковываются на диск, после чего Zed запускает `node server/dist/index.js --stdio`
- **Зависимости:** при установке вызывается `zed::npm_install_package()` для `vscode-languageserver` и `vscode-languageserver-textdocument`
- **Индексация воркспейса:** синхронный обход `fs.readdirSync` с лимитом глубины 10, пропуск `node_modules`, `vendor`, `dist`, `.git`, `storage`, `bootstrap/cache`, `public`; расширения `.js`, `.ts`, `.jsx`, `.tsx`, `.html`, `.blade.php`, `.php`
- **Кэширование:** атрибуты Alpine кэшируются per-URI при `onDidChangeContent`; индекс символов перестраивается полностью при каждом изменении (полная перестройка, не инкрементальная)
- **Парсинг x-data:** регулярные выражения (методы, property keys, shorthand properties) с фильтром JS-ключевых слов; НЕ полноценный JS-парсер, эвристики

## Нефункциональные требования

- **Логирование:** LSP-протокол (`connection.console.info/error`), без `console.log` напрямую; метрики индексации (число символов/data/store) при инициализации
- **Обработка ошибок:** ранние возвраты с дефолтами (`[]`, `null`), try/catch в обработчиках с записью в LSP-лог; Rust-часть — `.map_err(|e| format!(...))?` со строковыми ошибками
- **Безопасность:** расширение работает в песочнице Zed; читает только файлы воркспейса пользователя; не выполняет сетевых запросов; не обрабатывает учётные данные
- **Производительность:** полный обход FS при `onInitialize` (приемлемо для типичных веб-проектов); атрибут-кэш O(1) поиск; индекс символов — `Map<string, Def[]>`
- **Поддерживаемые языки:** Blade (`.blade.php`), HTML (`.html`, `.htm`) — заявлено в `extension.toml`

## Архитектура

Подробные архитектурные guidelines (правила зависимостей, коммуникация модулей, примеры кода, анти-паттерны) находятся в [.ai-factory/ARCHITECTURE.md](ARCHITECTURE.md).

**Паттерн:** Structured Modules (Technical Layer) — адаптированный под утилиту

## Лицензия

MIT — см. [LICENSE](../LICENSE)
