/** Every key of every member of a union (keyof of a union keeps only the common keys). */
export type AllKeys<U> = U extends unknown ? keyof U : never;
