# План: Инкрементальная индексация воркспейса

**Ветка:** main (без веток — `git.create_branches: false`)
**Создан:** 2026-08-09
**Milestone:** Инкрементальная индексация воркспейса (ROADMAP.md, Стабилизация)

## Original Request

roadmap

## Roadmap Linkage

**Milestone:** "Инкрементальная индексация воркспейса"
**Rationale:** Текущая архитектура выполняет полную перестройку `rebuildIndexes()` (O(F×D), где F=файлов, D=определений) на каждое нажатие клавиши через `onDidChangeContent` → `indexDocument()` → `rebuildIndexes()`. Для воркспейсов с 50+ файлами это вызывает лаги. Решение: debounce + инкрементальное обновление + устранение дублирующего парсинга.

## Settings

- **Testing:** yes — регрессионные тесты для debounce timing и корректности инкрементального обновления
- **Logging:** verbose — метрики времени индексации, debounced events
- **Docs:** no — warn-only (внутреннее изменение архитектуры, docs/features.md уже описывает indexer)

## Анализ

### Текущая архитектура (из audit)

**Per-keystroke call chain:**
```
onDidChangeContent [server.ts:36]
  → extractAlpineAttrs(text) → attrCache           — O(T), regex
  → workspace.indexDocument(uri, text) [workspace.ts:55]
    → extractDefinitions(uri, text) [workspace.ts:176]
      → extractAlpineAttrs(text)                    — O(T) AGAIN (duplicate!)
      → extractAlpineData(text)                     — O(T)
      → extractAlpineStore(text)                    — O(T)
      → parseXData() per match                      — O(M)
    → rebuildIndexes() [workspace.ts:228]
      → Clears nameIndex, dataRegistrations, storeRegistrations
      → For EACH file in fileDefs:                  — O(F)
        → For EACH def in file:                     — O(D)
          → Insert into 3 maps
```

**Worst case per keystroke:** O(T + F×D) — недопустимо для больших воркспейсов

**Дополнительная проблема:** `extractAlpineAttrs` вызывается дважды — в server.ts:38 (для attrCache) и в workspace.ts:180 (для extractDefinitions). Один и тот же regex по тому же тексту.

### Структуры данных (workspace.ts)
```ts
private fileDefs = new Map<string, WorkspaceDef[]>();        // uri → defs
private fileTexts = new Map<string, string>();                // uri → text
private nameIndex = new Map<string, WorkspaceDef[]>();        // name → defs (derived)
private dataRegistrations = new Map<string, {def,text}[]>();  // Alpine.data name (derived)
private storeRegistrations = new Map<string, {def,text}[]>(); // Alpine.store name (derived)
```
`nameIndex`, `dataRegistrations`, `storeRegistrations` — **derived maps**, полностью перестраиваются при каждом `rebuildIndexes()`.

## Задачи

### Task 1: Debounce в onDidChangeContent
- [x] **Файл:** `server/src/server.ts`
- [x] **Изменения:**
  - Добавить debounce timer поле в `AlpineLanguageServer`: `private debounceTimer: ReturnType<typeof setTimeout> | null = null;`
  - В `onDidChangeContent` разделить логику:
    1. **Eager (немедленно):** `extractAlpineAttrs(text)` → `attrCache.set()` — нужно для мгновенного completion
    2. **Debounced (300ms):** `workspace.indexDocument()` — отложенное обновление индекса
  - Реализация debounce:
    ```ts
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.workspace.indexDocument(document.uri, document.getText());
      this.connection.console.info(`onDidChangeContent: workspace indexed (debounced) for ${document.uri}`);
    }, 300);
    ```
  - Уничтожать timer в `onShutdown()` или при закрытии connection (если есть такой handler)
  - **ВАЖНО:** attrCache обновляется мгновенно (для completion без lag). Только workspace indexing дебаунсится
- [x] **Тесты** (`test/test.js`, suite `'server: debounce onDidChangeContent'`):
  - После изменения документа attrCache обновляется немедленно (0ms)
  - workspace.indexDocument НЕ вызывается немедленно — только после debounce delay
  - При быстром вводе (3 изменения за 100ms) indexDocument вызывается 1 раз (не 3) после последнего изменения + 300ms
  - Использовать fake timers или async/await с setTimeout в тестах

### Task 2: Инкрементальное обновление индекса в workspace.ts
- [x] **Файл:** `server/src/workspace.ts`
- [x] **Изменения:**
  - Добавить приватный метод `updateIndexesForUri(uri: string, oldDefs: WorkspaceDef[], newDefs: WorkspaceDef[]): void`:
    1. Для каждого `oldDef` в `oldDefs`:
       - Найти запись в `nameIndex.get(oldDef.name)`, удалить oldDef из массива. Если массив пуст → delete key
       - Если `oldDef.registrationKind === 'Alpine.data'` → аналогично из `dataRegistrations`
       - Если `oldDef.registrationKind === 'Alpine.store'` → аналогично из `storeRegistrations`
    2. Для каждого `newDef` в `newDefs`:
       - Добавить в `nameIndex` (создать массив если ключа нет)
       - Добавить в `dataRegistrations` / `storeRegistrations` по необходимости
  - Изменить `indexDocument()`:
    ```ts
    indexDocument(uri: string, text: string): void {
      const oldDefs = this.fileDefs.get(uri) ?? [];
      this.fileTexts.set(uri, text);
      const newDefs = this.extractDefinitions(uri, text);
      this.fileDefs.set(uri, newDefs);
      this.updateIndexesForUri(uri, oldDefs, newDefs);  // вместо rebuildIndexes()
    }
    ```
  - **НЕ удалять `rebuildIndexes()`** — оставить для `scanWorkspace()` (полная перестройка при старте)
  - Сложность: O(D_uri) вместо O(F×D) — обрабатываются только определения одного файла
- [x] **Тесты** (suite `'workspace: incremental index update'`):
  - Индексировать 2 файла, затем обновить 1 файл → nameIndex содержит только актуальные определения
  - Удалить все определения из файла (пустой x-data) → старые записи исчезают из nameIndex
  - Изменить имя метода в файле → старое имя исчезает из nameIndex, новое появляется
  - Добавить новый Alpine.data в файл → появляется в dataRegistrations
  - Сравнить результат `updateIndexesForUri` с результатом `rebuildIndexes()` — должны быть идентичны

### Task 3: Устранить дублирующий extractAlpineAttrs
- [x] **Файлы:** `server/src/server.ts`, `server/src/workspace.ts`
- [x] **Изменения:**
  - В `workspace.ts` добавить опциональный параметр:
    ```ts
    indexDocument(uri: string, text: string, precomputedAttrs?: AlpineAttr[]): void {
      // ...
      const attrs = precomputedAttrs ?? extractAlpineAttrs(text);
      // использовать attrs вместо внутреннего вызова
    }
    ```
  - В `extractDefinitions` тоже принять опциональный `precomputedAttrs?` параметр, использовать его вместо `extractAlpineAttrs(text)` вызова (строка ~180)
  - В `server.ts` `onDidChangeContent` (внутри debounced callback):
    ```ts
    const attrs = this.attrCache.get(document.uri);
    this.workspace.indexDocument(document.uri, document.getText(), attrs);
    ```
  - **ВАЖНО:** `attrs` из attrCache могут быть stale (если документ изменился после eager update но до debounced callback). Решение: передавать `document.getText()` как `text`, и если attrs !== undefined, использовать их. Если attrs undefined (cache miss), workspace.ts вызовет extractAlpineAttrs сам. В нормальном потоке attrs всегда в кэше (eager update происходит раньше debounce)
- [x] **Тесты** (suite `'workspace: indexDocument with precomputed attrs'`):
  - `indexDocument(uri, text, attrs)` даёт тот же результат что `indexDocument(uri, text)` без attrs
  - `indexDocument(uri, text, undefined)` работает (fallback на внутренний extractAlpineAttrs)
  - `indexDocument(uri, text, [])` — пустой attrs, fallback или empty defs

## Commit Plan

3 задачи (< 5) — единый коммит:
```
perf(workspace): debounced incremental workspace indexing

- Debounce workspace.indexDocument() by 300ms in onDidChangeContent;
  attrCache still updates eagerly for instant completion
- Replace full rebuildIndexes() with per-URI incremental update:
  remove old defs + insert new defs for changed file only (O(D_uri) vs O(F*D))
- Pass precomputed attrs from attrCache to indexDocument() to eliminate
  redundant extractAlpineAttrs regex pass
- Regression tests for debounce timing, incremental correctness, attrs reuse
```

## Проверка выполнения

- [x] `cd server && npm run build` — без ошибок TypeScript
- [x] `node test/test.js` — 156 тестов (140 существующих + 16 новых), 0 failed
- [x] Существующие completion/hover/definition тесты не сломаны (regression)
- [x] ROADMAP.md milestone отмечен `[x]`, добавлен в Completed таблицу
