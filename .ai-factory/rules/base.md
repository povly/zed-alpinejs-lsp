# Базовые правила проекта

> Автодетектированные конвенции из анализа кодовой базы. Редактируйте по мере необходимости.

## Именование

- **Файлы (TS):** lowercase без разделителей — `data.ts`, `server.ts`, `extractor.ts`, `xdata.ts`, `workspace.ts`, `index.ts`
- **Файлы (Rust):** `lib.rs` (единственный файл обёртки)
- **Файлы (тесты):** `test/test.js` (единый файл)
- **Переменные/функции (TS):** camelCase — `extractAlpineAttrs`, `findAttrAtOffset`, `getScopeMembers`, `valueOffset`
- **Переменные/функции (Rust):** snake_case — `did_install`, `server_exists`, `install_server`
- **Классы/интерфейсы/типы (TS):** PascalCase — `AlpineLanguageServer`, `AlpineAttr`, `XDataMember`, `WorkspaceDef`, `MagicProperty`, `DirectiveInfo`
- **Константы (TS):** UPPER_SNAKE_CASE для массивов/данных — `MAGIC_PROPERTIES`, `DIRECTIVES`, `MODIFIERS`, `SCAN_EXTENSIONS`, `SKIP_DIRS`, `ALPINE_PREFIXES`, `JS_KEYWORDS`, `SERVER_FILES`, `ATTR_REGEX`
- **Поля интерфейсов:** camelCase — `registrationName`, `objectLiteral`, `valueOffset`, `sourceFile`

## Структура модулей

- `src/` — Rust-обёртка Zed-расширения (один файл `lib.rs`)
- `server/src/` — TypeScript-исходники LSP-сервера (один модуль = один файл)
- `server/dist/` — скомпилированный JS (коммичируется, встраивается `include_str!()`)
- `test/` — автономные тесты на `node:assert`
- Жёсткое разделение: Rust не содержит бизнес-логики, только поставка/запуск; вся логика в TS

## Обработка ошибок

- **Ранние возвраты с дефолтами** — основной паттерн: `if (!doc) return [];`, `if (!attr) return null;`, `if (!word) return null;`
- **Try/catch** — только на границах (обработчики документов, сканирование FS), логирование в LSP: `catch (e) { this.connection.console.error(\`Parse error: ${e}\`); }`
- **Пропуск неоткрываемых файлов** — пустой `catch { /* skip */ }` при `fs.readdirSync`/`fs.readFileSync`
- **Rust:** `.map_err(|e| format!("Failed to write {path}: {e}"))?` — преобразование ошибок в строки с контекстом, распространение через `?`
- **Идемпотентность установки:** `if (self.did_install && self.server_exists()) return Ok(());`

## Поток управления

- Предпочитать плоское, читаемое управление потоком вместо глубоко вложенных условных конструкций. Использовать охранные предложения (guard clauses), ранние `return`/`continue`, небольшие именованные вспомогательные методы или явную логику классификации, когда это упрощает чтение. Обрабатывать краевые случаи и нерелевантные ветки как можно раньше, чтобы основной путь оставался видимым.
- Примеры из кода: `findScopeXData` — линейный обход с обновлением `best`; `onCompletion` — каскад ранних возвратов по типу триггера (`$` / `.` / default)

## Логирование

- **LSP-протокол:** `this.connection.console.info(...)` / `.error(...)` — единственный канал
- **НЕ использовать** `console.log`, `console.error`, `process.stdout.write` напрямую (конфликтует с LSP stdio-протоколом)
- **Rust:** без логирования (обёртка только пробрасывает ошибки через `Result`)
- Метрики при инициализации: число символов/data/store в виде `Workspace indexed: N symbols (D Alpine.data, S Alpine.store)`

## Парсинг и регулярные выражения

- Хранить ключевые регулярные выражения как именованные константы модуля (`ATTR_REGEX`, `methodRegex`, `propRegex`)
- Сбрасывать `lastIndex` перед использованием global regex: `ATTR_REGEX.lastIndex = 0;`
- Использовать `match[2] ?? match[3] ?? ''` для fallback-захвата групп
- Эвристический, не полноценный AST-парсинг — фиксировать ограничения в комментариях

## Тестирование

- Единый файл `test/test.js`, запускаемый `node test/test.js`
- Встроенные хелперы `test(name, fn)` и `suite(title, fn)`, обёртки над `node:assert`
- Синтетические данные (без реальных файлов проекта), секция "real-world patterns" для регрессий Blade/Alpine
- Тестируется ТОЛЬКО TS-логика (`extractor`, `xdata`); Rust-обёртка и LSP-обработчики без юнит-тестов
- Код возврата: `process.exit(1)` при наличии неудачных тестов
