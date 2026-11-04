/** The entity names of a module value. */
export type EntityNamesOf<M> = M extends { readonly entities: infer Es }
  ? keyof Es & string
  : never;

/** What `field.ref(module, entity)` and `relation` need of a module: its id and its entities. */
export interface RefModule {
  readonly id: string;
  readonly entities: object;
}
