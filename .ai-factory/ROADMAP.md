# Roadmap проекта

> Языковой сервер Alpine.js для Zed — от рабочего MVP к production-quality LSP с диагностикой, навигацией и рефакторингом

## Milestones

### Стабилизация (приоритет)

- [x] **Core LSP MVP** — hover, go-to-definition, completion, workspace indexer, Blade-толерантность (v0.1.0)
- [x] **Расширение тестового покрытия** — unit-тесты для server.ts (LSP-обработчики) и workspace.ts (индексатор); test-харнес для интеграционных тестов LSP запрос→ответ. Сейчас покрыты только extractor + xdata
- [x] **Робастность парсера** — edge-cases: spread `{...x}`, computed keys `[expr]:`, false-positives shorthand-regex в строках. Каждый кейс → регрессионный тест (правило parsing.md)
- [x] **Подключение модификаторов** — MODIFIERS (10 записей в data.ts) уже есть, но не wired к completion/hover. Добавить триггер `.` после директивы + hover для `.stop`, `.prevent`, `.debounce` и др.
- [x] **Полнота базы директив** — синхронизация с Alpine 3.x: добавить `x-modelable`, под-атрибуты `x-transition:*`, документация для комбинаций `x-on.debounce`, `x-model.lazy.number`
- [x] **Инкрементальная индексация воркспейса** — заменить полную перестройку `rebuildIndexes()` на каждое `onDidChangeContent` на debounced инкрементальное обновление только изменённого документа
- [x] **Наблюдаемость ошибок** — заменить молчаливые `catch { /* skip */ }` на `connection.console.warn` с контекстом; метрики производительности индексации

### Новые LSP-возможности (после стабилизации)

- [ ] **Диагностика: базовые правила** — `x-if`/`x-for` вне `<template>`, несколько `x-data` на одном элементе, `x-data="name"` без регистрации `Alpine.data(name)` в воркспейсе
- [ ] **Диагностика: scope-aware** — undefined method/property в `@click`/`x-data` scope с fuzzy-подсказками ("did you mean 'toggle()'?"), unknown `$store.name`, unknown magic property
- [ ] **Document Symbols** — outline x-data scope: методы/свойства как `SymbolKind.Method`/`Property`; регистрации `Alpine.data()`/`store()` как `SymbolKind.Function`. Низкий effort — парсинг уже есть
- [ ] **Document Links** — кликабельные `x-data="cart"` → `Alpine.data('cart')` регистрация; `$store.ui` → `Alpine.store('ui')`. Надстройка над существующим onDefinition
- [ ] **References + Rename** — find usages + rename для `x-ref`, компонентов `Alpine.data()`, stores `Alpine.store()`. Паритет с vscode-alpinejs-toolkit

### Долгосрочные возможности (дифференциация)

- [x] **Semantic Tokens** — цветовое выделение директив (`x-*`), magic properties (`$*`), модификаторов (`.prevent`) отдельно от HTML-атрибутов. Реализовано через tree-sitter injection queries (injections.scm + highlights.scm) вместо LSP semantic tokens — тот же визуальный результат через механизм Zed extension
- [ ] **Code Actions** — извлечение inline `x-data="{...}"` в `Alpine.data()` регистрацию; quick-fix для directive misuse; `:class` ternary → object syntax

## Completed

| Milestone | Date |
|-----------|------|
| Core LSP MVP | 2026-08-09 |
| Расширение тестового покрытия | 2026-08-09 |
| Робастность парсера | 2026-08-09 |
| Подключение модификаторов | 2026-08-09 |
| Полнота базы директив | 2026-08-09 |
| Инкрементальная индексация воркспейса | 2026-08-09 |
| Наблюдаемость ошибок | 2026-08-09 |
| Semantic Tokens (tree-sitter) | 2026-08-09 |
