/** The members of an event a re-decide compares: what the decision decided, not when or under which id it was stored. */
export interface ComparableEvent {
  /** 'library.book/<id>'. */
  readonly stream: string;
  readonly version: number;
  /** Full name: 'library.book.created'. */
  readonly type: string;
  readonly schemaVersion: number;
  readonly shape: string;
  readonly data: unknown;
  readonly before: unknown;
}
