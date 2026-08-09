export interface AlpineAttr {
  name: string;
  value: string;
  valueOffset: number;
  valueLength: number;
}

const ALPINE_PREFIXES = ['x-', '@', ':'];

export function isAlpineAttr(name: string): boolean {
  return ALPINE_PREFIXES.some((p) => name.startsWith(p));
}

// Match HTML attributes: name="value" or name='value'
// Captures: group 1 = name, group 2 = double-quoted value, group 3 = single-quoted value
const ATTR_REGEX =
  /(@?[\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function extractAlpineAttrs(text: string): AlpineAttr[] {
  const attrs: AlpineAttr[] = [];
  let match: RegExpExecArray | null;

  ATTR_REGEX.lastIndex = 0;
  while ((match = ATTR_REGEX.exec(text)) !== null) {
    const rawName = match[1];
    if (!isAlpineAttr(rawName)) continue;

    const value = match[2] ?? match[3] ?? '';
    const quoteChar = match[2] !== undefined ? '"' : "'";

    const fullMatch = match[0];
    const nameEndInMatch = fullMatch.indexOf(rawName) + rawName.length;
    const quotePosInMatch = fullMatch.indexOf(quoteChar, nameEndInMatch);
    const valueOffset = match.index + quotePosInMatch + 1;

    attrs.push({
      name: rawName,
      value,
      valueOffset,
      valueLength: value.length,
    });
  }

  return attrs;
}

export function findAttrAtOffset(
  attrs: AlpineAttr[],
  offset: number,
): AlpineAttr | null {
  for (const attr of attrs) {
    const start = attr.valueOffset;
    const end = attr.valueOffset + attr.valueLength;
    if (offset >= start && offset <= end) {
      return attr;
    }
  }
  return null;
}

// ── Alpine.data() / Alpine.store() extraction ───────────────────

export interface AlpineRegistration {
  /** Component or store name, e.g. 'modal' or 'settings' */
  registrationName: string;
  /** The object literal body (content between outermost { and }) */
  objectLiteral: string;
  /** Absolute offset of the first char inside the opening { */
  objectOffset: number;
  /** Type label for display: "Alpine.data" or "Alpine.store" */
  kind: 'Alpine.data' | 'Alpine.store';
}

/**
 * Match a balanced `{ … }` block starting at `openBraceOffset`.
 * Handles nested objects, strings (single/double/backtick), escapes,
 * line comments (//), block comments (/* *\/), and template interpolation (${...}).
 * Returns the offset of the closing `}`, or `null` if unbalanced.
 */
export function matchBraces(text: string, openBraceOffset: number): number | null {
  let depth = 1;
  let inString = false;
  let stringChar = '';
  let i = openBraceOffset + 1;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      if (ch === '\\') { i += 2; continue; }
      if (stringChar === '`' && ch === '$' && text[i + 1] === '{') {
        // Template interpolation: scan to matching } of ${...}
        i += 2;
        let interpDepth = 1;
        let interpInString = false;
        let interpStringChar = '';
        while (i < text.length && interpDepth > 0) {
          const ic = text[i];
          if (interpInString) {
            if (ic === '\\') { i += 2; continue; }
            if (ic === interpStringChar) interpInString = false;
          } else {
            if (ic === '"' || ic === "'" || ic === '`') {
              interpInString = true;
              interpStringChar = ic;
            } else if (ic === '{') {
              interpDepth++;
            } else if (ic === '}') {
              interpDepth--;
            }
          }
          i++;
        }
        continue;
      }
      if (ch === stringChar) inString = false;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
      } else if (ch === '/' && text[i + 1] === '/') {
        // line comment — skip to end of line
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      } else if (ch === '/' && text[i + 1] === '*') {
        // block comment — skip to */
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2;
        continue;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    i++;
  }
  return null;
}

/**
 * From `offset` forward, find the first `{` that begins an object literal.
 * Skips parens, brackets, strings, arrow `=>`, and `return` keyword.
 */
function findObjectBraceStart(text: string, from: number): number {
  let parenDepth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = from; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
    } else if (ch === '(' || ch === '[') {
      parenDepth++;
    } else if (ch === ')' || ch === ']') {
      parenDepth--;
    } else if (ch === '{' && parenDepth <= 1) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract all `Alpine.data('name', () => ({ … }))` registrations.
 * Handles common forms:
 *   Alpine.data('foo', () => ({ … }))
 *   Alpine.data('foo', () => { return { … } })
 *   Alpine.data('foo', { … })
 */
export function extractAlpineData(text: string): AlpineRegistration[] {
  return extractRegistration(text, /\bAlpine\.data\s*\(\s*['"]([^'"]+)['"]/g, 'Alpine.data');
}

/**
 * Extract all `Alpine.store('name', { … })` registrations.
 */
export function extractAlpineStore(text: string): AlpineRegistration[] {
  return extractRegistration(text, /\bAlpine\.store\s*\(\s*['"]([^'"]+)['"]/g, 'Alpine.store');
}

function extractRegistration(
  text: string,
  nameRegex: RegExp,
  kind: 'Alpine.data' | 'Alpine.store',
): AlpineRegistration[] {
  const results: AlpineRegistration[] = [];
  nameRegex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = nameRegex.exec(text)) !== null) {
    const registrationName = match[1];
    const searchFrom = match.index + match[0].length;
    const braceStart = findObjectBraceStart(text, searchFrom);

    if (braceStart === -1) continue;

    let actualBraceStart = braceStart;
    const afterFirstBrace = text.indexOf('}', braceStart);
    const contentBetween = text.slice(braceStart + 1, afterFirstBrace === -1 ? text.length : afterFirstBrace).trim();
    if (/^(?:return\s*)?$/i.test(contentBetween) || /^\{[\s\S]*return\s*\{/.test(text.slice(braceStart, braceStart + 200))) {
      const innerBrace = findObjectBraceStart(text, braceStart + 1);
      if (innerBrace !== -1 && innerBrace > braceStart) {
        actualBraceStart = innerBrace;
      }
    }

    const braceEnd = matchBraces(text, actualBraceStart);
    if (braceEnd === null) continue;

    results.push({
      registrationName,
      objectLiteral: text.slice(actualBraceStart + 1, braceEnd),
      objectOffset: actualBraceStart + 1,
      kind,
    });
  }

  return results;
}

// Normalise attribute name: x-on:click → @click, x-bind:class → :class
export function normalizeAttrName(name: string): string {
  if (name.startsWith('x-on:')) return '@' + name.slice(5);
  if (name.startsWith('x-bind:')) return ':' + name.slice(7);
  return name;
}

export function isXData(name: string): boolean {
  return name === 'x-data';
}
