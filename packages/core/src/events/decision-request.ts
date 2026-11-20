/**
 * What a decision record keeps of the request a decision read (S-126): only the members it read,
 * never the address. A decision that read the transport alone keeps no user agent, so the record
 * holds no personal data the decision did not use. That the address of a connection the request carried
 * was read is kept as a fact, without the address.
 */
export interface DecisionRequest {
  /** Present when the decision read `ctx.request.transport`. */
  readonly transport?: string;
  /** Present when the decision read `ctx.request.userAgent`; null: the request had none. */
  readonly userAgent?: string | null;
  /** Present when the decision read a `ctx.request.connection` the request carried; never the connection itself. */
  readonly connection?: true;
}
