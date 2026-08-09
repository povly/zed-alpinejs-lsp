# План: Диагностика — базовые правила

**Режим:** Fast  
**Дата:** 2026-08-09  
**Ветка:** main (create_branches = false)

## Original Request

roadmap → Диагностика: базовые правила

## Settings

- **Testing:** Да
- **Logging:** Verbose
- **Docs:** Нет (warn-only)

## Roadmap Linkage

- **Milestone:** "Диагностика: базовые правила — `x-if`/`x-for` вне `<template>`, несколько `x-data` на одном элементе, `x-data="name"` без регистрации `Alpine.data(name)` в воркспейсе"
- **Rationale:** Первый шаг к LSP diagnostics. Базовые статические правила без scope analysis. PublishDiagnostics notification.

## Анализ

### LSP Diagnostics механизм

- Server объявляет `diagnosticProvider` в capabilities
- Server отправляет `textDocument/publishDiagnostics` через `connection.sendDiagnostics()`
- Вычисление происходит на `onDidChangeContent` (уже кэширует attrs)
- `Diagnostic` = `{ range, severity, source?, code?, message }`

### 3 правила диагностики

| # | Правило | Severity | Условие |
|---|---------|----------|---------|
| 1 | x-if/x-for вне `<template>` | Error | `attr.name` = `x-if` или `x-for`, enclosing tag ≠ `template` |
| 2 | Дубль x-data на элементе | Error | Два+ `x-data` атрибута на одном HTML-элементе |
| 3 | Незарегистрированный компонент | Warning | `x-data="name"` (не inline `{...}`), `workspace.lookupAlpineData(name)` пусто |

### Что нужно для Rule 1 и 2

`AlpineAttr` не содержит имя тега. Нужен helper `findEnclosingTag(text, offset)`:
- Walk backward от offset до `<` (не `</`)
- Extract tag name: `<tagname` → `tagname`
- Return `{ tagName, tagStartOffset }`

Rule 2: group by `tagStartOffset` — атрибуты с одним tagStartOffset принадлежат одному элементу.

### Что есть

| Компонент | Метод |
|-----------|-------|
| `attrCache` | Все Alpine атрибуты документа |
| `workspace.lookupAlpineData(name)` | Проверка регистрации Alpine.data |
| `onDidChangeContent` | Место для вызова sendDiagnostics |
| `extractAlpineAttrs` | Уже вызывается на каждое изменение |

---

## Tasks

### Task 1: Добавить diagnosticProvider capability + импорты

**Файл:** `server/src/server.ts`

1. Добавить `Diagnostic`, `DiagnosticSeverity` в импорт из `vscode-languageserver/node`
2. Добавить `diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false }` в capabilities

---

### Task 2: Реализовать findEnclosingTag helper

**Файл:** `server/src/server.ts` (module-level function, рядом с другими helpers)

Walk backward от offset до `<` (не `</`), extract tag name. Return `{ tagName, tagStartOffset } | null`.

**MUST DO:**
- Pure function, no side effects
- Lowercase the tag name for comparison
- Handle self-closing tags (`<br/>` — `>` before `/`)

---

### Task 3: Реализовать computeDiagnostics метод

**Файл:** `server/src/server.ts`

3 правила:
1. x-if/x-for вне template → Error, code `x-if-template`
2. Дубль x-data → Error, code `duplicate-x-data`
3. Unregistered component → Warning, code `unregistered-component`

**MUST DO:**
- Verbose logging
- Использовать `normalizeAttrName`, `isXData` из extractor
- Rule 3: только для x-data значений, которые НЕ inline (`{` или `(`)
- Guard: если doc не найден → return []

**MUST NOT DO:**
- Не добавлять scope-aware правила
- Не валидировать выражения

---

### Task 4: Wire diagnostics в onDidChangeContent + onDidOpen

**Файл:** `server/src/server.ts`

1. В `onDidChangeContent` — после `attrCache.set`, вызвать computeDiagnostics + sendDiagnostics
2. В `onDidClose` — отправить пустой массив для очистки

---

### Task 5: Тесты для computeDiagnostics

**Файл:** `test/test.js`

8 тестов:
1. x-if outside template → Error
2. x-if inside template → no diagnostic
3. x-for outside template → Error
4. duplicate x-data → Error
5. unregistered component → Warning
6. registered component → no diagnostic
7. inline x-data → no diagnostic
8. clean document → no diagnostics

---

### Task 6: Сборка и проверка

- `npm run build` — tsc strict, 0 errors
- `node test/test.js` — Failed: 0

---

## Commit Plan

1 коммит:

**`feat: add basic diagnostics — x-if/x-for template, duplicate x-data, unregistered components`**
