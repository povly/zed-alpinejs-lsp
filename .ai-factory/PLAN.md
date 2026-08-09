# План: Code Actions

**Режим:** Fast  
**Дата:** 2026-08-09  
**Ветка:** main (create_branches = false)

## Original Request

запланируй!

## Settings

- **Testing:** Да
- **Logging:** Verbose
- **Docs:** Нет (warn-only)

## Roadmap Linkage

- **Milestone:** "Code Actions — извлечение inline x-data в Alpine.data() регистрацию; quick-fix для directive misuse; :class ternary → object syntax"
- **Rationale:** Последний milestone roadmap. LSP code actions предлагают quick-fixes для существующих diagnostics + refactor extract для inline x-data.

## Анализ

### LSP Code Action механизм

- `codeActionProvider: true` в capabilities
- `connection.onCodeAction(params: CodeActionParams)` handler
- `CodeAction` = `{ title, kind, diagnostics?, edit?, command? }`
- `CodeActionKind`: `quickfix`, `refactor.extract`, `refactor.rewrite`

### 4 code actions

| # | Action | Kind | Триггер |
|---|--------|------|---------|
| 1 | Extract inline x-data → Alpine.data() | refactor.extract | `x-data="{...}"` на элементе |
| 2 | Wrap in <template> | quickfix | Диагностика x-if-template |
| 3 | Remove duplicate x-data | quickfix | Диагностика duplicate-x-data |
| 4 | Register missing component | quickfix | Диагностика unregistered-component |

### Что уже есть

| Компонент | Использование |
|-----------|--------------|
| `computeDiagnostics` | Produces diagnostics with `code` field — onCodeAction uses these |
| `isXData(name)` | Check if attr is x-data |
| `attrCache` | All attrs per document |
| `workspace.lookupAlpineData(name)` | Check registration |
| `findEnclosingTag(text, offset)` | Find parent tag |

---

## Tasks

### Task 1: capabilities + imports + handler registration

**Файл:** `server/src/server.ts`

1. Добавить `CodeAction`, `CodeActionKind`, `CodeActionParams` в импорт
2. Добавить `codeActionProvider: true` в capabilities
3. Зарегистрировать `connection.onCodeAction(...)` в конструкторе

### Task 2: Реализовать onCodeAction — quick-fixes для diagnostics

**Файл:** `server/src/server.ts`

Для каждого diagnostic в `params.context.diagnostics`:
- `x-if-template` → CodeAction "Wrap in template" — заменить `<tag` на `<template` и `</tag>` на `</template>`
- `duplicate-x-data` → CodeAction "Remove duplicate x-data" — удалить атрибут из документа
- `unregistered-component` → CodeAction "Register as Alpine.data()" — добавить `Alpine.data('name', () => ({}))` в `<script>` тег или создать новый

### Task 3: Реализовать onCodeAction — extract inline x-data

**Файл:** `server/src/server.ts`

Для каждого x-data атрибута где значение начинается с `{`:
1. Найти существующий `<script>` тег в документе (regex)
2. Сгенерировать имя компонента (camelCase из контекста, или fallback `'component'`)
3. Создать WorkspaceEdit:
   - Заменить `x-data="{...}"` на `x-data="componentName"`
   - Добавить `Alpine.data('componentName', () => ({...}))` внутрь `<script>` или создать новый `<script>` тег

### Task 4: Тесты

**Файл:** `test/test.js`

8 тестов:
1. Extract inline x-data → CodeAction с WorkspaceEdit
2. x-if diagnostic → "Wrap in template" action
3. duplicate-x-data diagnostic → "Remove duplicate x-data" action
4. unregistered-component diagnostic → "Register component" action
5. No diagnostics, no inline x-data → empty actions
6. x-data without `{` (registered name) → no extract action
7. Multiple diagnostics → multiple actions
8. Action kind matches expected kind

### Task 5: Сборка и проверка

- `npm run build` — tsc strict, 0 errors
- `node test/test.js` — Failed: 0

## Commit Plan

1 коммит: `feat: add code actions — extract x-data, quick-fix diagnostics`
