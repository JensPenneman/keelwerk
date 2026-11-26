/** A membership, from principal resolvers and enrichers; its kind starts with the id of the module that returned it. */
export interface Membership {
  readonly kind: string;
  readonly id: string;
  readonly role: string;
}
