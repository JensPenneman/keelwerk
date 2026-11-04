declare const blobBrand: unique symbol;

/** A reference into a blob store (gap G5). */
export interface BlobRef {
  readonly [blobBrand]: true;
  readonly key: string;
}
