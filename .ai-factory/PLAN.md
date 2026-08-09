# План: Диагностика scope-aware

**Режим:** Fast  
**Дата:** 2026-08-09  
**Ветка:** main (create_branches = false)

## Original Request

roadmap → Диагностика: scope-aware

## Settings

- **Testing:** Да
- **Logging:** Verbose
- **Docs:** Нет (warn-only)

## Roadmap Linkage

- **Milestone:** "Диагностика: scope-aware — undefined method/property в @click/x-data scope с fuzzy-подсказками, unknown $store.name, unknown magic property"
- **Rationale:** Расширение существующего computeDiagnostics. getScopeMembers уже определяет доступные члены. findAllChainsInText сканирует $store/$magic. Нужен JS identifier extraction + Levenshtein fuzzy matching.

## Анализ

### 3 новых правила диагностики

| # | Правило | Severity | Условие |
|---|---------|----------|---------|
| 1 | Unknown $store.NAME | Warning | `$store.NAME` в attr value, `lookupAlpineStore(NAME)` пусто |
| 2 | Unknown magic property | Warning | `$magicName` не в MAGIC_PROPERTIES и не в lookupAlpineMagic |
| 3 | Undefined scope method | Warning | `identifier()` вызов, identifier не в scope members и не JS builtin, fuzzy "did you mean?" |

### Что уже есть

| Компонент | Использование |
|-----------|--------------|
| `computeDiagnostics(uri, doc)` | Расширить новыми правилами |
| `getScopeMembers(uri, attr)` | Доступные методы/свойства для attr |
| `findAllChainsInText(text)` | Поиск $store.X и $magic() |
| `workspace.lookupAlpineStore(name)` | Проверка регистрации store |
| `workspace.lookupAlpineMagic(name)` | Проверка регистрации magic |
| `MAGIC_PROPERTIES` | 10 известных magic properties |
| `getWordAtOffset` | Извлечение слова |

### Что нужно добавить

1. **JS_BUILTINS** — whitelist идентификаторов (this, console, window, JSON, Math, etc.)
2. **extractMethodCalls(text)** — regex для `identifier(` паттернов
3. **levenshtein(a, b)** — fuzzy matching для "did you mean?"
4. Интеграция в computeDiagnostics

---

## Tasks

### Task 1: Добавить JS_BUILTINS + levenshtein + extractMethodCalls helpers

**Файл:** `server/src/server.ts` (module-level)

```typescript
const JS_BUILTINS = new Set([
  'this', 'console', 'window', 'document', 'JSON', 'Object', 'Array',
  'Math', 'Date', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Number', 'String', 'Boolean', 'RegExp', 'Error', 'Promise',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'fetch', 'alert', 'confirm', 'prompt', 'event', 'true', 'false',
  'null', 'undefined', 'NaN', 'Infinity', 'typeof', 'instanceof',
  'new', 'return', 'if', 'else', 'for', 'while', 'switch', 'case',
  'break', 'continue', 'throw', 'try', 'catch', 'finally', 'void',
  'delete', 'in', 'of', 'let', 'const', 'var', 'function', 'class',
  'extends', 'super', 'import', 'export', 'default', 'from', 'as',
  'async', 'await', 'yield', 'static', 'get', 'set',
]);

function levenshtein(a: string, b: string): number { ... }

function extractMethodCalls(text: string): { name: string; offset: number }[] {
  const results: { name: string; offset: number }[] = [];
  const regex = /\b(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    results.push({ name: m[1], offset: m.index });
  }
  return results;
}
```

### Task 2: Расширить computeDiagnostics — $store и $magic проверки

**Файл:** `server/src/server.ts`

В существующем цикле `for (const attr of attrs)` добавить:

```typescript
// Unknown $store.NAME
const chains = findAllChainsInText(attr.value);
for (const c of chains) {
  if (c.type === '$store') {
    const storeRegs = this.workspace.lookupAlpineStore(c.name);
    if (storeRegs.length === 0) {
      diagnostics.push({
        range: { start: doc.positionAt(attr.valueOffset + c.offset), end: ... },
        severity: DiagnosticSeverity.Warning,
        source: 'alpinejs',
        code: 'unknown-store',
        message: `Unknown store '$store.${c.name}'`,
      });
    }
  } else if (c.type === '$magic') {
    const isKnown = MAGIC_PROPERTIES.some(p => p.name === `$${c.name}`);
    const isRegistered = this.workspace.lookupAlpineMagic(c.name).length > 0;
    if (!isKnown && !isRegistered) {
      diagnostics.push({
        range: ...,
        severity: DiagnosticSeverity.Warning,
        source: 'alpinejs',
        code: 'unknown-magic',
        message: `Unknown magic property '$${c.name}'`,
      });
    }
  }
}
```

### Task 3: Расширить computeDiagnostics — undefined method with "did you mean?"

Для каждого non-x-data Alpine атрибута:
1. Получить scope members через getScopeMembers
2. Извлечь method calls через extractMethodCalls
3. Для каждого call: если не в scope members и не в JS_BUILTINS → Warning с fuzzy match

```typescript
if (!isXData(attr.name) && attr.value) {
  const members = this.getScopeMembers(uri, attr);
  const memberNames = new Set(members.map(m => m.name));
  const calls = extractMethodCalls(attr.value);
  for (const call of calls) {
    if (JS_BUILTINS.has(call.name)) continue;
    if (memberNames.has(call.name)) continue;
    // Fuzzy match
    const closest = members
      .map(m => ({ name: m.name, dist: levenshtein(call.name, m.name) }))
      .filter(x => x.dist <= 2)
      .sort((a, b) => a.dist - b.dist)[0];
    const hint = closest ? ` Did you mean '${closest.name}'?` : '';
    diagnostics.push({
      range: { start: doc.positionAt(attr.valueOffset + call.offset), end: ... },
      severity: DiagnosticSeverity.Warning,
      source: 'alpinejs',
      code: 'undefined-method',
      message: `Method '${call.name}' is not defined in scope.${hint}`,
    });
  }
}
```

**MUST DO:**
- Проверять только в Alpine атрибутах (не обычных HTML)
- Исключить x-data атрибуты (там определение, не вызов)
- Fuzzy match только при distance ≤ 2
- Guard: если members пуст (нет scope), пропустить проверку

### Task 4: Тесты

**Файл:** `test/test.js`

8 тестов:
1. Unknown $store.NAME → Warning
2. Known $store.NAME → no diagnostic
3. Unknown $magic → Warning
4. Known $magic ($el) → no diagnostic
5. Undefined method in scope → Warning with "did you mean?"
6. Defined method in scope → no diagnostic
7. JS builtin (console.log) → no diagnostic
8. No scope (no x-data) → no method diagnostics

### Task 5: Сборка и проверка

- `npm run build` — tsc strict, 0 errors
- `node test/test.js` — Failed: 0

## Commit Plan

1 коммит: `feat: add scope-aware diagnostics — unknown $store/$magic, undefined method hints`
