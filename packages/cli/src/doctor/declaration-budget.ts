/** The two limits of section 13.11 and the path prefixes exempt from them. */
export interface DeclarationBudget {
  readonly manifestBytes: number;
  readonly packageBytes: number;
  readonly exempt: readonly string[];
}
