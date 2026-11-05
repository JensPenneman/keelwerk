/** What an object literal argument holds, reduced to names. */
export interface ObjectFacts {
  /** For each property, the identifiers its value names: an identifier, the elements of an array, the values (or shorthand names) of a nested object. */
  readonly names: ReadonlyMap<string, readonly string[]>;
  /** For each property, the string literal it holds. */
  readonly strings: ReadonlyMap<string, string>;
}

/** An argument of a call, reduced to what the layout pass compares. */
export type ArgFacts =
  | { readonly kind: 'identifier'; readonly name: string }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'within'; readonly base: string; readonly declaration: string }
  | { readonly kind: 'list'; readonly names: readonly string[] }
  | { readonly kind: 'object'; readonly facts: ObjectFacts }
  | { readonly kind: 'other' };

/** A call such as `defineEntity({...})` or `defineCommand(base, entity, {...})`. */
export interface CallFacts {
  readonly callee: string;
  readonly args: readonly ArgFacts[];
}

/** How an exported value is typed: a named type, `typeof` something, or inferred. */
export type Annotation = 'inferred' | 'named' | 'typeof';

/** An exported value with the call that initialises it, when there is one. */
export interface ExportedValue {
  readonly name: string;
  readonly call: CallFacts | undefined;
  readonly annotation: Annotation;
}

/** A source file as the layout pass reads it, parsed with TypeScript 6.0.3's compiler API. */
export interface ParsedSource {
  /** Relative to the workspace root, with `/` separators. */
  readonly path: string;
  readonly values: readonly ExportedValue[];
  readonly types: readonly string[];
  readonly defaultExport: boolean;
  /** Local name to module specifier, for the imports of the file. */
  readonly imports: ReadonlyMap<string, string>;
  /** Every identifier outside import declarations, types included. */
  readonly referenced: ReadonlySet<string>;
}
