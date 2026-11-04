import type { EntityOutputSpec } from '../dsl/page-of.ts';
import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { PageOutput, RowOutput } from './action-part.ts';
import type { EntityNameOf } from './entity-name-of.ts';
import type { BaseOf, OwnerOf } from './part-source.ts';

/** What callers receive; entity rows stay markers until the app resolves them. */
export type WireOutput<Out, S, Default> =
  Out extends Shape<infer F>
    ? ShapeValue<F, OwnerOf<S>, 'stored'>
    : Out extends EntityOutputSpec<'page', infer En>
      ? PageOutput<`${OwnerOf<S>}.${EntityNameOf<BaseOf<S>, En>}`>
      : Out extends EntityOutputSpec<'row', infer En>
        ? RowOutput<`${OwnerOf<S>}.${EntityNameOf<BaseOf<S>, En>}`>
        : Default;
