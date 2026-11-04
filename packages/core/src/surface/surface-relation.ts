export interface SurfaceRelation {
  readonly kind: 'one' | 'many' | 'through' | 'derived';
  /** Entity ref. */
  readonly target: string;
  /** The field on the other side, for 'many'. */
  readonly by?: string;
  readonly description?: string;
}
