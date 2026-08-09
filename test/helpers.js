/**
 * Test harness helpers for AlpineLanguageServer unit tests.
 *
 * createTestServer() instantiates the server with a mock Connection that
 * captures the LSP handler callbacks (onInitialize/onCompletion/onHover/onDefinition).
 *
 * loadDocument(server, uri, text) creates a TextDocument, populates the server's
 * attrCache and workspace index, and patches documents.get() so the handlers can
 * resolve the document by URI.
 *
 * NOTE: TypeScript `private` is NOT enforced at runtime in the compiled JS —
 * private fields and methods are accessed via bracket notation.
 */
const { TextDocument } = require('../server/node_modules/vscode-languageserver-textdocument');
const { AlpineLanguageServer } = require('../server/dist/server');
const { extractAlpineAttrs } = require('../server/dist/extractor');

const DEBUG = process.env.LOG_LEVEL === 'debug';

const noop = () => {};
// Disposable returned by connection.onXxx registrations
const disposable = () => ({ dispose: noop });

/**
 * Build a mock LSP Connection capable of constructing an AlpineLanguageServer.
 *
 * The AlpineLanguageServer constructor calls `this.documents.listen(connection)`
 * which registers several onDid*TextDocument handlers, and then registers
 * onInitialize/onCompletion/onHover/onDefinition. Every handler registration
 * captures the callback into `handlers` so tests can invoke them directly.
 */
function createTestServer() {
  const handlers = {};
  const mockConnection = {
    console: {
      info: noop,
      error: noop,
      warn: noop,
    },
    listen: noop,
    // LSP feature handlers — captured for direct invocation in tests
    onInitialize: (fn) => { handlers.onInitialize = fn; return disposable(); },
    onCompletion: (fn) => { handlers.onCompletion = fn; return disposable(); },
    onHover: (fn) => { handlers.onHover = fn; return disposable(); },
    onDefinition: (fn) => { handlers.onDefinition = fn; return disposable(); },
    onDocumentSymbol: (fn) => { handlers.onDocumentSymbol = fn; return disposable(); },
    onDocumentLinks: (fn) => { handlers.onDocumentLinks = fn; return disposable(); },
    // Outbound notifications — no-op stubs (server sends diagnostics on change/close)
    sendDiagnostics: () => {},
    // TextDocuments.listen() registers these document lifecycle hooks
    onDidOpenTextDocument: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    onWillSaveTextDocument: () => disposable(),
    onWillSaveTextDocumentWaitUntil: () => disposable(),
    onDidSaveTextDocument: () => disposable(),
  };
  const server = new AlpineLanguageServer(mockConnection);
  if (DEBUG) {
    console.error('[helpers] createTestServer: server constructed, handlers captured:', Object.keys(handlers));
  }
  return { server, handlers };
}

/**
 * Load a document into the server's internal state.
 *
 * Steps:
 *  1. Create a TextDocument via vscode-languageserver-textdocument.
 *  2. Extract Alpine attrs from text and store in server['attrCache'].
 *  3. Index the document text in server['workspace'].
 *  4. Patch server['documents'].get(uri) to return this document (the
 *     TextDocuments instance never sees real LSP open notifications in tests,
 *     so we bypass it with a per-instance URI→doc map).
 *
 * Returns the created TextDocument so callers can compute offsets via doc.offsetAt().
 */
function loadDocument(server, uri, text) {
  let doc;
  try {
    doc = TextDocument.create(uri, 'html', 1, text);
  } catch (e) {
    console.error(`[helpers] failed to create TextDocument for ${uri}: ${e}`);
    throw e;
  }

  // Populate attrCache (mimics onDidChangeContent handler)
  const attrs = extractAlpineAttrs(text);
  server['attrCache'].set(uri, attrs);

  // Index in workspace (mimics onDidChangeContent handler)
  server['workspace'].indexDocument(uri, text);

  // Patch documents.get() — install a URI→doc map once, then add to it.
  // This supports loading multiple documents across separate loadDocument calls.
  const documents = server['documents'];
  if (!documents.__alpineTestDocs) {
    documents.__alpineTestDocs = new Map();
    documents.get = (u) => documents.__alpineTestDocs.get(u);
  }
  documents.__alpineTestDocs.set(uri, doc);

  if (DEBUG) {
    const ws = server['workspace'];
    console.error(
      `[helpers] loaded ${uri}: ${attrs.length} attrs, ` +
      `${ws.allNames().length} names (${ws.allDataNames().length} data, ${ws.allStoreNames().length} store)`,
    );
  }

  return doc;
}

module.exports = { createTestServer, loadDocument, DEBUG };
