/** How a unit opens. */
export interface UnitOptions {
  /** Queries. */
  readonly readOnly?: boolean;
  readonly isolation?: 'read-committed' | 'repeatable-read' | 'serializable';
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
