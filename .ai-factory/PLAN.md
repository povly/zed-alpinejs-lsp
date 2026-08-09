# План: Tree-sitter injection + data.ts gaps + PHP support

**Режим:** Fast  
**Дата:** 2026-08-09  
**Веткa:** main (create_branches = false)

## Original Request

Оба сразу, и хочу чтобы работало везде - html, blade, php!

## Settings

- **Testing:** Да — структурные тесты (extension.toml валидность, .scm файлы exist, data.ts покрытие)
- **Logging:** Verbose
- **Docs:** Нет (warn-only)

## Roadmap Linkage

- **Milestone:** "Semantic Tokens — цветовое выделение директив (x-*), magic properties ($*), модификаторов (.prevent)"
- **Rationale:** Tree-sitter injection queries и highlights.scm напрямую решают milestone — подсветка Alpine директив отдельно от обычных HTML атрибутов. Дополнение data.ts расширяет LSP покрытие.

## Контекст исследований

### Tree-sitter injection — архитектурное ограничение Zed

Zed Extension API **не позволяет** добавлять `.scm` queries к существующим языкам. Нужно регистрировать новый язык. Однако `grammar = "html"` в `config.toml` reuses built-in HTML tree-sitter grammar по имени.

### Текущий статус по форматам

| Формат | LSP сейчас | Tree-sitter injection сейчас | После плана |
|--------|:---:|:---:|:---:|
| `.html` | ✅ | ❌ | ✅ + ✅ |
| `.blade.php` | ✅ | ✅ (Blade extension) | ✅ + ✅ |
| `.php` | ❌ | ❌ | ✅ + ❌ |

PHP tree-sitter injection требует кастомный PHP grammar — за рамками этого плана.

### Аудит Alpine.js API — пробелы в data.ts

- **Модификаторы:** 11 пропущено из ~30 (x-on: `.dot`, `.passive.false`; x-model: `.change`, `.blur`, `.enter`; x-transition: `.duration`, `.delay`, `.opacity`, `.scale`, `.origin`)
- **Global APIs:** 9 пропущено из 9 (`Alpine.data`, `.store`, `.bind`, `.start`, `.plugin`, `.directive`, `.magic`, `.reactive`, `.effect`)
- **Директивы / Magic / Transition subs:** полностью покрыто (18/18, 10/10, 6/6)

---

## Tasks

### Фаза 1: Tree-sitter injection (HTML (Alpine) language)

#### Task 1: Создать languages/html-alpine/ структуру

**Файлы:** `languages/html-alpine/config.toml`, `languages/html-alpine/injections.scm`, `languages/html-alpine/highlights.scm`

**config.toml** — по образцу alpine-syntax:
```toml
name = "HTML (Alpine)"
grammar = "html"
path_suffixes = ["html", "htm"]
completion_query_characters = ["-", ":", "@", "$"]
```

**injections.scm** — JS подсветка внутри Alpine атрибутов. Адаптировать из alpine-syntax + Blade extension:
- `x-data`, `x-init`, `x-show`, `x-if`, `x-for`, `x-text`, `x-html`, `x-effect`, `x-modelable`, `x-intersect` → `injection.language "javascript"`
- `x-bind:*`, `x-model:*` → `injection.language "javascript"`
- `x-on:*` → `injection.language "javascript"`
- Shorthand `@event="..."` → `injection.language "javascript"`
- Shorthand `:attr="..."` → `injection.language "javascript"`
- Стандартные HTML injections: `<script>`, `<style>`, `style=`, `on*=` (скопировать из built-in HTML чтобы не потерять)

**highlights.scm** — Alpine директивы визуально отделены:
- `(attribute_name) @keyword` для `^x-`, `^:`, `^@` паттернов
- Стандартные HTML highlight queries (скопировать из built-in HTML)

**MUST DO:**
- Скопировать стандартные HTML injections/highlights из Zed built-in HTML extension, чтобы не потерять существующую подсветку
- `x-teleport`, `x-ref`, `x-transition` — НЕ инжектить JS (значения не JS-выражения), как в Blade extension

**MUST NOT DO:**
- Не регистрировать path_suffixes для `.blade.php` или `.php` — это конфликтует с Blade/PHP грамматиками

---

#### Task 2: Обновить extension.toml — grammar + language registration

**Файл:** `extension.toml`

Изменения:
1. Добавить секцию `[grammars.html]` — registered tree-sitter HTML grammar (repository + commit из Zed built-in HTML extension)
2. Изменить `languages` в `[language_servers.alpine-language-server]` — добавить `"HTML (Alpine)"` и `"PHP"`:
```toml
[language_servers.alpine-language-server]
name = "Alpine Language Server"
languages = ["Blade", "HTML", "HTML (Alpine)", "PHP"]
```

**MUST DO:**
- Grammar commit hash взять из Zed built-in HTML extension: `tree-sitter/tree-sitter-html` commit `bfa075d83c6b97cd48440b3829ab8d24a2319809`
- Проверить что добавление "PHP" не конфликтует с Intelephense — Zed поддерживает несколько LSP серверов на один язык

**MUST NOT DO:**
- Не удалять существующие "Blade" и "HTML" из languages — backward compatibility

**Контекст:** [Zed multi-LSP per language docs](https://zed.dev/docs/languages) — подтверждает что несколько language_servers могут обслуживать один язык одновременно.

---

### Фаза 2: Дополнение data.ts

#### Task 3: Добавить 11 недостающих модификаторов в data.ts

**Файл:** `server/src/data.ts`

Добавить в массив `MODIFIERS`:

| Модификатор | appliesTo | Описание |
|-------------|-----------|----------|
| `.dot` | `["x-on"]` | Converts dashes to dots in event name |
| `.passive.false` | `["x-on"]` | Makes touch/wheel events cancelable (allows preventDefault) |
| `.change` | `["x-model"]` | Syncs on native `change` event |
| `.blur` | `["x-model"]` | Syncs when input loses focus |
| `.enter` | `["x-model"]` | Syncs when user presses Enter |
| `.duration` | `["x-transition"]` | Customize duration: `x-transition.duration.500ms` |
| `.delay` | `["x-transition"]` | Delay transition: `x-transition.delay.50ms` |
| `.opacity` | `["x-transition"]` | Only transition opacity (no scale) |
| `.scale` | `["x-transition"]` | Only transition scale (no opacity) |
| `.origin` | `["x-transition"]` | Scale origin: top/bottom/left/right |

> `.scale.N` и `.origin.*` — динамические значения, регистрируем base name `.scale` и `.origin`.

**MUST DO:**
- Каждый модификатор: `name`, `appliesTo`, `description`, `example` (как существующие)
- Hover должен работать для `.duration`, `.delay` и т.д. через `getModifierAtOffset`

**MUST NOT DO:**
- Не добавлять плагинные модификаторы (@alpinejs/*) — за рамками core Alpine

---

#### Task 4: Добавить 9 Global APIs в data.ts

**Файл:** `server/src/data.ts`

Создать новый массив `GLOBAL_APIS` (по аналогии с `DIRECTIVES`):

```typescript
export interface GlobalApi {
  name: string;           // "Alpine.data"
  signature: string;      // "Alpine.data(name, callback)"
  description: string;    // markdown docs
  example?: string;       // usage example
}
export const GLOBAL_APIS: GlobalApi[] = [ ... ]
```

9 APIs:
| Name | Signature |
|------|-----------|
| `Alpine.data` | `Alpine.data(name, callback)` |
| `Alpine.store` | `Alpine.store(name, object)` |
| `Alpine.bind` | `Alpine.bind(callback)` |
| `Alpine.start` | `Alpine.start()` |
| `Alpine.plugin` | `Alpine.plugin(callback)` |
| `Alpine.directive` | `Alpine.directive(name, callback)` |
| `Alpine.magic` | `Alpine.magic(name, callback)` |
| `Alpine.reactive` | `Alpine.reactive(object)` |
| `Alpine.effect` | `Alpine.effect(callback)` |

**MUST DO:**
- Описания из официальной документации alpinejs.dev/globals/* и alpinejs.dev/advanced/*
- Example для каждого (реальный usage)

**MUST NOT DO:**
- Не добавлять internal/undocumented APIs (`Alpine.addScopeToNode`, `Alpine.closestDataStack` и т.д.)

---

#### Task 5: Wire Global APIs в server.ts — hover и completion

**Файл:** `server/src/server.ts`

**Hover:** в `onHover` — если слово матчит `Alpine.\w+`, искать в `GLOBAL_APIS`, вернуть signature + description.

**Completion:** в `onCompletion` — если пользователь печатает `Alpine.`, предложить все global APIs как CompletionItem (Kind.Function).

**MUST DO:**
- Добавить detection: `const globalMatch = word.match(/^Alpine\.(\w+)$/);`
- Добавить GLOBAL_APIS import в server.ts
- Логирование: `this.connection.console.info('[hover] global API: ' + api.name)` (verbose level)

**MUST NOT DO:**
- Не добавлять go-to-definition для `Alpine.*` вызовов — это отдельная задача (workspace.ts уже сканирует registrations, но go-to-def для arbitrary `Alpine.plugin()` вызовов — за рамками)

---

### Фаза 3: Тесты и сборка

#### Task 6: Структурные тесты для tree-sitter queries

**Файл:** `test/test.js`

Добавить suite `"tree-sitter language files"`:
- `existsSync('languages/html-alpine/config.toml')` → true
- `existsSync('languages/html-alpine/injections.scm')` → true
- `existsSync('languages/html-alpine/highlights.scm')` → true
- Парсить config.toml — проверить `name`, `grammar` поля
- Проверить что injections.scm содержит `injection.language` и `javascript`

**MUST DO:**
- Использовать существующий test harness (test helpers)
- Группа в `suite("tree-sitter language files", () => { ... })`

**MUST NOT DO:**
- Не парсить .scm файлы как tree-sitter queries — это требует WASM runtime

---

#### Task 7: Тесты для новых модификаторов и global APIs

**Файл:** `test/test.js`

Добавить suite `"data.ts coverage"`:
- Test: все 11 новых модификаторов присутствуют в `MODIFIERS` (name, appliesTo, description не пустой)
- Test: все 9 global APIs присутствуют в `GLOBAL_APIS` (name, signature, description не пустой)
- Test: `MODIFIERS` totalCount >= 29 (19 существующих + 10 новых, `.scale.N` считается как `.scale`)
- Test: `GLOBAL_APIS.length === 9`

---

#### Task 8: Сборка и проверка

- `cd server && npm run build` — tsc strict, 0 errors
- `node test/test.js` — Failed: 0
- Проверить `extension.toml` валидность — `cargo check` (Rust компиляция с zed_extension_api)
- `cargo build --release` — успешно, extension.wasm создан

**Контекст:** AGENTS.md правило — «Сборка перед коммитом: пересобирать server/dist/ через npm run build после изменений TS — dist коммичится и встраивается в WASM».

---

## Commit Plan

3 коммита (8 задач, checkpoint каждые 2-3 задачи):

1. **`feat: add tree-sitter injection for HTML (Alpine) language + PHP LSP support`**
   - Tasks 1, 2 (languages/html-alpine/* + extension.toml grammar registration)

2. **`feat: add 11 missing modifiers + 9 global APIs to data.ts`**
   - Tasks 3, 4, 5 (data.ts additions + server.ts wiring)

3. **`test: add structural tests for tree-sitter files + data.ts coverage`**
   - Tasks 6, 7, 8 (tests + build verification)
