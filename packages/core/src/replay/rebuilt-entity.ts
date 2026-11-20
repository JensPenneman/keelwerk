export interface RebuiltEntity {
  readonly entity: string;
  /** The streams of the entity the chain holds. */
  readonly streams: number;
  readonly inserted: number;
  readonly updated: number;
  /** Rows of the table no stream of the scope accounts for. */
  readonly purged: number;
}
