/** A draft a driven handler is expected to return among its events. */
export interface DraftMatcher {
  readonly kind: 'create' | 'update' | 'archive' | 'restore';
  readonly prefix: string;
  /** Absent: any id (a create that takes it from elsewhere). */
  readonly id?: string;
  readonly values: Readonly<Record<string, unknown>>;
}
