declare const richTextBrand: unique symbol;

/** An opaque collaborative document handle (section 15.3.9). */
export interface RichText {
  readonly [richTextBrand]: true;
}
