declare const secretBrand: unique symbol;

/** A sealed secret held by reference, read only through a reveal request (section 6.6). */
export interface SecretRef {
  readonly [secretBrand]: true;
  readonly ref: string;
}
