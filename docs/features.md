[← Getting Started](getting-started.md) · [Back to README](../README.md) · [Architecture →](architecture.md)

# Features

Alpine.js LSP provides four core capabilities across HTML (`.html`, `.htm`) and Blade (`.blade.php`) files.

## Hover Documentation

Hover over any Alpine directive or magic property to see inline documentation and signature.

| You hover over | You see |
|----------------|---------|
| `x-data` | "Declares a new Alpine component scope." |
| `x-show` | "Toggles `display:none` based on expression truthiness." |
| `@click` / `x-on:click` | "Attaches an event listener." |
| `x-model` | "Two-way data binding for form inputs." |
| `$el` | `$el: HTMLElement` — the DOM element the directive is attached to |
| `$refs` | `$refs: Record<string, HTMLElement>` — elements marked with `x-ref` |
| `$dispatch` | `$dispatch(name, detail?, bubbles?)` — dispatch a custom browser event |
| `$watch` | `$watch(property, callback)` — watch a component property |

For component registration names (`x-data="cart"`), hover shows the source file and member list from `Alpine.data('cart', ...)`.

## Go-to-Definition

Jump from a reference to its definition — even across files.

### Inline `x-data` object literals

```html
<div x-data="{ open: false, toggle() { this.open = !this.open } }">
  <button @click="toggle()">Toggle</button>
                     ^^^^^^^ ← go-to-definition jumps here
</div>
```

**Jump target:** the `toggle` method definition inside the same `x-data` block.

### Registered `Alpine.data()` components

```js
// resources/js/alpine.js
Alpine.data('tabs', () => ({
  active: 1,
  select(n) { this.active = n },
}))
```

```blade
<!-- resources/views/dashboard.blade.php -->
<div x-data="tabs">
  <button @click="select(1)">Tab 1</button>
             ^^^^^^ ← go-to-definition jumps to resources/js/alpine.js
</div>
```

**Jump target:** the `select` method inside the `Alpine.data('tabs', ...)` registration — in a different file.

### `Alpine.store()` registrations

Same flow as `Alpine.data()` — `x-data="$store.settings"` resolves to the matching `Alpine.store('settings', { ... })` registration.

## Completions

### Magic properties

Type `$` inside any Alpine attribute to get the full magic property list:

```html
<input x-on:input="$" />
                   ^ — completions:
                       $el, $refs, $event, $dispatch, $nextTick,
                       $watch, $store, $root, $data, $id
```

Each completion includes the signature and documentation inline.

### Scope members

Type `.` to see methods and properties from the enclosing `x-data` scope:

```html
<div x-data="{ open: false, toggle() {}, init() {} }">
  <button @click="this." />
                      ^ — completions: open, toggle(), init()
</div>
```

Scope resolution supports both inline `x-data="{ ... }"` and registered `Alpine.data('name', ...)` components.

### Cross-file workspace members

When the workspace has indexed `Alpine.data()` / `Alpine.store()` registrations across the project, their members appear in completions regardless of which file you're editing — with a `detail` showing the source file.

## Workspace Indexer

On server initialization (`onInitialize`), the workspace is scanned for symbol definitions.

### What gets indexed

| Source | Example | Indexed as |
|--------|---------|------------|
| Inline `x-data="{ ... }"` | `{ open: false, toggle() {} }` | Local scope members |
| `Alpine.data('name', () => ({ ... }))` | `Alpine.data('cart', ...)` | Registered component + its members |
| `Alpine.store('name', { ... })` | `Alpine.store('settings', ...)` | Global store + its members |

### Scanned file types

`.js`, `.ts`, `.jsx`, `.tsx`, `.html`, `.blade.php`, `.php`

### Skipped directories

`node_modules`, `.git`, `vendor`, `dist`, `build`, `.next`, `.nuxt`, `storage`, `bootstrap/cache`, `public`

> Maximum scan depth: 10 directory levels. Symbols are indexed in memory and available for hover, definition, and completion across all open files.

## Blade-specific Handling

The attribute extractor understands Blade templating syntax mixed with Alpine:

```blade
<div x-data="{ open: @json($isOpen) }">
  <button @click="$dispatch('toggle', {{ $id }})">Toggle</button>
</div>

<div x-data="cart({{ Js::from(['items' => $items]) }})">
  <button @click="add($event)">Add</button>
</div>
```

`@json()`, `Js::from()`, and `{{ }}` interpolations are tolerated inside Alpine attribute values without breaking parsing.

## See Also

- [Getting Started](getting-started.md) — installation and first use
- [Architecture](architecture.md) — how the parser and indexer are structured
- [Development](development.md) — how to add or modify features
