import type { BlobRef, Id, RichText, SecretRef, SubjectId } from './id.ts';
import type { EntityNamesOf, RefModule } from './ref-module.ts';
import type { StandardOutput, StandardSchemaV1 } from './standard-schema.ts';

declare const valueType: unique symbol;

interface RuntimeField {
  readonly kind: FieldKind;
  readonly ref: FieldRef;
  readonly options: unknown;
  readonly flags: FieldFlags;
  readonly inner: RuntimeField | null;
  optional(): RuntimeField;
  default(value: unknown): RuntimeField;
  unique(): RuntimeField;
  index(): RuntimeField;
  hidden(): RuntimeField;
  maskable(): RuntimeField;
  personal(options?: PersonalOptions): RuntimeField;
  stateOnly(): RuntimeField;
  merge(type: MergeType): RuntimeField;
  tag(tag: number): RuntimeField;
  describe(text: string): RuntimeField;
  deprecated(reason: string): RuntimeField;
}

const noFlags: NoFlags = {
  optional: false,
  defaulted: false,
  unique: false,
  indexed: false,
  hidden: false,
  maskable: false,
  personal: false,
  stateOnly: false,
  merge: null,
  tag: null,
};

function runtimeField(
  kind: FieldKind,
  ref: FieldRef,
  options: unknown,
  flags: FieldFlags,
  inner: RuntimeField | null = null,
): RuntimeField {
  const next = (patch: Partial<FieldFlags>): RuntimeField =>
    runtimeField(kind, ref, options, { ...flags, ...patch }, inner);
  return {
    kind,
    ref,
    options,
    flags,
    inner,
    optional: () => next({ optional: true }),
    default: () => next({ defaulted: true }),
    unique: () => next({ unique: true, merge: 'exclusive' }),
    index: () => next({ indexed: true }),
    hidden: () => next({ hidden: true }),
    maskable: () => next({ maskable: true }),
    personal: (personal) => next({ personal: { subject: personal?.subject ?? null } }),
    stateOnly: () => next({ stateOnly: true }),
    merge: (type) => next({ merge: type }),
    tag: (tag) => next({ tag }),
    describe: () => next({}),
    deprecated: () => next({}),
  };
}

/** The one cast of the field model: the runtime object behind every typed field. */
function typed<T>(runtime: RuntimeField): T {
  return runtime as unknown as T;
}

function make<T>(kind: FieldKind, options?: unknown, flags: FieldFlags = noFlags): T {
  return typed(runtimeField(kind, null, options, flags));
}

function refField<const M extends RefModule, const E extends EntityNamesOf<M>>(
  module: M,
  entity: E,
): FieldDef<Id<`${M['id']}.${E}`>, NoFlags, AbsoluteRef<M['id'], E>, 'ref'> {
  return typed(runtimeField('ref', { module: module.id, entity }, undefined, noFlags));
}

function ownRefField<const E extends string>(
  entity: E,
): FieldDef<never, NoFlags, OwnRef<E>, 'ref'> {
  return typed(runtimeField('ref', { own: true, entity }, undefined, noFlags));
}

function collection<T>(kind: 'set' | 'list', inner: AnyField): T {
  return typed(runtimeField(kind, null, undefined, noFlags, inner as unknown as RuntimeField));
}

/** The field kinds of section 4.2. */
export type FieldKind =
  | 'string'
  | 'text'
  | 'integer'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'instant'
  | 'date'
  | 'timeZone'
  | 'enum'
  | 'json'
  | 'ref'
  | 'subject'
  | 'serial'
  | 'set'
  | 'list'
  | 'richText'
  | 'binary'
  | 'blob'
  | 'secret'
  | 'verifier';

/** Merge types of offline sync (section 15.3.4). */
export type MergeType =
  | 'lww'
  | 'exclusive'
  | 'counter'
  | 'max'
  | 'min'
  | 'set'
  | 'sequence'
  | 'richText';

/** Query capabilities of a personal field (section 14.7.9). */
export type PersonalQuery = 'eq' | 'prefix' | 'contains' | 'order';

/** Options of `.personal()`. */
export interface PersonalOptions {
  readonly subject?: string;
  readonly queries?: readonly PersonalQuery[];
  readonly normalize?: 'email' | 'nfc' | 'none';
  readonly keys?: string;
}

/** The personal flag: the field holding the data subject, or null for the entity's `dataSubject`. */
export interface PersonalFlag<S extends string | null = string | null> {
  readonly subject: S;
}

/** Every flag a modifier can set; each modifier keeps all the others (section 4.2). */
export interface FieldFlags {
  readonly optional: boolean;
  readonly defaulted: boolean;
  readonly unique: boolean;
  readonly indexed: boolean;
  readonly hidden: boolean;
  readonly maskable: boolean;
  readonly personal: false | PersonalFlag;
  readonly stateOnly: boolean;
  readonly merge: MergeType | null;
  readonly tag: number | null;
}

/** The flags of a fresh field. */
export interface NoFlags {
  readonly optional: false;
  readonly defaulted: false;
  readonly unique: false;
  readonly indexed: false;
  readonly hidden: false;
  readonly maskable: false;
  readonly personal: false;
  readonly stateOnly: false;
  readonly merge: null;
  readonly tag: null;
}

/** `F` with flag `K` set to `V`, every other flag kept. */
export type WithFlag<F extends FieldFlags, K extends keyof FieldFlags, V extends FieldFlags[K]> = {
  readonly [P in keyof FieldFlags]: P extends K ? V : F[P];
};

/** A reference to an entity of another module. */
export interface AbsoluteRef<M extends string = string, E extends string = string> {
  readonly module: M;
  readonly entity: E;
}

/** A reference to an entity of the declaring or contributing module, resolved per source. */
export interface OwnRef<E extends string = string> {
  readonly own: true;
  readonly entity: E;
}

/** What a field references, if anything. */
export type FieldRef = AbsoluteRef | OwnRef | null;

/** A field: value type, flags, reference and kind, each kept by every modifier. */
export interface FieldDef<
  T,
  F extends FieldFlags = NoFlags,
  R extends FieldRef = null,
  K extends FieldKind = FieldKind,
> {
  readonly kind: K;
  readonly flags: F;
  readonly ref: R;
  readonly [valueType]?: T;
  optional(): FieldDef<T, WithFlag<F, 'optional', true>, R, K>;
  default(value: T): FieldDef<T, WithFlag<F, 'defaulted', true>, R, K>;
  unique(): FieldDef<T, WithFlag<WithFlag<F, 'unique', true>, 'merge', 'exclusive'>, R, K>;
  index(): FieldDef<T, WithFlag<F, 'indexed', true>, R, K>;
  hidden(): FieldDef<T, WithFlag<F, 'hidden', true>, R, K>;
  maskable(): FieldDef<T, WithFlag<F, 'maskable', true>, R, K>;
  personal<const O extends PersonalOptions = {}>(
    options?: O,
  ): FieldDef<
    T,
    WithFlag<
      F,
      'personal',
      PersonalFlag<O extends { readonly subject: infer S extends string } ? S : null>
    >,
    R,
    K
  >;
  stateOnly(): FieldDef<T, WithFlag<F, 'stateOnly', true>, R, K>;
  merge<const M extends MergeType>(type: M): FieldDef<T, WithFlag<F, 'merge', M>, R, K>;
  tag<const N extends number>(tag: N): FieldDef<T, WithFlag<F, 'tag', N>, R, K>;
  describe(text: string): FieldDef<T, F, R, K>;
  deprecated(reason: string): FieldDef<T, F, R, K>;
}

/** Any field. */
export type AnyField = FieldDef<unknown, FieldFlags, FieldRef, FieldKind>;

/** The declared value type of a field (own references are `never` until resolved). */
export type ValueOfField<F> =
  F extends FieldDef<infer T, FieldFlags, FieldRef, FieldKind> ? T : never;

/** Options of string fields. */
export interface StringOptions {
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly pattern?: string;
  readonly format?: 'email' | 'uri' | 'hostname';
}

/** Options of integer fields. */
export interface IntegerOptions {
  readonly min?: number;
  readonly max?: number;
  readonly wide?: boolean;
}

/** `field.ref(module, entity)` and `field.ref.own(entity)`. */
export interface RefBuilders {
  <const M extends RefModule, const E extends EntityNamesOf<M>>(
    module: M,
    entity: E,
  ): FieldDef<Id<`${M['id']}.${E}`>, NoFlags, AbsoluteRef<M['id'], E>, 'ref'>;
  own<const E extends string>(entity: E): FieldDef<never, NoFlags, OwnRef<E>, 'ref'>;
}

/** The field builders of section 4.2. */
export interface FieldBuilders {
  string(options?: StringOptions): FieldDef<string, NoFlags, null, 'string'>;
  text(options?: StringOptions): FieldDef<string, NoFlags, null, 'text'>;
  integer<const O extends IntegerOptions = {}>(
    options?: O,
  ): FieldDef<O extends { readonly wide: true } ? bigint : number, NoFlags, null, 'integer'>;
  decimal(options: {
    readonly precision: number;
    readonly scale: number;
  }): FieldDef<string, NoFlags, null, 'decimal'>;
  float(): FieldDef<number, NoFlags, null, 'float'>;
  boolean(): FieldDef<boolean, NoFlags, null, 'boolean'>;
  instant(): FieldDef<Temporal.Instant, NoFlags, null, 'instant'>;
  date(): FieldDef<Temporal.PlainDate, NoFlags, null, 'date'>;
  timeZone(): FieldDef<string, NoFlags, null, 'timeZone'>;
  enum<const V extends readonly [string, ...string[]]>(
    values: V,
  ): FieldDef<V[number], NoFlags, null, 'enum'>;
  json<S extends StandardSchemaV1>(schema: S): FieldDef<StandardOutput<S>, NoFlags, null, 'json'>;
  readonly ref: RefBuilders;
  subject(): FieldDef<SubjectId, NoFlags, null, 'subject'>;
  serial(options?: { readonly per?: string }): FieldDef<number, NoFlags, null, 'serial'>;
  set<I extends AnyField>(inner: I): FieldDef<ReadonlySet<ValueOfField<I>>, NoFlags, null, 'set'>;
  list<I extends AnyField>(inner: I): FieldDef<readonly ValueOfField<I>[], NoFlags, null, 'list'>;
  richText(): FieldDef<RichText, NoFlags, null, 'richText'>;
  binary(): FieldDef<Uint8Array, NoFlags, null, 'binary'>;
  blob(options: {
    readonly mediaType?: string;
    readonly maxBytes?: number;
  }): FieldDef<BlobRef, NoFlags, null, 'blob'>;
  secret(): FieldDef<SecretRef, NoFlags, null, 'secret'>;
  verifier(): FieldDef<string, WithFlag<NoFlags, 'hidden', true>, null, 'verifier'>;
}

/** The field builders; every modifier returns a field that keeps every earlier flag and the reference. */
export const field: FieldBuilders = {
  string: (options) => make('string', options),
  text: (options) => make('text', options),
  integer: (options) => make('integer', options),
  decimal: (options) => make('decimal', options),
  float: () => make('float'),
  boolean: () => make('boolean'),
  instant: () => make('instant'),
  date: () => make('date'),
  timeZone: () => make('timeZone'),
  enum: (values) => make('enum', values),
  json: (schema) => make('json', schema),
  ref: Object.assign(refField, { own: ownRefField }),
  subject: () => make('subject'),
  serial: (options) => make('serial', options),
  set: (inner) => collection('set', inner),
  list: (inner) => collection('list', inner),
  richText: () => make('richText', undefined, { ...noFlags, merge: 'richText' }),
  binary: () => make('binary'),
  blob: (options) => make('blob', options),
  secret: () => make('secret'),
  verifier: () => make('verifier', undefined, { ...noFlags, hidden: true }),
};
