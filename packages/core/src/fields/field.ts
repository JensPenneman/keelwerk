import type { BlobRef } from '../ids/blob-ref.ts';
import type { Id } from '../ids/id.ts';
import type { RichText } from '../ids/rich-text.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { FieldKind } from '../storage/field-kind.ts';
import type { PersonalQuery } from '../storage/personal-query.ts';
import type {
  AbsoluteRef,
  AnyField,
  FieldDef,
  FieldRef,
  OwnRef,
  ValueOfField,
} from './field-def.ts';
import type { FieldFlags, NoFlags, WithFlag } from './field-flags.ts';
import type {
  BlobOptions,
  DecimalOptions,
  FieldOptions,
  IntegerOptions,
  SerialOptions,
  StringOptions,
} from './field-options.ts';
import type { PersonalFlags } from './personal-flags.ts';
import type { PersonalOptions } from './personal-options.ts';
import type { EntityNamesOf, RefModule } from './ref-module.ts';
import type { StandardOutput, StandardSchemaV1 } from './standard-schema-v1.ts';

/** The state behind one field value; every modifier builds a new one. */
interface FieldState {
  readonly kind: FieldKind;
  readonly ref: FieldRef;
  readonly options: FieldOptions;
  readonly flags: FieldFlags;
  readonly inner: AnyField | null;
  readonly defaultValue: unknown;
  readonly description: string | null;
  readonly deprecation: string | null;
  readonly personalOptions: PersonalOptions | null;
}

/** The runtime object behind every typed field; its types are written out on `FieldDef`. */
interface RuntimeField extends FieldState {
  optional(): RuntimeField;
  default(value: unknown): RuntimeField;
  unique(): RuntimeField;
  index(): RuntimeField;
  hidden(): RuntimeField;
  maskable(): RuntimeField;
  personal(options?: PersonalOptions): RuntimeField;
  stateOnly(): RuntimeField;
  merge(type: NonNullable<FieldFlags['merge']>): RuntimeField;
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

const leakByQuery: Readonly<Record<PersonalQuery, PersonalFlags['leaks'][number]>> = {
  eq: 'equality',
  prefix: 'prefixes',
  contains: 'ngrams',
  order: 'order',
  search: 'tokens',
};

/** The personal flag: `.unique()` and `.index()` imply `eq`, whichever modifier came first. */
function personalFlag(flags: FieldFlags, options: PersonalOptions | null): PersonalFlags | false {
  if (options === null) {
    return false;
  }
  const declared = options.queries ?? [];
  const queries: readonly PersonalQuery[] =
    (flags.unique || flags.indexed) && !declared.includes('eq') ? ['eq', ...declared] : declared;
  return {
    subject: options.subject ?? null,
    queries,
    leaks: ['presence', ...queries.map((query) => leakByQuery[query])],
  };
}

function runtimeField(state: FieldState): RuntimeField {
  const next = (change: Partial<FieldState>): RuntimeField => runtimeField({ ...state, ...change });
  const withFlags = (change: Partial<FieldFlags>): RuntimeField => {
    const flags = { ...state.flags, ...change };
    return next({ flags: { ...flags, personal: personalFlag(flags, state.personalOptions) } });
  };
  return {
    ...state,
    optional: () => withFlags({ optional: true }),
    default: (value) => next({ defaultValue: value, flags: { ...state.flags, defaulted: true } }),
    unique: () => withFlags({ unique: true, merge: 'exclusive' }),
    index: () => withFlags({ indexed: true }),
    hidden: () => withFlags({ hidden: true }),
    maskable: () => withFlags({ maskable: true }),
    personal: (options) => {
      const personalOptions = options ?? {};
      return next({
        personalOptions,
        flags: { ...state.flags, personal: personalFlag(state.flags, personalOptions) },
      });
    },
    stateOnly: () => withFlags({ stateOnly: true }),
    merge: (type) => withFlags({ merge: type }),
    tag: (tag) => withFlags({ tag }),
    describe: (text) => next({ description: text }),
    deprecated: (reason) => next({ deprecation: reason }),
  };
}

/** The one cast of the field model: the runtime object behind every typed field. */
function typed<T>(runtime: RuntimeField): T {
  return runtime as unknown as T;
}

function make<T>(
  kind: FieldKind,
  options?: FieldOptions,
  flags: FieldFlags = noFlags,
  ref: FieldRef = null,
  inner: AnyField | null = null,
): T {
  return typed(
    runtimeField({
      kind,
      ref,
      options,
      flags,
      inner,
      defaultValue: undefined,
      description: null,
      deprecation: null,
      personalOptions: null,
    }),
  );
}

function refField<const M extends RefModule, const E extends EntityNamesOf<M>>(
  module: M,
  entity: E,
): FieldDef<Id<`${M['id']}.${E}`>, NoFlags, AbsoluteRef<M['id'], E>, 'ref'> {
  return make('ref', undefined, noFlags, { module: module.id, entity });
}

function ownRefField<const E extends string>(
  entity: E,
): FieldDef<never, NoFlags, OwnRef<E>, 'ref'> {
  return make('ref', undefined, noFlags, { own: true, entity });
}

/** A text field; an invalid `pattern` throws here, at definition, not at validation. */
function textField<const K extends 'string' | 'text'>(
  kind: K,
  options: StringOptions | undefined,
): FieldDef<string, NoFlags, null, K> {
  if (options?.pattern !== undefined) {
    new RegExp(options.pattern, 'u');
  }
  return make(kind, options);
}

function integerField(): FieldDef<number, NoFlags, null, 'integer'>;
function integerField<const O extends IntegerOptions>(
  options: O,
): FieldDef<O extends { readonly wide: true } ? bigint : number, NoFlags, null, 'integer'>;
function integerField(options?: IntegerOptions): unknown {
  return make('integer', options);
}

/** `field.ref(module, entity)` and `field.ref.own(entity)`. */
interface RefBuilders {
  <const M extends RefModule, const E extends EntityNamesOf<M>>(
    module: M,
    entity: E,
  ): FieldDef<Id<`${M['id']}.${E}`>, NoFlags, AbsoluteRef<M['id'], E>, 'ref'>;
  own<const E extends string>(entity: E): FieldDef<never, NoFlags, OwnRef<E>, 'ref'>;
}

/** The field builders of section 4.2. */
interface FieldBuilders {
  string(options?: StringOptions): FieldDef<string, NoFlags, null, 'string'>;
  text(options?: StringOptions): FieldDef<string, NoFlags, null, 'text'>;
  integer(): FieldDef<number, NoFlags, null, 'integer'>;
  integer<const O extends IntegerOptions>(
    options: O,
  ): FieldDef<O extends { readonly wide: true } ? bigint : number, NoFlags, null, 'integer'>;
  decimal(options: DecimalOptions): FieldDef<string, NoFlags, null, 'decimal'>;
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
  serial(options?: SerialOptions): FieldDef<number, NoFlags, null, 'serial'>;
  set<I extends AnyField>(inner: I): FieldDef<ReadonlySet<ValueOfField<I>>, NoFlags, null, 'set'>;
  list<I extends AnyField>(inner: I): FieldDef<readonly ValueOfField<I>[], NoFlags, null, 'list'>;
  richText(): FieldDef<RichText, WithFlag<NoFlags, 'merge', 'richText'>, null, 'richText'>;
  binary(): FieldDef<Uint8Array, NoFlags, null, 'binary'>;
  blob(options: BlobOptions): FieldDef<BlobRef, NoFlags, null, 'blob'>;
  secret(): FieldDef<SecretRef, NoFlags, null, 'secret'>;
  verifier(): FieldDef<string, WithFlag<NoFlags, 'hidden', true>, null, 'verifier'>;
}

/** The field builders; every modifier returns a field that keeps every earlier flag and the reference. */
export const field: FieldBuilders = {
  string: (options) => textField('string', options),
  text: (options) => textField('text', options),
  integer: integerField,
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
  set: (inner) => make('set', undefined, noFlags, null, inner),
  list: (inner) => make('list', undefined, noFlags, null, inner),
  richText: () => make('richText', undefined, { ...noFlags, merge: 'richText' }),
  binary: () => make('binary'),
  blob: (options) => make('blob', options),
  secret: () => make('secret'),
  verifier: () => make('verifier', undefined, { ...noFlags, hidden: true }),
};

export type { FieldBuilders, RefBuilders };
