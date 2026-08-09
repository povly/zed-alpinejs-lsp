import * as fs from 'fs';
import * as path from 'path';
import { extractAlpineAttrs, isXData, extractAlpineData, extractAlpineStore, extractAlpineMagic, AlpineRegistration, AlpineAttr } from './extractor';
import { parseXData, XDataMember } from './xdata';

export interface WorkspaceDef {
  name: string;
  kind: 'method' | 'property' | 'getter';
  source: string;
  uri: string;
  startOffset: number;
  length: number;
  sourceFile: string;
  registrationName?: string;
  registrationKind?: 'Alpine.data' | 'Alpine.store' | 'Alpine.magic';
}

export interface ResolvedScope {
  members: WorkspaceDef[];
  sourceLabel: string;
}

/** Logger callback injected into WorkspaceIndex to keep it dependency-free. */
export type LoggerFn = (level: 'warn' | 'info', msg: string) => void;

/** Metrics returned by scanWorkspace for observability. */
export interface ScanMetrics {
  durationMs: number;
  fileCount: number;
  skippedCount: number;
}

const SCAN_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.html', '.blade.php', '.php'];
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'build',
  '.next', '.nuxt', 'storage', 'bootstrap/cache', 'public',
]);

function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

function basename(uri: string): string {
  return path.basename(uriToPath(uri));
}

function offsetToLineChar(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let char = 0;
  const max = Math.min(offset, text.length);
  for (let i = 0; i < max; i++) {
    if (text[i] === '\n') { line++; char = 0; }
    else char++;
  }
  return { line, character: char };
}

export class WorkspaceIndex {
  private fileDefs = new Map<string, WorkspaceDef[]>();
  private fileTexts = new Map<string, string>();
  private nameIndex = new Map<string, WorkspaceDef[]>();
  private dataRegistrations = new Map<string, { def: WorkspaceDef; text: string }[]>();
  private storeRegistrations = new Map<string, { def: WorkspaceDef; text: string }[]>();
  private magicRegistrations = new Map<string, { def: WorkspaceDef; text: string }[]>();

  indexDocument(uri: string, text: string, precomputedAttrs?: AlpineAttr[]): void {
    const oldDefs = this.fileDefs.get(uri) ?? [];
    this.fileTexts.set(uri, text);
    const newDefs = this.extractDefinitions(uri, text, precomputedAttrs);
    this.fileDefs.set(uri, newDefs);
    this.updateIndexesForUri(uri, oldDefs, newDefs);
  }

  removeDocument(uri: string): void {
    this.fileDefs.delete(uri);
    this.fileTexts.delete(uri);
    this.rebuildIndexes();
  }

  getText(uri: string): string | undefined {
    return this.fileTexts.get(uri);
  }

  lookup(name: string): WorkspaceDef[] {
    return this.nameIndex.get(name) ?? [];
  }

  allNames(): string[] {
    return [...this.nameIndex.keys()];
  }

  allDataNames(): string[] {
    return [...this.dataRegistrations.keys()];
  }

  allStoreNames(): string[] {
    return [...this.storeRegistrations.keys()];
  }

  allMagicNames(): string[] {
    return [...this.magicRegistrations.keys()];
  }

  lookupAlpineData(name: string): { def: WorkspaceDef; text: string }[] {
    return this.dataRegistrations.get(name) ?? [];
  }

  lookupAlpineStore(name: string): { def: WorkspaceDef; text: string }[] {
    return this.storeRegistrations.get(name) ?? [];
  }

  lookupAlpineMagic(name: string): { def: WorkspaceDef; text: string }[] {
    return this.magicRegistrations.get(name) ?? [];
  }

  getDefsForFile(uri: string): WorkspaceDef[] {
    return this.fileDefs.get(uri) ?? [];
  }

  resolveScope(xdataValue: string, currentUri: string): ResolvedScope | null {
    const trimmed = xdataValue.trim();

    if (trimmed.startsWith('{')) return null;

    // Strip trailing parentheses and arguments: 'blog()' → 'blog', 'cart(123)' → 'cart'
    const name = trimmed.replace(/\(.*$/, '').trim();
    if (!name) return null;

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

  getRegistrationMembers(def: WorkspaceDef, text: string): WorkspaceDef[] {
    const allDefs = this.fileDefs.get(def.uri) ?? [];
    return allDefs.filter(d =>
      d.registrationName === def.registrationName &&
      d.registrationKind === def.registrationKind,
    );
  }

  getPosition(def: WorkspaceDef): { line: number; character: number } | null {
    const text = this.fileTexts.get(def.uri);
    if (!text) return null;
    return offsetToLineChar(text, def.startOffset);
  }

  getEndPosition(def: WorkspaceDef): { line: number; character: number } | null {
    const text = this.fileTexts.get(def.uri);
    if (!text) return null;
    return offsetToLineChar(text, def.startOffset + def.length);
  }

  scanWorkspace(rootPath: string, logger?: LoggerFn): ScanMetrics {
    const t0 = performance.now();
    let fileCount = 0;
    let skippedCount = 0;

    const walk = (dir: string, depth: number) => {
      if (depth > 10) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        logger?.('warn', `scanWorkspace: cannot read directory "${dir}": ${e}`);
        skippedCount++;
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) {
            walk(path.join(dir, entry.name), depth + 1);
          }
        } else if (entry.isFile()) {
          const matched = SCAN_EXTENSIONS.some(ext => entry.name.endsWith(ext));
          if (!matched) continue;

          const fullPath = path.join(dir, entry.name);
          const uri = 'file://' + fullPath;
          if (this.fileTexts.has(uri)) continue;

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            this.fileTexts.set(uri, content);
            this.fileDefs.set(uri, this.extractDefinitions(uri, content));
            fileCount++;
          } catch (e) {
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

  private extractDefinitions(uri: string, text: string, precomputedAttrs?: AlpineAttr[]): WorkspaceDef[] {
    const defs: WorkspaceDef[] = [];
    const file = basename(uri);

    const attrs = precomputedAttrs ?? extractAlpineAttrs(text);
    for (const attr of attrs) {
      if (!isXData(attr.name)) continue;
      for (const m of parseXData(attr.value)) {
        defs.push(this.makeDef(m, 'x-data', uri, attr.valueOffset + m.offset, file));
      }
    }

    for (const reg of extractAlpineData(text)) {
      for (const m of parseXData(reg.objectLiteral)) {
        defs.push({
          ...this.makeDef(m, `${reg.kind}('${reg.registrationName}')`, uri, reg.objectOffset + m.offset, file),
          registrationName: reg.registrationName,
          registrationKind: reg.kind,
        });
      }
    }

    for (const reg of extractAlpineStore(text)) {
      for (const m of parseXData(reg.objectLiteral)) {
        defs.push({
          ...this.makeDef(m, `${reg.kind}('${reg.registrationName}')`, uri, reg.objectOffset + m.offset, file),
          registrationName: reg.registrationName,
          registrationKind: reg.kind,
        });
      }
    }

    for (const reg of extractAlpineMagic(text)) {
      for (const m of parseXData(reg.objectLiteral)) {
        defs.push({
          ...this.makeDef(m, `${reg.kind}('${reg.registrationName}')`, uri, reg.objectOffset + m.offset, file),
          registrationName: reg.registrationName,
          registrationKind: reg.kind,
        });
      }
    }

    return defs;
  }

  private makeDef(
    m: XDataMember,
    source: string,
    uri: string,
    startOffset: number,
    sourceFile: string,
  ): WorkspaceDef {
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
  private updateIndexesForUri(
    uri: string,
    oldDefs: WorkspaceDef[],
    newDefs: WorkspaceDef[],
  ): void {
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

  private removeFromNameIndex(def: WorkspaceDef): void {
    const arr = this.nameIndex.get(def.name);
    if (!arr) return;
    const filtered = arr.filter(
      (d) => !(d.uri === def.uri && d.startOffset === def.startOffset),
    );
    if (filtered.length === 0) {
      this.nameIndex.delete(def.name);
    } else {
      this.nameIndex.set(def.name, filtered);
    }
  }

  private removeFromRegistrations(
    regMap: Map<string, { def: WorkspaceDef; text: string }[]>,
    def: WorkspaceDef,
  ): void {
    const name = def.registrationName;
    if (name === undefined) return;
    const arr = regMap.get(name);
    if (!arr) return;
    const filtered = arr.filter(
      (entry) => !(entry.def.uri === def.uri && entry.def.startOffset === def.startOffset),
    );
    if (filtered.length === 0) {
      regMap.delete(name);
    } else {
      regMap.set(name, filtered);
    }
  }

  private insertIntoNameIndex(def: WorkspaceDef): void {
    const arr = this.nameIndex.get(def.name);
    if (arr) {
      arr.push(def);
    } else {
      this.nameIndex.set(def.name, [def]);
    }
  }

  private insertIntoRegistrations(
    regMap: Map<string, { def: WorkspaceDef; text: string }[]>,
    def: WorkspaceDef,
    uri: string,
  ): void {
    const name = def.registrationName;
    if (name === undefined) return;
    const text = this.fileTexts.get(uri) ?? '';
    const arr = regMap.get(name);
    if (arr) {
      arr.push({ def, text });
    } else {
      regMap.set(name, [{ def, text }]);
    }
  }

  private rebuildIndexes(): void {
    this.nameIndex.clear();
    this.dataRegistrations.clear();
    this.storeRegistrations.clear();
    this.magicRegistrations.clear();

    for (const [uri, defs] of this.fileDefs) {
      const text = this.fileTexts.get(uri);
      if (!text) continue;

      for (const def of defs) {
        if (!this.nameIndex.has(def.name)) {
          this.nameIndex.set(def.name, []);
        }
        this.nameIndex.get(def.name)!.push(def);

        if (def.registrationKind === 'Alpine.data') {
          const name = def.registrationName!;
          if (!this.dataRegistrations.has(name)) {
            this.dataRegistrations.set(name, []);
          }
          this.dataRegistrations.get(name)!.push({ def, text });
        }

        if (def.registrationKind === 'Alpine.store') {
          const name = def.registrationName!;
          if (!this.storeRegistrations.has(name)) {
            this.storeRegistrations.set(name, []);
          }
          this.storeRegistrations.get(name)!.push({ def, text });
        }

        if (def.registrationKind === 'Alpine.magic') {
          const name = def.registrationName!;
          if (!this.magicRegistrations.has(name)) {
            this.magicRegistrations.set(name, []);
          }
          this.magicRegistrations.get(name)!.push({ def, text });
        }
      }
    }
  }
}
