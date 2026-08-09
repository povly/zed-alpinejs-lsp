import { AlpineAttr } from './extractor';
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
    indexDocument(uri: string, text: string, precomputedAttrs?: AlpineAttr[]): void;
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
    /**
     * Incremental update of derived maps for one URI: O(D_uri) vs O(F*D) full rebuild.
     * Identity = (uri + startOffset), NOT name — same name can live in many files.
     */
    private updateIndexesForUri;
    private removeFromNameIndex;
    private removeFromRegistrations;
    private insertIntoNameIndex;
    private insertIntoRegistrations;
    private rebuildIndexes;
}
