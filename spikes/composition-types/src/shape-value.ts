import type { FieldDef, FieldFlags, OwnRef } from './field.ts';
import type { Id, SecretRef } from './id.ts';
import type { Prettify } from './prettify.ts';

type OptionalIn<Fd, Mode extends ValueMode> = Fd extends {
  readonly flags: { readonly optional: true };
}
  ? true
  : Mode extends 'stored'
    ? false
    : Fd extends { readonly flags: { readonly defaulted: true } }
      ? true
      : false;

/**
 * How a field's value is seen: `input` (an action input: secrets are plain strings, defaulted
 * fields may be omitted), `draft` (what a handler writes: defaulted fields may be omitted, secrets
 * are references) and `stored` (what is read back: defaulted fields are present).
 */
export type ValueMode = 'input' | 'draft' | 'stored';

/** A field's value, with own references resolved against `Owner`. */
export type FieldValue<Fd, Owner extends string, Mode extends ValueMode> =
  Fd extends FieldDef<infer T, FieldFlags, infer R, infer K>
    ? R extends OwnRef<infer E>
      ? Id<`${Owner}.${E}`>
      : K extends 'secret'
        ? Mode extends 'input'
          ? string
          : SecretRef
        : T
    : never;

/** The object type of a set of fields in one mode; optional fields accept `undefined` explicitly. */
export type ShapeValue<F, Owner extends string, Mode extends ValueMode> = Prettify<
  {
    readonly [K in keyof F as OptionalIn<F[K], Mode> extends true ? never : K]: FieldValue<
      F[K],
      Owner,
      Mode
    >;
  } & {
    readonly [K in keyof F as OptionalIn<F[K], Mode> extends true ? K : never]?:
      | FieldValue<F[K], Owner, Mode>
      | undefined;
  }
>;
