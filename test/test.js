#!/usr/bin/env node
/**
 * Inline test suite for alpine-ls extractor and x-data parser.
 * Uses synthetic test cases — no real project files.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractAlpineAttrs, findAttrAtOffset, findAttrByNameAtOffset, resolveDirectiveBase, getModifierAtOffset, isAlpineAttr, matchBraces } = require('../server/dist/extractor');
const { CompletionItemKind } = require('../server/node_modules/vscode-languageserver/node');
const { parseXData } = require('../server/dist/xdata');
const { WorkspaceIndex } = require('../server/dist/workspace');
const { createTestServer, loadDocument, DEBUG } = require('./helpers');

const DEBUG_LOG = process.env.LOG_LEVEL === 'debug';
const pos = (line, character) => ({ line, character });

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

// ── extractor: AlpineAttr name position ─────────────────────

suite('extractor: AlpineAttr name position', () => {
  test('x-data nameOffset points to "x", nameLength = 6', () => {
    const html = '<div x-data="test">';
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].nameOffset, html.indexOf('x-data'));
    assert.strictEqual(attrs[0].nameLength, 'x-data'.length);
    assert.strictEqual(html.slice(attrs[0].nameOffset, attrs[0].nameOffset + attrs[0].nameLength), 'x-data');
  });

  test('x-on:click.stop nameLength covers full name incl. dots/colons', () => {
    const html = '<button x-on:click.stop="fn()">';
    const attrs = extractAlpineAttrs(html);
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(attrs[0].name, 'x-on:click.stop');
    assert.strictEqual(attrs[0].nameLength, 'x-on:click.stop'.length);
    assert.strictEqual(
      html.slice(attrs[0].nameOffset, attrs[0].nameOffset + attrs[0].nameLength),
      'x-on:click.stop',
    );
  });

  test('findAttrByNameAtOffset returns attr when cursor inside name', () => {
    const html = '<div x-data="test">';
    const attrs = extractAlpineAttrs(html);
    const nameStart = html.indexOf('x-data');
    const mid = nameStart + 2;
    const attr = findAttrByNameAtOffset(attrs, mid);
    assert.ok(attr);
    assert.strictEqual(attr.name, 'x-data');
  });

  test('findAttrByNameAtOffset returns null when cursor inside value', () => {
    const html = '<div x-data="test">';
    const attrs = extractAlpineAttrs(html);
    const valOffset = html.indexOf('test');
    const attr = findAttrByNameAtOffset(attrs, valOffset);
    assert.strictEqual(attr, null);
  });

  test('findAttrByNameAtOffset returns null between attributes', () => {
    const html = '<div x-data="a" @click="b">';
    const attrs = extractAlpineAttrs(html);
    const spaceBetween = html.indexOf('" ') + 1;
    const attr = findAttrByNameAtOffset(attrs, spaceBetween);
    assert.strictEqual(attr, null);
  });

  test('findAttrByNameAtOffset boundary: offset == nameOffset matches', () => {
    const html = '<div x-data="test">';
    const attrs = extractAlpineAttrs(html);
    const attr = findAttrByNameAtOffset(attrs, attrs[0].nameOffset);
    assert.ok(attr);
  });
});

// ── extractor: directive base resolver ──────────────────────

suite('extractor: directive base resolver', () => {
  test('resolveDirectiveBase("x-on:click.stop") → "x-on"', () => {
    assert.strictEqual(resolveDirectiveBase('x-on:click.stop'), 'x-on');
  });

  test('resolveDirectiveBase("@click") → "x-on"', () => {
    assert.strictEqual(resolveDirectiveBase('@click'), 'x-on');
  });

  test('resolveDirectiveBase("x-model.lazy.number") → "x-model"', () => {
    assert.strictEqual(resolveDirectiveBase('x-model.lazy.number'), 'x-model');
  });

  test('resolveDirectiveBase(":class") → "x-bind"', () => {
    assert.strictEqual(resolveDirectiveBase(':class'), 'x-bind');
  });

  test('resolveDirectiveBase("x-transition:enter") → "x-transition"', () => {
    assert.strictEqual(resolveDirectiveBase('x-transition:enter'), 'x-transition');
  });

  test('resolveDirectiveBase("x-data") → "x-data"', () => {
    assert.strictEqual(resolveDirectiveBase('x-data'), 'x-data');
  });

  test('resolveDirectiveBase("x-unknown") → null', () => {
    assert.strictEqual(resolveDirectiveBase('x-unknown'), null);
  });

  test('resolveDirectiveBase("class") → null (non-Alpine)', () => {
    assert.strictEqual(resolveDirectiveBase('class'), null);
  });

  test('getModifierAtOffset("x-on:click.stop", 11) → {stop, x-on}', () => {
    assert.deepStrictEqual(
      getModifierAtOffset('x-on:click.stop', 11),
      { modifier: 'stop', base: 'x-on' },
    );
  });

  test('getModifierAtOffset("x-on:click.stop", 0) → null (on base)', () => {
    assert.strictEqual(getModifierAtOffset('x-on:click.stop', 0), null);
  });

  test('getModifierAtOffset("@click.prevent", 7) → {prevent, x-on}', () => {
    assert.deepStrictEqual(
      getModifierAtOffset('@click.prevent', 7),
      { modifier: 'prevent', base: 'x-on' },
    );
  });

  test('getModifierAtOffset chained: "x-model.lazy.number" on "number" → {number, x-model}', () => {
    const numIdx = 'x-model.lazy.number'.indexOf('number');
    assert.deepStrictEqual(
      getModifierAtOffset('x-model.lazy.number', numIdx),
      { modifier: 'number', base: 'x-model' },
    );
  });

  test('getModifierAtOffset chained: "x-model.lazy.number" on "lazy" → {lazy, x-model}', () => {
    const lazyIdx = 'x-model.lazy.number'.indexOf('lazy');
    assert.deepStrictEqual(
      getModifierAtOffset('x-model.lazy.number', lazyIdx),
      { modifier: 'lazy', base: 'x-model' },
    );
  });

  test('getModifierAtOffset on dot punctuation → null', () => {
    const dotIdx = 'x-on:click.stop'.indexOf('.');
    assert.strictEqual(getModifierAtOffset('x-on:click.stop', dotIdx), null);
  });

  test('getModifierAtOffset when no dot exists → null', () => {
    assert.strictEqual(getModifierAtOffset('x-data', 2), null);
  });
});

// ── matchBraces edge-cases ─────────────────────────────────

suite('matchBraces edge-cases', () => {
  test('block comment with fake close brace does not break depth', () => {
    const text = '{ /* } fake close */ open: false }';
    const result = matchBraces(text, 0);
    assert.ok(result !== null, 'should find closing brace');
    assert.strictEqual(text[result], '}', 'must be the real closing brace');
    assert.ok(result > text.indexOf('fake'), 'closing brace must be after the comment');
  });

  test('template interpolation ${expr} does not break depth', () => {
    const text = '{ msg: `text ${expr}` }';
    const result = matchBraces(text, 0);
    assert.ok(result !== null, 'should find closing brace');
    assert.strictEqual(text[result], '}', 'must be the real closing brace');
    assert.strictEqual(result, text.length - 1, 'closing brace at end');
  });

  test('block comment opener inside string is NOT treated as comment', () => {
    const text = '{ a: "/* not comment */", b: 2 }';
    const result = matchBraces(text, 0);
    assert.ok(result !== null, 'should find closing brace');
    assert.strictEqual(text[result], '}', 'must be the real closing brace');
    assert.strictEqual(result, text.length - 1, 'closing brace at end');
  });

  test('nested objects with block comment between them', () => {
    const text = '{ a: 1, /* comment */ b: { c: 2 } }';
    const result = matchBraces(text, 0);
    assert.ok(result !== null);
    assert.strictEqual(text[result], '}');
  });

  test('unclosed block comment returns null', () => {
    const text = '{ /* never closed, open: false }';
    const result = matchBraces(text, 0);
    assert.strictEqual(result, null, 'unclosed comment → unbalanced → null');
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

// ── parseXData edge-cases: spread ──────────────────────────

suite('parseXData edge-cases: spread', () => {
  test('{ ...defaults, override: true } — defaults NOT a member', () => {
    const members = parseXData('{ ...defaults, override: true }');
    const names = members.map(m => m.name);
    assert.ok(!names.includes('defaults'), 'spread target must NOT be a member');
    assert.ok(names.includes('override'));
  });

  test('{...config} — spread-only, config NOT a member', () => {
    const members = parseXData('{...config}');
    const names = members.map(m => m.name);
    assert.ok(!names.includes('config'), 'spread target must NOT be a member');
  });

  test('{ a: 1, ...b, c: 2 } — b excluded, a and c included', () => {
    const members = parseXData('{ a: 1, ...b, c: 2 }');
    const names = members.map(m => m.name);
    assert.ok(names.includes('a'));
    assert.ok(names.includes('c'));
    assert.ok(!names.includes('b'), 'spread target must NOT be a member');
  });
});

// ── parseXData edge-cases: computed keys ───────────────────

suite('parseXData edge-cases: computed keys', () => {
  test('{ [Symbol.iterator]: fn, open: false } — computed key excluded', () => {
    const members = parseXData('{ [Symbol.iterator]: fn, open: false }');
    const names = members.map(m => m.name);
    assert.ok(names.includes('open'));
    assert.ok(!names.includes('Symbol'));
    assert.ok(!names.includes('iterator'));
  });

  test("{ ['dynamic-' + key]: value, name: 'test' } — computed key excluded", () => {
    const members = parseXData("{ ['dynamic-' + key]: value, name: 'test' }");
    const names = members.map(m => m.name);
    assert.ok(names.includes('name'));
    assert.ok(!names.includes('dynamic'));
    assert.ok(!names.includes('key'));
  });

  test("{ [0]: 'first', items: [] } — numeric computed key excluded", () => {
    const members = parseXData("{ [0]: 'first', items: [] }");
    const names = members.map(m => m.name);
    assert.ok(names.includes('items'));
    assert.ok(!names.includes('0'));
  });
});

// ── parseXData edge-cases: strings ─────────────────────────

suite('parseXData edge-cases: strings', () => {
  test("{ msg: 'hello, world}', open: false } — world inside string excluded", () => {
    const members = parseXData("{ msg: 'hello, world}', open: false }");
    const names = members.map(m => m.name);
    assert.ok(names.includes('open'));
    assert.ok(!names.includes('world'), 'world is inside a string, must NOT be a member');
  });

  test('{ a: "foo, bar}", b: 1 } — foo/bar inside string excluded', () => {
    const members = parseXData('{ a: "foo, bar}", b: 1 }');
    const names = members.map(m => m.name);
    assert.ok(names.includes('a'));
    assert.ok(names.includes('b'));
    assert.ok(!names.includes('foo'));
    assert.ok(!names.includes('bar'));
  });

  test('backtick template literal contents excluded', () => {
    const members = parseXData('{ tpl: `template, end`}');
    const names = members.map(m => m.name);
    assert.ok(names.includes('tpl'));
    assert.ok(!names.includes('template'));
    assert.ok(!names.includes('end'));
  });

  test('escaped quote inside string does not break detection', () => {
    const members = parseXData("{ msg: 'it\\'s, fine}', open: true }");
    const names = members.map(m => m.name);
    assert.ok(names.includes('open'));
    assert.ok(!names.includes('fine'));
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

// ── WorkspaceIndex ──────────────────────────────────────────

suite('WorkspaceIndex', () => {
  test('indexDocument indexes inline x-data members', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///app.html', '<div x-data="{ open: false, toggle() {} }">');
    const openDefs = ws.lookup('open');
    const toggleDefs = ws.lookup('toggle');
    assert.ok(openDefs.length > 0, 'lookup("open") should return defs');
    assert.ok(toggleDefs.length > 0, 'lookup("toggle") should return defs');
    assert.strictEqual(openDefs[0].kind, 'property');
    assert.strictEqual(toggleDefs[0].kind, 'method');
    if (DEBUG_LOG) console.error(`[WorkspaceIndex] lookup open=${openDefs.length}, toggle=${toggleDefs.length}`);
  });

  test('indexDocument indexes Alpine.data registration', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///app.js', "Alpine.data('cart', () => ({ items: [], add() {} }))");
    const regs = ws.lookupAlpineData('cart');
    assert.ok(regs.length > 0, 'lookupAlpineData should return registration entries');
    assert.strictEqual(regs[0].def.registrationName, 'cart');
    assert.strictEqual(regs[0].def.registrationKind, 'Alpine.data');
    const members = ws.getRegistrationMembers(regs[0].def, regs[0].text);
    const memberNames = members.map(m => m.name);
    assert.ok(memberNames.includes('items'));
    assert.ok(memberNames.includes('add'));
  });

  test('indexDocument indexes Alpine.store registration', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///store.js', "Alpine.store('ui', { theme: 'dark' })");
    const regs = ws.lookupAlpineStore('ui');
    assert.strictEqual(regs.length, 1);
    assert.strictEqual(regs[0].def.registrationName, 'ui');
    assert.strictEqual(regs[0].def.registrationKind, 'Alpine.store');
  });

  test('allNames / allDataNames / allStoreNames return correct arrays', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    ws.indexDocument('file:///b.js', "Alpine.data('cart', () => ({ items: [] }))");
    ws.indexDocument('file:///c.js', "Alpine.store('ui', { theme: 'dark' })");
    assert.ok(ws.allNames().includes('open'));
    assert.ok(ws.allNames().includes('items'));
    assert.ok(ws.allNames().includes('theme'));
    assert.ok(ws.allDataNames().includes('cart'));
    assert.ok(ws.allStoreNames().includes('ui'));
  });

  test('resolveScope returns members for registered Alpine.data', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///reg.js', "Alpine.data('cart', () => ({ items: [], add() {} }))");
    const resolved = ws.resolveScope('cart', 'file:///consumer.html');
    assert.ok(resolved);
    assert.ok(resolved.members.length > 0);
    assert.ok(resolved.sourceLabel.includes("Alpine.data('cart')"));
    const names = resolved.members.map(m => m.name);
    assert.ok(names.includes('items'));
    assert.ok(names.includes('add'));
  });

  test('resolveScope returns null for inline object literal', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///app.html', '<div x-data="{ open: false }">');
    const resolved = ws.resolveScope('{ open: false }', 'file:///app.html');
    assert.strictEqual(resolved, null);
  });

  test('resolveScope returns null for unknown name', () => {
    const ws = new WorkspaceIndex();
    const resolved = ws.resolveScope('nonexistent', 'file:///app.html');
    assert.strictEqual(resolved, null);
  });

  test('getPosition / getEndPosition convert offset to line:character for multi-line text', () => {
    const ws = new WorkspaceIndex();
    const text = '<div x-data="{\n  open: false\n}">';
    ws.indexDocument('file:///m.html', text);
    const openDefs = ws.lookup('open');
    assert.ok(openDefs.length > 0);
    const def = openDefs[0];
    const start = ws.getPosition(def);
    const end = ws.getEndPosition(def);
    assert.ok(start);
    assert.ok(end);
    // "open" is on line 1 (after first \n), character 2 (two spaces)
    assert.strictEqual(start.line, 1);
    assert.strictEqual(start.character, 2);
    assert.strictEqual(end.line, 1);
    assert.strictEqual(end.character, 6);
    if (DEBUG_LOG) console.error(`[WorkspaceIndex] open at ${JSON.stringify(start)}–${JSON.stringify(end)}`);
  });

  test('getPosition returns null for unknown uri', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    const def = ws.lookup('open')[0];
    const forged = { ...def, uri: 'file:///missing.html' };
    assert.strictEqual(ws.getPosition(forged), null);
    assert.strictEqual(ws.getEndPosition(forged), null);
  });

  test('removeDocument clears definitions from index', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    assert.ok(ws.lookup('open').length > 0);
    ws.removeDocument('file:///a.html');
    assert.strictEqual(ws.lookup('open').length, 0);
    assert.strictEqual(ws.getText('file:///a.html'), undefined);
  });

  test('indexDocument overwrites previous content for same uri', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    assert.ok(ws.lookup('open').length > 0);
    ws.indexDocument('file:///a.html', '<div x-data="{ closed: true }">');
    assert.strictEqual(ws.lookup('open').length, 0);
    assert.ok(ws.lookup('closed').length > 0);
  });
});

// ── WorkspaceIndex.scanWorkspace ────────────────────────────

suite('WorkspaceIndex.scanWorkspace', () => {
  let tmpDir;

  test.beforeAll = () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-test-'));
  };
  test.beforeAll();

  test('indexes .js, .html, and nested .blade.php files', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), "Alpine.data('tabs', () => ({ select() {}, close() {} }))");
    fs.writeFileSync(path.join(tmpDir, 'page.html'), '<div x-data="{ open: false }">');
    fs.mkdirSync(path.join(tmpDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'nested', 'store.blade.php'), "Alpine.store('ui', { theme: 'dark' })");

    const ws = new WorkspaceIndex();
    ws.scanWorkspace(tmpDir);

    assert.ok(ws.allDataNames().includes('tabs'), 'tabs should be indexed from app.js');
    assert.ok(ws.allStoreNames().includes('ui'), 'ui should be indexed from store.blade.php');
    assert.ok(ws.allNames().includes('open'), 'open should be indexed from page.html inline x-data');
    assert.ok(ws.allNames().includes('select'), 'select method from tabs registration');
    if (DEBUG_LOG) {
      console.error(`[scanWorkspace] scanned: ${ws.allNames().length} names, ` +
        `${ws.allDataNames().length} data, ${ws.allStoreNames().length} store`);
    }
  });

  test('SKIP_DIRS: node_modules is ignored', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'dep.js'), "Alpine.data('ignored', () => ({ leak: true }))");

    const ws = new WorkspaceIndex();
    ws.scanWorkspace(tmpDir);
    const names = ws.allNames();
    assert.ok(!ws.allDataNames().includes('ignored'), 'node_modules/dep.js must NOT be indexed');
    assert.ok(!names.includes('leak'), 'leak member from node_modules must NOT appear');
  });

  test('extension filtering: .md files are ignored', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), "Alpine.data('docs', () => ({}))");

    const ws = new WorkspaceIndex();
    ws.scanWorkspace(tmpDir);
    assert.ok(!ws.allDataNames().includes('docs'), 'readme.md must NOT be indexed');
  });

  test('handles empty directory gracefully', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-empty-'));
    try {
      const ws = new WorkspaceIndex();
      ws.scanWorkspace(empty);
      assert.strictEqual(ws.allNames().length, 0);
    } finally {
      fs.rmSync(empty, { recursive: true });
    }
  });

  // Cleanup once the whole suite is done
  const origTest = global.test;
  process.on('exit', () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) { }
    }
  });
});

// ── AlpineLanguageServer.onCompletion ───────────────────────

suite('AlpineLanguageServer.onCompletion', () => {
  test('$ trigger returns magic properties filtered by prefix', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }"><button @click="$">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const dollarOffset = html.indexOf('$') + 1;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(dollarOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('$el'));
    assert.ok(labels.includes('$refs'));
    assert.ok(labels.includes('$store'));
    assert.ok(labels.every(l => l.startsWith('$')), 'all items should be magic $-prefixed');
    if (DEBUG_LOG) console.error(`[onCompletion] $ trigger items=${items.length}`);
  });

  test('$ trigger filters by typed prefix', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }"><button @click="$r">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('$r') + 2;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('$refs'));
    assert.ok(labels.includes('$root'));
    assert.ok(!labels.includes('$el'), '$el should be filtered out by $r prefix');
  });

  test('. trigger returns scope members', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false, toggle() {} }"><button @click="this.">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('this.') + 5;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('open'));
    assert.ok(labels.includes('toggle'));
  });

  test('default (non-x-data attr, no trigger) returns scope + magic + workspace', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }"><button @click="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('@click="') + '@click="'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('open'), 'scope members present');
    assert.ok(labels.includes('$el'), 'magic properties present');
  });

  test('x-data attr does NOT return magic properties (only scope)', () => {
    const { server } = createTestServer();
    const html = '<div x-data="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('x-data="') + 'x-data="'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.strictEqual(items.length, 0);
  });

  test('no attr at cursor returns empty array', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">plain text</div>';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('plain');
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.deepStrictEqual(items, []);
  });

  test('unknown uri returns empty array', () => {
    const { server } = createTestServer();
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///missing.html' },
      position: pos(0, 0),
    });
    assert.deepStrictEqual(items, []);
  });

  test('. trigger also includes workspace members from other docs', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///lib.js', "Alpine.data('lib', () => ({ libMethod() {} }))");
    const html = '<div x-data="lib"><button @click="this.">';
    const doc = loadDocument(server, 'file:///use.html', html);
    const cursorOffset = html.indexOf('this.') + 5;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///use.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('libMethod'), 'workspace member from other doc present');
  });
});

// ── AlpineLanguageServer.onHover ────────────────────────────

suite('AlpineLanguageServer.onHover', () => {
  test('magic property $el returns typescript signature + docs', () => {
    const { server } = createTestServer();
    const html = '<div @click="$el">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('$el') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.ok(Array.isArray(hover.contents));
    const sig = hover.contents[0];
    assert.strictEqual(sig.language, 'typescript');
    assert.ok(sig.value.includes('$el'));
    if (DEBUG_LOG) console.error(`[onHover] magic $el matched`);
  });

  test('scope member in inline x-data returns hover with member kind + basename', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('open') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.strictEqual(sig.language, 'typescript');
    assert.ok(sig.value.includes('open'));
    assert.ok(hover.contents[1].includes('h.html'), 'basename should appear');
  });

  test('registration name x-data="cart" returns Alpine.data hover with member list', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///lib.js', "Alpine.data('cart', () => ({ items: [], add() {} }))");
    const html = '<div x-data="cart">';
    const doc = loadDocument(server, 'file:///use.html', html);
    const cursorOffset = html.indexOf('cart') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///use.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.strictEqual(sig.language, 'typescript');
    assert.ok(sig.value.includes("Alpine.data('cart')"));
    const detail = hover.contents[1];
    assert.ok(detail.includes('items'), 'member list includes items');
    assert.ok(detail.includes('add'), 'member list includes add');
  });

  test('registration name x-data for Alpine.store returns store hover', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///lib.js', "Alpine.store('ui', { theme: 'dark' })");
    const html = '<div x-data="ui">';
    const doc = loadDocument(server, 'file:///use.html', html);
    const cursorOffset = html.indexOf('ui') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///use.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.ok(hover.contents[0].value.includes("Alpine.store('ui')"));
  });

  test('outside attr value returns null', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">content</div>';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = 2;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.strictEqual(hover, null);
  });

  test('empty word returns null', () => {
    const { server } = createTestServer();
    const html = '<div @click="">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('@"') + 2;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.strictEqual(hover, null);
  });

  test('unknown uri returns null', () => {
    const { server } = createTestServer();
    const hover = server['onHover']({
      textDocument: { uri: 'file:///missing.html' },
      position: pos(0, 0),
    });
    assert.strictEqual(hover, null);
  });
});

// ── onCompletion: modifiers ─────────────────────────────────

suite('onCompletion: modifiers', () => {
  test('x-on:click.| returns all 8 x-on modifiers', () => {
    const { server } = createTestServer();
    const html = '<button x-on:click.="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('.') + 1;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('.stop'));
    assert.ok(labels.includes('.prevent'));
    assert.ok(labels.includes('.outside'));
    assert.ok(labels.includes('.window'));
    assert.ok(labels.includes('.document'));
    assert.ok(labels.includes('.once'));
    assert.ok(labels.includes('.debounce'));
    assert.ok(labels.includes('.throttle'));
    assert.strictEqual(labels.length, 8);
    if (DEBUG_LOG) console.error(`[modifiers] x-on completion items=${items.length}`);
  });

  test('x-on:click.s| still includes .stop (client filters by prefix)', () => {
    const { server } = createTestServer();
    const html = '<button x-on:click.s="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('.s') + 2;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('.stop'), '.stop should be present for client-side filtering');
  });

  test('x-model.| returns 4 x-model modifiers', () => {
    const { server } = createTestServer();
    const html = '<input x-model.="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('.') + 1;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('.lazy'));
    assert.ok(labels.includes('.number'));
    assert.ok(labels.includes('.debounce'));
    assert.ok(labels.includes('.throttle'));
    assert.strictEqual(labels.length, 4);
  });

  test('cursor in VALUE region (x-on:click="test.|") does NOT return modifiers', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false, test: { a: 1 } }"><button x-on:click="test.">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const valDot = html.lastIndexOf('.') + 1;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(valDot),
    });
    const labels = items.map(i => i.label);
    assert.ok(!labels.some(l => l.startsWith('.')), 'no modifier items in value region');
    assert.ok(labels.includes('test'), 'scope members still returned in value region');
  });

  test('cursor at start of value (after opening quote) does NOT return modifiers', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }"><button x-on:click="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const valStart = html.lastIndexOf('=""') + 2;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(valStart),
    });
    const labels = items.map(i => i.label);
    assert.ok(!labels.some(l => l.startsWith('.')), 'no modifiers when cursor in value');
  });

  test('cursor on directive name without dot → [] (no modifiers yet)', () => {
    const { server } = createTestServer();
    const html = '<button x-on:click="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const onDirective = html.indexOf('x-on');
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(onDirective),
    });
    assert.deepStrictEqual(items, []);
  });

  test('modifier completion items use EnumMember kind + Modifier detail', () => {
    const { server } = createTestServer();
    const html = '<button x-on:click.="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('.') + 1;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const stop = items.find(i => i.label === '.stop');
    assert.ok(stop);
    assert.strictEqual(stop.kind, CompletionItemKind.EnumMember);
    assert.strictEqual(stop.detail, 'Modifier for x-on');
    assert.ok(stop.documentation);
  });
});

// ── onHover: directives and modifiers ───────────────────────

suite('onHover: directives and modifiers', () => {
  test('hover on x-data name shows directive documentation', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('x-data');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.strictEqual(sig.language, 'plaintext');
    assert.strictEqual(sig.value, 'x-data');
    assert.ok(hover.contents[1].includes('Declares a new Alpine component scope.'));
  });

  test('hover on x-show name shows directive documentation', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }" x-show="open">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('x-show');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.ok(hover.contents[1].includes('Toggles `display:none`'));
  });

  test('hover on .stop modifier shows stopPropagation doc + "(for x-on)"', () => {
    const { server } = createTestServer();
    const html = '<button x-on:click.stop="fn()">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('stop');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.strictEqual(sig.value, '.stop');
    assert.ok(hover.contents[1].includes('stopPropagation'));
    assert.ok(hover.contents[1].includes('(for x-on)'));
  });

  test('hover on .prevent modifier in @click.prevent shows preventDefault doc', () => {
    const { server } = createTestServer();
    const html = '<button @click.prevent="fn()">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('prevent');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, '.prevent');
    assert.ok(hover.contents[1].includes('preventDefault'));
  });

  test('hover on .lazy modifier in x-model.lazy shows change-event doc', () => {
    const { server } = createTestServer();
    const html = '<input x-model.lazy="val">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('lazy');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, '.lazy');
    assert.ok(hover.contents[1].includes('change'));
    assert.ok(hover.contents[1].includes('(for x-model)'));
  });

  test('hover on member in VALUE region uses existing member hover, NOT directive', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('open') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover, 'hover on value member should resolve');
    const doc_text = hover.contents[1];
    assert.ok(!doc_text.includes('Declares a new Alpine component scope'), 'must not show directive doc for value member');
    const sig = hover.contents[0];
    assert.ok(sig.value.includes('open'), 'should show member signature');
  });

  test('hover on x-transition:enter resolves base x-transition directive', () => {
    const { server } = createTestServer();
    const html = '<template x-transition:enter="">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('x-transition');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, 'x-transition');
    assert.ok(hover.contents[1].includes('Adds enter/leave CSS transitions.'));
  });
});

// ── AlpineLanguageServer.onDefinition ───────────────────────

suite('AlpineLanguageServer.onDefinition', () => {
  test('inline x-data member returns Location within same doc', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const cursorOffset = html.indexOf('open') + 1;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///d.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///d.html');
    assert.ok(loc.range.start.character >= 0);
    assert.strictEqual(loc.range.end.character - loc.range.start.character, 4);
    if (DEBUG_LOG) console.error(`[onDefinition] inline member at ${JSON.stringify(loc.range)}`);
  });

  test('Alpine.data registration name returns Location of registration file', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///lib.js', "Alpine.data('cart', () => ({ items: [], add() {} }))");
    const html = '<div x-data="cart">';
    const doc = loadDocument(server, 'file:///use.html', html);
    const cursorOffset = html.indexOf('cart') + 1;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///use.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///lib.js');
  });

  test('method inside Alpine.data registration returns Location in registration file', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///lib.js', "Alpine.data('tabs', () => ({ select() {}, close() {} }))");
    const html = '<div x-data="tabs"><button @click="select()">';
    const doc = loadDocument(server, 'file:///use.html', html);
    const cursorOffset = html.indexOf('select') + 2;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///use.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result, 'should resolve select method to registration');
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///lib.js');
  });

  test('magic property ($-prefixed) returns null', () => {
    const { server } = createTestServer();
    const html = '<div @click="$el">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const cursorOffset = html.indexOf('$el') + 1;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///d.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.strictEqual(result, null);
  });

  test('unknown word returns null', () => {
    const { server } = createTestServer();
    const html = '<div @click="nonexistent()">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const cursorOffset = html.indexOf('nonexistent') + 3;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///d.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.strictEqual(result, null);
  });

  test('outside attr value returns null', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">text</div>';
    const doc = loadDocument(server, 'file:///d.html', html);
    const cursorOffset = html.indexOf('text');
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///d.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.strictEqual(result, null);
  });

  test('unknown uri returns null', () => {
    const { server } = createTestServer();
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///missing.html' },
      position: pos(0, 0),
    });
    assert.strictEqual(result, null);
  });
});

// ── Integration: full pipeline ──────────────────────────────

suite('Integration: full pipeline', () => {
  test('cross-document hover, definition, and completion', () => {
    const { server } = createTestServer();
    const doc1Text = "Alpine.data('modal', () => ({ open: false, show() {}, hide() {} }))";
    loadDocument(server, 'file:///modal.js', doc1Text);
    const doc2Text = '<div x-data="modal"><button @click="show()">';
    const doc2 = loadDocument(server, 'file:///view.html', doc2Text);

    const showOffset = doc2Text.indexOf('show') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///view.html' },
      position: doc2.positionAt(showOffset),
    });
    assert.ok(hover, 'hover on show should resolve via workspace registration');
    const hoverStr = JSON.stringify(hover.contents);
    assert.ok(
      hoverStr.includes('show()'),
      'hover should contain the resolved method signature from registration scope',
    );
    if (DEBUG_LOG) console.error(`[integration] hover on show matched`);

    const modalOffset = doc2Text.indexOf('modal') + 1;
    const def = server['onDefinition']({
      textDocument: { uri: 'file:///view.html' },
      position: doc2.positionAt(modalOffset),
    });
    assert.ok(def);
    const loc = Array.isArray(def) ? def[0] : def;
    assert.strictEqual(loc.uri, 'file:///modal.js');

    const useText = '<div x-data="modal"><button @click="this.">';
    const doc3 = loadDocument(server, 'file:///view2.html', useText);
    const thisOffset = useText.indexOf('this.') + 5;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///view2.html' },
      position: doc3.positionAt(thisOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('open'), 'completion includes open');
    assert.ok(labels.includes('show'), 'completion includes show');
  });

  test('empty workspace: unknown hover returns null, $ completion returns magic', () => {
    const { server } = createTestServer();
    const html = '<div @click="$unknown">';
    const doc = loadDocument(server, 'file:///solo.html', html);

    const hover = server['onHover']({
      textDocument: { uri: 'file:///solo.html' },
      position: doc.positionAt(html.indexOf('$unknown') + 1),
    });
    assert.strictEqual(hover, null);

    const clickHtml = '<div @click="$">';
    const doc2 = loadDocument(server, 'file:///solo2.html', clickHtml);
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///solo2.html' },
      position: doc2.positionAt(clickHtml.indexOf('$') + 1),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('$el'));
    assert.ok(labels.includes('$store'));
    assert.ok(labels.includes('$refs'));
  });

  test('definition fallback to workspace lookup for bare word', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///lib.js', "Alpine.data('lib', () => ({ helper() {} }))");
    const html = '<div x-data="lib"><button @click="helper()">';
    const doc = loadDocument(server, 'file:///use.html', html);
    const cursorOffset = html.indexOf('helper') + 2;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///use.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result, 'helper should resolve via registration scope');
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///lib.js');
  });
});

// ── Summary ─────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);
if (failed > 0) process.exit(1);
