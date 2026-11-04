/** Flattens an intersection into one object type, so hovers show rows instead of conditionals. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
