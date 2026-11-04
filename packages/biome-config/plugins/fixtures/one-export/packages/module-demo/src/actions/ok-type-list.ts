const a = 1;

type T = typeof a;
type S = string;
export type { S, T };
export { a };
