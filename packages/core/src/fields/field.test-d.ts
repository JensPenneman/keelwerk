import { describe, expectTypeOf, test } from 'vitest';
import type { BlobRef } from '../ids/blob-ref.ts';
import type { Id } from '../ids/id.ts';
import type { RichText } from '../ids/rich-text.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { InsertOf } from '../model/insert-of.ts';
import type { OfflinePatchOf } from '../model/offline-patch-of.ts';
import type { CrdtUpdate, PatchOf } from '../model/patch-of.ts';
import { field } from './field.ts';
import type { AbsoluteRef, OwnRef, ValueOfField } from './field-def.ts';
import type { PersonalFlags } from './personal-flags.ts';
import { relation } from './relation.ts';
import { shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';

const accounts = { id: 'accounts', entities: { profile: {}, credential: {} } } as const;

describe('self-typed field modifiers', () => {
  test('every modifier keeps every earlier flag, in any order', () => {
    const forward = field
      .string()
      .optional()
      .default('x')
      .unique()
      .index()
      .hidden()
      .maskable()
      .personal({ subject: 'owner' })
      .stateOnly()
      .merge('lww')
      .tag(7)
      .describe('text')
      .deprecated('reason');
    expectTypeOf(forward.flags).toEqualTypeOf<{
      readonly optional: true;
      readonly defaulted: true;
      readonly unique: true;
      readonly indexed: true;
      readonly hidden: true;
      readonly maskable: true;
      readonly personal: PersonalFlags<readonly ['eq'], 'owner'>;
      readonly stateOnly: true;
      readonly merge: 'lww';
      readonly tag: 7;
    }>();
    const backward = field
      .string()
      .tag(3)
      .merge('set')
      .stateOnly()
      .personal()
      .maskable()
      .hidden()
      .index()
      .unique()
      .default('y')
      .optional();
    expectTypeOf(backward.flags).toEqualTypeOf<{
      readonly optional: true;
      readonly defaulted: true;
      readonly unique: true;
      readonly indexed: true;
      readonly hidden: true;
      readonly maskable: true;
      readonly personal: PersonalFlags<readonly ['eq'], null>;
      readonly stateOnly: true;
      readonly merge: 'exclusive';
      readonly tag: 3;
    }>();
  });

  test('unique implies the exclusive merge type', () => {
    expectTypeOf(field.string().unique().flags.merge).toEqualTypeOf<'exclusive'>();
    expectTypeOf(field.string().flags.merge).toEqualTypeOf<null>();
  });

  test('personal flags carry the effective queries and what they leak', () => {
    const plain = field.string().personal();
    expectTypeOf(plain.flags.personal).toEqualTypeOf<PersonalFlags<readonly [], null>>();
    const searched = field.string().personal({ queries: ['prefix', 'order'] });
    expectTypeOf(searched.flags.personal.queries).toEqualTypeOf<readonly ['prefix', 'order']>();
    expectTypeOf(searched.flags.personal.leaks).toEqualTypeOf<
      readonly ('presence' | 'prefixes' | 'order')[]
    >();
    const looked = field
      .string()
      .personal({ queries: ['prefix'] })
      .index();
    expectTypeOf(looked.flags.personal.queries).toEqualTypeOf<readonly ['eq', 'prefix']>();
    const declared = field
      .string()
      .personal({ queries: ['eq', 'prefix'] })
      .unique();
    expectTypeOf(declared.flags.personal.queries).toEqualTypeOf<readonly ['eq', 'prefix']>();
    expectTypeOf(field.string().flags.personal).toEqualTypeOf<false>();
  });

  test('references survive every modifier', () => {
    const ref = field.ref(accounts, 'profile').optional().index();
    expectTypeOf(ref.ref).toEqualTypeOf<AbsoluteRef<'accounts', 'profile'>>();
    expectTypeOf<ValueOfField<typeof ref>>().toEqualTypeOf<Id<'accounts.profile'>>();
    const own = field.ref.own('credential').optional().tag(4);
    expectTypeOf(own.ref).toEqualTypeOf<OwnRef<'credential'>>();
    const personal = field.ref(accounts, 'credential').personal().unique();
    expectTypeOf(personal.ref).toEqualTypeOf<AbsoluteRef<'accounts', 'credential'>>();
    // @ts-expect-error accounts has no entity 'profiles'
    field.ref(accounts, 'profiles');
  });

  test('field.subject() rejects a plain string (decision 93)', () => {
    const subject = field.subject();
    expectTypeOf<ValueOfField<typeof subject>>().toEqualTypeOf<SubjectId>();
    // @ts-expect-error a plain string is not a SubjectId
    subject.default('plain');
    expectTypeOf<string>().not.toExtend<SubjectId>();
  });

  test('value types per kind and per mode', () => {
    const fields = {
      wide: field.integer({ wide: true }),
      count: field.integer({ min: 0 }),
      kind: field.enum(['a', 'b']),
      tags: field.set(field.string()),
      lines: field.list(field.json(shape({ id: field.string() }))),
      subject: field.subject(),
      key: field.secret(),
      verifier: field.verifier(),
      file: field.blob({ maxBytes: 10 }),
      body: field.richText(),
      raw: field.binary(),
      at: field.instant().optional(),
      size: field.integer().default(1),
      parent: field.ref.own('node'),
    };
    expectTypeOf<ShapeValue<typeof fields, 'm', 'stored'>>().toEqualTypeOf<{
      readonly wide: bigint;
      readonly count: number;
      readonly kind: 'a' | 'b';
      readonly tags: ReadonlySet<string>;
      readonly lines: readonly { readonly id: string }[];
      readonly subject: SubjectId;
      readonly key: SecretRef;
      readonly verifier: string;
      readonly file: BlobRef;
      readonly body: RichText;
      readonly raw: Uint8Array;
      readonly size: number;
      readonly parent: Id<'m.node'>;
      readonly at?: Temporal.Instant | undefined;
    }>();
    expectTypeOf<ShapeValue<typeof fields, 'm', 'input'>['key']>().toEqualTypeOf<string>();
    expectTypeOf<ShapeValue<typeof fields, 'm', 'draft'>['key']>().toEqualTypeOf<
      string | SecretRef
    >();
    expectTypeOf<ShapeValue<typeof fields, 'm', 'stored'>['key']>().toEqualTypeOf<SecretRef>();
    expectTypeOf<ShapeValue<typeof fields, 'm', 'input'>>()
      .toHaveProperty('size')
      .toEqualTypeOf<number | undefined>();
    expectTypeOf(fields.verifier.flags.hidden).toEqualTypeOf<true>();
    expectTypeOf(fields.body.flags.merge).toEqualTypeOf<'richText'>();
  });

  test('relations keep their target and cardinality', () => {
    const many = relation.many(accounts, 'profile', { by: 'owner', to: 'id' });
    expectTypeOf(many.cardinality).toEqualTypeOf<'many'>();
    expectTypeOf(many.target).toEqualTypeOf<AbsoluteRef<'accounts', 'profile'>>();
    expectTypeOf(relation.one.own('credential', { by: 'id', to: 'id' }).target).toEqualTypeOf<
      OwnRef<'credential'>
    >();
  });

  test('relation.through is many-to-many through an own join entity', () => {
    const keys = { join: 'membership', by: 'teamId', to: 'id', via: 'userId' } as const;
    const own = relation.through.own('member', keys);
    expectTypeOf(own.cardinality).toEqualTypeOf<'many'>();
    expectTypeOf(own.target).toEqualTypeOf<OwnRef<'member'>>();
    expectTypeOf(own.through).toEqualTypeOf<{ readonly entity: string; readonly via: string }>();
    const other = relation.through(accounts, 'profile', keys);
    expectTypeOf(other.target).toEqualTypeOf<AbsoluteRef<'accounts', 'profile'>>();
    // @ts-expect-error the join entity and its fields are required
    relation.through.own('member', { by: 'teamId', to: 'id' });
    expectTypeOf(relation.many.own('x', { by: 'a', to: 'id' }).through).toEqualTypeOf<
      { readonly entity: string; readonly via: string } | undefined
    >();
  });
});

describe('write shapes', () => {
  const fields = {
    visits: field.integer().merge('counter'),
    tags: field.set(field.string()),
    lines: field.list(field.string()).merge('sequence'),
    body: field.richText(),
    note: field.string().optional(),
    email: field.string().unique(),
    locale: field.string().default('nl-BE'),
    key: field.secret(),
    uid: field.serial(),
  };

  test('InsertOf: optional and defaulted fields may be omitted, secrets are references, serials are kernel-made', () => {
    expectTypeOf<InsertOf<typeof fields>>().toEqualTypeOf<{
      readonly visits: number;
      readonly tags: ReadonlySet<string>;
      readonly lines: readonly string[];
      readonly body: RichText;
      readonly email: string;
      readonly key: string | SecretRef;
      readonly note?: string | undefined;
      readonly locale?: string | undefined;
    }>();
  });

  test('PatchOf: field operations for merge types, null clears optional fields', () => {
    expectTypeOf<PatchOf<typeof fields>>().toEqualTypeOf<{
      readonly visits?: number | { readonly inc: number };
      readonly tags?:
        | ReadonlySet<string>
        | { readonly add?: readonly string[]; readonly remove?: readonly string[] };
      readonly lines?: readonly string[] | { readonly crdt: CrdtUpdate };
      readonly body?: string | { readonly crdt: CrdtUpdate };
      readonly note?: string | null;
      readonly email?: string;
      readonly locale?: string;
      readonly key?: string | SecretRef;
    }>();
  });

  test('OfflinePatchOf leaves out exclusive and unique fields', () => {
    expectTypeOf<OfflinePatchOf<typeof fields>>().not.toHaveProperty('email');
    expectTypeOf<OfflinePatchOf<typeof fields>>().not.toHaveProperty('uid');
    expectTypeOf<OfflinePatchOf<typeof fields>>().toHaveProperty('note');
  });
});

describe('shape output', () => {
  test('validation returns defaults present and secrets as plain strings', () => {
    const input = shape({
      k: field.secret(),
      locale: field.string().default('nl'),
      n: field.string().optional(),
    });
    type Out = NonNullable<(typeof input)['~standard']['types']>['output'];
    expectTypeOf<Out>().toEqualTypeOf<{
      readonly k: string;
      readonly locale: string;
      readonly n?: string | undefined;
    }>();
  });
});
