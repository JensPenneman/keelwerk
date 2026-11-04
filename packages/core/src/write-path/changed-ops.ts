/** The payload of `changed` (section 15.1.5): what an actor proposed, per field, in event form. */
export interface ChangedOps {
  readonly set?: Readonly<Record<string, unknown>>;
  readonly inc?: Readonly<Record<string, number | string>>;
  readonly add?: Readonly<Record<string, readonly unknown[]>>;
  readonly remove?: Readonly<Record<string, readonly unknown[]>>;
  readonly crdt?: Readonly<Record<string, { readonly codec: string; readonly update: string }>>;
}
