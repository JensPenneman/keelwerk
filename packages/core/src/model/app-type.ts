/** The named type of an app value: the identity; extending it in an interface gives emit a name (section 4.5). */
export type AppType<T extends { readonly kind: 'app' }> = T;
