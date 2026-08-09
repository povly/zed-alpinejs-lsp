export interface MagicProperty {
    name: string;
    signature: string;
    documentation: string;
    example?: string;
}
export declare const MAGIC_PROPERTIES: MagicProperty[];
export interface DirectiveInfo {
    name: string;
    documentation: string;
    example?: string;
}
export declare const DIRECTIVES: DirectiveInfo[];
export interface TransitionSubAttr {
    name: string;
    documentation: string;
}
export declare const TRANSITION_SUBS: TransitionSubAttr[];
export interface ModifierInfo {
    name: string;
    for: string[];
    documentation: string;
}
export declare const MODIFIERS: ModifierInfo[];
export interface GlobalApi {
    name: string;
    signature: string;
    description: string;
    example?: string;
}
export declare const GLOBAL_APIS: GlobalApi[];
