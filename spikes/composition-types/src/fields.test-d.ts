import { describe, expectTypeOf, test } from 'vitest';
import {
  type AbsoluteRef,
  field,
  type OwnRef,
  type PersonalFlag,
  type ValueOfField,
} from './field.ts';
import { accounts } from './fixtures/accounts/module.generated.ts';
import type { Id, SecretRef, SubjectId } from './id.ts';
import { shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';
import type { CrdtUpdate, OfflinePatchOf, PatchOf } from './write-shapes.ts';

describe('self-typed field modifiers (checklist 4)', () => {
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
      readonly personal: PersonalFlag<'owner'>;
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
      readonly personal: PersonalFlag<null>;
      readonly stateOnly: true;
      readonly merge: 'exclusive';
      readonly tag: 3;
    }>();
  });

  test('unique implies the exclusive merge type', () => {
    expectTypeOf(field.string().unique().flags.merge).toEqualTypeOf<'exclusive'>();
    expectTypeOf(field.string().flags.merge).toEqualTypeOf<null>();
  });

  test('references survive every modifier (checklist 5)', () => {
    const ref = field.ref(accounts, 'profile').optional().index();
    expectTypeOf(ref.ref).toEqualTypeOf<AbsoluteRef<'accounts', 'profile'>>();
    expectTypeOf<ValueOfField<typeof ref>>().toEqualTypeOf<Id<'accounts.profile'>>();
    const own = field.ref.own('credential').optional().tag(4);
    expectTypeOf(own.ref).toEqualTypeOf<OwnRef<'credential'>>();
    // @ts-expect-error accounts has no entity 'profiles'
    field.ref(accounts, 'profiles');
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
      at: field.instant().optional(),
      size: field.integer().default(1),
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
      readonly at?: Temporal.Instant | undefined;
      readonly size: number;
    }>();
    expectTypeOf<ShapeValue<typeof fields, 'm', 'input'>['key']>().toEqualTypeOf<string>();
    expectTypeOf<ShapeValue<typeof fields, 'm', 'input'>>()
      .toHaveProperty('size')
      .toEqualTypeOf<number | undefined>();
    expectTypeOf(fields.verifier.flags.hidden).toEqualTypeOf<true>();
  });

  test('patch values: field operations for merge types, null clears optional fields (checklist 9)', () => {
    const fields = {
      visits: field.integer().merge('counter'),
      tags: field.set(field.string()),
      lines: field.list(field.string()).merge('sequence'),
      body: field.richText(),
      note: field.string().optional(),
      email: field.string().unique(),
    };
    expectTypeOf<PatchOf<typeof fields>>().toEqualTypeOf<{
      readonly visits?: number | { readonly inc: number };
      readonly tags?:
        | ReadonlySet<string>
        | { readonly add?: readonly string[]; readonly remove?: readonly string[] };
      readonly lines?: readonly string[] | { readonly crdt: CrdtUpdate };
      readonly body?: string | { readonly crdt: CrdtUpdate };
      readonly note?: string | null;
      readonly email?: string;
    }>();
    expectTypeOf<OfflinePatchOf<typeof fields>>().not.toHaveProperty('email');
  });
});
