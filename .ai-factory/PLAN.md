# План: Подключение модификаторов

**Ветка:** main (без веток — `git.create_branches: false`)
**Создан:** 2026-08-09
**Milestone:** Подключение модификаторов (ROADMAP.md, Стабилизация)

## Original Request

roadmap

## Roadmap Linkage

**Milestone:** "Подключение модификаторов"
**Rationale:** MODIFIERS (10 записей в data.ts) уже определены, но не подключены к completion/hover. Пользователь не получает автодополнение модификаторов (`.stop`, `.prevent`, `.debounce`) при вводе `.` после директивы и не видит hover-документацию для них. Это следующая приоритетная задача стабилизации после робастности парсера.

## Settings

- **Testing:** yes — регрессионные тесты для каждой новой функции (правило parsing.md: каждый edge-case → тест)
- **Logging:** verbose — DEBUG-логи в новых ветках completion/hover
- **Docs:** no — warn-only (внутренние изменения LSP-обработчиков, docs/features.md уже описывает completions)

## Анализ

### Проблема
Модификаторы живут в **имени** атрибута (`x-on:click.stop="..."`, `@click.prevent="..."`, `x-model.lazy="..."`), но:
1. `findAttrAtOffset` покрывает только **value**-диапазон (`valueOffset..valueOffset+valueLength`)
2. `AlpineAttr` хранит `valueOffset/valueLength`, но не позицию имени → нельзя определить, находится ли курсор в имени
3. `onCompletion` при триггере `.` ищет scope-members внутри значения — не различает `.` в имени (модификатор) и `.` в значении (member access)
4. `onHover` извлекает слово через `getWordAtOffset` (только `[\w$]`) — не захватывает `.stop`, а также вообще не обрабатывает имя атрибута (нет hover для самих директив `x-data`, `x-show`)

### Структура данных
```ts
// data.ts — уже есть, экспортировать в server.ts
export interface ModifierInfo {
  name: string;      // '.stop', '.prevent', '.debounce'
  for: string[];     // ['x-on'], ['x-on','x-model'], ['x-model']
  documentation: string;
}
export const MODIFIERS: ModifierInfo[];  // 10 записей

export interface DirectiveInfo { name: string; documentation: string; example?: string; }
export const DIRECTIVES: DirectiveInfo[];  // 17 записей
```

### Синтаксис модификаторов
- `x-on:click.stop` → base=`x-on`, event=`click`, modifiers=[`stop`]
- `@click.prevent` → normalizes to `x-on`, base after normalize
- `x-model.lazy.number` → base=`x-model`, modifiers=[`lazy`,`number`] (chained)
- `x-transition:enter` → это **sub-attribute** (через `:`), НЕ модификатор — не путать

## Задачи

### Task 1: Расширить AlpineAttr позицией имени + findAttrByNameAtOffset
- [x] **Файл:** `server/src/extractor.ts`
- [x] **Изменения:**
  - Добавить поля `nameOffset: number` и `nameLength: number` в интерфейс `AlpineAttr`
  - В `extractAlpineAttrs`: заполнить `nameOffset = match.index`, `nameLength = rawName.length`
  - Добавить функцию `findAttrByNameAtOffset(attrs, offset): AlpineAttr | null` — возвращает attr, если offset ∈ `[nameOffset, nameOffset+nameLength)`
- [x] **Тесты** (`test/test.js`, suite `'extractor: AlpineAttr name position'`):
  - `<div x-data="test">` → `nameOffset` указывает на `x`, `nameLength` = 5
  - `<button x-on:click.stop="fn()">` → `nameLength` = 14 (вся строка `x-on:click.stop`)
  - `findAttrByNameAtOffset` на offset внутри `x-data` → возвращает attr; на offset внутри `"test"` (value) → null
  - `findAttrByNameAtOffset` на offset между атрибутами → null
- [x] **Логирование:** без — pure функция, тесты покрывают

### Task 2: Резолвер базы директивы + извлечение модификатора из позиции
- [x] **Файл:** `server/src/extractor.ts`
- [x] **Изменения:**
  - Добавить `resolveDirectiveBase(attrName: string): string | null` — нормализует имя к базе директивы:
    - `x-on:click.stop` → `x-on`
    - `@click.prevent` → `x-on`
    - `x-model.lazy` → `x-model`
    - `:class` → `x-bind`
    - `x-data` → `x-data`
    - `x-unknown` → null (не в DIRECTIVES)
  - Добавить `getModifierAtOffset(attrName: string, relOffset: number): { modifier: string; base: string } | null`:
    - Если `relOffset` попадает на слово после `.` → возвращает `{modifier: 'stop', base: 'x-on'}`
    - Если `relOffset` на самом имени директивы (до первой `.` или `:`) → null (это директива, не модификатор)
- [x] **Тесты** (suite `'extractor: directive base resolver'`):
  - `resolveDirectiveBase('x-on:click.stop')` → `'x-on'`
  - `resolveDirectiveBase('@click')` → `'x-on'`
  - `resolveDirectiveBase('x-model.lazy.number')` → `'x-model'`
  - `resolveDirectiveBase(':class')` → `'x-bind'`
  - `resolveDirectiveBase('x-transition:enter')` → `'x-transition'` (база, sub-attr через `:` не отрезается)
  - `resolveDirectiveBase('x-unknown')` → `null`
  - `getModifierAtOffset('x-on:click.stop', 11)` → `{modifier: 'stop', base: 'x-on'}` (offset на `stop`)
  - `getModifierAtOffset('x-on:click.stop', 0)` → `null` (offset на `x-on`)
  - `getModifierAtOffset('@click.prevent', 7)` → `{modifier: 'prevent', base: 'x-on'}`

### Task 3: Completion модификаторов в имени атрибута
- [x] **Файл:** `server/src/server.ts`
- [x] **Изменения:**
  - Импортировать `MODIFIERS` и `DIRECTIVES` из `./data` (сейчас импортируется только `MAGIC_PROPERTIES`)
  - Импортировать `findAttrByNameAtOffset`, `resolveDirectiveBase` из `./extractor`
  - В `onCompletion`, **в самом начале** (до проверки `findAttrAtOffset` для value):
    1. Проверить `findAttrByNameAtOffset(attrs, offset)` — cursor в имени атрибута
    2. Если да → вычислить `relOffset = offset - attr.nameOffset`, `textBefore = attr.name.slice(0, relOffset)`
    3. Если `/\.\w*$/` матчит `textBefore` → это контекст модификатора:
       - `base = resolveDirectiveBase(attr.name)`
       - Фильтровать `MODIFIERS` где `base ∈ modifier.for`
       - Вернуть `CompletionItem[]` с `label: modifier.name` (`.stop`, `.prevent`), `kind: CompletionItemKind.EnumMember`, `detail: 'Modifier for ' + base`, `documentation: modifier.documentation`
    4. Если `.` ещё не введён (cursor на самой директиве) → НЕ возвращать модификаторы (пусть IDE продолжает печатать); вернуть `[]`
  - **ВАЖНО:** этот блок должен быть ДО существующего value-region кода, чтобы `.`-trigger в имени не падал в scope-member completion
- [x] **Тесты** (suite `'onCompletion: modifiers'` через `createTestServer`):
  - `<button x-on:click.|` → completion содержит `.stop`, `.prevent`, `.outside`, `.window`, `.document`, `.once`, `.debounce`, `.throttle` (8 модификаторов для x-on)
  - `<button x-on:click.s|` → `.stop` присутствует в результате (Zed фильтрует по prefix на клиенте)
  - `<input x-model.|` → completion содержит `.lazy`, `.number`, `.debounce`, `.throttle` (4 для x-model)
  - `<button x-on:click="test.|">` → НЕ возвращает модификаторы (cursor в value, не в имени) — возвращает scope-members как раньше
  - `<div x-data="..." |` → cursor после `=` начала value — НЕ возвращает модификаторы
  - `<button x-on:click>` (cursor на `x-on`, без точки) → `[]` (модификаторы не предлагаются до ввода `.`)

### Task 4: Hover для модификаторов и директив в имени атрибута
- [x] **Файл:** `server/src/server.ts`
- [x] **Изменения:**
  - В `onHover`, **в самом начале** (до существующих value-region проверок):
    1. Проверить `findAttrByNameAtOffset(attrs, offset)` — cursor в имени
    2. Если да:
       - `relOffset = offset - attr.nameOffset`
       - Сначала попробовать `getModifierAtOffset(attr.name, relOffset)`:
         - Если вернул модификатор → найти в `MODIFIERS` по имени `.${modifier.modifier}`, вернуть hover `{contents: [{language: 'plaintext', value: modifier.name}, modifier.documentation + ' (for ' + modifier.for.join('/') + ')']}`
       - Если модификатор не найден → попробовать hover для директивы:
         - Найти `DIRECTIVES.find(d => d.name === resolveDirectiveBase(attr.name))`
         - Если найдена → вернуть hover `{contents: [{language: 'plaintext', value: directive.name}, directive.documentation + (directive.example ? '\n\nExample: ' + directive.example : '')]}`
       - Если ничего не найдено → return null (провалиться к существующей логике)
  - **ВАЖНО:** блок имени должен идти ДО value-region блока, чтобы курсор на `x-data` (имя) не проваливался в value-логику
- [x] **Тесты** (suite `'onHover: directives and modifiers'`):
  - Hover на `x-data` в `<div x-data="{ open: false }">` → показывает "Declares a new Alpine component scope."
  - Hover на `x-show` в `<div x-show="open">` → показывает "Toggles `display:none` based on expression truthiness."
  - Hover на `stop` в `<button x-on:click.stop="fn()">` → показывает "Equivalent to `event.stopPropagation()`." + "(for x-on)"
  - Hover на `prevent` в `<button @click.prevent="fn()">` → показывает "Equivalent to `event.preventDefault()`."
  - Hover на `lazy` в `<input x-model.lazy="val">` → показывает "Only sync on `change` event (not `input`)." + "(for x-on/x-model)"
  - Hover на `open` в `<div x-data="{ open: false }">` (cursor в VALUE) → существующая логика (member hover) работает, НЕ директива
  - Hover на `x-transition` в `<template x-transition:enter>` → показывает "Adds enter/leave CSS transitions." (база, `:enter` не ломает резолв)

## Commit Plan

4 задачи (< 5) — единый коммит в конце:
```
feat(lsp): wire MODIFIERS and DIRECTIVES to completion and hover

- onCompletion: suggest modifiers (.stop/.prevent/.debounce) when typing
  after '.' in attribute name region (x-on:click.|), filtered by directive
- onHover: show modifier documentation on .stop/.prevent/etc. and directive
  documentation on x-data/x-show/etc. in attribute name region
- extractor: extend AlpineAttr with nameOffset/nameLength, add
  findAttrByNameAtOffset, resolveDirectiveBase, getModifierAtOffset
- 20+ regression tests across extractor and server handlers
```

## Проверка выполнения

- [x] `cd server && npm run build` — без ошибок TypeScript
- [x] `node test/test.js` — 124 теста (89 существующих + 35 новых), 0 failed
- [x] Существующие completion/hover тесты не сломаны (regression)
- [x] Все 4 чекбокса выше отмечены
- [x] ROADMAP.md milestone отмечен `[x]`, добавлен в Completed таблицу
