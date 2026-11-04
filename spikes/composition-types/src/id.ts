declare const entityBrand: unique symbol;
declare const subjectBrand: unique symbol;
declare const secretBrand: unique symbol;
declare const blobBrand: unique symbol;
declare const richTextBrand: unique symbol;

/** A row id of the entity `Ref` ('module.entity'): a UUIDv7 string at runtime, branded by its entity. */
export type Id<Ref extends string> = string & { readonly [entityBrand]: Ref };

/** An opaque principal or data-subject id (section 8.5). */
export type SubjectId = string & { readonly [subjectBrand]: true };

/** A sealed secret held by reference, read only through a reveal request (section 6.6). */
export interface SecretRef {
  readonly [secretBrand]: true;
  readonly ref: string;
}

/** A reference into a blob store (gap G5). */
export interface BlobRef {
  readonly [blobBrand]: true;
  readonly key: string;
}

/** An opaque collaborative document handle (section 15.3.9). */
export interface RichText {
  readonly [richTextBrand]: true;
}
