/** The type of key `K` in whichever union members define it. */
export type TypeAt<U, K extends PropertyKey> = U extends unknown
  ? K extends keyof U
    ? U[K]
    : never
  : never;
