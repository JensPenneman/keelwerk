import type { MemberOf } from './member-of.ts';

export type SectionsOf<L> =
  | L
  | {
      [K in keyof MemberOf<L, 'contributes'>]: MemberOf<L, 'contributes'>[K];
    }[keyof MemberOf<L, 'contributes'>]
  | {
      [K in keyof MemberOf<L, 'conditional'>]: MemberOf<L, 'conditional'>[K];
    }[keyof MemberOf<L, 'conditional'>];
