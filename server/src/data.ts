export interface MagicProperty {
  name: string;
  signature: string;
  documentation: string;
  example?: string;
}

export const MAGIC_PROPERTIES: MagicProperty[] = [
  {
    name: '$el',
    signature: '$el: HTMLElement',
    documentation: 'The DOM element that the directive/attribute is attached to.',
  },
  {
    name: '$refs',
    signature: '$refs: Record<string, HTMLElement>',
    documentation:
      'An object containing all elements marked with `x-ref` inside the current component.',
  },
  {
    name: '$event',
    signature: '$event: Event',
    documentation: 'The native browser event object for `x-on` handlers.',
  },
  {
    name: '$dispatch',
    signature: '$dispatch(name: string, detail?: any, bubbles?: boolean)',
    documentation:
      'Dispatch a custom browser event. Listeners on the same element and ancestors receive it.',
    example: '$dispatch("toggle", { open: true })',
  },
  {
    name: '$nextTick',
    signature: '$nextTick(callback: () => void)',
    documentation:
      'Run a callback after Alpine has reacted to the most recent DOM update.',
  },
  {
    name: '$watch',
    signature: '$watch(property: string, callback: (value: any, oldValue: any) => void)',
    documentation:
      'Watch a component property and fire a callback whenever its value changes.',
    example: '$watch("open", (value) => console.log(value))',
  },
  {
    name: '$store',
    signature: '$store: Record<string, any>',
    documentation:
      'Access Alpine global stores registered with `Alpine.store(name, {...})`.',
  },
  {
    name: '$root',
    signature: '$root: HTMLElement',
    documentation: 'The closest ancestor element with `x-data` (the component root).',
  },
  {
    name: '$data',
    signature: '$data(element: HTMLElement): Record<string, any>',
    documentation: 'Access the data scope of another Alpine component by its root element.',
  },
  {
    name: '$id',
    signature: '$id(name: string): string',
    documentation: 'Generate a unique ID — useful for accessibility (aria-* attributes).',
  },
];

export interface DirectiveInfo {
  name: string;
  documentation: string;
  example?: string;
}

export const DIRECTIVES: DirectiveInfo[] = [
  { name: 'x-data', documentation: 'Declares a new Alpine component scope.', example: 'x-data="{ open: false }"' },
  { name: 'x-init', documentation: 'Runs an expression when the component is initialized.', example: 'x-init="init()"' },
  { name: 'x-show', documentation: 'Toggles `display:none` based on expression truthiness.', example: 'x-show="open"' },
  { name: 'x-bind', documentation: 'Binds an HTML attribute value to an expression.', example: ':class="{ active: isActive }"' },
  { name: 'x-on', documentation: 'Attaches an event listener.', example: '@click="toggle()"' },
  { name: 'x-model', documentation: 'Two-way data binding for form inputs.', example: 'x-model="name"' },
  { name: 'x-modelable', documentation: 'Exposes a piece of component state as the model for nested x-model.' },
  { name: 'x-text', documentation: 'Sets the `innerText` of an element.', example: 'x-text="message"' },
  { name: 'x-html', documentation: 'Sets the `innerHTML` of an element.', example: 'x-html="<strong>bold</strong>"' },
  { name: 'x-ref', documentation: 'Marks an element for retrieval via `$refs`.', example: 'x-ref="button"' },
  { name: 'x-if', documentation: 'Conditionally renders a `<template>` block.', example: 'x-if="show"' },
  { name: 'x-for', documentation: 'Loops over an iterable in a `<template>` block.', example: 'x-for="item in items"' },
  { name: 'x-effect', documentation: 'Re-runs an expression whenever any reactive dependency changes.', example: 'x-effect="update()"' },
  { name: 'x-transition', documentation: 'Adds enter/leave CSS transitions.', example: 'x-show="open" x-transition' },
  { name: 'x-cloak', documentation: 'Hides an element until Alpine has initialized (pair with `[x-cloak] { display: none }`).', example: 'x-cloak' },
  { name: 'x-teleport', documentation: 'Moves part of the template to another DOM location.', example: 'x-teleport="#modal-container"' },
  { name: 'x-ignore', documentation: 'Stops Alpine from initializing the element and its children.', example: 'x-ignore' },
  { name: 'x-id', documentation: 'Declares a scope for $id() unique ID generation.', example: 'x-id="user"' },
];

export interface TransitionSubAttr {
  name: string;
  documentation: string;
}

export const TRANSITION_SUBS: TransitionSubAttr[] = [
  { name: ':enter', documentation: 'CSS classes applied during the entire entering phase.' },
  { name: ':enter-start', documentation: 'Added before element is inserted, removed one animation frame after.' },
  { name: ':enter-end', documentation: 'Added one frame after insertion, removed when transition finishes.' },
  { name: ':leave', documentation: 'CSS classes applied during the entire leaving phase.' },
  { name: ':leave-start', documentation: 'Added immediately on leave trigger, removed after one frame.' },
  { name: ':leave-end', documentation: 'Added one frame after leave trigger, removed when transition finishes.' },
];

export interface ModifierInfo {
  name: string;
  for: string[];
  documentation: string;
}

export const MODIFIERS: ModifierInfo[] = [
  { name: '.stop', for: ['x-on'], documentation: 'Equivalent to `event.stopPropagation()`.' },
  { name: '.prevent', for: ['x-on'], documentation: 'Equivalent to `event.preventDefault()`.' },
  { name: '.outside', for: ['x-on'], documentation: 'Trigger when clicking outside the element.' },
  { name: '.window', for: ['x-on'], documentation: 'Listen on the `window` object instead of the element.' },
  { name: '.document', for: ['x-on'], documentation: 'Listen on the `document` object instead of the element.' },
  { name: '.once', for: ['x-on'], documentation: 'Fire the handler only once.' },
  { name: '.debounce', for: ['x-on', 'x-model'], documentation: 'Debounce the event handler.' },
  { name: '.throttle', for: ['x-on', 'x-model'], documentation: 'Throttle the event handler.' },
  { name: '.lazy', for: ['x-model'], documentation: 'Only sync on `change` event (not `input`).' },
  { name: '.number', for: ['x-model'], documentation: 'Coerce the input value to a number.' },
  { name: '.self', for: ['x-on'], documentation: 'Only trigger if event.target is the element itself (not a child).' },
  { name: '.capture', for: ['x-on'], documentation: 'Listen during capture phase (before bubbling).' },
  { name: '.passive', for: ['x-on'], documentation: 'Mark listener as passive for performance (cannot call preventDefault).' },
  { name: '.camel', for: ['x-on'], documentation: 'Convert event name from kebab-case to camelCase (e.g. custom-event → customEvent).' },
  { name: '.trim', for: ['x-model'], documentation: 'Trim whitespace from the input value.' },
  { name: '.boolean', for: ['x-model'], documentation: 'Coerce value to a JS boolean (accepts true/false/1/0).' },
  { name: '.fill', for: ['x-model'], documentation: "Populate empty bound property from element's value attribute." },
  { name: '.important', for: ['x-show'], documentation: 'Set display:none !important instead of display:none.' },
  { name: '.immediate', for: ['x-show'], documentation: 'Show/hide immediately without transition animation.' },
  { name: '.dot', for: ['x-on'], documentation: 'Converts dashes to dots in the event name. Useful for listening to custom events with dotted names.' },
  { name: '.passive.false', for: ['x-on'], documentation: 'By default, Alpine marks touch/wheel events as passive for better scroll performance. Use .passive.false to make them cancelable via preventDefault().' },
  { name: '.change', for: ['x-model'], documentation: 'Syncs the model value on the native \'change\' event instead of \'input\'. Functionally equivalent to .lazy.' },
  { name: '.blur', for: ['x-model'], documentation: 'Syncs the model value when the input element loses focus (on blur event).' },
  { name: '.enter', for: ['x-model'], documentation: 'Syncs the model value when the user presses the Enter key.' },
  { name: '.duration', for: ['x-transition'], documentation: 'Customizes the transition duration in milliseconds. Append the value after the modifier: .duration.500ms.' },
  { name: '.delay', for: ['x-transition'], documentation: 'Delays the start of the transition by the specified milliseconds: .delay.50ms.' },
  { name: '.opacity', for: ['x-transition'], documentation: 'Restricts the transition to only animate opacity (no scale transform).' },
  { name: '.scale', for: ['x-transition'], documentation: 'Restricts the transition to only animate scale (no opacity). Append a scale value: .scale.80 for 80% scale.' },
  { name: '.origin', for: ['x-transition'], documentation: 'Sets the transform origin for scale transitions. Combinable: .origin.top.right.' },
];

export interface GlobalApi {
  name: string;
  signature: string;
  description: string;
  example?: string;
}

export const GLOBAL_APIS: GlobalApi[] = [
  {
    name: 'Alpine.data',
    signature: 'Alpine.data(name, callback)',
    description:
      'Registers a reusable Alpine component factory. The callback receives an initialization function that returns an object with data, methods, and computed properties.',
    example: "Alpine.data('dropdown', () => ({ open: false, toggle() { this.open = !this.open } }))",
  },
  {
    name: 'Alpine.store',
    signature: 'Alpine.store(name, value)',
    description:
      'Registers a global reactive store accessible via $store magic. The store object becomes reactive and shared across all Alpine components.',
    example: "Alpine.store('darkMode', { enabled: false, toggle() { this.enabled = !this.enabled } })",
  },
  {
    name: 'Alpine.bind',
    signature: 'Alpine.bind(callback)',
    description:
      'Registers a reusable x-bind object that can be referenced by name in x-bind directives. Useful for sharing complex binding logic.',
    example: "Alpine.bind('inputStyles', () => ({ class: 'border-gray-300', '@focus': 'focused = true' }))",
  },
  {
    name: 'Alpine.start',
    signature: 'Alpine.start()',
    description:
      "Manually starts Alpine's initialization process. Useful when Alpine is loaded as an NPM module and you need to control when Alpine begins scanning the DOM.",
    example: "import Alpine from 'alpinejs'; window.Alpine = Alpine; Alpine.start();",
  },
  {
    name: 'Alpine.plugin',
    signature: 'Alpine.plugin(callback)',
    description:
      'Registers an Alpine plugin. The callback receives the Alpine instance, allowing the plugin to register directives, magics, or other functionality.',
    example: "import focus from '@alpinejs/focus'; Alpine.plugin(focus);",
  },
  {
    name: 'Alpine.directive',
    signature: 'Alpine.directive(name, callback)',
    description:
      'Registers a custom directive. The callback receives (el, { value, modifiers, expression, cleanup }) where el is the DOM element and the second arg contains directive metadata.',
    example: "Alpine.directive('intersection', (el, { expression }) => { /* custom logic */ })",
  },
  {
    name: 'Alpine.magic',
    signature: 'Alpine.magic(name, callback)',
    description:
      'Registers a custom magic property accessible via $ prefix in Alpine expressions. The callback receives the Alpine element scope.',
    example: "Alpine.magic('clipboard', () => navigator.clipboard); // $clipboard",
  },
  {
    name: 'Alpine.reactive',
    signature: 'Alpine.reactive(object)',
    description:
      "Creates a deeply reactive proxy of the given object. Changes to the object's properties (including nested ones) are tracked by Alpine's reactivity system. Returns the reactive proxy.",
    example: "let state = Alpine.reactive({ count: 0 }); state.count++; // triggers effects",
  },
  {
    name: 'Alpine.effect',
    signature: 'Alpine.effect(callback)',
    description:
      'Registers a reactive effect that automatically re-runs whenever any reactive data accessed inside the callback changes. Returns a cleanup function to stop tracking.',
    example: "Alpine.effect(() => { console.log('Count is:', state.count) });",
  },
];
