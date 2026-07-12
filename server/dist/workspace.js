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
    indexDocument(uri, text) {
        this.fileTexts.set(uri, text);
        const defs = this.extractDefinitions(uri, text);
        this.fileDefs.set(uri, defs);
        this.rebuildIndexes();
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
    lookupAlpineData(name) {
        return this.dataRegistrations.get(name) ?? [];
    }
    lookupAlpineStore(name) {
        return this.storeRegistrations.get(name) ?? [];
    }
    resolveScope(xdataValue, currentUri) {
        const trimmed = xdataValue.trim();
        if (trimmed.startsWith('{'))
            return null;
        const dataRegs = this.lookupAlpineData(trimmed);
        if (dataRegs.length > 0) {
            const reg = dataRegs[0];
            return {
                members: this.getRegistrationMembers(reg.def, reg.text),
                sourceLabel: `${reg.def.registrationKind}('${trimmed}') — ${reg.def.sourceFile}`,
            };
        }
        const storeRegs = this.lookupAlpineStore(trimmed);
        if (storeRegs.length > 0) {
            const reg = storeRegs[0];
            return {
                members: this.getRegistrationMembers(reg.def, reg.text),
                sourceLabel: `${reg.def.registrationKind}('${trimmed}') — ${reg.def.sourceFile}`,
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
    scanWorkspace(rootPath) {
        const walk = (dir, depth) => {
            if (depth > 10)
                return;
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
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
                    }
                    catch { /* skip */ }
                }
            }
        };
        walk(rootPath, 0);
        this.rebuildIndexes();
    }
    extractDefinitions(uri, text) {
        const defs = [];
        const file = basename(uri);
        for (const attr of (0, extractor_1.extractAlpineAttrs)(text)) {
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
    rebuildIndexes() {
        this.nameIndex.clear();
        this.dataRegistrations.clear();
        this.storeRegistrations.clear();
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
            }
        }
    }
}
exports.WorkspaceIndex = WorkspaceIndex;
//# sourceMappingURL=workspace.js.map