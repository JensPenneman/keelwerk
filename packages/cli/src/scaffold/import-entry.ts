/** One import statement: the module specifier and its named bindings (`type X` for a type). */
export interface ImportEntry {
  readonly from: string;
  readonly names: readonly string[];
}
