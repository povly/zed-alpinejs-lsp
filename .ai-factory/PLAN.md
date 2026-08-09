# План: Document Symbols

**Режим:** Fast  
**Дата:** 2026-08-09  
**Веткa:** main (create_branches = false)

## Original Request

roadmap → Document Symbols

## Settings

- **Testing:** Да — тесты для onDocumentSymbol handler
- **Logging:** Verbose
- **Docs:** Нет (warn-only)

## Roadmap Linkage

- **Milestone:** "Document Symbols — outline x-data scope: методы/свойства как SymbolKind.Method/Property; регистрации Alpine.data()/store() как SymbolKind.Function. Низкий effort — парсинг уже есть"
- **Rationale:** Парсинг x-data членов (parseXData) и регистраций (workspace.ts fileDefs) уже существует. Нужно только добавить LSP handler и преобразование в DocumentSymbol[].

## Анализ

### Что есть

| Компонент | Где | Что предоставляет |
|-----------|-----|-------------------|
| `parseXData(value)` | `xdata.ts` | `XDataMember[]` — имя, kind (method/property/getter), offset, length |
| `attrCache` | `server.ts` | Все Alpine атрибуты документа, включая x-data |
| `workspace.fileDefs` | `workspace.ts` | `Map<uri, WorkspaceDef[]>` — регистрации Alpine.data/store/magic per file |
| `workspace.resolveScope(name, uri)` | `workspace.ts` | `ResolvedScope | null` — members зарегистрированного компонента |

### Что нужно добавить

1. `documentSymbolProvider: true` в capabilities onInitialize
2. Импорты `DocumentSymbol`, `SymbolKind` из vscode-languageserver
3. `connection.onDocumentSymbol(...)` handler
4. Метод `onDocumentSymbol(params)` — возвращает `DocumentSymbol[]`

### Логика onDocumentSymbol

Для текущего документа (`params.textDocument.uri`):

**1. Inline x-data scope:**
- Найти все x-data атрибуты через `attrCache`
- Для каждого с объектным литералом (`value.startsWith('{')`): `parseXData(value)` → child symbols
- Properties → `SymbolKind.Property`, Methods → `SymbolKind.Method`
- Родительский symbol → `SymbolKind.Object`, range = весь x-data атрибут

**2. Registered x-data (по имени):**
- Для x-data со значением-именем (`value = "dropdown"`): `workspace.resolveScope(value, uri)` → members
- Те же SymbolKind, но range указывает на атрибут в HTML

**3. Регистрации Alpine.data/store в этом файле:**
- `workspace.fileDefs.get(uri)` → все определения в текущем файле
- Для каждого с `registrationKind === 'Alpine.data'` → `SymbolKind.Function`
- Для каждого с `registrationKind === 'Alpine.store'` → `SymbolKind.Object`
- Range из `def.startOffset` / `def.length`

### Маппинг range

`DocumentSymbol.range` и `.selectionRange` требуют `{ start: Position, end: Position }`. Используем `doc.offsetAt()`:
- Inline x-data members: offset относительно начала value атрибута → абсолютный через `attr.valueOffset + member.offset`
- Регистрации: `def.startOffset` / `def.length` (уже абсолютные)

---

## Tasks

### Task 1: Добавить documentSymbolProvider capability + импорты

**Файл:** `server/src/server.ts`

1. Добавить `DocumentSymbol`, `SymbolKind` в импорт из `vscode-languageserver/node` (строка 1-11)
2. Добавить `documentSymbolProvider: true` в `capabilities` объект (после `definitionProvider: true`, строка 104)

**MUST DO:**
- Сохранить существующие capabilities без изменений
- Использовать `hierarchicalDocumentSymbolSupport: true` если нужны nested symbols (опционально)

---

### Task 2: Реализовать onDocumentSymbol handler

**Файл:** `server/src/server.ts`

1. Зарегистрировать handler в конструкторе `start()` (или там где регистрируются onHover/onDefinition):
```typescript
connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  return this.onDocumentSymbol(params);
});
```

2. Импортировать `DocumentSymbolParams` из vscode-languageserver/node

3. Реализовать метод `onDocumentSymbol`:
```typescript
private onDocumentSymbol(params: DocumentSymbolParams): DocumentSymbol[] {
  const uri = params.textDocument.uri;
  const doc = this.documents.get(uri);
  if (!doc) return [];

  const symbols: DocumentSymbol[] = [];

  // 1. Inline x-data scopes from attrCache
  const attrs = this.attrCache.get(uri) ?? [];
  for (const attr of attrs) {
    if (!isXData(attr.name)) continue;
    const members = this.getScopeMembers(uri, attr);
    if (members.length === 0) continue;

    const valueStart = attr.valueOffset;
    const childSymbols = members.map((m) => {
      const memberOffset = valueStart + (m.offset ?? 0);
      const memberEnd = memberOffset + (m.length ?? m.name.length);
      return {
        name: m.name,
        kind: m.kind === 'method' ? SymbolKind.Method : SymbolKind.Property,
        range: {
          start: doc.positionAt(memberOffset),
          end: doc.positionAt(memberEnd),
        },
        selectionRange: {
          start: doc.positionAt(memberOffset),
          end: doc.positionAt(memberOffset + m.name.length),
        },
      };
    });

    // Parent symbol for the x-data scope
    const xdataStart = attr.valueOffset;
    const xdataEnd = attr.valueOffset + attr.valueLength;
    const scopeName = attr.value.trim().startsWith('{')
      ? 'x-data (inline)'
      : `x-data: ${attr.value}`;
    symbols.push({
      name: scopeName,
      kind: SymbolKind.Object,
      range: { start: doc.positionAt(xdataStart), end: doc.positionAt(xdataEnd) },
      selectionRange: { start: doc.positionAt(xdataStart), end: doc.positionAt(xdataStart + scopeName.length) },
      children: childSymbols,
    });
  }

  // 2. Alpine.data/store registrations in this file
  const fileDefs = this.workspace.getDefsForFile(uri);
  for (const def of fileDefs) {
    if (!def.registrationName) continue;
    const defStart = def.startOffset;
    const defEnd = defStart + def.length;
    symbols.push({
      name: `${def.registrationKind}('${def.registrationName}')`,
      kind: def.registrationKind === 'Alpine.store' ? SymbolKind.Object : SymbolKind.Function,
      range: { start: doc.positionAt(defStart), end: doc.positionAt(defEnd) },
      selectionRange: { start: doc.positionAt(defStart), end: doc.positionAt(defStart + def.name.length) },
    });
  }

  this.connection.console.info(`[documentSymbol] returned ${symbols.length} symbols for ${uri}`);
  return symbols;
}
```

**MUST DO:**
- Добавить `isXData` в импорт из extractor если ещё нет (проверить)
- Добавить public метод `getDefsForFile(uri)` в WorkspaceIndex если ещё нет (fileDefs приватный)
- Verbose логирование: `[documentSymbol] returned N symbols for <uri>`
- Guard clauses: `if (!doc) return []`, `if (members.length === 0) continue`
- Для registered scopes (имя, не inline): использовать `workspace.resolveScope(name, uri)` вместо parseXData напрямую — `getScopeMembers` уже это делает
- children опциональны — если x-data scope пустой, пропустить

**MUST NOT DO:**
- Не создавать новых парсеров — использовать существующие `getScopeMembers` / `parseXData`
- Не модифицировать workspace.ts логику индексации — только добавить getter `getDefsForFile`
- Не добавлять `console.log` — только `connection.console.info`

---

### Task 3: Добавить getDefsForFile в WorkspaceIndex

**Файл:** `server/src/workspace.ts`

Добавить public метод:
```typescript
getDefsForFile(uri: string): WorkspaceDef[] {
  return this.fileDefs.get(uri) ?? [];
}
```

**MUST DO:**
- Возвращает массив всех определений в файле (включая Alpine.data/store/magic registrations и inline x-data)
- Read-only — не мутирует fileDefs

---

### Task 4: Тесты для onDocumentSymbol

**Файл:** `test/test.js`

Добавить suite `"Document Symbols"`:

1. **Test: inline x-data → method + property symbols**
   - HTML: `<div x-data="{ open: false, toggle() { this.open = !this.open } }">`
   - Expect: 1 parent symbol (SymbolKind.Object), 2 children (open as Property, toggle as Method)

2. **Test: registered x-data → resolved members**
   - HTML with `x-data="dropdown"` + workspace with `Alpine.data('dropdown', ...)` registration
   - Expect: parent symbol + children from registration

3. **Test: Alpine.data registration symbol**
   - JS: `Alpine.data('cart', () => ({ items: [] }))`
   - Expect: SymbolKind.Function symbol

4. **Test: Alpine.store registration symbol**
   - JS: `Alpine.store('ui', { sidebar: false })`
   - Expect: SymbolKind.Object symbol

5. **Test: empty document → empty symbols**
   - HTML без Alpine атрибутов
   - Expect: `[]`

6. **Test: symbol names are correct**
   - Verify `symbol.name` for each case

**MUST DO:**
- Использовать `createTestServer()` + `loadDocument()` хелперы
- Использовать `SymbolKind` enum из vscode-languageserver для проверок
- Для registration тестов: настроить workspace через mock файлы (как в existing workspace tests)

---

### Task 5: Сборка и проверка

- `cd server && npm run build` — tsc strict, 0 errors
- `node test/test.js` — Failed: 0
- Проверить что `documentSymbolProvider: true` в capabilities onInitialize response

---

## Commit Plan

1 коммит (< 5 задач):

**`feat: add documentSymbolProvider with x-data scope outline`**
- Tasks 1-5 (capability + handler + workspace getter + tests + build)
