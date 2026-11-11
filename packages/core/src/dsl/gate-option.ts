import type { MemberOf } from '../model/member-of.ts';

/** The boolean flags of a base, which a `gate` may name (section 20.6). */
export type GateOption<B> = {
  [K in keyof MemberOf<B, 'flags'>]: MemberOf<B, 'flags'>[K] extends { readonly kind: 'boolean' }
    ? K
    : never;
}[keyof MemberOf<B, 'flags'>] &
  string;
