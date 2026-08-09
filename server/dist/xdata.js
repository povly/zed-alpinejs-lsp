"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseXData = parseXData;
const JS_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function',
    'return', 'new', 'delete', 'typeof', 'instanceof',
    'void', 'in', 'of', 'class', 'super', 'import', 'export',
    'true', 'false', 'null', 'undefined', 'this', 'NaN',
]);
function isValidMemberName(name) {
    if (JS_KEYWORDS.has(name))
        return false;
    if (/^\d+$/.test(name))
        return false;
    if (name.length === 0)
        return false;
    return true;
}
/** Pure scan: returns true if `offset` falls inside a string literal. */
function isInsideString(text, offset) {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < offset; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') {
                i++;
                continue;
            } // skip escaped char
            if (ch === stringChar)
                inString = false;
        }
        else {
            if (ch === '"' || ch === "'" || ch === '`') {
                inString = true;
                stringChar = ch;
            }
        }
    }
    return inString;
}
function parseXData(value) {
    const members = [];
    const seen = new Set();
    // Match shorthand methods and getters/setters: [get|set] name(args) {
    const methodRegex = /\b(?:get\s+|set\s+|async\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
    let match;
    while ((match = methodRegex.exec(value)) !== null) {
        const name = match[1];
        if (!isValidMemberName(name) || seen.has(name))
            continue;
        const keywordPrefix = match[0].match(/^(get|set)\s/);
        const kind = keywordPrefix
            ? keywordPrefix[1] === 'get'
                ? 'getter'
                : 'property'
            : 'method';
        const offset = match.index + match[0].indexOf(name);
        members.push({ name, kind, offset, length: name.length });
        seen.add(name);
    }
    // Match property keys: name: value
    // (runs after methods so shorthand methods are excluded)
    const propRegex = /\b(\w+)\s*:/g;
    while ((match = propRegex.exec(value)) !== null) {
        const name = match[1];
        if (!isValidMemberName(name) || seen.has(name))
            continue;
        // Skip computed key context: [expr] or member.access
        const charBefore = value[match.index - 1] ?? '';
        if (charBefore === '[' || charBefore === '.')
            continue;
        members.push({
            name,
            kind: 'property',
            offset: match.index,
            length: name.length,
        });
        seen.add(name);
    }
    // Match trailing shorthand properties: { a, b, c }
    // These appear as bare identifiers followed by comma or closing brace
    const shortRegex = /\b(\w+)\s*([,}])/g;
    while ((match = shortRegex.exec(value)) !== null) {
        const name = match[1];
        if (!isValidMemberName(name) || seen.has(name))
            continue;
        // Skip spread targets: { ...x, }
        if (value.slice(match.index - 3, match.index) === '...')
            continue;
        // Skip matches inside string literals (single/double/backtick)
        if (isInsideString(value, match.index))
            continue;
        members.push({
            name,
            kind: 'property',
            offset: match.index,
            length: name.length,
        });
        seen.add(name);
    }
    return members;
}
//# sourceMappingURL=xdata.js.map