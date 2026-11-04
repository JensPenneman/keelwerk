declare const entityBrand: unique symbol;

/** A row id of the entity `Ref` ('module.entity'): a UUIDv7 string at runtime, branded by its entity. */
export type Id<Ref extends string> = string & { readonly [entityBrand]: Ref };
