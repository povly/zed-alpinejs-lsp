"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceIndex = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const extractor_1 = require("./extractor");
const xdata_1 = require("./xdata");
const SCAN_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.html', '.blade.php', '.php'];
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'vendor', 'dist', 'build',
    '.next', '.nuxt', 'storage', 'bootstrap/cache', 'public',
]);
function uriToPath(uri) {
    return uri.replace(/^file:\/\//, '');
}
function basename(uri) {
    return path.basename(uriToPath(uri));
}
function offsetToLineChar(text, offset) {
    let line = 0;
    let char = 0;
    const max = Math.min(offset, text.length);
    for (let i = 0; i < max; i++) {
        if (text[i] === '\n') {
            line++;
            char = 0;
        }
        else
            char++;
    }
    return { line, character: char };
}
class WorkspaceIndex {
    fileDefs = new Map();
    fileTexts = new Map();
    nameIndex = new Map();
    dataRegistrations = new Map();
    storeRegistrations = new Map();
    magicRegistrations = new Map();
    indexDocument(uri, text, precomputedAttrs) {
        const oldDefs = this.fileDefs.get(uri) ?? [];
        this.fileTexts.set(uri, text);
        const newDefs = this.extractDefinitions(uri, text, precomputedAttrs);
        this.fileDefs.set(uri, newDefs);
        this.updateIndexesForUri(uri, oldDefs, newDefs);
    }
    removeDocument(uri) {
        this.fileDefs.delete(uri);
        this.fileTexts.delete(uri);
        this.rebuildIndexes();
    }
    getText(uri) {
        return this.fileTexts.get(uri);
    }
    lookup(name) {
        return this.nameIndex.get(name) ?? [];
    }
    allNames() {
        return [...this.nameIndex.keys()];
    }
    allDataNames() {
        return [...this.dataRegistrations.keys()];
    }
    allStoreNames() {
        return [...this.storeRegistrations.keys()];
    }
    allMagicNames() {
        return [...this.magicRegistrations.keys()];
    }
    lookupAlpineData(name) {
        return this.dataRegistrations.get(name) ?? [];
    }
    lookupAlpineStore(name) {
        return this.storeRegistrations.get(name) ?? [];
    }
    lookupAlpineMagic(name) {
        return this.magicRegistrations.get(name) ?? [];
    }
    getDefsForFile(uri) {
        return this.fileDefs.get(uri) ?? [];
    }
    resolveScope(xdataValue, currentUri) {
        const trimmed = xdataValue.trim();
        if (trimmed.startsWith('{'))
            return null;
        // Strip trailing parentheses and arguments: 'blog()' → 'blog', 'cart(123)' → 'cart'
        const name = trimmed.replace(/\(.*$/, '').trim();
        if (!name)
            return null;
        const dataRegs = this.lookupAlpineData(name);
        if (dataRegs.length > 0) {
            const reg = dataRegs[0];
            return {
                members: this.getRegistrationMembers(reg.def, reg.text),
                sourceLabel: `${reg.def.registrationKind}('${name}') — ${reg.def.sourceFile}`,
            };
        }
        const storeRegs = this.lookupAlpineStore(name);
        if (storeRegs.length > 0) {
            const reg = storeRegs[0];
            return {
                members: this.getRegistrationMembers(reg.def, reg.text),
                sourceLabel: `${reg.def.registrationKind}('${name}') — ${reg.def.sourceFile}`,
            };
        }
        return null;
    }
    getRegistrationMembers(def, text) {
        const allDefs = this.fileDefs.get(def.uri) ?? [];
        return allDefs.filter(d => d.registrationName === def.registrationName &&
            d.registrationKind === def.registrationKind);
    }
    getPosition(def) {
        const text = this.fileTexts.get(def.uri);
        if (!text)
            return null;
        return offsetToLineChar(text, def.startOffset);
    }
    getEndPosition(def) {
        const text = this.fileTexts.get(def.uri);
        if (!text)
            return null;
        return offsetToLineChar(text, def.startOffset + def.length);
    }
    scanWorkspace(rootPath, logger) {
        const t0 = performance.now();
        let fileCount = 0;
        let skippedCount = 0;
        const walk = (dir, depth) => {
            if (depth > 10)
                return;
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch (e) {
                logger?.('warn', `scanWorkspace: cannot read directory "${dir}": ${e}`);
                skippedCount++;
                return;
            }
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name)) {
                        walk(path.join(dir, entry.name), depth + 1);
                    }
                }
                else if (entry.isFile()) {
                    const matched = SCAN_EXTENSIONS.some(ext => entry.name.endsWith(ext));
                    if (!matched)
                        continue;
                    const fullPath = path.join(dir, entry.name);
                    const uri = 'file://' + fullPath;
                    if (this.fileTexts.has(uri))
                        continue;
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        this.fileTexts.set(uri, content);
                        this.fileDefs.set(uri, this.extractDefinitions(uri, content));
                        fileCount++;
                    }
                    catch (e) {
                        logger?.('warn', `scanWorkspace: cannot read file "${fullPath}": ${e}`);
                        skippedCount++;
                    }
                }
            }
        };
        walk(rootPath, 0);
        this.rebuildIndexes();
        return { durationMs: performance.now() - t0, fileCount, skippedCount };
    }
    extractDefinitions(uri, text, precomputedAttrs) {
        const defs = [];
        const file = basename(uri);
        const attrs = precomputedAttrs ?? (0, extractor_1.extractAlpineAttrs)(text);
        for (const attr of attrs) {
            if (!(0, extractor_1.isXData)(attr.name))
                continue;
            for (const m of (0, xdata_1.parseXData)(attr.value)) {
                defs.push(this.makeDef(m, 'x-data', uri, attr.valueOffset + m.offset, file));
            }
        }
        for (const reg of (0, extractor_1.extractAlpineData)(text)) {
            for (const m of (0, xdata_1.parseXData)(reg.objectLiteral)) {
                defs.push({
                    ...this.makeDef(m, `${reg.kind}('${reg.registrationName}')`, uri, reg.objectOffset + m.offset, file),
                    registrationName: reg.registrationName,
                    registrationKind: reg.kind,
                });
            }
        }
        for (const reg of (0, extractor_1.extractAlpineStore)(text)) {
            for (const m of (0, xdata_1.parseXData)(reg.objectLiteral)) {
                defs.push({
                    ...this.makeDef(m, `${reg.kind}('${reg.registrationName}')`, uri, reg.objectOffset + m.offset, file),
                    registrationName: reg.registrationName,
                    registrationKind: reg.kind,
                });
            }
        }
        for (const reg of (0, extractor_1.extractAlpineMagic)(text)) {
            for (const m of (0, xdata_1.parseXData)(reg.objectLiteral)) {
                defs.push({
                    ...this.makeDef(m, `${reg.kind}('${reg.registrationName}')`, uri, reg.objectOffset + m.offset, file),
                    registrationName: reg.registrationName,
                    registrationKind: reg.kind,
                });
            }
        }
        return defs;
    }
    makeDef(m, source, uri, startOffset, sourceFile) {
        return {
            name: m.name,
            kind: m.kind,
            source,
            uri,
            startOffset,
            length: m.length,
            sourceFile,
        };
    }
    /**
     * Incremental update of derived maps for one URI: O(D_uri) vs O(F*D) full rebuild.
     * Identity = (uri + startOffset), NOT name — same name can live in many files.
     */
    updateIndexesForUri(uri, oldDefs, newDefs) {
        for (const def of oldDefs) {
            this.removeFromNameIndex(def);
            if (def.registrationKind === 'Alpine.data') {
                this.removeFromRegistrations(this.dataRegistrations, def);
            }
            if (def.registrationKind === 'Alpine.store') {
                this.removeFromRegistrations(this.storeRegistrations, def);
            }
            if (def.registrationKind === 'Alpine.magic') {
                this.removeFromRegistrations(this.magicRegistrations, def);
            }
        }
        for (const def of newDefs) {
            this.insertIntoNameIndex(def);
            if (def.registrationKind === 'Alpine.data') {
                this.insertIntoRegistrations(this.dataRegistrations, def, uri);
            }
            if (def.registrationKind === 'Alpine.store') {
                this.insertIntoRegistrations(this.storeRegistrations, def, uri);
            }
            if (def.registrationKind === 'Alpine.magic') {
                this.insertIntoRegistrations(this.magicRegistrations, def, uri);
            }
        }
    }
    removeFromNameIndex(def) {
        const arr = this.nameIndex.get(def.name);
        if (!arr)
            return;
        const filtered = arr.filter((d) => !(d.uri === def.uri && d.startOffset === def.startOffset));
        if (filtered.length === 0) {
            this.nameIndex.delete(def.name);
        }
        else {
            this.nameIndex.set(def.name, filtered);
        }
    }
    removeFromRegistrations(regMap, def) {
        const name = def.registrationName;
        if (name === undefined)
            return;
        const arr = regMap.get(name);
        if (!arr)
            return;
        const filtered = arr.filter((entry) => !(entry.def.uri === def.uri && entry.def.startOffset === def.startOffset));
        if (filtered.length === 0) {
            regMap.delete(name);
        }
        else {
            regMap.set(name, filtered);
        }
    }
    insertIntoNameIndex(def) {
        const arr = this.nameIndex.get(def.name);
        if (arr) {
            arr.push(def);
        }
        else {
            this.nameIndex.set(def.name, [def]);
        }
    }
    insertIntoRegistrations(regMap, def, uri) {
        const name = def.registrationName;
        if (name === undefined)
            return;
        const text = this.fileTexts.get(uri) ?? '';
        const arr = regMap.get(name);
        if (arr) {
            arr.push({ def, text });
        }
        else {
            regMap.set(name, [{ def, text }]);
        }
    }
    rebuildIndexes() {
        this.nameIndex.clear();
        this.dataRegistrations.clear();
        this.storeRegistrations.clear();
        this.magicRegistrations.clear();
        for (const [uri, defs] of this.fileDefs) {
            const text = this.fileTexts.get(uri);
            if (!text)
                continue;
            for (const def of defs) {
                if (!this.nameIndex.has(def.name)) {
                    this.nameIndex.set(def.name, []);
                }
                this.nameIndex.get(def.name).push(def);
                if (def.registrationKind === 'Alpine.data') {
                    const name = def.registrationName;
                    if (!this.dataRegistrations.has(name)) {
                        this.dataRegistrations.set(name, []);
                    }
                    this.dataRegistrations.get(name).push({ def, text });
                }
                if (def.registrationKind === 'Alpine.store') {
                    const name = def.registrationName;
                    if (!this.storeRegistrations.has(name)) {
                        this.storeRegistrations.set(name, []);
                    }
                    this.storeRegistrations.get(name).push({ def, text });
                }
                if (def.registrationKind === 'Alpine.magic') {
                    const name = def.registrationName;
                    if (!this.magicRegistrations.has(name)) {
                        this.magicRegistrations.set(name, []);
                    }
                    this.magicRegistrations.get(name).push({ def, text });
                }
            }
        }
    }
}
exports.WorkspaceIndex = WorkspaceIndex;
//# sourceMappingURL=workspace.js.map