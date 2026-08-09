# План: Document Links

**Режим:** Fast  
**Дата:** 2026-08-09  
**Ветка:** main (create_branches = false)

## Original Request

roadmap → Document Links

## Settings

- **Testing:** Да
- **Logging:** Verbose
- **Docs:** Нет (warn-only)

## Roadmap Linkage

- **Milestone:** "Document Links — кликабельные x-data=\"cart\" → Alpine.data('cart') регистрацию; $store.ui → Alpine.store('ui'). Надстройка над существующим onDefinition"
- **Rationale:** onDefinition уже резолвит x-data registrations и $store chains. Document Links делает их видимыми как кликабельные ссылки без явного F12.

## Анализ

### Что уже есть

- `workspace.lookupAlpineData(name)` / `lookupAlpineStore(name)` — регистрации
- `defToLocation(def)` — WorkspaceDef → Location (uri + range)
- `getChainAtOffset(text, offset)` — извлечение $store/$magic цепочки
- `attrCache` — все атрибуты документа

### Логика

1. `x-data="name"` (registered) → DocumentLink с target = registration URI
2. `$store.NAME` в любом значении атрибута → DocumentLink на store registration
3. Inline x-data (`{...}`) → пропустить

---

## Tasks

### Task 1-3: capability + handler + helper

**Файл:** `server/src/server.ts`

1. Импорты: `DocumentLink`, `DocumentLinkParams` из vscode-languageserver/node
2. Capability: `documentLinkProvider: { resolveProvider: false }`
3. Handler: `connection.onDocumentLink(...)` в конструкторе
4. `onDocumentLink(params)` метод:
   - Для каждого attr: если x-data="name" registered → link
   - Для каждого $store.NAME / $magic() в attr.value → link
   - Использовать `defToLocation` для target URI + range
5. Helper `findAllChainsInText(text)` — regex-сканер для $store.NAME и $magic() вхождений

### Task 4: Тесты

**Файл:** `test/test.js`

6 тестов: registered x-data → link, inline → no link, unregistered → no link, $store → link, multiple $store → multiple links, empty → 0 links

### Task 5: Сборка

- `npm run build` + `node test/test.js` — 0 errors, 0 failed

## Commit Plan

1 коммит: `feat: add documentLinkProvider for x-data and $store references`
