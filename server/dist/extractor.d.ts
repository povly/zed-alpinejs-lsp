export interface AlpineAttr {
    name: string;
    nameOffset: number;
    nameLength: number;
    value: string;
    valueOffset: number;
    valueLength: number;
}
export declare function isAlpineAttr(name: string): boolean;
export declare function extractAlpineAttrs(text: string): AlpineAttr[];
export declare function findAttrAtOffset(attrs: AlpineAttr[], offset: number): AlpineAttr | null;
export declare function findAttrByNameAtOffset(attrs: AlpineAttr[], offset: number): AlpineAttr | null;
export interface AlpineRegistration {
    /** Component or store name, e.g. 'modal' or 'settings' */
    registrationName: string;
    /** The object literal body (content between outermost { and }) */
    objectLiteral: string;
    /** Absolute offset of the first char inside the opening { */
    objectOffset: number;
    /** Type label for display: "Alpine.data" or "Alpine.store" */
    kind: 'Alpine.data' | 'Alpine.store';
}
/**
 * Match a balanced `{ … }` block starting at `openBraceOffset`.
 * Handles nested objects, strings (single/double/backtick), escapes,
 * line comments (//), block comments (/* *\/), and template interpolation (${...}).
 * Returns the offset of the closing `}`, or `null` if unbalanced.
 */
export declare function matchBraces(text: string, openBraceOffset: number): number | null;
/**
 * Extract all `Alpine.data('name', () => ({ … }))` registrations.
 * Handles common forms:
 *   Alpine.data('foo', () => ({ … }))
 *   Alpine.data('foo', () => { return { … } })
 *   Alpine.data('foo', { … })
 */
export declare function extractAlpineData(text: string): AlpineRegistration[];
/**
 * Extract all `Alpine.store('name', { … })` registrations.
 */
export declare function extractAlpineStore(text: string): AlpineRegistration[];
export declare function normalizeAttrName(name: string): string;
export declare function isXData(name: string): boolean;
export declare function resolveDirectiveBase(attrName: string): string | null;
export declare function getModifierAtOffset(attrName: string, relOffset: number): {
    modifier: string;
    base: string;
} | null;
