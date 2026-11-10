/** The limits a transport enforces on the selection of a request (16.4.12, 16.6.6); configurable per backend. */
export interface SelectionLimits {
  /** No entity type twice on one path from the root. */
  readonly noRepeatedEntity: boolean;
  /** Most entity levels on one path. */
  readonly depth: number;
  /** Most aliases in a request. */
  readonly aliases: number;
  /** Most operations in a request. */
  readonly operations: number;
  /** Most wire-format tokens in the selection part. */
  readonly tokens: number;
  /** Most cost: 1 per field, 10 per connection page. */
  readonly cost: number;
}
