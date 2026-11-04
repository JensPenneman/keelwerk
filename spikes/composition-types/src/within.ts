import type { ConditionsOf, ContributionsOf } from './base-members.ts';
import type { AnyModuleBase } from './define-module-base.ts';

type SectionOf<D> = D extends { readonly kind: 'contribution' } ? 'contributions' : 'conditions';
type MembersOf<B, Sec> = Sec extends 'contributions' ? ContributionsOf<B> : ConditionsOf<B>;
type KeyOf<Ds, D> = {
  [K in keyof Ds]: [Ds[K]] extends [D] ? ([D] extends [Ds[K]] ? K : never) : never;
}[keyof Ds] &
  string;
type DeclarationOfBase<B> =
  | ContributionsOf<B>[keyof ContributionsOf<B>]
  | ConditionsOf<B>[keyof ConditionsOf<B>];

/** Which declaration list of the base a `within` narrowing names. */
export type DeclarationSection = 'contributions' | 'conditions';

/** A base narrowed to one contribution or conditional part, by the declaration's key in the base. */
export interface Within<B extends AnyModuleBase, K extends string, Sec extends DeclarationSection> {
  readonly kind: 'within';
  readonly base: B;
  readonly key: K;
  readonly section: Sec;
}

/** Any `within` narrowing. */
export type AnyWithin = Within<AnyModuleBase, string, DeclarationSection>;

/** Types a part of a contribution or conditional part: its target and `when` modules count as required. */
export function within<const B extends AnyModuleBase, const D extends DeclarationOfBase<B>>(
  base: B,
  declaration: D,
): Within<B, KeyOf<MembersOf<B, SectionOf<D>>, D>, SectionOf<D>> {
  const isContribution = (declaration as { readonly kind: string }).kind === 'contribution';
  const members: { readonly [key: string]: unknown } =
    (isContribution ? base.contributions : base.conditions) ?? {};
  const key = Object.keys(members).find((name) => members[name] === declaration) ?? '';
  return {
    kind: 'within',
    base,
    key,
    section: isContribution ? 'contributions' : 'conditions',
  } as unknown as Within<B, KeyOf<MembersOf<B, SectionOf<D>>, D>, SectionOf<D>>;
}
