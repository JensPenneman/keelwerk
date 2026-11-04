/**
 * What jobs and receipts store of a principal: the resolver and the principal id; the module that
 * resolves the principal adds its own typed fields (`principalRef` on its base, section 8.5).
 */
export interface PrincipalRef {
  readonly resolver: string;
  readonly principalId: string;
}
