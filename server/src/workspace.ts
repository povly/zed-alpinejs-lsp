import * as fs from 'fs';
import * as path from 'path';
import { extractAlpineAttrs, isXData, extractAlpineData, extractAlpineStore, AlpineRegistration } from './extractor';
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
  registrationKind?: 'Alpine.data' | 'Alpine.store';
}

export interface ResolvedScope {
  members: WorkspaceDef[];
  sourceLabel: string;
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

  indexDocument(uri: string, text: string): void {
    this.fileTexts.set(uri, text);
    const defs = this.extractDefinitions(uri, text);
    this.fileDefs.set(uri, defs);
    this.rebuildIndexes();
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

  lookupAlpineData(name: string): { def: WorkspaceDef; text: string }[] {
    return this.dataRegistrations.get(name) ?? [];
  }

  lookupAlpineStore(name: string): { def: WorkspaceDef; text: string }[] {
    return this.storeRegistrations.get(name) ?? [];
  }

  resolveScope(xdataValue: string, currentUri: string): ResolvedScope | null {
    const trimmed = xdataValue.trim();

    if (trimmed.startsWith('{')) return null;

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

  scanWorkspace(rootPath: string): void {
    const walk = (dir: string, depth: number) => {
      if (depth > 10) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { return; }

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
          } catch { /* skip */ }
        }
      }
    };

    walk(rootPath, 0);
    this.rebuildIndexes();
  }

  private extractDefinitions(uri: string, text: string): WorkspaceDef[] {
    const defs: WorkspaceDef[] = [];
    const file = basename(uri);

    for (const attr of extractAlpineAttrs(text)) {
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

  private rebuildIndexes(): void {
    this.nameIndex.clear();
    this.dataRegistrations.clear();
    this.storeRegistrations.clear();

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
      }
    }
  }
}
