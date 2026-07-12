import {
  CompletionItem,
  CompletionItemKind,
  CompletionParams,
  Hover,
  InitializeResult,
  TextDocumentSyncKind,
  Connection,
  Location,
  InitializeParams,
} from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
  extractAlpineAttrs,
  findAttrAtOffset,
  AlpineAttr,
  isXData,
} from './extractor';
import { parseXData, XDataMember } from './xdata';
import { MAGIC_PROPERTIES } from './data';
import { WorkspaceIndex, WorkspaceDef } from './workspace';

export class AlpineLanguageServer {
  private documents = new TextDocuments(TextDocument);
  private attrCache = new Map<string, AlpineAttr[]>();
  private workspace = new WorkspaceIndex();

  constructor(private connection: Connection) {
    this.documents.listen(connection);

    this.documents.onDidChangeContent(({ document }) => {
      try {
        const attrs = extractAlpineAttrs(document.getText());
        this.attrCache.set(document.uri, attrs);
        this.workspace.indexDocument(document.uri, document.getText());
      } catch (e) {
        this.connection.console.error(`Parse error: ${e}`);
      }
    });

    this.documents.onDidClose(({ document }) => {
      this.attrCache.delete(document.uri);
    });

    connection.onInitialize((params: InitializeParams): InitializeResult => {
      const rootUri = params.rootUri;
      if (rootUri) {
        const rootPath = rootUri.replace(/^file:\/\//, '');
        this.connection.console.info(`Scanning workspace: ${rootPath}`);
        try {
          this.workspace.scanWorkspace(rootPath);
          const count = this.workspace.allNames().length;
          const dataCount = this.workspace.allDataNames().length;
          const storeCount = this.workspace.allStoreNames().length;
          this.connection.console.info(
            `Workspace indexed: ${count} symbols (${dataCount} Alpine.data, ${storeCount} Alpine.store)`,
          );
        } catch (e) {
          this.connection.console.error(`Workspace scan failed: ${e}`);
        }
      }

      return {
        capabilities: {
          completionProvider: { triggerCharacters: ['$', '.'] },
          hoverProvider: true,
          definitionProvider: true,
          textDocumentSync: TextDocumentSyncKind.Full,
        },
      };
    });

    connection.onCompletion((p) => this.onCompletion(p));
    connection.onHover((p) => this.onHover(p));
    connection.onDefinition((p) => this.onDefinition(p));
  }

  start() {
    this.connection.listen();
  }

  private onCompletion({
    textDocument,
    position,
  }: CompletionParams): CompletionItem[] {
    const doc = this.documents.get(textDocument.uri);
    if (!doc) return [];

    const offset = doc.offsetAt(position);
    const attrs = this.attrCache.get(textDocument.uri) ?? [];
    const attr = findAttrAtOffset(attrs, offset);
    if (!attr) return [];

    const relOffset = offset - attr.valueOffset;
    const textBefore = attr.value.slice(0, relOffset);
    const items: CompletionItem[] = [];
    const localMembers = this.getScopeMembers(textDocument.uri, attr);
    const localNames = new Set(localMembers.map((m) => m.name));

    if (/\$\w*$/.test(textBefore)) {
      const typed = textBefore.match(/\$(\w*)$/)?.[1] ?? '';
      for (const prop of MAGIC_PROPERTIES) {
        const rest = prop.name.slice(1);
        if (rest.startsWith(typed)) {
          items.push({
            label: prop.name,
            kind: CompletionItemKind.Property,
            detail: prop.signature,
            documentation: prop.documentation,
          });
        }
      }
      return items;
    }

    if (/\.\w*$/.test(textBefore)) {
      for (const m of localMembers) {
        items.push(this.memberToCompletion(m));
      }
      this.addWorkspaceMembers(items, localNames, textDocument.uri);
      return items;
    }

    if (!isXData(attr.name)) {
      for (const m of localMembers) {
        items.push(this.memberToCompletion(m));
      }
      for (const prop of MAGIC_PROPERTIES) {
        items.push({
          label: prop.name,
          kind: CompletionItemKind.Property,
          detail: prop.signature,
          documentation: prop.documentation,
        });
      }
      this.addWorkspaceMembers(items, localNames, textDocument.uri);
    }

    return items;
  }

  private onHover(params: {
    textDocument: { uri: string };
    position: { line: number; character: number };
  }): Hover | null {
    const doc = this.documents.get(params.textDocument.uri);
    if (!doc) return null;

    const offset = doc.offsetAt(params.position);
    const attrs = this.attrCache.get(params.textDocument.uri) ?? [];
    const attr = findAttrAtOffset(attrs, offset);
    if (!attr) return null;

    const word = getWordAtOffset(attr.value, offset - attr.valueOffset);
    if (!word) return null;

    const magic = MAGIC_PROPERTIES.find((p) => p.name === word);
    if (magic) {
      return {
        contents: [
          { language: 'typescript', value: magic.signature },
          magic.documentation,
        ],
      };
    }

    if (isXData(attr.name) && !attr.value.trim().startsWith('{')) {
      return this.hoverRegistrationName(attr.value.trim());
    }

    const localMembers = this.getScopeMembers(params.textDocument.uri, attr);
    const localMember = localMembers.find((m) => m.name === word);
    if (localMember) {
      return this.formatHover(localMember, params.textDocument.uri, doc);
    }

    const wsDefs = this.workspace.lookup(word).filter((d) => d.uri !== params.textDocument.uri);
    if (wsDefs.length > 0) {
      return this.formatHoverDef(wsDefs[0]);
    }

    return null;
  }

  private onDefinition({
    textDocument,
    position,
  }: {
    textDocument: { uri: string };
    position: { line: number; character: number };
  }): Location | Location[] | null {
    const doc = this.documents.get(textDocument.uri);
    if (!doc) return null;

    const offset = doc.offsetAt(position);
    const attrs = this.attrCache.get(textDocument.uri) ?? [];
    const attr = findAttrAtOffset(attrs, offset);
    if (!attr) return null;

    const word = getWordAtOffset(attr.value, offset - attr.valueOffset);
    if (!word || word.startsWith('$')) return null;

    if (isXData(attr.name) && !attr.value.trim().startsWith('{')) {
      const dataRegs = this.workspace.lookupAlpineData(word);
      if (dataRegs.length > 0) return this.defToLocation(dataRegs[0].def);
      const storeRegs = this.workspace.lookupAlpineStore(word);
      if (storeRegs.length > 0) return this.defToLocation(storeRegs[0].def);
      return null;
    }

    const xdataAttr = this.getXDataScope(textDocument.uri, attr);
    if (xdataAttr) {
      if (xdataAttr.value.trim().startsWith('{')) {
        const members = parseXData(xdataAttr.value);
        const member = members.find((m) => m.name === word);
        if (member) {
          const memberOffset = xdataAttr.valueOffset + member.offset;
          const start = doc.positionAt(memberOffset);
          const end = doc.positionAt(memberOffset + member.length);
          return Location.create(textDocument.uri, { start, end });
        }
      } else {
        const resolved = this.workspace.resolveScope(xdataAttr.value, textDocument.uri);
        if (resolved) {
          const member = resolved.members.find((m) => m.name === word);
          if (member) return this.defToLocation(member);
        }
      }
    }

    const wsDefs = this.workspace.lookup(word).filter((d) => d.uri !== textDocument.uri);
    if (wsDefs.length > 0) {
      return this.defToLocation(wsDefs[0]);
    }

    return null;
  }

  private getScopeMembers(uri: string, attr: AlpineAttr): XDataMember[] {
    const xdata = this.getXDataScope(uri, attr);
    if (!xdata) return [];

    if (!xdata.value.trim().startsWith('{')) {
      const resolved = this.workspace.resolveScope(xdata.value, uri);
      if (resolved) {
        return resolved.members.map((d) => ({
          name: d.name,
          kind: d.kind,
          offset: 0,
          length: d.length,
        }));
      }
      return [];
    }

    return parseXData(xdata.value);
  }

  private getXDataScope(uri: string, attr: AlpineAttr): AlpineAttr | null {
    if (isXData(attr.name)) return attr;
    const attrs = this.attrCache.get(uri) ?? [];
    return this.findScopeXData(attrs, attr);
  }

  private findScopeXData(
    attrs: AlpineAttr[],
    current: AlpineAttr,
  ): AlpineAttr | null {
    let best: AlpineAttr | null = null;
    for (const a of attrs) {
      if (!isXData(a.name)) continue;
      if (a.valueOffset < current.valueOffset) {
        best = a;
      } else {
        break;
      }
    }
    return best;
  }

  private hoverRegistrationName(name: string): Hover | null {
    const dataRegs = this.workspace.lookupAlpineData(name);
    if (dataRegs.length > 0) {
      const reg = dataRegs[0];
      const members = this.workspace.getRegistrationMembers(reg.def, reg.text);
      const memberList = members
        .map((m) => (m.kind === 'method' ? `${m.name}()` : m.name))
        .join(', ');
      return {
        contents: [
          { language: 'typescript', value: `Alpine.data('${name}')` },
          `📍 ${reg.def.sourceFile} — ${members.length} members:\n${memberList}`,
        ],
      };
    }

    const storeRegs = this.workspace.lookupAlpineStore(name);
    if (storeRegs.length > 0) {
      const reg = storeRegs[0];
      const members = this.workspace.getRegistrationMembers(reg.def, reg.text);
      const memberList = members
        .map((m) => (m.kind === 'method' ? `${m.name}()` : m.name))
        .join(', ');
      return {
        contents: [
          { language: 'typescript', value: `Alpine.store('${name}')` },
          `📍 ${reg.def.sourceFile} — ${members.length} members:\n${memberList}`,
        ],
      };
    }

    return null;
  }

  private memberToCompletion(m: XDataMember): CompletionItem {
    return {
      label: m.name,
      kind: m.kind === 'method' ? CompletionItemKind.Method : CompletionItemKind.Field,
      detail: m.kind,
    };
  }

  private addWorkspaceMembers(
    items: CompletionItem[],
    localNames: Set<string>,
    currentUri: string,
  ): void {
    const seen = new Set(items.map((i) => i.label));
    for (const n of localNames) seen.add(n);

    for (const name of this.workspace.allNames()) {
      if (seen.has(name)) continue;
      const defs = this.workspace.lookup(name);
      const externalDef = defs.find((d) => d.uri !== currentUri);
      if (!externalDef) continue;

      items.push({
        label: name,
        kind: externalDef.kind === 'method' ? CompletionItemKind.Method : CompletionItemKind.Field,
        detail: `${externalDef.source} — ${externalDef.sourceFile}`,
      });
      seen.add(name);
    }
  }

  private formatHover(
    member: XDataMember,
    uri: string,
    doc: TextDocument,
  ): Hover {
    return {
      contents: [
        {
          language: 'typescript',
          value: member.kind === 'method'
            ? `${member.name}()`
            : `${member.name}: ${member.kind}`,
        },
        `📍 x-data — ${pathBasename(uri)}`,
      ],
    };
  }

  private formatHoverDef(def: WorkspaceDef): Hover {
    const sig = def.kind === 'method' ? `${def.name}()` : `${def.name}`;
    return {
      contents: [
        {
          language: 'typescript',
          value: sig,
        },
        `📍 ${def.source} — ${def.sourceFile}`,
      ],
    };
  }

  private defToLocation(def: WorkspaceDef): Location | null {
    const startPos = this.workspace.getPosition(def);
    const endPos = this.workspace.getEndPosition(def);
    if (!startPos || !endPos) return null;

    return Location.create(def.uri, {
      start: startPos,
      end: endPos,
    });
  }
}

function pathBasename(uri: string): string {
  const parts = uri.replace(/^file:\/\//, '').split('/');
  return parts[parts.length - 1] || uri;
}

function getWordAtOffset(text: string, offset: number): string | null {
  if (offset < 0 || offset > text.length) return null;
  let start = offset;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && /[\w$]/.test(text[end])) end++;
  const word = text.slice(start, end);
  return word || null;
}
