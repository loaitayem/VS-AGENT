declare module 'diff' {
    export interface Change {
        count?: number;
        value: string;
        added?: boolean;
        removed?: boolean;
    }

    export function diffLines(oldStr: string, newStr: string, options?: any): Change[];
    export function diffChars(oldStr: string, newStr: string, options?: any): Change[];
    export function diffWords(oldStr: string, newStr: string, options?: any): Change[];
    export function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: any): string;
    export function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: any): string;
    export function applyPatch(source: string, uniDiff: string, options?: any): string | false;
    export function parsePatch(uniDiff: string): any[];
    export function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: any): any;
}
