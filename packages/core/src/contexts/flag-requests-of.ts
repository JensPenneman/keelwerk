import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { CamelCase } from '../model/camel-case.ts';
import type { MemberOf } from '../model/member-of.ts';
import type { ModuleById, PresentIds, PresentModules } from '../model/present-modules.ts';
import type { FlagRequest } from '../protocol/flag-request.ts';

type FlagValueOf<F, I extends string> = F extends { readonly kind: 'boolean' }
  ? boolean
  : F extends { readonly kind: 'string' }
    ? string
    : F extends { readonly kind: 'number' }
      ? number
      : F extends { readonly kind: 'variant'; readonly variants: readonly (infer V)[] }
        ? V
        : F extends { readonly kind: 'json'; readonly schema: Shape<infer Sf> }
          ? ShapeValue<Sf, I, 'value'>
          : unknown;

type FlagsOf<Fl, I extends string> = {
  readonly [K in keyof Fl]: FlagRequest<FlagValueOf<Fl[K], I>>;
};

/** `ctx.flags` (sections 7.6 and 20.3): the base's flags and those of its present modules, by context name. */
export type FlagRequestsOf<B extends AnyModuleBase, W> = {
  readonly [I in B['id'] as CamelCase<I>]: FlagsOf<MemberOf<B, 'flags'>, I>;
} & {
  readonly [I in PresentIds<B, W> as CamelCase<I>]: FlagsOf<
    MemberOf<MemberOf<ModuleById<PresentModules<B, W>, I>, 'base'>, 'flags'>,
    I
  >;
};
