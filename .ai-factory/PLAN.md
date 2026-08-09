# Implementation Plan: Робастность парсера

Branch: main
Created: 2026-08-09

## Original Request
roadmap

## Settings
- Testing: yes  # каждый edge-case → регрессионный тест (правило parsing.md)
- Logging: verbose
- Docs: no  # внутренние изменения парсера, docs не требуют обновления

## Roadmap Linkage
Milestone: "Робастность парсера"
Rationale: Третий milestone фазы стабилизации — устраняет известные false-positives regex-парсеров (spread, computed keys, строки) до добавления диагностики.

## Tasks

### Phase 1: parseXData edge-cases (xdata.ts)

- [x] **Task 1: Spread operator `{...x}` — skip spread targets**
  - Проблема: `shortRegex = /\b(\w+)\s*([,}])/g` в `parseXData` матчит `config` в `{ ...config, open: false }` — FALSE POSITIVE, `config` из spread не должен быть member
  - Фикс: перед добавлением shorthand-property проверить, что символ(ы) перед именем НЕ `...`. Добавить проверку: если `value.slice(match.index - 3, match.index) === '...'` → skip (spread target)
  - Регрессионные тесты в `test/test.js` suite `'parseXData edge-cases'`:
    - `{ ...defaults, override: true }` → `defaults` НЕ в members, `override` в members
    - `{...config}` (spread only) → `config` НЕ в members
    - `{ a: 1, ...b, c: 2 }` → `a`, `c` в members, `b` НЕ в members
  - Files: `server/src/xdata.ts`, `test/test.js`
  - LOGGING: `[parseXData] skipping spread target: <name>` при DEBUG

- [x] **Task 2: Computed keys `[expr]:` — skip gracefully**
  - Проблема: `{ [Symbol.iterator]: fn, open: false }` — computed key `[...]` не должен добавляться как member. `propRegex = /\b(\w+)\s*:/g` может матчить `iterator` внутри `[Symbol.iterator]:` если `\b` срабатывает после `.`
  - Фикс: перед добавлением property проверить, что символ перед именем НЕ `[` или `.` (computed key context). Проверка: `value[match.index - 1]` не должен быть `[` или `.`
  - Регрессионные тесты:
    - `{ [Symbol.iterator]: fn, open: false }` → `open` в members, `Symbol`/`iterator` НЕ в members
    - `{ ['dynamic-' + key]: value, name: 'test' }` → `name` в members, `dynamic`/`key` НЕ в members
    - `{ [0]: 'first', items: [] }` → `items` в members, `0` НЕ в members
  - Files: `server/src/xdata.ts`, `test/test.js`
  - LOGGING: `[parseXData] skipping computed key context: <name>` при DEBUG

- [x] **Task 3: String false-positives — improve in-string detection**
  - Проблема: `shortRegex` проверяет только `charBefore` (символ прямо перед match). Для `'hello, world}'` — `world` preceded by space (внутри строки), charBefore=space, НЕ кавычка → FALSE POSITIVE
  - Фикс: заменить простую `charBefore` проверку на полноценный in-string scan. Перед добавлением shorthand-property проверить, что match.index НЕ внутри строки (одиночной/двойной/backtick). Реализовать helper `isInsideString(text, offset)` который сканирует от начала текста до offset, отслеживая in-string состояние (с учётом escape `\\`)
  - Регрессионные тесты:
    - `{ msg: 'hello, world}', open: false }` → `open` в members, `world` НЕ в members
    - `{ a: "foo, bar}", b: 1 }` → `a`, `b` в members, `foo`/`bar` НЕ в members
    - `{ tpl: `template, end`}` → `tpl` в members, `template`/`end` НЕ в members
    - Existing passing tests остаются зелёными (не регрессия)
  - Files: `server/src/xdata.ts`, `test/test.js`
  - LOGGING: `[parseXData] skipping in-string match: <name> at offset <N>` при DEBUG

### Phase 2: extractor.ts robustness

- [x] **Task 4: matchBraces — handle block comments `/* */` и template interpolation `${}`**
  - Проблема 1: `matchBraces` обрабатывает line comments `//`, но НЕ block comments `/* */`. `{ /* } not a brace */ open: false }` — `}` внутри block comment воспринимается как closing brace → depth уходит в минус, парсинг ломается
  - Проблема 2: template literals с интерполяцией `` `prefix${expr}` `` — `${` содержит `{`, который matchBraces может посчитать за открытие nested object. А `}` в `${...}` закрывает interpolation, не object
  - Фикс в `matchBraces` (extractor.ts):
    - Block comments: при встрече `/*` вне строки — skip до `*/`
    - Template interpolation: при встрече `${` внутри backtick-string — отслеживать баланс `${...}` (не считать `{` и `}` внутри interpolation как object braces)
  - Регрессионные тесты в suite `'matchBraces edge-cases'`:
    - `matchBraces('{ /* } fake close */ open: false }', 0)` → возвращает offset последнего `}`, не fake
    - `matchBraces('{ msg: `text ${expr}` }', 0)` → корректный closing brace, `${expr}` не ломает depth
    - `matchBraces('{ a: "/* not comment */", b: 2 }', 0)` → `/*` внутри строки НЕ treated as comment
  - Files: `server/src/extractor.ts`, `test/test.js`
  - LOGGING: `[matchBraces] skipping block comment at <offset>` / `[matchBraces] template interpolation at <offset>` при DEBUG

## Заметки по реализации

- **Порядок сборки:** после изменений в `server/src/*.ts` → `cd server && npm run build` → затем `node test/test.js` (тесты импортируют из `server/dist/`)
- **Не ломать существующие 74 теста** — каждый фикс должен быть обратно-совместим. Если фикс меняет поведение существующего теста — это регрессия, нужно явно обновить тест с обоснованием
- **Регрессионные тесты — обязательны** (правило parsing.md): каждый edge-case получает свой test case
- **Helper `isInsideString`** (Task 3) должен быть pure function — без side effects, принимает `(text, offset)`, возвращает `boolean`. Можно вынести в xdata.ts или общий util
