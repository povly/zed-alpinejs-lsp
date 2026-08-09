# Implementation Plan: Расширение тестового покрытия

Branch: main
Created: 2026-08-09

## Original Request
roadmap

## Settings
- Testing: yes  # milestone сам состоит из тестов
- Logging: verbose  # DEBUG-логи в test-харнессе для отладки провалов
- Docs: yes  # обязательный checkpoint — обновить docs/development.md

## Roadmap Linkage
Milestone: "Расширение тестового покрытия"
Rationale: Первый unchecked milestone фазы стабилизации — разблокирует безопасный рефакторинг server.ts (404 строки) и workspace.ts (261 строка), которые сейчас без тестов.

## Commit Plan
- **Commit 1** (после задач 1-3): `test: add test harness and WorkspaceIndex unit tests`
- **Commit 2** (после задач 4-6): `test: add server.ts handler tests (completion, hover, definition)`
- **Commit 3** (после задачи 7): `test: add integration pipeline test and update docs`

## Tasks

### Phase 1: Test infrastructure

- [x] **Task 1: Test harness — mock Connection + document loader**
  - Создать `test/helpers.js` с двумя хелперами:
    - `createTestServer()` — инстанцирует `AlpineLanguageServer` с mock-Connection, захватывает handlers (onInitialize/onCompletion/onHover/onDefinition) в объект, возвращает `{ server, handlers }`. Mock-Connection: `console: { info: ()=>{}, error: ()=>{}, warn: ()=>{} }`, `listen: ()=>{}`, `onXxx: (fn) => { handlers.onXxx = fn }`
    - `loadDocument(server, uri, text)` — создаёт `TextDocument.create(uri, languageId, version, text)` из `vscode-languageserver-textdocument`, заполняет `server['attrCache']` через `extractAlpineAttrs(text)`, индексирует через `server['workspace'].indexDocument(uri, text)`, подменяет `server['documents'].get` для возврата этого документа
  - LOGGING: `console.error('[helpers] failed to load document: ...')` при ошибках; `LOG_LEVEL=debug` выводит содержимое attrCache и workspace.allNames() после загрузки
  - File: `test/helpers.js` (новый)
  - ПРИМЕЧАНИЕ: компилируемые private-методы доступны в JS через bracket-notation `server['onHover'](...)` — TS `private` не enforced в runtime

### Phase 2: WorkspaceIndex unit tests

- [x] **Task 2: WorkspaceIndex — методы индексации и поиска** (зависит от 1)
  - Добавить suite `'WorkspaceIndex'` в `test/test.js`:
    - `indexDocument` — индексация inline x-data: `{ open: false, toggle() {} }` → `lookup('open')` и `lookup('toggle')` возвращают определения
    - `indexDocument` — индексация `Alpine.data('cart', () => ({ items: [], add() {} }))` → `lookupAlpineData('cart')` возвращает регистрацию, члены доступны через `getRegistrationMembers`
    - `indexDocument` — индексация `Alpine.store('ui', { theme: 'dark' })` → `lookupAlpineStore('ui')` возвращает регистрацию
    - `allNames` / `allDataNames` / `allStoreNames` — корректные списки после индексации
    - `resolveScope('cart', uri)` — возвращает `{ members, sourceLabel }` для зарегистрированного компонента; `null` для inline x-data (`{`) и неизвестных имён
    - `getPosition` / `getEndPosition` — конвертация offset → `{ line, character }` для многострочного документа
    - `removeDocument` — удаление из индекса, `lookup` возвращает пустой массив после
  - LOGGING: каждый тест логирует `[WorkspaceIndex] indexed N names (D data, S store)` при DEBUG
  - Files: `test/test.js` (добавить suite)

- [x] **Task 3: WorkspaceIndex.scanWorkspace — интеграция с FS** (зависит от 2)
  - Добавить suite `'WorkspaceIndex.scanWorkspace'`:
    - Создать temp-директорию через `fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-test-'))`
    - Записать fixture-файлы: `app.js` с `Alpine.data('tabs', ...)`, `page.html` с inline `x-data`, `nested/store.blade.php` с `Alpine.store('ui', ...)`
    - `scanWorkspace(tmpDir)` → проверить что все 3 файла проиндексированы, `allDataNames()` включает `'tabs'`, `allStoreNames()` включает `'ui'`, `allNames()` включает inline-члены
    - SKIP_DIRS: создать `node_modules/dep.js` с Alpine.data — убедиться что НЕ проиндексирован
    - Extension filtering: создать `readme.md` — убедиться что проигнорирован
    - Cleanup: `fs.rmSync(tmpDir, { recursive: true })` в конце suite (или в finally)
  - LOGGING: `[scanWorkspace] scanned N files, indexed M symbols` при DEBUG; WARN при ошибках чтения файлов
  - Files: `test/test.js` (добавить suite)
<!-- Commit checkpoint: tasks 1-3 -->

### Phase 3: server.ts handler tests

- [x] **Task 4: onCompletion — триггеры и контекст** (зависит от 1)
  - Добавить suite `'AlpineLanguageServer.onCompletion'`:
    - Magic `$` trigger: документ `<div x-data="{ open: false }"><button @click="$">`, позиция курсора после `$` → возвращаются magic properties (`$el`, `$refs`, ...), отфильтрованные по введённому префиксу
    - `.` trigger: документ с `x-data="{ open: false, toggle() {} }"`, курсор после `this.` → возвращаются scope members (`open`, `toggle`)
    - Default (без триггера, non-x-data attr): `@click=""` пустое → scope + magic + workspace members
    - x-data attr special case: `x-data=""` → НЕ возвращаются magic properties (только scope members)
    - Empty doc / нет attr на курсоре → `[]`
  - LOGGING: `[onCompletion] trigger=$|.|none, items=N` при DEBUG; `[onCompletion] no attr at offset` при WARN
  - Files: `test/test.js` (добавить suite), использует `test/helpers.js`

- [x] **Task 5: onHover — типы контента** (зависит от 1)
  - Добавить suite `'AlpineLanguageServer.onHover'`:
    - Magic property: курсор на `$el` в `@click="$el..."` → Hover с `typescript` signature + documentation
    - Scope member (inline x-data): курсор на `open` в `x-data="{ open: false }"` → Hover с типом member + basename файла
    - Registration name: `x-data="cart"` (cart зарегистрирован через Alpine.data в workspace) → Hover с `Alpine.data('cart')` + список членов + файл-источник
    - Outside attr value: курсор на `<div` → `null`
    - Empty word: курсор в пустом attr value → `null`
    - Workspace definition fallback: член из другого файла → Hover с source label
  - LOGGING: `[onHover] word=..., matched=magic|scope|registration|none` при DEBUG
  - Files: `test/test.js` (добавить suite)

- [x] **Task 6: onDefinition — варианты перехода** (зависит от 1)
  - Добавить suite `'AlpineLanguageServer.onDefinition'`:
    - Inline x-data member: `x-data="{ open: false }"`, курсор на `open` → Location внутри того же документа, range указывает на `open` в object literal
    - Alpine.data registration: `x-data="cart"`, курсор на `cart` → Location файла-источника регистрации
    - Method inside Alpine.data: `x-data="tabs"`, `@click="select()"`, курсор на `select` → Location в файле регистрации tabs, на члене `select`
    - Alpine.store: `x-data="$store.ui"`, курсор на `ui` → Location файла-источника `Alpine.store('ui')` (если применимо по логике onDefinition)
    - Magic property ($-prefixed word): → `null` (onDefinition возвращает null для `$*`)
    - Unknown word: → `null`
  - LOGGING: `[onDefinition] word=..., resolved=inline|registration|store|none` при DEBUG
  - Files: `test/test.js` (добавить suite)
<!-- Commit checkpoint: tasks 4-6 -->

### Phase 4: Integration + Docs

- [x] **Task 7: Integration test + обновление docs/development.md** (зависит от 1-6)
  - Добавить suite `'Integration: full pipeline'`:
    - Сценарий: загрузить 2 документа в workspace (один с `Alpine.data('modal', () => ({ open: false, show() {} }))`, другой с `<div x-data="modal"><button @click="show()">`), выполнить onHover на `show` во втором документе → Hover ссылается на registration; выполнить onDefinition на `modal` → Location первого файла; onCompletion после `this.` → включает `open`, `show`
    - Сценарий с пустым workspace: один документ, onHover на неизвестном члене → `null`, onCompletion в `@click="$"` → magic properties
  - Обновить `docs/development.md` секцию "Running Tests":
    - Описать новую структуру: `test/helpers.js` + расширенный `test/test.js`
    - Добавить инструкцию `LOG_LEVEL=debug node test/test.js` для verbose-вывода
    - Указать ожидаемое число тестов после расширения (~50+, было 31)
  - LOGGING: `[integration] pipeline scenario: open→index→hover→definition→completion` при DEBUG; ERROR при несоответствии ожиданий
  - Files: `test/test.js` (добавить suite), `docs/development.md` (обновить секцию), `test/helpers.js` (если нужны доп. хелперы)
<!-- Commit checkpoint: task 7 -->
