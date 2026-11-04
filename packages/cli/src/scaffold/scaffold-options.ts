/** The flags of `keelwerk new`, normalised: lists split, absent values undefined. */
export interface ScaffoldOptions {
  readonly kind: string | undefined;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly app: string | undefined;
  readonly from: string | undefined;
  readonly when: readonly string[];
  readonly level: string | undefined;
  readonly purpose: string | undefined;
  readonly expires: string | undefined;
  readonly effect: string | undefined;
  readonly on: string | undefined;
  readonly every: string | undefined;
  readonly modules: readonly string[];
  readonly scope: string | undefined;
  readonly dir: string | undefined;
}
