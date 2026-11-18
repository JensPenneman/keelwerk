/**
 * What jobs and receipts store of a principal: the resolver and the principal id; the module that
 * resolves the principal adds its own typed fields (`principalRef` on its base, section 8.5).
 */
export interface PrincipalRef {
  readonly resolver: string;
  /**
   * An opaque id (`isOpaqueId`: a UUID of version 4 or 7, or a ULID), or the id of a kernel
   * principal (the service principal of a module, an operator). A principal id is stored in clear
   * text in receipts, jobs, tickets, flags and the effect records, where an erasure does not reach
   * it, so a resolver never builds it from a name, an address or another value that identifies a
   * person. The shipped resolvers (sessions, API keys) are pinned to the rule by tests; the kernel
   * does not check it yet.
   */
  readonly principalId: string;
}
