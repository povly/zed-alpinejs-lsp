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
