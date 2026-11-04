import type { EntityOutputSpec } from '../dsl/page-of.ts';
import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { EntityNameOf } from './entity-name-of.ts';
import type { OwnRow } from './own-row.ts';
import type { Page } from './page.ts';
import type { BaseOf, OwnerOf } from './part-source.ts';
import type { TypedOutput } from './typed-output.ts';

/** What a handler produces as output (module-local rows). */
export type HandlerOutput<Out, S, Default> =
  Out extends TypedOutput<infer T>
    ? T
    : Out extends Shape<infer F>
      ? ShapeValue<F, OwnerOf<S>, 'draft'>
      : Out extends EntityOutputSpec<'page', infer En>
        ? Page<OwnRow<BaseOf<S>, EntityNameOf<BaseOf<S>, En>, 'readable'>>
        : Out extends EntityOutputSpec<'row', infer En>
          ? OwnRow<BaseOf<S>, EntityNameOf<BaseOf<S>, En>, 'readable'>
          : Default;
