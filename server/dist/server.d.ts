import { Connection } from 'vscode-languageserver/node';
export declare class AlpineLanguageServer {
    private connection;
    private documents;
    private attrCache;
    private workspace;
    private indexDebounceTimer;
    constructor(connection: Connection);
    start(): void;
    private onCompletion;
    private onHover;
    private onDefinition;
    private onDocumentSymbol;
    private onDocumentLink;
    private onReferences;
    private onRename;
    /**
     * Open files resolve via TextDocuments.positionAt; non-open files fall back
     * to scanning raw workspace text (only open files have a TextDocument).
     */
    private offsetToPosition;
    private onCodeAction;
    private computeDiagnostics;
    private getScopeMembers;
    private getXDataScope;
    private findScopeXData;
    private hoverRegistrationName;
    private memberToCompletion;
    private addWorkspaceMembers;
    private formatHover;
    private formatHoverDef;
    private defToLocation;
}
