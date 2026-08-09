# План: Полнота базы директив

**Ветка:** main (без веток — `git.create_branches: false`)
**Создан:** 2026-08-09
**Milestone:** Полнота базы директив (ROADMAP.md, Стабилизация)

## Original Request

roadmap

## Roadmap Linkage

**Milestone:** "Полнота базы директив"
**Rationale:** Синхронизация базы данных LSP (DIRECTIVES, MODIFIERS) с Alpine 3.x. Текущая база неполна: не хватает `x-id` directive, `x-transition:*` sub-attributes, behavior modifiers (`.self`, `.capture`, `.passive`, `.trim`, `.boolean`), и examples у большинства директив. Цель — hover и completion отражают актуальный Alpine 3.x API.

## Settings

- **Testing:** yes — регрессионные тесты для каждой новой записи (правило parsing.md)
- **Logging:** verbose
- **Docs:** no — warn-only (данные в data.ts, docs/features.md уже описывает возможности)

## Анализ

### Текущее состояние (из audit)
- **DIRECTIVES:** 17 записей, `x-modelable` уже присутствует. **Не хватает:** `x-id`. **12 из 17** без `example` поля.
- **MODIFIERS:** 10 записей. Не хватает behavior modifiers для x-on (`.self`, `.capture`, `.passive`, `.camel`), x-model (`.trim`, `.boolean`, `.fill`), x-show (`.important`, `.immediate`).
- **x-transition:** только базовая запись. Sub-attributes (`:enter`, `:enter-start`, `:enter-end`, `:leave`, `:leave-start`, `:leave-end`) не документированы. `resolveDirectiveBase` срезает `:enter` → показывает generic `x-transition` hover.
- **Ключевые модификаторы** (`.enter`, `.escape`, `.tab` и т.д.) — НЕ добавляем: их 30+, они self-explanatory, и замусорят completion list.

### Источник
Alpine 3.x source code: `packages/alpinejs/src/directives/index.js`, `utils/on.js`, `x-model.js`, `x-show.js` (commit `bc956c22`).

## Задачи

### Task 1: DIRECTIVES — добавить `x-id` + examples для существующих
- [x] **Файл:** `server/src/data.ts`
- [x] **Изменения:**
  - Добавить запись `x-id` в DIRECTIVES:
    - `name: 'x-id'`
    - `documentation: 'Declares a scope for $id() unique ID generation.'`
    - `example: 'x-id="user"'`
  - Добавить `example` поле директивам где его нет (12 штук). Примеры из Alpine docs:
    - `x-init`: `x-init="init()"` (вызов функции)
    - `x-show`: `x-show="open"`
    - `x-model`: `x-model="name"`
    - `x-text`: `x-text="message"`
    - `x-html`: `x-html="<strong>bold</strong>"`
    - `x-ref`: `x-ref="button"`
    - `x-if`: `x-if="show"` (на `<template>`)
    - `x-for`: `x-for="item in items"` (на `<template>`)
    - `x-effect`: `x-effect="update()"`
    - `x-transition`: `x-show="open" x-transition`
    - `x-cloak`: `x-cloak` (без значения)
    - `x-teleport`: `x-teleport="#modal-container"`
    - `x-ignore`: `x-ignore`
  - **НЕ менять** существующие example поля (x-data, x-bind, x-on)
- [x] **Тесты** (`test/test.js`, suite `'data: DIRECTIVES completeness'`):
  - `DIRECTIVES.find(d => d.name === 'x-id')` существует и имеет documentation + example
  - Все 17+1=18 директив имеют documentation (непустая строка)
  - Минимум 15 из 18 имеют example (непустая строка)
  - `resolveDirectiveBase('x-id')` → `'x-id'` (verify в extractor test suite)
  - Hover тест: hover на `x-id` в `<div x-id="user">` показывает documentation

### Task 2: x-transition sub-attributes для hover
- [x] **Файлы:** `server/src/data.ts`, `server/src/server.ts`
- [x] **Изменения:**
  - В `data.ts` добавить `TRANSITION_SUBS` массив (6 записей):
    ```ts
    export interface TransitionSubAttr { name: string; documentation: string; }
    export const TRANSITION_SUBS: TransitionSubAttr[] = [
      { name: ':enter', documentation: 'CSS classes applied during the entire entering phase.' },
      { name: ':enter-start', documentation: 'Added before element is inserted, removed one animation frame after.' },
      { name: ':enter-end', documentation: 'Added one frame after insertion, removed when transition finishes.' },
      { name: ':leave', documentation: 'CSS classes applied during the entire leaving phase.' },
      { name: ':leave-start', documentation: 'Added immediately on leave trigger, removed after one frame.' },
      { name: ':leave-end', documentation: 'Added one frame after leave trigger, removed when transition finishes.' },
    ];
    ```
  - В `server.ts` (onHover name-region block): **перед** fallback на `resolveDirectiveBase`, проверить full colon-qualified имя:
    1. Если `attr.name` начинается с `x-transition:` → извлечь sub-attr часть (`:enter`, `:enter-start` и т.д.)
    2. Найти в `TRANSITION_SUBS` по имени
    3. Если найдено → вернуть hover `{contents: ['x-transition' + sub.name, sub.documentation + '\n\nSee: x-transition']}`
    4. Если не найдено → fall through к существующему `resolveDirectiveBase` → показывает generic `x-transition` hover
  - **ВАЖНО:** не ломать существующий hover на base `x-transition` (без sub-attr) — должен показывать generic документацию
- [x] **Тесты** (suite `'onHover: x-transition sub-attributes'`):
  - Hover на `x-transition:enter` → показывает "CSS classes applied during the entire entering phase."
  - Hover на `x-transition:leave-start` → показывает "Added immediately on leave trigger..."
  - Hover на `x-transition` (без sub-attr) → показывает generic "Adds enter/leave CSS transitions." (не сломан)
  - Hover на `x-transition:unknown` → fall through к generic x-transition hover (не null)

### Task 3: MODIFIERS — добавить недостающие behavior modifiers
- [x] **Файл:** `server/src/data.ts`
- [x] **Изменения:**
  - Добавить в MODIFIERS (9 новых записей):
    - x-on behavior: `{name:'.self', for:['x-on'], documentation:'Only trigger if event.target is the element itself (not a child).'}` 
    - `{name:'.capture', for:['x-on'], documentation:'Listen during capture phase (before bubbling).'}` 
    - `{name:'.passive', for:['x-on'], documentation:'Mark listener as passive for performance (cannot call preventDefault).'}` 
    - `{name:'.camel', for:['x-on'], documentation:'Convert event name from kebab-case to camelCase (e.g. custom-event → customEvent).'}` 
    - x-model: `{name:'.trim', for:['x-model'], documentation:'Trim whitespace from the input value.'}` 
    - `{name:'.boolean', for:['x-model'], documentation:'Coerce value to a JS boolean (accepts true/false/1/0).'}` 
    - `{name:'.fill', for:['x-model'], documentation:'Populate empty bound property from element\'s value attribute.'}` 
    - x-show: `{name:'.important', for:['x-show'], documentation:'Set display:none !important instead of display:none.'}` 
    - `{name:'.immediate', for:['x-show'], documentation:'Show/hide immediately without transition animation.'}` 
  - Итого MODIFIERS: 10 + 9 = 19 записей
- [x] **Тесты** (расширить suite `'onCompletion: modifiers'` и `'onHover: directives and modifiers'`):
  - Completion: `<button x-on:click.|` теперь содержит `.self`, `.capture`, `.passive`, `.camel` (в дополнение к существующим 8)
  - Completion: `<input x-model.|` теперь содержит `.trim`, `.boolean`, `.fill` (в дополнение к 4)
  - Completion: `<div x-show.|` содержит `.important`, `.immediate` (новые для x-show)
  - Hover: hover на `.self` в `x-on:click.self` → показывает "Only trigger if event.target is the element itself"
  - Hover: hover на `.trim` в `x-model.trim` → показывает "Trim whitespace from the input value."
  - Hover: hover на `.important` в `x-show.important` → показывает "Set display:none !important"

## Commit Plan

3 задачи (< 5) — единый коммит:
```
feat(data): sync directive and modifier database with Alpine 3.x

- Add x-id directive, enrich 12 directives with example fields
- Add TRANSITION_SUBS for x-transition:enter/leave sub-attribute hover
- Add 9 missing modifiers: .self/.capture/.passive/.camel (x-on),
  .trim/.boolean/.fill (x-model), .important/.immediate (x-show)
- Regression tests for all new entries
```

## Проверка выполнения

- [x] `cd server && npm run build` — без ошибок TypeScript
- [x] `node test/test.js` — 140 тестов (124 существующих + 16 новых), 0 failed
- [x] Существующие completion/hover тесты не сломаны (regression)
- [x] ROADMAP.md milestone отмечен `[x]`, добавлен в Completed таблицу
