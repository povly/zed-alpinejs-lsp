#!/usr/bin/env node
/**
 * Inline test suite for alpine-ls extractor and x-data parser.
 * Uses synthetic test cases — no real project files.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractAlpineAttrs, findAttrAtOffset, findAttrByNameAtOffset, resolveDirectiveBase, getModifierAtOffset, isAlpineAttr, matchBraces, extractAlpineData, extractAlpineMagic } = require('../server/dist/extractor');
const { CompletionItemKind, SymbolKind, DiagnosticSeverity } = require('../server/node_modules/vscode-languageserver/node');
const { parseXData } = require('../server/dist/xdata');
const { WorkspaceIndex } = require('../server/dist/workspace');
const { DIRECTIVES, TRANSITION_SUBS, MODIFIERS, GLOBAL_APIS } = require('../server/dist/data');
const { createTestServer, loadDocument, DEBUG } = require('./helpers');
const { TextDocument } = require('../server/node_modules/vscode-languageserver-textdocument');

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

// Async variant — runs the test, returns a promise. Exits process when all done.
const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

function suite(title, fn) {
  console.log(`\n${title}`);
  fn();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Trigger the server's real onDidChangeContent handler by firing the
 * underlying TextDocuments emitter directly. Bypasses loadDocument (which
 * pokes attrCache + workspace directly) so we exercise the debounce path.
 */
function fireDidChangeContent(server, uri, text) {
  const doc = TextDocument.create(uri, 'html', 1, text);
  const documents = server['documents'];
  if (!documents.__alpineTestDocs) {
    documents.__alpineTestDocs = new Map();
    documents.get = (u) => documents.__alpineTestDocs.get(u);
  }
  documents.__alpineTestDocs.set(uri, doc);
  documents._onDidChangeContent.fire({ document: doc });
  return doc;
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
  test('x-on:click.| returns all 14 x-on modifiers', () => {
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
    assert.ok(labels.includes('.self'));
    assert.ok(labels.includes('.capture'));
    assert.ok(labels.includes('.passive'));
    assert.ok(labels.includes('.camel'));
    assert.ok(labels.includes('.dot'), '.dot added for x-on');
    assert.ok(labels.includes('.passive.false'), '.passive.false added for x-on');
    assert.strictEqual(labels.length, 14);
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

  test('x-model.| returns 10 x-model modifiers', () => {
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
    assert.ok(labels.includes('.trim'));
    assert.ok(labels.includes('.boolean'));
    assert.ok(labels.includes('.fill'));
    assert.ok(labels.includes('.change'), '.change added for x-model');
    assert.ok(labels.includes('.blur'), '.blur added for x-model');
    assert.ok(labels.includes('.enter'), '.enter added for x-model');
    assert.strictEqual(labels.length, 10);
  });

  test('x-show.| returns 2 x-show modifiers', () => {
    const { server } = createTestServer();
    const html = '<div x-show.="">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('.') + 1;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('.important'));
    assert.ok(labels.includes('.immediate'));
    assert.strictEqual(labels.length, 2);
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

  test('hover on x-transition (no sub-attr) resolves base x-transition directive', () => {
    const { server } = createTestServer();
    const html = '<template x-transition="">';
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

  test('hover on x-id name shows directive documentation', () => {
    const { server } = createTestServer();
    const html = '<div x-id="user">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('x-id');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.strictEqual(sig.language, 'plaintext');
    assert.strictEqual(sig.value, 'x-id');
    assert.ok(hover.contents[1].includes('Declares a scope for $id()'));
  });

  test('hover on .self modifier in x-on:click.self shows self doc', () => {
    const { server } = createTestServer();
    const html = '<button x-on:click.self="fn()">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('self');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, '.self');
    assert.ok(hover.contents[1].includes('event.target is the element itself'));
    assert.ok(hover.contents[1].includes('(for x-on)'));
  });

  test('hover on .trim modifier in x-model.trim shows trim doc', () => {
    const { server } = createTestServer();
    const html = '<input x-model.trim="val">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('trim');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, '.trim');
    assert.ok(hover.contents[1].includes('Trim whitespace from the input value.'));
    assert.ok(hover.contents[1].includes('(for x-model)'));
  });

  test('hover on .important modifier in x-show.important shows important doc', () => {
    const { server } = createTestServer();
    const html = '<div x-show.important="open">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('important');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, '.important');
    assert.ok(hover.contents[1].includes('display:none !important'));
    assert.ok(hover.contents[1].includes('(for x-show)'));
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

// ── data: DIRECTIVES completeness ──────────────────────────

suite('data: DIRECTIVES completeness', () => {
  test('x-id entry exists with documentation and example', () => {
    const entry = DIRECTIVES.find(d => d.name === 'x-id');
    assert.ok(entry, 'x-id must exist in DIRECTIVES');
    assert.ok(entry.documentation.length > 0);
    assert.ok(entry.example && entry.example.length > 0);
  });

  test('all DIRECTIVES entries have non-empty documentation', () => {
    for (const d of DIRECTIVES) {
      assert.ok(d.documentation && d.documentation.length > 0,
        `${d.name} must have non-empty documentation`);
    }
  });

  test('at least 16 of DIRECTIVES entries have non-empty example', () => {
    const withExample = DIRECTIVES.filter(d => d.example && d.example.length > 0);
    assert.ok(withExample.length >= 16,
      `expected >= 16 with example, got ${withExample.length}`);
  });

  test("resolveDirectiveBase('x-id') returns 'x-id'", () => {
    assert.strictEqual(resolveDirectiveBase('x-id'), 'x-id');
  });

  test('hover on x-id in <div x-id="user"> shows documentation text', () => {
    const { server } = createTestServer();
    const html = '<div x-id="user">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const cursorOffset = html.indexOf('x-id') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///d.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, 'x-id');
    assert.ok(hover.contents[1].includes('Declares a scope for $id()'));
  });
});

// ── onHover: x-transition sub-attributes ───────────────────

suite('onHover: x-transition sub-attributes', () => {
  test('hover on x-transition:enter shows :enter sub-attr documentation', () => {
    const { server } = createTestServer();
    const html = '<template x-transition:enter="">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('enter');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, 'x-transition:enter');
    assert.ok(hover.contents[1].includes('CSS classes applied during the entire entering phase.'));
    assert.ok(hover.contents[1].includes('See: x-transition'));
  });

  test('hover on x-transition:leave-start shows :leave-start sub-attr documentation', () => {
    const { server } = createTestServer();
    const html = '<template x-transition:leave-start="">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('leave-start');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, 'x-transition:leave-start');
    assert.ok(hover.contents[1].includes('Added immediately on leave trigger, removed after one frame.'));
  });

  test('hover on x-transition (no sub-attr) shows generic x-transition documentation', () => {
    const { server } = createTestServer();
    const html = '<template x-transition="">';
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

  test('hover on x-transition:unknown falls through to generic x-transition hover (not null)', () => {
    const { server } = createTestServer();
    const html = '<template x-transition:unknown="">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('x-transition');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover, 'must not be null — should fall through to generic x-transition');
    assert.strictEqual(hover.contents[0].value, 'x-transition');
    assert.ok(hover.contents[1].includes('Adds enter/leave CSS transitions.'));
  });

  test('TRANSITION_SUBS has 6 entries with non-empty documentation', () => {
    assert.strictEqual(TRANSITION_SUBS.length, 6);
    for (const s of TRANSITION_SUBS) {
      assert.ok(s.name.startsWith(':'), `${s.name} should start with colon`);
      assert.ok(s.documentation.length > 0, `${s.name} needs documentation`);
    }
  });

  test('hover on x-transition:enter with modifier (.duration) still shows :enter doc', () => {
    const { server } = createTestServer();
    const html = '<template x-transition:enter.duration.500ms="">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('enter');
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.strictEqual(hover.contents[0].value, 'x-transition:enter');
    assert.ok(hover.contents[1].includes('entering phase'));
  });
});

// ── server: debounce onDidChangeContent ─────────────────────

suite('server: debounce onDidChangeContent', () => {
  test('attrCache updated eagerly (synchronous, no debounce wait)', () => {
    const { server } = createTestServer();
    fireDidChangeContent(server, 'file:///debounce1.html', '<div x-data="{ open: false }">');
    const attrs = server['attrCache'].get('file:///debounce1.html');
    assert.ok(attrs && attrs.length === 1, 'attrCache must be populated synchronously');
    assert.strictEqual(attrs[0].name, 'x-data');
    if (server['indexDebounceTimer']) clearTimeout(server['indexDebounceTimer']);
  });

  test('attrCache reflects latest text after rapid changes', () => {
    const { server } = createTestServer();
    fireDidChangeContent(server, 'file:///debounce2.html', '<div x-data="{ a: 1 }">');
    fireDidChangeContent(server, 'file:///debounce2.html', '<div x-data="{ b: 2 }">');
    const attrs = server['attrCache'].get('file:///debounce2.html');
    assert.ok(attrs && attrs.length === 1);
    assert.ok(attrs[0].value.includes('b:'), 'attrCache must hold the LATEST text');
    if (server['indexDebounceTimer']) clearTimeout(server['indexDebounceTimer']);
  });

  test('indexDebounceTimer is set after change (pending workspace update)', () => {
    const { server } = createTestServer();
    assert.strictEqual(server['indexDebounceTimer'], null, 'no timer before any change');
    fireDidChangeContent(server, 'file:///debounce3.html', '<div x-data="{ open: false }">');
    assert.ok(server['indexDebounceTimer'] !== null, 'timer must be pending after change');
    if (server['indexDebounceTimer']) clearTimeout(server['indexDebounceTimer']);
  });

  testAsync('workspace indexed only after 300ms debounce elapses', async () => {
    const { server } = createTestServer();
    fireDidChangeContent(server, 'file:///debounce4.html', '<div x-data="{ open: false }">');
    assert.strictEqual(server['workspace'].lookup('open').length, 0,
      'workspace must NOT be updated synchronously');
    await sleep(350);
    assert.strictEqual(server['workspace'].lookup('open').length, 1,
      'workspace must be indexed after debounce delay');
  });

  testAsync('3 rapid changes coalesce into single workspace.indexDocument call', async () => {
    const { server } = createTestServer();
    fireDidChangeContent(server, 'file:///debounce5.html', '<div x-data="{ a: 1 }">');
    await sleep(50);
    fireDidChangeContent(server, 'file:///debounce5.html', '<div x-data="{ a: 1, b: 2 }">');
    await sleep(50);
    fireDidChangeContent(server, 'file:///debounce5.html', '<div x-data="{ a: 1, b: 2, c: 3 }">');
    await sleep(350);
    const names = server['workspace'].allNames().sort();
    assert.deepStrictEqual(names, ['a', 'b', 'c'],
      'only the final state must be indexed (3 members), not intermediate ones');
  });
});

// ── workspace: incremental index update ─────────────────────

suite('workspace: incremental index update', () => {
  test('add method to file: new name appears, other file untouched', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    ws.indexDocument('file:///b.html', '<div x-data="{ count: 0 }">');
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false, toggle() {} }">');
    assert.ok(ws.lookup('toggle').length > 0, 'toggle added via incremental update');
    assert.ok(ws.lookup('open').length > 0, 'open still present');
    assert.ok(ws.lookup('count').length === 1, 'count in file b untouched');
  });

  test('remove all defs from file (empty new): old names disappear', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false, count: 0 }">');
    ws.indexDocument('file:///b.html', '<div x-data="{ other: true }">');
    ws.indexDocument('file:///a.html', '<div>');
    assert.strictEqual(ws.lookup('open').length, 0, 'open removed');
    assert.strictEqual(ws.lookup('count').length, 0, 'count removed');
    assert.ok(ws.lookup('other').length > 0, 'other still in file b');
  });

  test('rename method: old name gone, new name present', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    ws.indexDocument('file:///a.html', '<div x-data="{ closed: true }">');
    assert.strictEqual(ws.lookup('open').length, 0, 'old name gone');
    assert.ok(ws.lookup('closed').length > 0, 'new name present');
  });

  test('add Alpine.data registration: appears in dataRegistrations', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    assert.strictEqual(ws.allDataNames().length, 0);
    ws.indexDocument('file:///a.html',
      '<div x-data="{ open: false }"> Alpine.data(\'cart\', () => ({ items: [] }))');
    assert.ok(ws.allDataNames().includes('cart'), 'cart registration added');
    assert.ok(ws.lookupAlpineData('cart').length === 1);
  });

  test('remove Alpine.store: disappears from storeRegistrations', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///s.js', "Alpine.store('ui', { theme: 'dark' })");
    assert.ok(ws.allStoreNames().includes('ui'));
    ws.indexDocument('file:///s.js', '// nothing here');
    assert.strictEqual(ws.allStoreNames().length, 0, 'store removed on reindex');
    assert.strictEqual(ws.lookupAlpineStore('ui').length, 0);
  });

  test('same name in 2 files: removing one file keeps the other', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.html', '<div x-data="{ open: false }">');
    ws.indexDocument('file:///b.html', '<div x-data="{ open: true }">');
    assert.strictEqual(ws.lookup('open').length, 2);
    ws.indexDocument('file:///b.html', '<div x-data="{ closed: false }">');
    assert.strictEqual(ws.lookup('open').length, 1, 'only file a open remains');
    const remaining = ws.lookup('open')[0];
    assert.strictEqual(remaining.uri, 'file:///a.html');
  });

  test('incremental update produces identical result to full rebuildIndexes', () => {
    const inc = new WorkspaceIndex();
    inc.indexDocument('file:///a.html', '<div x-data="{ open: false, toggle() {} }">');
    inc.indexDocument('file:///b.js', "Alpine.data('cart', () => ({ items: [], add() {} }))");
    inc.indexDocument('file:///c.js', "Alpine.store('ui', { theme: 'dark' })");
    inc.indexDocument('file:///a.html', '<div x-data="{ open: false, toggle() {}, close() {} }">');
    inc.indexDocument('file:///b.js', "Alpine.data('cart', () => ({ items: [], add() {}, remove() {} }))");

    const full = new WorkspaceIndex();
    full.indexDocument('file:///a.html', '<div x-data="{ open: false, toggle() {}, close() {} }">');
    full.indexDocument('file:///b.js', "Alpine.data('cart', () => ({ items: [], add() {}, remove() {} }))");
    full.indexDocument('file:///c.js', "Alpine.store('ui', { theme: 'dark' })");

    assert.deepStrictEqual(inc.allNames().sort(), full.allNames().sort(),
      'nameIndex names must match');
    assert.deepStrictEqual(inc.allDataNames().sort(), full.allDataNames().sort(),
      'dataRegistrations names must match');
    assert.deepStrictEqual(inc.allStoreNames().sort(), full.allStoreNames().sort(),
      'storeRegistrations names must match');
    for (const name of full.allNames()) {
      assert.strictEqual(inc.lookup(name).length, full.lookup(name).length,
        `name ${name} entry count mismatch`);
    }
    for (const name of full.allDataNames()) {
      assert.strictEqual(inc.lookupAlpineData(name).length, full.lookupAlpineData(name).length,
        `data ${name} entry count mismatch`);
    }
  });
});

// ── workspace: indexDocument with precomputed attrs ─────────

suite('workspace: indexDocument with precomputed attrs', () => {
  test('precomputed attrs produce same defs as internal extractAlpineAttrs', () => {
    const ws1 = new WorkspaceIndex();
    const ws2 = new WorkspaceIndex();
    const html = '<div x-data="{ open: false, toggle() {} }">';
    ws1.indexDocument('file:///a.html', html);
    const attrs = extractAlpineAttrs(html);
    ws2.indexDocument('file:///a.html', html, attrs);
    assert.deepStrictEqual(
      ws1.lookup('open')[0],
      ws2.lookup('open')[0],
      'open def must be identical with/without precomputed attrs',
    );
    assert.deepStrictEqual(
      ws1.lookup('toggle')[0],
      ws2.lookup('toggle')[0],
      'toggle def must be identical with/without precomputed attrs',
    );
  });

  test('undefined attrs falls back to internal extractAlpineAttrs', () => {
    const ws = new WorkspaceIndex();
    const html = '<div x-data="{ count: 0 }">';
    ws.indexDocument('file:///a.html', html, undefined);
    assert.ok(ws.lookup('count').length > 0, 'fallback must index count');
  });

  test('empty attrs [] still indexes Alpine.data/store registrations', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.js',
      "Alpine.data('cart', () => ({ items: [] }))", []);
    assert.ok(ws.allDataNames().includes('cart'), 'Alpine.data still indexed with [] attrs');
    assert.strictEqual(ws.lookup('items').length, 1, 'registration member indexed');
    assert.strictEqual(ws.lookup('nonexistent').length, 0);
  });

  test('precomputed attrs for Alpine.store registration matches no-attrs path', () => {
    const ws1 = new WorkspaceIndex();
    const ws2 = new WorkspaceIndex();
    const js = "Alpine.store('ui', { theme: 'dark' })";
    ws1.indexDocument('file:///a.js', js);
    const attrs = extractAlpineAttrs(js);
    ws2.indexDocument('file:///a.js', js, attrs);
    assert.deepStrictEqual(
      ws1.lookupAlpineStore('ui')[0].def,
      ws2.lookupAlpineStore('ui')[0].def,
      'store def identical with/without precomputed attrs',
    );
  });
});

// ── Summary ─────────────────────────────────────────────────

// ── workspace: scanWorkspace logging ────────────────────────

suite('workspace: scanWorkspace logging', () => {
  test('scanWorkspace without logger is backward compatible and returns metrics', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-silent-'));
    try {
      fs.writeFileSync(path.join(tmp, 'app.js'), "Alpine.data('x', () => ({ a: 1 }))");
      const ws = new WorkspaceIndex();
      const metrics = ws.scanWorkspace(tmp);
      assert.ok(typeof metrics.durationMs === 'number', 'durationMs must be a number');
      assert.ok(typeof metrics.fileCount === 'number', 'fileCount must be a number');
      assert.ok(typeof metrics.skippedCount === 'number', 'skippedCount must be a number');
      assert.ok(metrics.durationMs >= 0, 'durationMs must be non-negative');
      assert.strictEqual(metrics.fileCount, 1, 'one file scanned');
      assert.strictEqual(metrics.skippedCount, 0, 'nothing skipped');
      assert.ok(ws.allDataNames().includes('x'), 'registration indexed');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('logger NOT called when scanning valid directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-clean-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.js'), "Alpine.data('a', () => ({}))");
      fs.writeFileSync(path.join(tmp, 'b.html'), '<div x-data="{ open: false }">');
      const logs = [];
      const logger = (level, msg) => logs.push({ level, msg });
      const ws = new WorkspaceIndex();
      const metrics = ws.scanWorkspace(tmp, logger);
      assert.strictEqual(logs.length, 0, 'no warnings on valid scan');
      assert.ok(metrics.fileCount >= 2, 'at least 2 files indexed');
      assert.strictEqual(metrics.skippedCount, 0, 'nothing skipped');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('logger emits warn with directory name for nonexistent path', () => {
    const bogus = path.join(os.tmpdir(), 'alpine-does-not-exist-' + process.pid);
    const logs = [];
    const logger = (level, msg) => logs.push({ level, msg });
    const ws = new WorkspaceIndex();
    const metrics = ws.scanWorkspace(bogus, logger);
    assert.ok(logs.length >= 1, 'at least one warn emitted');
    const warn = logs.find((l) => l.level === 'warn');
    assert.ok(warn, 'a warn-level entry must exist');
    assert.ok(warn.msg.includes(bogus), 'warn message must mention the directory path');
    assert.ok(warn.msg.includes('cannot read directory'), 'warn message must identify the failure kind');
    assert.strictEqual(metrics.fileCount, 0, 'no files scanned');
    assert.ok(metrics.skippedCount >= 1, 'at least one skip recorded');
  });

  test('logger emits warn with file path when readFileSync throws', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-rfail-'));
    try {
      const targetPath = path.join(tmp, 'forced-fail.js');
      fs.writeFileSync(targetPath, "Alpine.data('ok', () => ({}))");
      const origRead = fs.readFileSync;
      fs.readFileSync = function (p, opts) {
        if (typeof p === 'string' && p === targetPath) {
          throw new Error('synthetic read failure');
        }
        return origRead.apply(this, arguments);
      };
      try {
        const logs = [];
        const logger = (level, msg) => logs.push({ level, msg });
        const ws = new WorkspaceIndex();
        const metrics = ws.scanWorkspace(tmp, logger);
        const warn = logs.find((l) => l.level === 'warn' && l.msg.includes(targetPath));
        assert.ok(warn, 'a warn mentioning the failing file path must be logged');
        assert.ok(warn.msg.includes('cannot read file'), 'warn must identify the failure kind');
        assert.ok(metrics.skippedCount >= 1, 'skipped count incremented');
        assert.strictEqual(metrics.fileCount, 0, 'failed file must NOT be counted as scanned');
      } finally {
        fs.readFileSync = origRead;
      }
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

// ── server: error logging context ───────────────────────────

function createCapturingServer() {
  const { server, handlers } = createTestServer();
  const captured = { info: [], warn: [], error: [] };
  server['connection'].console.info = (m) => captured.info.push(m);
  server['connection'].console.warn = (m) => captured.warn.push(m);
  server['connection'].console.error = (m) => captured.error.push(m);
  return { server, handlers, captured };
}

suite('server: error logging context', () => {
  test('Parse error catch includes URI in error message', () => {
    const orig = require('../server/dist/extractor').extractAlpineAttrs;
    const extractorModule = require('../server/dist/extractor');
    const { server, captured } = createCapturingServer();
    try {
      extractorModule.extractAlpineAttrs = () => {
        throw new Error('forced parse failure');
      };
      const uri = 'file:///parse-err.html';
      fireDidChangeContent(server, uri, '<div x-data="{ open: false }">');
      const parseErr = captured.error.find((m) => m.includes('Parse error'));
      assert.ok(parseErr, 'Parse error must be logged');
      assert.ok(parseErr.includes(uri), 'Parse error log must include the URI');
      assert.ok(parseErr.includes('forced parse failure'), 'Parse error log must include the cause');
      if (server['indexDebounceTimer']) clearTimeout(server['indexDebounceTimer']);
    } finally {
      extractorModule.extractAlpineAttrs = orig;
    }
  });

  testAsync('Index error catch (debounced) includes URI in error message', async () => {
    const { server, captured } = createCapturingServer();
    const ws = server['workspace'];
    const origIndex = ws.indexDocument.bind(ws);
    ws.indexDocument = function () {
      throw new Error('forced index failure');
    };
    try {
      const uri = 'file:///index-err.html';
      fireDidChangeContent(server, uri, '<div x-data="{ open: false }">');
      await sleep(350);
      const indexErr = captured.error.find((m) => m.includes('Index error'));
      assert.ok(indexErr, 'Index error must be logged after debounce fires');
      assert.ok(indexErr.includes(uri), 'Index error log must include the URI');
      assert.ok(indexErr.includes('forced index failure'), 'Index error log must include the cause');
    } finally {
      ws.indexDocument = origIndex;
      if (server['indexDebounceTimer']) clearTimeout(server['indexDebounceTimer']);
    }
  });

  test('scanWorkspace warns forward to connection.console.warn via logger callback', () => {
    const { server, handlers, captured } = createCapturingServer();
    const bogus = path.join(os.tmpdir(), 'alpine-server-nowhere-' + process.pid);
    handlers.onInitialize({ rootUri: 'file://' + bogus });
    const scanWarn = captured.warn.find((m) => m.includes(bogus));
    assert.ok(scanWarn, 'scanWorkspace warn must be forwarded to connection.console.warn');
    assert.ok(scanWarn.includes('cannot read directory'), 'forwarded warn must identify failure kind');
  });

  test('Workspace scan failed catch includes rootPath in error message', () => {
    const { server, handlers, captured } = createCapturingServer();
    const ws = server['workspace'];
    const origScan = ws.scanWorkspace.bind(ws);
    ws.scanWorkspace = function () {
      throw new Error('forced scan failure');
    };
    try {
      const rootPath = '/forced/scan/path';
      handlers.onInitialize({ rootUri: 'file://' + rootPath });
      const scanErr = captured.error.find((m) => m.includes('Workspace scan failed'));
      assert.ok(scanErr, 'Workspace scan failed must be logged');
      assert.ok(scanErr.includes(rootPath), 'scan failed log must include rootPath');
      assert.ok(scanErr.includes('forced scan failure'), 'scan failed log must include the cause');
    } finally {
      ws.scanWorkspace = origScan;
    }
  });
});

// ── server: performance metrics ─────────────────────────────

suite('server: performance metrics', () => {
  test('onInitialize logs scan metrics line (files, skipped, ms)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-perf-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.js'), "Alpine.data('x', () => ({ a: 1 }))");
      fs.writeFileSync(path.join(tmp, 'b.html'), '<div x-data="{ open: false }">');
      const { server, handlers, captured } = createCapturingServer();
      handlers.onInitialize({ rootUri: 'file://' + tmp });
      const metricsLine = captured.info.find(
        (m) => m.startsWith('Workspace scan:') && m.includes('files'),
      );
      assert.ok(metricsLine, 'metrics log line must be present');
      assert.ok(metricsLine.includes('skipped'), 'metrics must mention skipped');
      assert.ok(/\d+ms/.test(metricsLine), 'metrics must contain <N>ms token');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('metrics durationMs is a positive number reflecting real elapsed time', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpine-perf2-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.js'), "Alpine.store('s', { x: 1 })");
      const ws = new WorkspaceIndex();
      const metrics = ws.scanWorkspace(tmp);
      assert.ok(metrics.durationMs >= 0, 'durationMs non-negative');
      assert.ok(metrics.durationMs < 5000, 'durationMs sanity bound (<5s)');
      assert.ok(metrics.fileCount >= 1, 'at least one file counted');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test('debounced indexDocument under 50ms does not emit timing log', async () => {
    const { server, captured } = createCapturingServer();
    fireDidChangeContent(server, 'file:///perf-fast.html', '<div x-data="{ open: false }">');
    await sleep(350);
    const timingLine = captured.info.find((m) => /indexed ".*" in \d+ms/.test(m));
    assert.strictEqual(timingLine, undefined,
      'no per-document timing line emitted for fast (<50ms) indexing');
    const debouncedLine = captured.info.find((m) => m.includes('workspace indexed (debounced)'));
    assert.ok(debouncedLine, 'the regular debounced log line must still be emitted for fast path');
  });

  test('debounced indexDocument over 50ms emits timing log with URI', async () => {
    const { server, captured } = createCapturingServer();
    const ws = server['workspace'];
    const origIndex = ws.indexDocument.bind(ws);
    ws.indexDocument = function (uri, text, attrs) {
      const start = Date.now();
      while (Date.now() - start < 70) { /* spin ~70ms to exceed the 50ms threshold */ }
      return origIndex(uri, text, attrs);
    };
    try {
      const uri = 'file:///perf-slow.html';
      fireDidChangeContent(server, uri, '<div x-data="{ open: false }">');
      await sleep(400);
      const timingLine = captured.info.find((m) => /indexed ".*" in \d+ms/.test(m));
      assert.ok(timingLine, 'timing log must be emitted when indexDocument takes >50ms');
      assert.ok(timingLine.includes(uri), 'timing log must include the URI');
    } finally {
      ws.indexDocument = origIndex;
      if (server['indexDebounceTimer']) clearTimeout(server['indexDebounceTimer']);
    }
  });
});

// ── Summary (final) ─────────────────────────────────────────

async function runAsync() {
  for (const t of asyncTests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${t.name}`);
      console.log(`    ${e.message}`);
    }
  }
}

// ── extractAlpineData: default parameter edge cases ─────────────

suite('extractAlpineData: default param in object literal', () => {
  test('Alpine.data with default param { items: [] } skips param brace', () => {
    const js = `Alpine.data('cart', (initial = { items: [] }) => ({
      items: initial.items ?? [],
      hasItem(id) { return true; },
      remove(id) { this.items = []; },
    }));`;
    const regs = extractAlpineData(js);
    assert.strictEqual(regs.length, 1);
    assert.strictEqual(regs[0].registrationName, 'cart');
    assert.ok(regs[0].objectLiteral.includes('hasItem'), 'objectLiteral must contain hasItem');
    assert.ok(regs[0].objectLiteral.includes('remove'), 'objectLiteral must contain remove');
    assert.ok(!regs[0].objectLiteral.trim().startsWith('items: []'), 'must not capture default param');
  });

  test('Alpine.data without params still works', () => {
    const js = `Alpine.data('blog', () => ({
      visibleCount: 6,
      showMore() {},
    }));`;
    const regs = extractAlpineData(js);
    assert.strictEqual(regs.length, 1);
    assert.strictEqual(regs[0].registrationName, 'blog');
    assert.ok(regs[0].objectLiteral.includes('visibleCount'));
    assert.ok(regs[0].objectLiteral.includes('showMore'));
  });

  test('Alpine.data with simple param (no default object)', () => {
    const js = `Alpine.data('filters', (data = {}) => ({
      open: false,
      toggle() {},
    }));`;
    const regs = extractAlpineData(js);
    assert.strictEqual(regs.length, 1);
    assert.ok(regs[0].objectLiteral.includes('toggle'));
  });

  test('resolveScope strips parentheses from registration name', () => {
    const ws = new WorkspaceIndex();
    const js = `Alpine.data('blog', () => ({
      visibleCount: 6,
      showMore() {},
    }));`;
    const regs = extractAlpineData(js);
    ws.indexDocument('file:///blog.js', js);
    const scope = ws.resolveScope('blog()', 'file:///blog.js');
    assert.ok(scope, 'resolveScope must find scope for "blog()"');
    assert.ok(scope.members.some(m => m.name === 'showMore'), 'members must include showMore');
  });
});

// ── Scope-aware $store/$magic chain resolution ──────────────

suite('extractAlpineMagic', () => {
  test("extracts Alpine.magic('modal', () => ({ show() {}, hide() {} }))", () => {
    const js = "Alpine.magic('modal', () => ({ show() {}, hide() {} }))";
    const regs = extractAlpineMagic(js);
    assert.strictEqual(regs.length, 1);
    assert.strictEqual(regs[0].registrationName, 'modal');
    assert.strictEqual(regs[0].kind, 'Alpine.magic');
    assert.ok(regs[0].objectLiteral.includes('show'));
    assert.ok(regs[0].objectLiteral.includes('hide'));
  });

  test('extracts multiple Alpine.magic registrations', () => {
    const js = `
      Alpine.magic('modal', () => ({ show() {} }));
      Alpine.magic('confirm', () => ({ ask() {} }));
    `;
    const regs = extractAlpineMagic(js);
    assert.strictEqual(regs.length, 2);
    const names = regs.map(r => r.registrationName);
    assert.ok(names.includes('modal'));
    assert.ok(names.includes('confirm'));
  });

  test("uses double quotes: Alpine.magic(\"tooltip\", () => ({}))", () => {
    const js = 'Alpine.magic("tooltip", () => ({ open() {} }))';
    const regs = extractAlpineMagic(js);
    assert.strictEqual(regs.length, 1);
    assert.strictEqual(regs[0].registrationName, 'tooltip');
  });

  test('does NOT extract Alpine.data or Alpine.store', () => {
    const js = "Alpine.data('modal', () => ({})) Alpine.store('ui', {})";
    const regs = extractAlpineMagic(js);
    assert.strictEqual(regs.length, 0);
  });

  test('returns empty for text without Alpine.magic', () => {
    assert.strictEqual(extractAlpineMagic('const x = 1').length, 0);
    assert.strictEqual(extractAlpineMagic('').length, 0);
  });
});

suite('WorkspaceIndex.lookupAlpineMagic', () => {
  test("lookupAlpineMagic('modal') returns registration after indexDocument", () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///magic.js', "Alpine.magic('modal', () => ({ show() {}, hide() {} }))");
    const regs = ws.lookupAlpineMagic('modal');
    assert.ok(regs.length > 0, 'should return one entry per member');
    assert.strictEqual(regs[0].def.registrationName, 'modal');
    assert.strictEqual(regs[0].def.registrationKind, 'Alpine.magic');
  });

  test('allMagicNames returns all registered magic names', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///a.js', "Alpine.magic('modal', () => ({ show() {} }))");
    ws.indexDocument('file:///b.js', "Alpine.magic('confirm', () => ({ ask() {} }))");
    const names = ws.allMagicNames();
    assert.ok(names.includes('modal'));
    assert.ok(names.includes('confirm'));
  });

  test('lookupAlpineMagic returns [] for unknown name', () => {
    const ws = new WorkspaceIndex();
    assert.deepStrictEqual(ws.lookupAlpineMagic('nope'), []);
  });

  test('getRegistrationMembers returns magic members', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///m.js', "Alpine.magic('modal', () => ({ show() {}, hide() {} }))");
    const regs = ws.lookupAlpineMagic('modal');
    const members = ws.getRegistrationMembers(regs[0].def, regs[0].text);
    const names = members.map(m => m.name);
    assert.ok(names.includes('show'));
    assert.ok(names.includes('hide'));
  });

  test('incremental update: removing Alpine.magic clears the registration', () => {
    const ws = new WorkspaceIndex();
    ws.indexDocument('file:///m.js', "Alpine.magic('modal', () => ({ show() {} }))");
    assert.strictEqual(ws.allMagicNames().length, 1);
    ws.indexDocument('file:///m.js', '// nothing');
    assert.strictEqual(ws.allMagicNames().length, 0);
    assert.strictEqual(ws.lookupAlpineMagic('modal').length, 0);
  });
});

suite('$store/$magic chain: onDefinition', () => {
  test('$store.catalogMenu.isOpen → returns catalogMenu store member, NOT modal', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js',
      "Alpine.store('catalogMenu', () => ({ isOpen: false, toggle() {} }))");
    loadDocument(server, 'file:///modal.js',
      "Alpine.magic('modal', () => ({ show() {}, hide() {} }))");
    const html = '<div x-data="{}"><button @click="$store.catalogMenu.isOpen">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('isOpen') + 1;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result, 'should resolve isOpen to a location');
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///store.js', 'must point to store.js, not modal.js');
  });

  test('$store.catalogMenu (cursor on NAME) → returns store registration location', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js',
      "Alpine.store('catalogMenu', () => ({ isOpen: false }))");
    const html = '<div><button @click="$store.catalogMenu">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('catalogMenu') + 3;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///store.js');
  });

  test('$modal.show → returns modal magic member', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///magic.js',
      "Alpine.magic('modal', () => ({ show() {}, hide() {} }))");
    const html = '<div><button @click="$modal.show()">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('show') + 1;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result, 'should resolve show to magic registration');
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///magic.js');
  });

  test('$modal.unknownMember → returns null (member not found)', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///magic.js',
      "Alpine.magic('modal', () => ({ show() {} }))");
    const html = '<div><button @click="$modal.unknownMember()">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('unknownMember') + 1;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.strictEqual(result, null);
  });

  test('bare word (no chain) still works — does not regress', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///lib.js', "Alpine.data('cart', () => ({ items: [] }))");
    const html = '<div x-data="cart"><button @click="items">';
    const doc = loadDocument(server, 'file:///use.html', html);
    const cursorOffset = html.indexOf('items') + 1;
    const result = server['onDefinition']({
      textDocument: { uri: 'file:///use.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.strictEqual(loc.uri, 'file:///lib.js');
  });
});

suite('$store/$magic chain: onHover', () => {
  test('$store.catalogMenu (hover on NAME) → shows store info with member list', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js',
      "Alpine.store('catalogMenu', () => ({ isOpen: false, toggle() {} }))");
    const html = '<div><button @click="$store.catalogMenu">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('catalogMenu') + 3;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.strictEqual(sig.language, 'typescript');
    assert.ok(sig.value.includes("Alpine.store('catalogMenu')"));
    const detail = hover.contents[1];
    assert.ok(detail.includes('isOpen'), 'member list includes isOpen');
    assert.ok(detail.includes('toggle'), 'member list includes toggle');
  });

  test('$store.catalogMenu.isOpen (hover on member) → shows member signature', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js',
      "Alpine.store('catalogMenu', () => ({ isOpen: false }))");
    const html = '<div><button @click="$store.catalogMenu.isOpen">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('isOpen') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.ok(sig.value.includes('isOpen'));
  });

  test('$modal.show (hover) → shows magic member signature', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///magic.js',
      "Alpine.magic('modal', () => ({ show() {}, hide() {} }))");
    const html = '<div><button @click="$modal.show()">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('show') + 1;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    const sig = hover.contents[0];
    assert.ok(sig.value.includes('show'));
  });

  test('hover on $store word itself → still shows magic property doc (no regression)', () => {
    const { server } = createTestServer();
    const html = '<div @click="$store">';
    const doc = loadDocument(server, 'file:///h.html', html);
    const cursorOffset = html.indexOf('$store') + 2;
    const hover = server['onHover']({
      textDocument: { uri: 'file:///h.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.ok(hover);
    assert.ok(hover.contents[0].value.includes('$store'));
  });
});

suite('$store/$magic chain: onCompletion', () => {
  test('$store. → shows all registered store names', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///s1.js', "Alpine.store('catalogMenu', { a: 1 })");
    loadDocument(server, 'file:///s2.js', "Alpine.store('ui', { theme: 'dark' })");
    const html = '<div><button @click="$store.">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('$store.') + '$store.'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('catalogMenu'));
    assert.ok(labels.includes('ui'));
  });

  test('$store.catal → filters store names by prefix', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///s1.js', "Alpine.store('catalogMenu', { a: 1 })");
    loadDocument(server, 'file:///s2.js', "Alpine.store('ui', { theme: 'dark' })");
    const html = '<div><button @click="$store.catal">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('$store.catal') + '$store.catal'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('catalogMenu'));
    assert.ok(!labels.includes('ui'), 'ui should be filtered out by prefix');
  });

  test('$store.catalogMenu. → shows catalogMenu members only', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///s1.js',
      "Alpine.store('catalogMenu', () => ({ isOpen: false, toggle() {} }))");
    loadDocument(server, 'file:///s2.js',
      "Alpine.store('ui', { theme: 'dark' })");
    const html = '<div><button @click="$store.catalogMenu.">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('$store.catalogMenu.') + '$store.catalogMenu.'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('isOpen'), 'catalogMenu member isOpen present');
    assert.ok(labels.includes('toggle'), 'catalogMenu member toggle present');
    assert.ok(!labels.includes('theme'), 'ui store member theme must NOT appear');
  });

  test('$modal. → shows modal magic members', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///magic.js',
      "Alpine.magic('modal', () => ({ show() {}, hide() {} }))");
    const html = '<div><button @click="$modal.">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('$modal.') + '$modal.'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('show'));
    assert.ok(labels.includes('hide'));
  });

  test('$store. with no stores registered → returns []', () => {
    const { server } = createTestServer();
    const html = '<div><button @click="$store.">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('$store.') + '$store.'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.deepStrictEqual(items, []);
  });

  test('$magic. for unregistered magic → returns []', () => {
    const { server } = createTestServer();
    const html = '<div><button @click="$unknown.">';
    const doc = loadDocument(server, 'file:///view.html', html);
    const cursorOffset = html.indexOf('$unknown.') + '$unknown.'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///view.html' },
      position: doc.positionAt(cursorOffset),
    });
    assert.deepStrictEqual(items, []);
  });

  test('this. (non-chain) still returns scope members — no regression', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }"><button @click="this.">';
    const doc = loadDocument(server, 'file:///c.html', html);
    const cursorOffset = html.indexOf('this.') + 'this.'.length;
    const items = server['onCompletion']({
      textDocument: { uri: 'file:///c.html' },
      position: doc.positionAt(cursorOffset),
    });
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('open'), 'scope members still returned for this.');
  });
});

// ─── Tree-sitter language files ─────────────────────────────────────────
suite('tree-sitter language files', () => {
  const langDir = path.join(__dirname, '..', 'languages', 'html-alpine');

  test('config.toml exists', () => {
    assert.ok(fs.existsSync(path.join(langDir, 'config.toml')));
  });

  test('injections.scm exists', () => {
    assert.ok(fs.existsSync(path.join(langDir, 'injections.scm')));
  });

  test('highlights.scm exists', () => {
    assert.ok(fs.existsSync(path.join(langDir, 'highlights.scm')));
  });

  test('config.toml has name = "HTML (Alpine)"', () => {
    const config = fs.readFileSync(path.join(langDir, 'config.toml'), 'utf-8');
    assert.ok(config.includes('name = "HTML (Alpine)"'));
  });

  test('config.toml has grammar = "html"', () => {
    const config = fs.readFileSync(path.join(langDir, 'config.toml'), 'utf-8');
    assert.ok(config.includes('grammar = "html"'));
  });

  test('injections.scm contains JS injection for Alpine directives', () => {
    const inj = fs.readFileSync(path.join(langDir, 'injections.scm'), 'utf-8');
    assert.ok(inj.includes('injection.language'), 'missing injection.language');
    assert.ok(inj.includes('"javascript"'), 'missing javascript injection');
    assert.ok(inj.includes('x-data'), 'missing x-data injection rule');
  });

  test('highlights.scm contains Alpine directive highlight rules', () => {
    const hl = fs.readFileSync(path.join(langDir, 'highlights.scm'), 'utf-8');
    assert.ok(hl.includes('@keyword'), 'missing @keyword capture');
    assert.ok(hl.includes('^x-') || hl.includes('^x-'), 'missing x- directive pattern');
  });
});

// ─── data.ts coverage ───────────────────────────────────────────────────
suite('data.ts coverage', () => {
  const NEW_MODIFIERS = ['.dot', '.passive.false', '.change', '.blur', '.enter', '.duration', '.delay', '.opacity', '.scale', '.origin'];

  test('all 10 new modifiers present in MODIFIERS', () => {
    for (const name of NEW_MODIFIERS) {
      const mod = MODIFIERS.find((m) => m.name === name);
      assert.ok(mod, `modifier ${name} not found in MODIFIERS`);
      assert.ok(mod.for.length > 0, `modifier ${name} has empty for[]`);
      assert.ok(mod.documentation.length > 0, `modifier ${name} has empty documentation`);
    }
  });

  test('MODIFIERS total count >= 29', () => {
    assert.ok(MODIFIERS.length >= 29, `expected >= 29 modifiers, got ${MODIFIERS.length}`);
  });

  test('GLOBAL_APIS has exactly 9 entries', () => {
    assert.strictEqual(GLOBAL_APIS.length, 9, `expected 9 global APIs, got ${GLOBAL_APIS.length}`);
  });

  test('all GLOBAL_APIS have name, signature, description', () => {
    for (const api of GLOBAL_APIS) {
      assert.ok(api.name.startsWith('Alpine.'), `API name should start with "Alpine." got: ${api.name}`);
      assert.ok(api.signature.length > 0, `API ${api.name} has empty signature`);
      assert.ok(api.description.length > 0, `API ${api.name} has empty description`);
    }
  });

  test('expected global APIs present', () => {
    const expected = ['Alpine.data', 'Alpine.store', 'Alpine.bind', 'Alpine.start', 'Alpine.plugin', 'Alpine.directive', 'Alpine.magic', 'Alpine.reactive', 'Alpine.effect'];
    for (const name of expected) {
      const api = GLOBAL_APIS.find((a) => a.name === name);
      assert.ok(api, `global API ${name} not found`);
    }
  });
});

// ── AlpineLanguageServer.onDocumentSymbol ───────────────────

suite('Document Symbols', () => {
  test('inline x-data → method + property symbols', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false, toggle() { this.open = !this.open } }">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const symbols = server['onDocumentSymbol']({
      textDocument: { uri: 'file:///test.html' },
    });
    assert.ok(symbols.length >= 1, 'should have at least 1 parent symbol');
    const xdataSymbol = symbols.find(s => s.name.includes('x-data'));
    assert.ok(xdataSymbol, 'should have x-data parent symbol');
    assert.strictEqual(xdataSymbol.kind, SymbolKind.Object);
    assert.ok(xdataSymbol.children, 'should have child symbols');
    assert.ok(xdataSymbol.children.length >= 2, 'should have open + toggle');
    const openSym = xdataSymbol.children.find(c => c.name === 'open');
    assert.ok(openSym, 'should have open property');
    assert.strictEqual(openSym.kind, SymbolKind.Property);
    const toggleSym = xdataSymbol.children.find(c => c.name === 'toggle');
    assert.ok(toggleSym, 'should have toggle method');
    assert.strictEqual(toggleSym.kind, SymbolKind.Method);
  });

  test('empty document → empty symbols', () => {
    const { server } = createTestServer();
    const html = '<div class="foo">no alpine here</div>';
    const doc = loadDocument(server, 'file:///test.html', html);
    const symbols = server['onDocumentSymbol']({
      textDocument: { uri: 'file:///test.html' },
    });
    assert.strictEqual(symbols.length, 0);
  });

  test('x-data with no members → skipped', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{}">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const symbols = server['onDocumentSymbol']({
      textDocument: { uri: 'file:///test.html' },
    });
    assert.strictEqual(symbols.length, 0);
  });

  test('multiple x-data on same page → multiple parent symbols', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ a: 1 }"><span x-data="{ b: 2 }">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const symbols = server['onDocumentSymbol']({
      textDocument: { uri: 'file:///test.html' },
    });
    const xdataSymbols = symbols.filter(s => s.name.includes('x-data'));
    assert.strictEqual(xdataSymbols.length, 2);
  });

  test('registered x-data name → resolved members from workspace', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///comp.js', "Alpine.data('dropdown', () => ({ open: false, toggle() { this.open = !this.open } }))");
    const html = '<div x-data="dropdown">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const symbols = server['onDocumentSymbol']({
      textDocument: { uri: 'file:///test.html' },
    });
    const xdataSymbol = symbols.find(s => s.name.includes('x-data'));
    assert.ok(xdataSymbol, 'should have x-data symbol for registered component');
    if (xdataSymbol && xdataSymbol.children) {
      assert.ok(xdataSymbol.children.find(c => c.name === 'open'), 'should resolve open from registration');
    }
  });

  test('symbol ranges are within document bounds', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const symbols = server['onDocumentSymbol']({
      textDocument: { uri: 'file:///test.html' },
    });
    for (const sym of symbols) {
      const startPos = sym.range.start;
      const endPos = sym.range.end;
      assert.ok(startPos.line >= 0 && startPos.character >= 0, `${sym.name} start position invalid`);
      assert.ok(endPos.line >= startPos.line, `${sym.name} end before start`);
    }
  });
});

// ── computeDiagnostics ──
suite('Diagnostics', () => {
  test('x-if outside template → Error diagnostic', () => {
    const { server } = createTestServer();
    const html = '<div x-if="show">text</div>';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, DiagnosticSeverity.Error);
    assert.strictEqual(diags[0].code, 'x-if-template');
  });

  test('x-if inside template → no diagnostic', () => {
    const { server } = createTestServer();
    const html = '<template x-if="show"><div>text</div></template>';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    const templateDiags = diags.filter(d => d.code === 'x-if-template');
    assert.strictEqual(templateDiags.length, 0);
  });

  test('x-for outside template → Error', () => {
    const { server } = createTestServer();
    const html = '<div x-for="item in items">text</div>';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    assert.ok(diags.some(d => d.code === 'x-if-template' && d.severity === DiagnosticSeverity.Error));
  });

  test('duplicate x-data on same element → Error', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ a: 1 }" x-data="{ b: 2 }">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    const dupDiags = diags.filter(d => d.code === 'duplicate-x-data');
    assert.strictEqual(dupDiags.length, 2);
    assert.strictEqual(dupDiags[0].severity, DiagnosticSeverity.Error);
  });

  test('unregistered component → Warning', () => {
    const { server } = createTestServer();
    const html = '<div x-data="nonexistent">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    assert.ok(diags.some(d => d.code === 'unregistered-component' && d.severity === DiagnosticSeverity.Warning));
  });

  test('registered component → no unregistered diagnostic', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///comp.js', "Alpine.data('dropdown', () => ({ open: false }))");
    const html = '<div x-data="dropdown">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    const unregDiags = diags.filter(d => d.code === 'unregistered-component');
    assert.strictEqual(unregDiags.length, 0);
  });

  test('inline x-data → no unregistered diagnostic', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    const unregDiags = diags.filter(d => d.code === 'unregistered-component');
    assert.strictEqual(unregDiags.length, 0);
  });

  test('clean document → no diagnostics', () => {
    const { server } = createTestServer();
    const html = '<template x-if="show"><div x-data="{ a: 1 }"></div></template>';
    const doc = loadDocument(server, 'file:///d.html', html);
    const diags = server['computeDiagnostics']('file:///d.html', doc);
    assert.strictEqual(diags.length, 0);
  });
});

// ── onDocumentLink ──
suite('Document Links', () => {
  test('x-data registered → link to registration file', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///comp.js', "Alpine.data('dropdown', () => ({ open: false }))");
    const html = '<div x-data="dropdown">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const links = server['onDocumentLink']({
      textDocument: { uri: 'file:///test.html' },
    });
    assert.strictEqual(links.length, 1);
    assert.ok(links[0].target);
    assert.ok(links[0].tooltip.includes('dropdown'));
    assert.ok(links[0].range);
  });

  test('x-data inline → no link', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const links = server['onDocumentLink']({
      textDocument: { uri: 'file:///test.html' },
    });
    assert.strictEqual(links.length, 0);
  });

  test('x-data unregistered → no link', () => {
    const { server } = createTestServer();
    const html = '<div x-data="nonexistent">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const links = server['onDocumentLink']({
      textDocument: { uri: 'file:///test.html' },
    });
    assert.strictEqual(links.length, 0);
  });

  test('$store.NAME → link to store registration', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js', "Alpine.store('ui', { open: false })");
    const html = '<div x-data x-init="$store.ui.toggle()">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const links = server['onDocumentLink']({
      textDocument: { uri: 'file:///test.html' },
    });
    const storeLinks = links.filter(l => l.tooltip && l.tooltip.includes('Alpine.store'));
    assert.strictEqual(storeLinks.length, 1);
    assert.ok(storeLinks[0].tooltip.includes('ui'));
  });

  test('multiple $store references → multiple links', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js', "Alpine.store('ui', { open: false }); Alpine.store('cart', { count: 0 })");
    const html = '<div x-data x-init="$store.ui.open && $store.cart.add()">';
    const doc = loadDocument(server, 'file:///test.html', html);
    const links = server['onDocumentLink']({
      textDocument: { uri: 'file:///test.html' },
    });
    const storeLinks = links.filter(l => l.tooltip && l.tooltip.includes('Alpine.store'));
    assert.strictEqual(storeLinks.length, 2);
  });

  test('empty document → no links', () => {
    const { server } = createTestServer();
    const html = '<div class="foo">no alpine here</div>';
    const doc = loadDocument(server, 'file:///test.html', html);
    const links = server['onDocumentLink']({
      textDocument: { uri: 'file:///test.html' },
    });
    assert.strictEqual(links.length, 0);
  });
});

// ── References + Rename ──
suite('References + Rename', () => {
  test('references for Alpine.data → finds x-data usages', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///comp.js', "Alpine.data('dropdown', () => ({ open: false }))");
    const html = '<div x-data="dropdown">';
    const doc = loadDocument(server, 'file:///page.html', html);
    const cursorOffset = html.indexOf('dropdown') + 3;
    const refs = server['onReferences']({
      textDocument: { uri: 'file:///page.html' },
      position: doc.positionAt(cursorOffset),
      context: { includeDeclaration: true },
    });
    assert.ok(refs.length >= 1);
    const pageRefs = refs.filter(r => r.uri === 'file:///page.html');
    assert.ok(pageRefs.length >= 1, 'should find usage in page.html');
  });

  test('references for Alpine.store → finds $store.name usages', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js', "Alpine.store('ui', { open: false })");
    const html = '<div x-data x-init="$store.ui.toggle()">';
    const doc = loadDocument(server, 'file:///page.html', html);
    const cursorOffset = html.indexOf('$store.ui') + 7;
    const refs = server['onReferences']({
      textDocument: { uri: 'file:///page.html' },
      position: doc.positionAt(cursorOffset),
      context: { includeDeclaration: true },
    });
    assert.ok(refs.length >= 1);
    const storeRefs = refs.filter(r => r.uri === 'file:///page.html');
    assert.ok(storeRefs.length >= 1, 'should find $store.ui usage');
  });

  test('references on unregistered symbol → empty', () => {
    const { server } = createTestServer();
    const html = '<div x-data="nonexistent">';
    const doc = loadDocument(server, 'file:///page.html', html);
    const cursorOffset = html.indexOf('nonexistent') + 3;
    const refs = server['onReferences']({
      textDocument: { uri: 'file:///page.html' },
      position: doc.positionAt(cursorOffset),
      context: { includeDeclaration: true },
    });
    assert.ok(refs.length === 0 || refs.every(r => r.uri !== 'file:///registered.js'));
  });

  test('rename Alpine.data → WorkspaceEdit with usages', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///comp.js', "Alpine.data('dropdown', () => ({ open: false }))");
    const html = '<div x-data="dropdown">';
    const doc = loadDocument(server, 'file:///page.html', html);
    const cursorOffset = html.indexOf('dropdown') + 3;
    const result = server['onRename']({
      textDocument: { uri: 'file:///page.html' },
      position: doc.positionAt(cursorOffset),
      newName: 'menu',
    });
    assert.ok(result);
    assert.ok(result.changes);
    const pageEdits = result.changes['file:///page.html'];
    assert.ok(pageEdits && pageEdits.length >= 1);
    assert.ok(pageEdits.some(e => e.newText === 'menu'));
  });

  test('rename Alpine.store → WorkspaceEdit with usages', () => {
    const { server } = createTestServer();
    loadDocument(server, 'file:///store.js', "Alpine.store('ui', { sidebar: false })");
    const html = '<div x-data x-init="$store.ui.toggle()">';
    const doc = loadDocument(server, 'file:///page.html', html);
    const cursorOffset = html.indexOf('$store.ui') + 7;
    const result = server['onRename']({
      textDocument: { uri: 'file:///page.html' },
      position: doc.positionAt(cursorOffset),
      newName: 'interface',
    });
    assert.ok(result);
    assert.ok(result.changes);
    const pageEdits = result.changes['file:///page.html'];
    assert.ok(pageEdits && pageEdits.length >= 1);
    assert.ok(pageEdits.some(e => e.newText === 'interface'));
  });

  test('references on inline x-data → empty (no registration to search)', () => {
    const { server } = createTestServer();
    const html = '<div x-data="{ open: false }">';
    const doc = loadDocument(server, 'file:///page.html', html);
    const cursorOffset = html.indexOf('{ open') + 2;
    const refs = server['onReferences']({
      textDocument: { uri: 'file:///page.html' },
      position: doc.positionAt(cursorOffset),
      context: { includeDeclaration: true },
    });
    assert.strictEqual(refs.length, 0);
  });

  test('empty document → empty references', () => {
    const { server } = createTestServer();
    const html = '<div class="foo">no alpine</div>';
    const doc = loadDocument(server, 'file:///page.html', html);
    const refs = server['onReferences']({
      textDocument: { uri: 'file:///page.html' },
      position: { line: 0, character: 5 },
      context: { includeDeclaration: true },
    });
    assert.strictEqual(refs.length, 0);
  });
});

async function main() {
  if (asyncTests.length > 0) {
    await runAsync();
  }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main();
