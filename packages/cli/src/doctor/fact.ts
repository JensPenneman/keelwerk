/** What doctor knows of one thing: its value, or the reason it could not find out and what the operator can do about it. A value of zero or none is still known. */
export type Fact<T> =
  | { readonly known: true; readonly value: T }
  | { readonly known: false; readonly reason: string; readonly fix: string };
