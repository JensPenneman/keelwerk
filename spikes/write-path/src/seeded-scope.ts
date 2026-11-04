/** A tenant scope with its counter row and some entity rows of its own. */
export interface SeededScope {
  readonly index: number;
  readonly id: string;
  readonly entities: readonly string[];
}
