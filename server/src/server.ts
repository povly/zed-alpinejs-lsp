import {
  CompletionItem,
  CompletionItemKind,
  CompletionParams,
  Connection,
  Diagnostic,
  DiagnosticSeverity,
  DocumentLink,
  DocumentLinkParams,
  DocumentSymbol,
  DocumentSymbolParams,
  Hover,
  InitializeParams,
  InitializeResult,
  Location,
  ReferenceParams,
  RenameParams,
  SymbolKind,
  TextDocumentSyncKind,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
  extractAlpineAttrs,
  findAttrAtOffset,
  findAttrByNameAtOffset,
  resolveDirectiveBase,
  getModifierAtOffset,
  normalizeAttrName,
  AlpineAttr,
  isXData,
} from './extractor';
import { parseXData, XDataMember } from './xdata';
import { MAGIC_PROPERTIES, MODIFIERS, DIRECTIVES, TRANSITION_SUBS, GLOBAL_APIS } from './data';
import { WorkspaceIndex, WorkspaceDef, LoggerFn } from './workspace';

export class AlpineLanguageServer {
  private documents = new TextDocuments(TextDocument);
  private attrCache = new Map<string, AlpineAttr[]>();
  private workspace = new WorkspaceIndex();
  private indexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private connection: Connection) {
    this.documents.listen(connection);

    this.documents.onDidChangeContent(({ document }) => {
      const uri = document.uri;
      try {
        // Eager: attrCache updates immediately for instant completion/hover.
        const text = document.getText();
        const attrs = extractAlpineAttrs(text);
        this.attrCache.set(uri, attrs);

        const diagnostics = this.computeDiagnostics(uri, document);
        this.connection.sendDiagnostics({ uri, diagnostics });

        // Debounced (300ms): workspace index update coalesces rapid keystrokes
        // into a single incremental rebuild per URI.
        if (this.indexDebounceTimer) clearTimeout(this.indexDebounceTimer);
        this.indexDebounceTimer = setTimeout(() => {
          const t0 = performance.now();
          try {
            const cachedAttrs = this.attrCache.get(uri);
            this.workspace.indexDocument(uri, text, cachedAttrs ?? undefined);
            const elapsed = performance.now() - t0;
            if (elapsed > 50) {
              this.connection.console.info(
                `onDidChangeContent: indexed "${uri}" in ${elapsed.toFixed(0)}ms`,
              );
            } else {
              this.connection.console.info(
                `onDidChangeContent: workspace indexed (debounced) for ${uri}`,
              );
            }
          } catch (e) {
            this.connection.console.error(`Index error for "${uri}": ${e}`);
          }
        }, 300);
      } catch (e) {
        this.connection.console.error(`Parse error for "${uri}": ${e}`);
      }
    });

    this.documents.onDidClose(({ document }) => {
      this.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
      this.attrCache.delete(document.uri);
    });

    connection.onInitialize((params: InitializeParams): InitializeResult => {
      const rootUri = params.rootUri;
      if (rootUri) {
        const rootPath = rootUri.replace(/^file:\/\//, '');
        this.connection.console.info(`Scanning workspace: ${rootPath}`);
        try {
          const logger: LoggerFn = (level, msg) => {
            this.connection.console[level](msg);
          };
          const metrics = this.workspace.scanWorkspace(rootPath, logger);
          const count = this.workspace.allNames().length;
          const dataCount = this.workspace.allDataNames().length;
          const storeCount = this.workspace.allStoreNames().length;
          this.connection.console.info(
            `Workspace indexed: ${count} symbols (${dataCount} Alpine.data, ${storeCount} Alpine.store)`,
          );
          this.connection.console.info(
            `Workspace scan: ${metrics.fileCount} files, ${metrics.skippedCount} skipped, ${metrics.durationMs.toFixed(0)}ms`,
          );
        } catch (e) {
          this.connection.console.error(`Workspace scan failed for "${rootPath}": ${e}`);
        }
      }

      return {
        capabilities: {
          completionProvider: { triggerCharacters: ['$', '.'] },
          hoverProvider: true,
          definitionProvider: true,
          documentSymbolProvider: true,
          diagnosticProvider: {
            interFileDependencies: false,
            workspaceDiagnostics: false,
          },
          documentLinkProvider: { resolveProvider: false },
          referencesProvider: true,
          renameProvider: { prepareProvider: false },
          textDocumentSync: TextDocumentSyncKind.Full,
        },
      };
    });

    connection.onCompletion((p) => this.onCompletion(p));
    connection.onHover((p) => this.onHover(p));
    connection.onDefinition((p) => this.onDefinition(p));
    connection.onDocumentSymbol((params: DocumentSymbolParams) => {
      return this.onDocumentSymbol(params);
    });
    connection.onDocumentLinks((params: DocumentLinkParams) => {
      return this.onDocumentLink(params);
    });
    connection.onReferences((params: ReferenceParams) => {
      return this.onReferences(params);
    });
    connection.onRenameRequest((params: RenameParams) => {
      return this.onRename(params);
    });
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

    const nameAttr = findAttrByNameAtOffset(attrs, offset);
    if (nameAttr) {
      const relOffset = offset - nameAttr.nameOffset;
      const textBefore = nameAttr.name.slice(0, relOffset);
      if (/\.\w*$/.test(textBefore)) {
        const base = resolveDirectiveBase(nameAttr.name);
        this.connection.console.info(
          `onCompletion: modifier context, base=${base ?? '<unknown>'}, attr="${nameAttr.name}"`,
        );
        if (!base) return [];
        return MODIFIERS
          .filter((m) => m.for.includes(base))
          .map((m) => ({
            label: m.name,
            kind: CompletionItemKind.EnumMember,
            detail: 'Modifier for ' + base,
            documentation: m.documentation,
          }));
      }
      return [];
    }

    const attr = findAttrAtOffset(attrs, offset);
    if (!attr) return [];

    const relOffset = offset - attr.valueOffset;
    const textBefore = attr.value.slice(0, relOffset);
    const items: CompletionItem[] = [];
    const localMembers = this.getScopeMembers(textDocument.uri, attr);
    const localNames = new Set(localMembers.map((m) => m.name));

    // Global API completions when typing "Alpine." or "Alpine"
    if (textBefore === 'Alpine' || /Alpine\.\w*$/.test(textBefore)) {
      this.connection.console.info('[completion] global APIs suggested');
      return GLOBAL_APIS.map((api) => ({
        label: api.name,
        kind: CompletionItemKind.Function,
        detail: api.signature,
        documentation: api.description,
      }));
    }

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

    // Chain-aware completion: $store.NAME (store names) / $store.NAME. (members) / $magic. (members)
    const storeMemberChainMatch = textBefore.match(/\$store\.(\w+)\.\w*$/);
    if (storeMemberChainMatch) {
      const storeName = storeMemberChainMatch[1];
      const regs = this.workspace.lookupAlpineStore(storeName);
      if (regs.length > 0) {
        const members = this.workspace.getRegistrationMembers(regs[0].def, regs[0].text);
        return members.map((m) => ({
          label: m.name,
          kind: m.kind === 'method' ? CompletionItemKind.Method : CompletionItemKind.Property,
          detail: `Alpine.store('${storeName}')`,
        }));
      }
      return [];
    }
    const storeNameChainMatch = textBefore.match(/\$store\.(\w*)$/);
    if (storeNameChainMatch) {
      const prefix = storeNameChainMatch[1];
      return this.workspace.allStoreNames()
        .filter((n) => n.startsWith(prefix))
        .map((name) => ({
          label: name,
          kind: CompletionItemKind.Module,
          detail: 'Alpine.store',
          documentation: `Store: ${name}`,
        }));
    }
    const magicChainMatch = textBefore.match(/\$(\w+)\.\w*$/);
    if (magicChainMatch && magicChainMatch[1] !== 'store') {
      const magicName = magicChainMatch[1];
      const regs = this.workspace.lookupAlpineMagic(magicName);
      if (regs.length > 0) {
        const members = this.workspace.getRegistrationMembers(regs[0].def, regs[0].text);
        return members.map((m) => ({
          label: m.name,
          kind: m.kind === 'method' ? CompletionItemKind.Method : CompletionItemKind.Property,
          detail: `$${magicName}`,
        }));
      }
      return [];
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

    const nameAttr = findAttrByNameAtOffset(attrs, offset);
    if (nameAttr) {
      const relOffset = offset - nameAttr.nameOffset;
      const modResult = getModifierAtOffset(nameAttr.name, relOffset);
      if (modResult) {
        const modInfo = MODIFIERS.find((m) => m.name === '.' + modResult.modifier);
        if (modInfo) {
          this.connection.console.info(
            `onHover: modifier ${modInfo.name} (for ${modInfo.for.join('/')})`,
          );
          return {
            contents: [
              { language: 'plaintext', value: modInfo.name },
              `${modInfo.documentation} (for ${modInfo.for.join('/')})`,
            ],
          };
        }
      }
      if (nameAttr.name.startsWith('x-transition:')) {
        const colonIdx = nameAttr.name.indexOf(':');
        let suffix = nameAttr.name.slice(colonIdx);
        const dotInSuffix = suffix.indexOf('.');
        if (dotInSuffix !== -1) suffix = suffix.slice(0, dotInSuffix);
        const subAttr = TRANSITION_SUBS.find((s) => s.name === suffix);
        if (subAttr) {
          this.connection.console.info('onHover: transition sub-attribute ' + subAttr.name);
          return {
            contents: [
              { language: 'plaintext', value: 'x-transition' + subAttr.name },
              subAttr.documentation + '\n\nSee: x-transition',
            ],
          };
        }
      }
      const base = resolveDirectiveBase(nameAttr.name);
      if (base) {
        const directive = DIRECTIVES.find((d) => d.name === base);
        if (directive) {
          this.connection.console.info(`onHover: directive ${directive.name}`);
          return {
            contents: [
              { language: 'plaintext', value: directive.name },
              directive.documentation +
                (directive.example ? '\n\nExample: ' + directive.example : ''),
            ],
          };
        }
      }
    }

    const attr = findAttrAtOffset(attrs, offset);
    if (!attr) return null;

    // Check for Alpine.* global API (e.g. Alpine.data, Alpine.store)
    const alpineApiName = getAlpineApiAtOffset(attr.value, offset - attr.valueOffset);
    if (alpineApiName) {
      const api = GLOBAL_APIS.find((a) => a.name === `Alpine.${alpineApiName}`);
      if (api) {
        this.connection.console.info('[hover] global API: ' + api.name);
        return {
          contents: [
            { language: 'typescript', value: api.signature },
            api.description,
          ],
        };
      }
    }

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

    // Chain-aware hover: $store.NAME / $store.NAME.member / $magic.method()
    const chain = getChainAtOffset(attr.value, offset - attr.valueOffset);
    if (chain && chain.length >= 2 && chain[0] === '$store') {
      const storeName = chain[1];
      const regs = this.workspace.lookupAlpineStore(storeName);
      if (regs.length > 0) {
        const reg = regs[0];
        if (chain.length === 2) {
          const members = this.workspace.getRegistrationMembers(reg.def, reg.text);
          const memberList = members
            .map((m) => (m.kind === 'method' ? `${m.name}()` : m.name))
            .join(', ');
          return {
            contents: [
              { language: 'typescript', value: `Alpine.store('${storeName}')` },
              `📍 ${reg.def.sourceFile} — ${members.length} members:\n${memberList}`,
            ],
          };
        }
        const wordInChain = chain[chain.length - 1];
        const members = this.workspace.getRegistrationMembers(reg.def, reg.text);
        const member = members.find((m) => m.name === wordInChain);
        if (member) return this.formatHoverDef(member);
      }
    }
    if (chain && chain.length >= 2 && chain[0].startsWith('$') && chain[0] !== '$store') {
      const magicName = chain[0].slice(1);
      const regs = this.workspace.lookupAlpineMagic(magicName);
      if (regs.length > 0) {
        const wordInChain = chain[chain.length - 1];
        const members = this.workspace.getRegistrationMembers(regs[0].def, regs[0].text);
        const member = members.find((m) => m.name === wordInChain);
        if (member) return this.formatHoverDef(member);
      }
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

    // Chain-aware resolution: $store.NAME.member, $magic.method()
    const chain = getChainAtOffset(attr.value, offset - attr.valueOffset);
    if (chain && chain.length >= 2) {
      if (chain[0] === '$store') {
        const storeName = chain[1];
        const regs = this.workspace.lookupAlpineStore(storeName);
        if (regs.length > 0) {
          if (chain.length === 2) {
            return this.defToLocation(regs[0].def);
          }
          const wordInChain = chain[chain.length - 1];
          const members = this.workspace.getRegistrationMembers(regs[0].def, regs[0].text);
          const member = members.find((m) => m.name === wordInChain);
          if (member) return this.defToLocation(member);
        }
      }
      if (chain[0].startsWith('$') && chain[0] !== '$store') {
        const magicName = chain[0].slice(1);
        const regs = this.workspace.lookupAlpineMagic(magicName);
        if (regs.length > 0) {
          const wordInChain = chain[chain.length - 1];
          const members = this.workspace.getRegistrationMembers(regs[0].def, regs[0].text);
          const member = members.find((m) => m.name === wordInChain);
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

  private onDocumentSymbol(params: DocumentSymbolParams): DocumentSymbol[] {
    const uri = params.textDocument.uri;
    const doc = this.documents.get(uri);
    if (!doc) return [];

    const symbols: DocumentSymbol[] = [];

    const attrs = this.attrCache.get(uri) ?? [];
    for (const attr of attrs) {
      if (!isXData(attr.name)) continue;
      const members = this.getScopeMembers(uri, attr);
      if (members.length === 0) continue;

      const valueStart = attr.valueOffset;
      const childSymbols: DocumentSymbol[] = members.map((m) => {
        const memberOffset = valueStart + (m.offset ?? 0);
        const memberEnd = memberOffset + (m.length ?? m.name.length);
        return {
          name: m.name,
          kind: m.kind === 'method' ? SymbolKind.Method : SymbolKind.Property,
          range: {
            start: doc.positionAt(memberOffset),
            end: doc.positionAt(memberEnd),
          },
          selectionRange: {
            start: doc.positionAt(memberOffset),
            end: doc.positionAt(memberOffset + m.name.length),
          },
        };
      });

      const xdataStart = attr.valueOffset;
      const xdataEnd = attr.valueOffset + attr.valueLength;
      const scopeName = attr.value.trim().startsWith('{')
        ? 'x-data (inline)'
        : `x-data: ${attr.value}`;
      symbols.push({
        name: scopeName,
        kind: SymbolKind.Object,
        range: { start: doc.positionAt(xdataStart), end: doc.positionAt(xdataEnd) },
        selectionRange: {
          start: doc.positionAt(xdataStart),
          end: doc.positionAt(xdataStart + Math.min(scopeName.length, attr.valueLength)),
        },
        children: childSymbols,
      });
    }

    const fileDefs = this.workspace.getDefsForFile(uri);
    for (const def of fileDefs) {
      if (!def.registrationName) continue;
      const defStart = def.startOffset;
      const defEnd = defStart + def.length;
      symbols.push({
        name: `${def.registrationKind}('${def.registrationName}')`,
        kind: def.registrationKind === 'Alpine.store' ? SymbolKind.Object : SymbolKind.Function,
        range: { start: doc.positionAt(defStart), end: doc.positionAt(defEnd) },
        selectionRange: {
          start: doc.positionAt(defStart),
          end: doc.positionAt(defStart + def.name.length),
        },
      });
    }

    this.connection.console.info(`[documentSymbol] returned ${symbols.length} symbols for ${uri}`);
    return symbols;
  }

  private onDocumentLink(params: DocumentLinkParams): DocumentLink[] {
    const uri = params.textDocument.uri;
    const doc = this.documents.get(uri);
    if (!doc) return [];

    const attrs = this.attrCache.get(uri) ?? [];
    const links: DocumentLink[] = [];

    for (const attr of attrs) {
      // 1. x-data="name" (registered component) → link to registration
      if (isXData(attr.name)) {
        const value = attr.value.trim();
        if (value && !value.startsWith('{') && !value.startsWith('(')) {
          const dataRegs = this.workspace.lookupAlpineData(value);
          if (dataRegs.length > 0) {
            const loc = this.defToLocation(dataRegs[0].def);
            if (loc) {
              const nameOffset = attr.valueOffset;
              links.push({
                range: {
                  start: doc.positionAt(nameOffset),
                  end: doc.positionAt(nameOffset + attr.valueLength),
                },
                target: loc.uri,
                tooltip: `Alpine.data('${value}')`,
              });
            }
          }
        }
      }

      // 2. $store.NAME and $magic() chains in any attribute value
      const chains = findAllChainsInText(attr.value);
      for (const c of chains) {
        const chainOffset = attr.valueOffset + c.offset;
        if (c.type === '$store') {
          const storeRegs = this.workspace.lookupAlpineStore(c.name);
          if (storeRegs.length > 0) {
            const loc = this.defToLocation(storeRegs[0].def);
            if (loc) {
              const chainLen = `$store.${c.name}`.length;
              links.push({
                range: {
                  start: doc.positionAt(chainOffset),
                  end: doc.positionAt(chainOffset + chainLen),
                },
                target: loc.uri,
                tooltip: `Alpine.store('${c.name}')`,
              });
            }
          }
        } else if (c.type === '$magic') {
          const magicRegs = this.workspace.lookupAlpineMagic(c.name);
          if (magicRegs.length > 0) {
            const loc = this.defToLocation(magicRegs[0].def);
            if (loc) {
              const chainLen = `$${c.name}`.length;
              links.push({
                range: {
                  start: doc.positionAt(chainOffset),
                  end: doc.positionAt(chainOffset + chainLen),
                },
                target: loc.uri,
                tooltip: `Alpine.magic('${c.name}')`,
              });
            }
          }
        }
      }
    }

    this.connection.console.info(`[documentLink] returned ${links.length} links for ${uri}`);
    return links;
  }

  private onReferences(params: ReferenceParams): Location[] {
    const uri = params.textDocument.uri;
    const doc = this.documents.get(uri);
    if (!doc) return [];

    const offset = doc.offsetAt(params.position);
    const attrs = this.attrCache.get(uri) ?? [];
    const attr = findAttrAtOffset(attrs, offset);
    if (!attr) return [];

    const locations: Location[] = [];

    if (
      isXData(attr.name) &&
      !attr.value.trim().startsWith('{') &&
      !attr.value.trim().startsWith('(')
    ) {
      const word = getWordAtOffset(attr.value, offset - attr.valueOffset);
      if (word) {
        for (const fileUri of this.workspace.allUris()) {
          const text = this.workspace.getText(fileUri);
          if (!text) continue;
          const fileAttrs = extractAlpineAttrs(text);
          for (const fa of fileAttrs) {
            if (isXData(fa.name) && fa.value.trim() === word) {
              locations.push({
                uri: fileUri,
                range: {
                  start: this.offsetToPosition(fileUri, fa.valueOffset),
                  end: this.offsetToPosition(fileUri, fa.valueOffset + fa.valueLength),
                },
              });
            }
          }
        }
      }
    }

    // Check if cursor is on $store.NAME chain (usage of a registered store)
    const chain = getChainAtOffset(attr.value, offset - attr.valueOffset);
    if (chain && chain.length >= 2 && chain[0] === '$store') {
      const storeName = chain[1];
      for (const fileUri of this.workspace.allUris()) {
        const text = this.workspace.getText(fileUri);
        if (!text) continue;
        const chains = findAllChainsInText(text);
        for (const c of chains) {
          if (c.type === '$store' && c.name === storeName) {
            locations.push({
              uri: fileUri,
              range: {
                start: this.offsetToPosition(fileUri, c.offset),
                end: this.offsetToPosition(fileUri, c.offset + `$store.${storeName}`.length),
              },
            });
          }
        }
      }
    }

    this.connection.console.info(`[references] found ${locations.length} references`);
    return locations;
  }

  private onRename(params: RenameParams): WorkspaceEdit | null {
    const uri = params.textDocument.uri;
    const doc = this.documents.get(uri);
    if (!doc) return null;

    const newName = params.newName;
    const offset = doc.offsetAt(params.position);
    const attrs = this.attrCache.get(uri) ?? [];
    const attr = findAttrAtOffset(attrs, offset);
    if (!attr) return null;

    const changes: Record<string, TextEdit[]> = {};

    if (
      isXData(attr.name) &&
      !attr.value.trim().startsWith('{') &&
      !attr.value.trim().startsWith('(')
    ) {
      const word = getWordAtOffset(attr.value, offset - attr.valueOffset);
      if (!word) return null;

      for (const fileUri of this.workspace.allUris()) {
        const text = this.workspace.getText(fileUri);
        if (!text) continue;
        const fileAttrs = extractAlpineAttrs(text);
        for (const fa of fileAttrs) {
          if (isXData(fa.name) && fa.value.trim() === word) {
            if (!changes[fileUri]) changes[fileUri] = [];
            changes[fileUri].push({
              range: {
                start: this.offsetToPosition(fileUri, fa.valueOffset),
                end: this.offsetToPosition(fileUri, fa.valueOffset + fa.valueLength),
              },
              newText: newName,
            });
          }
        }
      }
      const editCount = Object.values(changes).reduce((a, e) => a + e.length, 0);
      this.connection.console.info(
        `[rename] Alpine.data '${word}' → '${newName}': ${editCount} edits`,
      );
      return { changes };
    }

    const chain = getChainAtOffset(attr.value, offset - attr.valueOffset);
    if (chain && chain.length >= 2 && chain[0] === '$store') {
      const storeName = chain[1];
      for (const fileUri of this.workspace.allUris()) {
        const text = this.workspace.getText(fileUri);
        if (!text) continue;
        const chains = findAllChainsInText(text);
        for (const c of chains) {
          if (c.type === '$store' && c.name === storeName) {
            if (!changes[fileUri]) changes[fileUri] = [];
            const nameOffset = c.offset + '$store.'.length;
            changes[fileUri].push({
              range: {
                start: this.offsetToPosition(fileUri, nameOffset),
                end: this.offsetToPosition(fileUri, nameOffset + storeName.length),
              },
              newText: newName,
            });
          }
        }
      }
      const editCount = Object.values(changes).reduce((a, e) => a + e.length, 0);
      this.connection.console.info(
        `[rename] Alpine.store '${storeName}' → '${newName}': ${editCount} edits`,
      );
      return { changes };
    }

    return null;
  }

  /**
   * Open files resolve via TextDocuments.positionAt; non-open files fall back
   * to scanning raw workspace text (only open files have a TextDocument).
   */
  private offsetToPosition(uri: string, offset: number): { line: number; character: number } {
    const doc = this.documents.get(uri);
    if (doc) return doc.positionAt(offset);
    const text = this.workspace.getText(uri) ?? '';
    let line = 0;
    let char = 0;
    const max = Math.min(offset, text.length);
    for (let i = 0; i < max; i++) {
      if (text[i] === '\n') {
        line++;
        char = 0;
      } else {
        char++;
      }
    }
    return { line, character: char };
  }

  private computeDiagnostics(uri: string, doc: TextDocument): Diagnostic[] {
    const attrs = this.attrCache.get(uri) ?? [];
    const text = doc.getText();
    const diagnostics: Diagnostic[] = [];
    const elementGroups = new Map<number, AlpineAttr[]>();

    for (const attr of attrs) {
      const normalized = normalizeAttrName(attr.name);

      if (normalized === 'x-if' || normalized === 'x-for') {
        const tag = findEnclosingTag(text, attr.nameOffset);
        if (tag && tag.tagName !== 'template') {
          diagnostics.push({
            range: {
              start: doc.positionAt(attr.nameOffset),
              end: doc.positionAt(attr.nameOffset + attr.nameLength),
            },
            severity: DiagnosticSeverity.Error,
            source: 'alpinejs',
            code: 'x-if-template',
            message: `${normalized} must be used on a <template> element`,
          });
        }
      }

      if (isXData(attr.name)) {
        const value = attr.value.trim();
        if (value && !value.startsWith('{') && !value.startsWith('(')) {
          const registered = this.workspace.lookupAlpineData(value);
          if (registered.length === 0) {
            diagnostics.push({
              range: {
                start: doc.positionAt(attr.valueOffset),
                end: doc.positionAt(attr.valueOffset + attr.valueLength),
              },
              severity: DiagnosticSeverity.Warning,
              source: 'alpinejs',
              code: 'unregistered-component',
              message: `Component '${value}' is not registered via Alpine.data()`,
            });
          }
        }

        const tag = findEnclosingTag(text, attr.nameOffset);
        if (tag) {
          const group = elementGroups.get(tag.tagStartOffset) ?? [];
          group.push(attr);
          elementGroups.set(tag.tagStartOffset, group);
        }
      }
    }

    for (const [, groupAttrs] of elementGroups) {
      if (groupAttrs.length > 1) {
        for (const attr of groupAttrs) {
          diagnostics.push({
            range: {
              start: doc.positionAt(attr.nameOffset),
              end: doc.positionAt(attr.nameOffset + attr.nameLength),
            },
            severity: DiagnosticSeverity.Error,
            source: 'alpinejs',
            code: 'duplicate-x-data',
            message: `Only one x-data is allowed per element (found ${groupAttrs.length})`,
          });
        }
      }
    }

    this.connection.console.info(`[diagnostics] computed ${diagnostics.length} diagnostics for ${uri}`);
    return diagnostics;
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

  private hoverRegistrationName(rawName: string): Hover | null {
    const name = rawName.replace(/\(.*$/, '').trim();
    if (!name) return null;

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

/**
 * Detect an `Alpine.NAME` reference at `offset` and return the NAME segment.
 * Handles cursor positioned on either segment ("Alpine" or "NAME").
 *
 *   "Alpine.data('x')" @ "data"   → "data"
 *   "Alpine.start()"   @ "Alpine" → "start"  (only when ".NAME" follows)
 *   "toggle()"         @ "toggle" → null     (not Alpine-prefixed)
 */
function getAlpineApiAtOffset(text: string, offset: number): string | null {
  if (offset < 0 || offset > text.length) return null;

  let start = offset;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && /\w/.test(text[end])) end++;

  if (end <= start) return null;
  const segment = text.slice(start, end);

  if (start >= 7 && text.slice(start - 7, start) === 'Alpine.') {
    return segment;
  }

  if (segment === 'Alpine' && text[end] === '.') {
    let nameEnd = end + 1;
    while (nameEnd < text.length && /\w/.test(text[nameEnd])) nameEnd++;
    const name = text.slice(end + 1, nameEnd);
    if (name) return name;
  }

  return null;
}

/**
 * Walk backward from `offset` through dot-separated word segments.
 * Returns the full chain only when the FIRST segment starts with "$".
 *
 *   "$store.catalogMenu.isOpen" @ "isOpen" → ["$store", "catalogMenu", "isOpen"]
 *   "$modal.show"              @ "show"    → ["$modal", "show"]
 *   "toggle()"                 @ "toggle"  → null  (no dot-chain, not $-prefixed)
 */
function getChainAtOffset(text: string, offset: number): string[] | null {
  if (offset < 0 || offset > text.length) return null;

  let wordStart = offset;
  while (wordStart > 0 && /[\w$]/.test(text[wordStart - 1])) wordStart--;
  let wordEnd = offset;
  while (wordEnd < text.length && /[\w$]/.test(text[wordEnd])) wordEnd++;

  if (wordEnd <= wordStart) return null;

  const segments: string[] = [text.slice(wordStart, wordEnd)];

  let cursor = wordStart;
  while (cursor > 0 && text[cursor - 1] === '.') {
    const prevEnd = cursor - 1;
    let prevStart = prevEnd;
    while (prevStart > 0 && /[\w$]/.test(text[prevStart - 1])) prevStart--;
    if (prevStart >= prevEnd) break;
    segments.unshift(text.slice(prevStart, prevEnd));
    cursor = prevStart;
  }

  if (segments.length === 0) return null;
  if (!segments[0].startsWith('$')) return null;
  return segments;
}

function findEnclosingTag(text: string, offset: number): { tagName: string; tagStartOffset: number } | null {
  let i = offset;
  while (i >= 0) {
    if (text[i] === '<' && i + 1 < text.length && text[i + 1] !== '/') {
      let j = i + 1;
      while (j < text.length && /[\w-]/.test(text[j])) j++;
      const tagName = text.slice(i + 1, j).toLowerCase();
      if (tagName) return { tagName, tagStartOffset: i };
      return null;
    }
    i--;
  }
  return null;
}

function findAllChainsInText(text: string): { type: string; name: string; offset: number }[] {
  const results: { type: string; name: string; offset: number }[] = [];
  const storeRegex = /\$store\.(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = storeRegex.exec(text)) !== null) {
    results.push({ type: '$store', name: m[1], offset: m.index });
  }
  const magicRegex = /\$(\w+)\s*\(/g;
  while ((m = magicRegex.exec(text)) !== null) {
    const magicName = m[1];
    if (magicName !== 'store') {
      results.push({ type: '$magic', name: magicName, offset: m.index });
    }
  }
  return results;
}
