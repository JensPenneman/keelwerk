import type { MemberOf } from './member-of.ts';

/** An executor mounted under a key whose effect is a different one, or no effect at all. */
export type MismatchedExecutors<L> = {
  [K in keyof MemberOf<L, 'executors'>]: MemberOf<L, 'executors'>[K] extends {
    readonly effect: infer E;
  }
    ? K extends keyof MemberOf<L, 'effects'>
      ? [E] extends [MemberOf<L, 'effects'>[K]]
        ? never
        : K & string
      : K & string
    : never;
}[keyof MemberOf<L, 'executors'>];
