/** What one module package emitted, in bytes of `.d.ts`. */
export interface DeclarationSize {
  readonly dir: string;
  /** `module.generated.d.ts`, or 0 when the package has none. */
  readonly manifestBytes: number;
  /** Every `.d.ts` of the package together. */
  readonly totalBytes: number;
}
