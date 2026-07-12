"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODIFIERS = exports.DIRECTIVES = exports.MAGIC_PROPERTIES = void 0;
exports.MAGIC_PROPERTIES = [
    {
        name: '$el',
        signature: '$el: HTMLElement',
        documentation: 'The DOM element that the directive/attribute is attached to.',
    },
    {
        name: '$refs',
        signature: '$refs: Record<string, HTMLElement>',
        documentation: 'An object containing all elements marked with `x-ref` inside the current component.',
    },
    {
        name: '$event',
        signature: '$event: Event',
        documentation: 'The native browser event object for `x-on` handlers.',
    },
    {
        name: '$dispatch',
        signature: '$dispatch(name: string, detail?: any, bubbles?: boolean)',
        documentation: 'Dispatch a custom browser event. Listeners on the same element and ancestors receive it.',
        example: '$dispatch("toggle", { open: true })',
    },
    {
        name: '$nextTick',
        signature: '$nextTick(callback: () => void)',
        documentation: 'Run a callback after Alpine has reacted to the most recent DOM update.',
    },
    {
        name: '$watch',
        signature: '$watch(property: string, callback: (value: any, oldValue: any) => void)',
        documentation: 'Watch a component property and fire a callback whenever its value changes.',
        example: '$watch("open", (value) => console.log(value))',
    },
    {
        name: '$store',
        signature: '$store: Record<string, any>',
        documentation: 'Access Alpine global stores registered with `Alpine.store(name, {...})`.',
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
exports.DIRECTIVES = [
    { name: 'x-data', documentation: 'Declares a new Alpine component scope.', example: 'x-data="{ open: false }"' },
    { name: 'x-init', documentation: 'Runs an expression when the component is initialized.' },
    { name: 'x-show', documentation: 'Toggles `display:none` based on expression truthiness.' },
    { name: 'x-bind', documentation: 'Binds an HTML attribute value to an expression.', example: ':class="{ active: isActive }"' },
    { name: 'x-on', documentation: 'Attaches an event listener.', example: '@click="toggle()"' },
    { name: 'x-model', documentation: 'Two-way data binding for form inputs.' },
    { name: 'x-modelable', documentation: 'Exposes a piece of component state as the model for nested x-model.' },
    { name: 'x-text', documentation: 'Sets the `innerText` of an element.' },
    { name: 'x-html', documentation: 'Sets the `innerHTML` of an element.' },
    { name: 'x-ref', documentation: 'Marks an element for retrieval via `$refs`.' },
    { name: 'x-if', documentation: 'Conditionally renders a `<template>` block.' },
    { name: 'x-for', documentation: 'Loops over an iterable in a `<template>` block.' },
    { name: 'x-effect', documentation: 'Re-runs an expression whenever any reactive dependency changes.' },
    { name: 'x-transition', documentation: 'Adds enter/leave CSS transitions.' },
    { name: 'x-cloak', documentation: 'Hides an element until Alpine has initialized (pair with `[x-cloak] { display: none }`).' },
    { name: 'x-teleport', documentation: 'Moves part of the template to another DOM location.' },
    { name: 'x-ignore', documentation: 'Stops Alpine from initializing the element and its children.' },
];
exports.MODIFIERS = [
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
];
//# sourceMappingURL=data.js.map