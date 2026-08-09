# План: References + Rename

**Режим:** Fast  
**Дата:** 2026-08-09  
**Ветка:** main (create_branches = false)

## Original Request

roadmap → References + Rename

## Settings

- **Testing:** Да
- **Logging:** Verbose
- **Docs:** Нет (warn-only)

## Roadmap Linkage

- **Milestone:** "References + Rename — find usages + rename для x-ref, компонентов Alpine.data(), stores Alpine.store()"
- **Rationale:** onDefinition уже резолвит символы. fileTexts хранит все тексты. References находит usages, Rename производит WorkspaceEdit.

## Tasks

### Task 1: capabilities + импорты
server.ts: referencesProvider, renameProvider, ReferenceParams/RenameParams/TextEdit/WorkspaceEdit импорт

### Task 2: allUris() в workspace.ts
Public method returning [...this.fileTexts.keys()]

### Task 3: onReferences handler
- Регистрация connection.onReferences
- Для Alpine.data(name): search all fileTexts for x-data="name" attrs → Location[]
- Для Alpine.store(name): search all fileTexts for $store.name chains → Location[]

### Task 4: onRename handler  
- Регистрация connection.onRenameRequest
- Collect registration + usage locations
- WorkspaceEdit { changes: Map<uri, TextEdit[]> }

### Task 5: Тесты (7 тестов)

### Task 6: Сборка + проверка

## Commit Plan
1 коммит: `feat: add references and rename providers for Alpine.data/store`
