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
export declare class WorkspaceIndex {
    private fileDefs;
    private fileTexts;
    private nameIndex;
    private dataRegistrations;
    private storeRegistrations;
    indexDocument(uri: string, text: string): void;
    removeDocument(uri: string): void;
    getText(uri: string): string | undefined;
    lookup(name: string): WorkspaceDef[];
    allNames(): string[];
    allDataNames(): string[];
    allStoreNames(): string[];
    lookupAlpineData(name: string): {
        def: WorkspaceDef;
        text: string;
    }[];
    lookupAlpineStore(name: string): {
        def: WorkspaceDef;
        text: string;
    }[];
    resolveScope(xdataValue: string, currentUri: string): ResolvedScope | null;
    getRegistrationMembers(def: WorkspaceDef, text: string): WorkspaceDef[];
    getPosition(def: WorkspaceDef): {
        line: number;
        character: number;
    } | null;
    getEndPosition(def: WorkspaceDef): {
        line: number;
        character: number;
    } | null;
    scanWorkspace(rootPath: string): void;
    private extractDefinitions;
    private makeDef;
    private rebuildIndexes;
}
