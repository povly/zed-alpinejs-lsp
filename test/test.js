#!/usr/bin/env node
/**
 * Inline test suite for alpine-ls extractor and x-data parser.
 * Uses synthetic test cases — no real project files.
 */
const assert = require('assert');
const { extractAlpineAttrs, findAttrAtOffset, isAlpineAttr } = require('../server/dist/extractor');
const { parseXData } = require('../server/dist/xdata');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function suite(title, fn) {
  console.log(`\n${title}`);
  fn();
}

// ── extractAlpineAttrs ──────────────────────────────────────

suite('extractAlpineAttrs', () => {
  test('finds x-data', () => {
    const attrs = extractAlpineAttrs('<div x-data="{ open: false }">');
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].name, 'x-data');
    assert.strictEqual(attrs[0].value, '{ open: false }');
  });

  test('finds @click', () => {
    const attrs = extractAlpineAttrs('<button @click="toggle()">');
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].name, '@click');
    assert.strictEqual(attrs[0].value, 'toggle()');
  });

  test('finds :class binding', () => {
    const attrs = extractAlpineAttrs('<li :class="{ active: open }">');
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].name, ':class');
    assert.strictEqual(attrs[0].value, '{ active: open }');
  });

  test('finds x-on:click', () => {
    const attrs = extractAlpineAttrs('<button x-on:click="toggle()">');
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].name, 'x-on:click');
  });

  test('finds x-bind:class', () => {
    const attrs = extractAlpineAttrs('<div x-bind:class="cls">');
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].name, 'x-bind:class');
  });

  test('finds single-quoted values', () => {
    const attrs = extractAlpineAttrs(`<div x-data='{ open: false }'>`);
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].value, '{ open: false }');
  });

  test('finds multiple attrs in one tag', () => {
    const html = '<div x-data="{ open: false }" @click="toggle()" :class="{ active: open }">';
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 3);
    assert.strictEqual(attrs[0].name, 'x-data');
    assert.strictEqual(attrs[1].name, '@click');
    assert.strictEqual(attrs[2].name, ':class');
  });

  test('handles multiline x-data', () => {
    const html = `<div x-data="{
  open: false,
  toggle() { this.open = !this.open }
}">`;
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 1);
    assert.ok(attrs[0].value.includes('toggle()'));
  });

  test('ignores non-Alpine attributes', () => {
    const attrs = extractAlpineAttrs('<div class="container" id="main">');
    assert.strictEqual(attrs.length, 0);
  });

  test('handles empty x-data', () => {
    const attrs = extractAlpineAttrs('<div x-data="">');
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].value, '');
  });

  test('correct valueOffset positions', () => {
    const html = '<div x-data="test">';
    const attrs = extractAlpineAttrs(html);
    const offset = attrs[0].valueOffset;
    assert.strictEqual(html.slice(offset, offset + 4), 'test');
  });

  test('handles x-show, x-model, x-text, x-ref', () => {
    const html = '<div x-show="open" x-model="name" x-text="label" x-ref="btn">';
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 4);
    assert.strictEqual(attrs[0].name, 'x-show');
    assert.strictEqual(attrs[1].name, 'x-model');
    assert.strictEqual(attrs[2].name, 'x-text');
    assert.strictEqual(attrs[3].name, 'x-ref');
  });
});

// ── findAttrAtOffset ────────────────────────────────────────

suite('findAttrAtOffset', () => {
  test('finds attr at given position', () => {
    const html = '<div x-data="{ open: false }" @click="toggle()">';
    const attrs = extractAlpineAttrs(html);
    // Cursor inside "@click" value (around "toggle")
    const toggleOffset = html.indexOf('toggle');
    const attr = findAttrAtOffset(attrs, toggleOffset);
    assert.ok(attr);
    assert.strictEqual(attr.name, '@click');
  });

  test('returns null outside attr values', () => {
    const html = '<div x-data="{ open: false }">';
    const attrs = extractAlpineAttrs(html);
    const attr = findAttrAtOffset(attrs, 0);
    assert.strictEqual(attr, null);
  });
});

// ── parseXData ──────────────────────────────────────────────

suite('parseXData', () => {
  test('extracts simple property', () => {
    const members = parseXData('{ open: false }');
    assert.ok(members.some(m => m.name === 'open' && m.kind === 'property'));
  });

  test('extracts shorthand method', () => {
    const members = parseXData('{ toggle() { this.open = !this.open } }');
    assert.ok(members.some(m => m.name === 'toggle' && m.kind === 'method'));
  });

  test('extracts getter', () => {
    const members = parseXData('{ get isOpen() { return this.open } }');
    assert.ok(members.some(m => m.name === 'isOpen' && m.kind === 'getter'));
  });

  test('extracts multiple members', () => {
    const members = parseXData('{ open: false, count: 0, toggle() {}, init() {} }');
    const names = members.map(m => m.name);
    assert.ok(names.includes('open'));
    assert.ok(names.includes('count'));
    assert.ok(names.includes('toggle'));
    assert.ok(names.includes('init'));
  });

  test('does NOT extract booleans', () => {
    const members = parseXData('{ open: false, active: true, done: null }');
    const names = members.map(m => m.name);
    assert.ok(!names.includes('false'));
    assert.ok(!names.includes('true'));
    assert.ok(!names.includes('null'));
  });

  test('does NOT extract numbers as keys', () => {
    const members = parseXData('{ breakpoints: { 0: { perView: 1 }, 768: { perView: 2 } } }');
    const names = members.map(m => m.name);
    assert.ok(!names.includes('0'));
    assert.ok(!names.includes('768'));
    assert.ok(!names.includes('1'));
    assert.ok(!names.includes('2'));
  });

  test('handles empty object', () => {
    const members = parseXData('{}');
    assert.strictEqual(members.length, 0);
  });

  test('handles arrow function wrapper', () => {
    const members = parseXData('() => ({ open: false, toggle() {} })');
    const names = members.map(m => m.name);
    assert.ok(names.includes('open'));
    assert.ok(names.includes('toggle'));
  });

  test('handles nested objects', () => {
    const members = parseXData('{ config: { theme: "dark" }, init() {} }');
    const names = members.map(m => m.name);
    assert.ok(names.includes('config'));
    assert.ok(names.includes('init'));
    assert.ok(names.includes('theme'));
  });

  test('dedupes members', () => {
    const members = parseXData('{ open: false, open: true }');
    assert.strictEqual(members.filter(m => m.name === 'open').length, 1);
  });

  test('correct offset within value', () => {
    const value = '{ open: false }';
    const members = parseXData(value);
    const open = members.find(m => m.name === 'open');
    assert.ok(open);
    assert.strictEqual(value.slice(open.offset, open.offset + open.length), 'open');
  });
});

// ── isAlpineAttr ────────────────────────────────────────────

suite('isAlpineAttr', () => {
  test('x-data is Alpine', () => {
    assert.ok(isAlpineAttr('x-data'));
  });
  test('@click is Alpine', () => {
    assert.ok(isAlpineAttr('@click'));
  });
  test(':class is Alpine', () => {
    assert.ok(isAlpineAttr(':class'));
  });
  test('class is NOT Alpine', () => {
    assert.ok(!isAlpineAttr('class'));
  });
  test('id is NOT Alpine', () => {
    assert.ok(!isAlpineAttr('id'));
  });
});

// ── Real-world patterns ─────────────────────────────────────

suite('real-world patterns', () => {
  test('cart component with Js::from', () => {
    const html = '<div x-data="cart({{ Js::from([\'items\' => $items]) }})" @click="add($event)">';
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 2);
    assert.strictEqual(attrs[0].name, 'x-data');
    assert.strictEqual(attrs[1].name, '@click');
  });

  test('Alpine with Blade conditionals', () => {
    const html = '<div x-data="{ open: @json($isOpen) }" x-show="open">';
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 2);
  });

  test('multi-line @click with complex logic', () => {
    const html = `<button @click="
      if (confirm('Delete?')) {
        $dispatch('delete', { id: {{ $id }} })
      }
    ">Delete</button>`;
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 1);
    assert.ok(attrs[0].value.includes('$dispatch'));
  });

  test('x-transition modifiers', () => {
    const html = '<div x-transition:enter-start="opacity-0" x-transition:leave-end="opacity-100">';
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 2);
    assert.strictEqual(attrs[0].name, 'x-transition:enter-start');
    assert.strictEqual(attrs[1].name, 'x-transition:leave-end');
  });
});

// ── Summary ─────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);
if (failed > 0) process.exit(1);
