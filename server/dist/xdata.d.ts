export interface XDataMember {
    name: string;
    kind: 'method' | 'property' | 'getter';
    offset: number;
    length: number;
}
export declare function parseXData(value: string): XDataMember[];
