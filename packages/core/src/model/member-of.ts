import type { Empty } from '../types/empty.ts';

/** The type of member `K` of `T`, empty when `T` has none. */
export type MemberOf<T, K extends string> = T extends { readonly [P in K]: infer V } ? V : Empty;
