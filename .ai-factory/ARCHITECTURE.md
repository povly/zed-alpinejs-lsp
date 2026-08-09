# Архитектура: Structured Modules (Technical Layer) — адаптированная

## Обзор

Проект использует адаптированный вариант **Structured Modules (Technical Layer)**, оптимизированный под специфику утилиты — языкового сервера для редактора. В отличие от классического бизнес-приложения с контроллерами/сервисами/репозиториями, здесь модули разделены по **технической зоне ответственности** внутри единого предмета области «Alpine.js LSP»: парсинг, индексация, протокол LSP, статические данные.

Архитектура гибридная: тонкая Rust-обёртка (Wasm-расширение Zed) встроенными строками поставляет JavaScript-сервер, который запускается под Node.js. Вся бизнес-логика парсинга и LSP-обработки сосредоточена в TypeScript; Rust отвечает только за поставку файлов, npm-установку и запуск процесса.

Паттерн выбран потому, что проект: (1) имеет малый размер (6 TS-модулей, 79 строк Rust), (2) единую предметную область без сущностных границ, (3) требует чёткого разделения по техническим слоям (протокол ↔ парсинг ↔ данные), (4) уже реализован и работает — документируем реальность, а не навязываем рефакторинг.

## Обоснование выбора

- **Тип проекта:** утилита / инструмент разработчика (Language Server для редактора)
- **Стек:** Rust 2021 (обёртка Zed Extension API) + TypeScript 5.5 strict (LSP-сервер на Node.js)
- **Ключевой фактор:** единая область «парсинг Alpine-директив + LSP-протокол» без бизнес-сущностей — модули разделяются по технической ответственности, а не по домену
- **Размер:** один разработчик, ~900 строк TS + 79 строк Rust — избыточно что-либо сложнее плоской модульной структуры

## Структура проекта

```
.
├── extension.toml              # Манифест Zed (id, language_servers, languages)
├── Cargo.toml                  # Манифест Rust (cdylib → Wasm)
├── src/
│   └── lib.rs                  # Rust-обёртка Zed Extension (standalone, 79 строк)
│       ↑ include_str!("../server/dist/*.js") — встраивает скомпилированный JS
├── server/
│   ├── package.json            # npm-зависимости + скрипты build/dev
│   ├── tsconfig.json           # strict, ES2022, CommonJS, declaration, sourcemap
│   ├── src/                    # Исходники TS-сервера
│   │   ├── index.ts            # Точка входа — создаёт Connection + Server
│   │   ├── server.ts           # ПРОТОКОЛЬНЫЙ СЛОЙ: LSP-обработчики
│   │   ├── extractor.ts        # СЛОЙ ПАРСИНГА: Alpine-атрибуты + Alpine.data/store
│   │   ├── xdata.ts            # СЛОЙ ПАРСИНГА: inline x-data объектный литерал
│   │   ├── workspace.ts        # СЛОЙ ИНДЕКСАЦИИ: сканер FS + индекс символов
│   │   └── data.ts             # СТАТИЧЕСКИЕ ДАННЫЕ: MAGIC_PROPERTIES, DIRECTIVES
│   └── dist/                   # Скомпилированный JS (коммичится, embedded в Wasm)
├── test/
│   └── test.js                 # Тесты extractor + xdata (node:assert)
└── .gitignore                  # target/, node_modules/, extension.wasm
```

## Правила зависимостей

Поток зависимостей строго однонаправленный: протокол → индексация → парсинг → статические данные. Внутренние (нижние) слои никогда не импортируют внешние (верхние).

```
index.ts (точка входа)
    ↓ создаёт
server.ts (протокольный слой)
    ↓ делегирует к
workspace.ts (индексация)   →   extractor.ts (парсинг атрибутов)
    ↓                             ↓
    ↓ использует                   xdata.ts (парсинг объектных литералов)
    ↓ для индексации
    ↓
data.ts (статические данные — leaf, не зависит ни от чего)
```

- ✅ `server.ts` → `extractor.ts`, `workspace.ts`, `xdata.ts`, `data.ts` (протокольный слой делегирует вниз)
- ✅ `workspace.ts` → `extractor.ts`, `xdata.ts` (индексация использует парсеры)
- ✅ `index.ts` → `server.ts` (точка входа создаёт сервер)
- ✅ `lib.rs` (Rust) → встраивает `server/dist/*.js` через `include_str!()` (поставка, не логика)
- ❌ `extractor.ts` → `server.ts` (парсер не знает о LSP-протоколе)
- ❌ `xdata.ts` → `workspace.ts` или `server.ts` (чистый leaf-модуль)
- ❌ `data.ts` → любой другой модуль (чистые статические данные)
- ❌ Rust-сторона → TypeScript-бизнес-логика (Rust НЕ содержит парсинга/обработчиков)

## Коммуникация между модулями

- **Импорты ES-модулей (CommonJS)** — основной канал. Каждый модуль экспортирует функции/классы/интерфейсы; `server.ts` импортирует и оркестрирует
- **Передача данных через параметры** — функции не имеют побочных эффектов на глобальное состояние (кроме `WorkspaceIndex` который инкапсулирует своё состояние в приватных Map)
- **Инкапсуляция состояния** — `AlpineLanguageServer` владеет `attrCache`, `workspace`, `documents`; `WorkspaceIndex` владеет `fileDefs`, `fileTexts`, `nameIndex`, `dataRegistrations`, `storeRegistrations`. Внешний код не обращается к внутренним коллекциям напрямую
- **Rust ↔ TypeScript** — однонаправленный мост: Rust встраивает JS как строки, распаковывает на диск, запускает `node --stdio`. Никакого обратного вызова из TS в Rust

## Ключевые принципы

1. **Разделение языков по ответственности:** Rust — только поставка/запуск (thin wrapper); TypeScript — вся бизнес-логика парсинга и LSP-обработки. Не переносить парсинг/обработчики в Rust.

2. **Leaf-модули без побочных эффектов:** `extractor.ts`, `xdata.ts`, `data.ts` — чистые функции (pure), не зависят от состояния или других модулей. Это делает их тривиально тестируемыми (см. `test/test.js`).

3. **Единый источник состояния:** `WorkspaceIndex` — единственный владелец индекса символов воркспейса. `AlpineLanguageServer` владеет атрибут-кэшем. Никаких глобальных singleton'ов вне этих классов.

4. **Идемпотентность установки:** Rust-обёртка проверяет `self.did_install && self.server_exists()` перед повторной установкой — повторные вызовы безопасны.

5. **Dist коммитится:** `server/dist/*.js` — часть репозитория (встраивается в Wasm через `include_str!()`). После любого изменения в `server/src/*.ts` обязательно `npm run build` в `server/` перед коммитом.

6. **Эвристический парсинг вместо AST:** парсеры (`extractor.ts`, `xdata.ts`) используют регулярные выражения с фильтром ключевых слов, а не полноценный JS-парсер. Ограничения фиксировать в комментариях; добавлять регрессион-тесты в `test/test.js` для каждого нового edge-case.

## Политика существующего vs нового кода

- **Новые функции:** Весь новый код должен следовать архитектуре из этого документа там, где это практически целесообразно. Новые модули добавлять как sibling-файлы в `server/src/` с однонаправленной зависимостью вниз.
- **Существующий код:** Документировать структуру как есть. При модификации существующего кода предпочитать следование архитектурным конвенциям из этого документа, но не форсировать переписывание нерелевантного кода.
- **Интероперабельность:** Когда новый код вызывает существующий, предпочитать чистые интерфейсы (экспортируемые функции/классы), но не рефакторить исключительно ради структурного соответствия.

## Примеры кода

### Точка входа — минимальный оркестратор

```typescript
// server/src/index.ts — точка входа создаёт Connection и Server, ничего больше
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { AlpineLanguageServer } from './server';

const connection = createConnection(ProposedFeatures.all);
const server = new AlpineLanguageServer(connection);
server.start();
```

### Протокольный слой делегирует в парсеры (ранние возвраты)

```typescript
// server/src/server.ts — обработчик hover делегирует к extractor/data/workspace
private onHover(params: { textDocument: { uri: string }; position: { line: number; character: number } }): Hover | null {
  const doc = this.documents.get(params.textDocument.uri);
  if (!doc) return null;                                    // guard clause

  const offset = doc.offsetAt(params.position);
  const attrs = this.attrCache.get(params.textDocument.uri) ?? [];
  const attr = findAttrAtOffset(attrs, offset);             // extractor.ts
  if (!attr) return null;

  const word = getWordAtOffset(attr.value, offset - attr.valueOffset);
  if (!word) return null;

  const magic = MAGIC_PROPERTIES.find((p) => p.name === word);  // data.ts
  if (magic) {
    return { contents: [{ language: 'typescript', value: magic.signature }, magic.documentation] };
  }
  // ... делегирование к workspace.lookupAlpineData() и т.д.
}
```

### Leaf-модуль — чистый парсер без зависимостей

```typescript
// server/src/extractor.ts — экспортирует функции и интерфейсы, не импортирует ничего из проекта
export interface AlpineAttr {
  name: string;
  value: string;
  valueOffset: number;
  valueLength: number;
}

const ALPINE_PREFIXES = ['x-', '@', ':'];

export function isAlpineAttr(name: string): boolean {
  return ALPINE_PREFIXES.some((p) => name.startsWith(p));
}

export function extractAlpineAttrs(text: string): AlpineAttr[] {
  // ... регулярное выражение + фильтр isAlpineAttr
}
```

### Слой индексации использует парсеры

```typescript
// server/src/workspace.ts — импортирует extractor + xdata, инкапсулирует состояние
import { extractAlpineAttrs, isXData, extractAlpineData, extractAlpineStore } from './extractor';
import { parseXData } from './xdata';

export class WorkspaceIndex {
  private fileDefs = new Map<string, WorkspaceDef[]>();
  private nameIndex = new Map<string, WorkspaceDef[]>();
  // ... приватное состояние

  scanWorkspace(rootPath: string): void {
    // обход FS, вызов extractAlpineAttrs + parseXData для каждого файла
    // перестройка nameIndex
  }
}
```

### Rust-обёртка — поставка и запуск, без бизнес-логики

```rust
// src/lib.rs — встраивает JS, распаковывает, запускает node --stdio
const SERVER_FILES: &[(&str, &str)] = &[
    ("server/dist/index.js", include_str!("../server/dist/index.js")),
    // ... остальные .js файлы
];

impl zed::Extension for AlpineExtension {
    fn language_server_command(&mut self, _id: &LanguageServerId, _wt: &zed::Worktree) -> Result<zed::Command> {
        self.install_server(_id)?;   // распаковка + npm install
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec!["server/dist/index.js".into(), "--stdio".into()],
            env: Default::default(),
        })
    }
}
```

## Анти-паттерны

- ❌ **Перенос парсинга в Rust:** бизнес-логика парсинга Alpine-атрибутов или x-data объектных литералов должна оставаться в TypeScript. Rust — только поставка/запуск.
- ❌ **Обращение протокольного слоя к FS напрямую:** `server.ts` должен работать через `WorkspaceIndex`, а не через `fs.readFileSync` самостоятельно.
- ❌ **Глобальное состояние вне классов:** создавать singleton'ы на уровне модуля (кроме статических данных в `data.ts`) — запрещено. Состояние инкапсулировать в `AlpineLanguageServer` и `WorkspaceIndex`.
- ❌ **`console.log` в TS-коде:** ломает LSP stdio-протокол. Только `this.connection.console.info/error`.
- ❌ **Коммит `server/src/*.ts` без пересборки `dist/`:** dist встраивается в Wasm через `include_str!()` — несинхронизированный dist = неработающее расширение.
- ❌ **Циклические импорты:** `extractor` ↔ `workspace` или `server` ↔ `workspace` — разрывать через передачу данных через параметры, не через обратные импорты.
- ❌ **Полноценный JS-AST-парсер вместо эвристик:** текущий regex-подход осознанно выбран для лёгкости и скорости. Переход на AST только при доказанном масштабе проблем.
- ❌ **Пропуск тестов после правок парсеров:** `extractor.ts` и `xdata.ts` покрыты тестами в `test/test.js` — после любых правок запускать `node test/test.js`, ожидать `Failed: 0`.
