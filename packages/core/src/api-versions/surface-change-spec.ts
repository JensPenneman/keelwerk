import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { EntityAt, EntityNames } from '../model/entities-of.ts';
import type { FieldsOf } from '../model/fields-of.ts';

type FieldOf<B, E> = keyof FieldsOf<EntityAt<B, E>> & string;

/** One change a version change describes: a renamed or added field, a removed field, a renamed action (section 18.2). */
export type SurfaceChangeSpec<B = AnyModuleBase> =
  | {
      [E in EntityNames<B>]:
        | {
            readonly entity: EntityAt<B, E>;
            readonly field: FieldOf<B, E>;
            readonly renamedFrom: string;
          }
        | {
            readonly entity: EntityAt<B, E>;
            readonly field: FieldOf<B, E>;
            readonly addedRequired: true;
          };
    }[EntityNames<B>]
  | {
      readonly entity: EntityAt<B, EntityNames<B>>;
      readonly field: string;
      readonly removed: true;
    }
  | { readonly action: string; readonly renamedFrom: string };
