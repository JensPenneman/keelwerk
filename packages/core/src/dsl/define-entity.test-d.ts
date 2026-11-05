import { describe, expectTypeOf, test } from 'vitest';
import { field } from '../fields/field.ts';
import type { PersonalFlags } from '../fields/personal-flags.ts';
import { relation } from '../fields/relation.ts';
import { shape } from '../fields/shape.ts';
import type { Id } from '../ids/id.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { EntityType } from '../model/entity-type.ts';
import type { InsertOf } from '../model/insert-of.ts';
import type { Where } from '../model/where.ts';
import { type AnyEntity, defineEntity, type Entity } from './define-entity.ts';

const profileDef = defineEntity({
  prefix: 'prof',
  dataSubject: 'id',
  fields: {
    displayName: field.string({ maxLength: 120 }).merge('lww'),
    email: field
      .string({ format: 'email' })
      .unique()
      .personal({ normalize: 'email', queries: ['prefix'] })
      .maskable(),
    locale: field.string().default('nl-BE'),
    deactivatedAt: field.instant().optional(),
  },
  indexes: [{ fields: ['displayName'] }],
  events: {
    deactivated: shape({ at: field.instant(), reason: field.string().optional() }),
  },
  evolve: {
    deactivated: (state, e) => ({ ...state, deactivatedAt: e.at }),
  },
});
interface Profile extends EntityType<typeof profileDef> {}
const profile: Profile = profileDef;

const credentialDef = defineEntity({
  prefix: 'cred',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    kind: field.enum(['password', 'passkey']),
    identifier: field.string({ format: 'email' }).optional().personal({ normalize: 'email' }),
    verifier: field.verifier(),
    label: field.string().optional().merge('lww'),
    lastUsedAt: field.instant().optional().maskable(),
    revokedAt: field.instant().optional(),
  },
  indexes: [
    {
      fields: ['identifier'],
      unique: true,
      where: { kind: 'password', revokedAt: { isNull: true } },
    },
  ],
  events: { revoked: shape({ at: field.instant(), reason: field.string().optional() }) },
  evolve: { revoked: (state, e) => ({ ...state, revokedAt: e.at }) },
  generated: { set: false },
});
interface Credential extends EntityType<typeof credentialDef> {}
const credential: Credential = credentialDef;

const sessionDef = defineEntity({
  prefix: 'sess',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    credentialId: field.ref.own('credential'),
    publicId: field.string().unique(),
    tokenVerifier: field.verifier(),
    authenticatedAt: field.instant(),
    revokedAt: field.instant().optional(),
  },
  history: 'state',
  reason: 'Sessions are replaced, not edited; the chain of credentials is the audit trail.',
  generated: { set: false },
});
interface Session extends EntityType<typeof sessionDef> {}
const session: Session = sessionDef;

const profileRelations = {
  credentials: relation.many.own('credential', { by: 'subject', to: 'id' }),
};

function wrap<const E extends { readonly entities: { readonly [name: string]: AnyEntity } }>(
  value: E,
): E {
  return value;
}

describe('defineEntity', () => {
  test('the sketch entities compile with named entity types', () => {
    expectTypeOf(profile).toExtend<AnyEntity>();
    expectTypeOf(credential).toExtend<AnyEntity>();
    expectTypeOf(session).toExtend<AnyEntity>();
    expectTypeOf(profile).toEqualTypeOf<Profile>();
    expectTypeOf(credential.prefix).toEqualTypeOf<'cred'>();
    expectTypeOf(session.history).toEqualTypeOf<'state'>();
    expectTypeOf(credential.generated).toEqualTypeOf<{ readonly set: false }>();
    expectTypeOf(profileRelations.credentials.cardinality).toEqualTypeOf<'many'>();
  });

  test('history defaults to chain; the defaults survive a nested call (decision 100)', () => {
    expectTypeOf(profile.history).toEqualTypeOf<'chain'>();
    expectTypeOf(profile.relations).toEqualTypeOf<Record<never, never>>();
    const outer = wrap({ entities: { inner: defineEntity({ prefix: 'in', fields: {} }) } });
    expectTypeOf(outer.entities.inner.history).toEqualTypeOf<'chain'>();
    expectTypeOf(outer.entities.inner.generated).toEqualTypeOf<Record<never, never>>();
    expectTypeOf(outer.entities.inner.prefix).toEqualTypeOf<'in'>();
  });

  test('personal flags of the sketch fields', () => {
    expectTypeOf(profile.fields.email.flags.personal).toEqualTypeOf<
      PersonalFlags<readonly ['eq', 'prefix'], null>
    >();
    expectTypeOf(credential.fields.identifier.flags.personal).toEqualTypeOf<
      PersonalFlags<readonly ['eq'], null>
    >();
    expectTypeOf(credential.fields.verifier.flags.hidden).toEqualTypeOf<true>();
  });

  test('InsertOf and Where over an entity', () => {
    expectTypeOf<InsertOf<Credential['fields']>>().toEqualTypeOf<{
      readonly subject: SubjectId;
      readonly kind: 'password' | 'passkey';
      readonly verifier: string;
      readonly identifier?: string | undefined;
      readonly label?: string | undefined;
      readonly lastUsedAt?: Temporal.Instant | undefined;
      readonly revokedAt?: Temporal.Instant | undefined;
    }>();
    type SessionInsert = InsertOf<Session['fields'], 'auth'>;
    expectTypeOf<SessionInsert['credentialId']>().toEqualTypeOf<Id<'auth.credential'>>();
    const where: Where<{ email: string; locale: string }, Profile['fields']> = {
      email: { startsWith: 'je' },
      locale: { contains: 'nl' },
    };
    expectTypeOf(where).toExtend<object>();
    const byIdentifier: Where<{ identifier: string }, Credential['fields']> = {
      identifier: { eq: 'a@b.c' },
    };
    expectTypeOf(byIdentifier).toExtend<object>();
    // @ts-expect-error the email declares eq and prefix, not order
    const bad: Where<{ email: string }, Profile['fields']> = { email: { gt: 'a' } };
    expectTypeOf(bad).toExtend<object>();
  });

  test('a secret field takes a new plain value or the loaded reference in entities', () => {
    const vault = defineEntity({ prefix: 'vlt', fields: { token: field.secret() } });
    expectTypeOf<InsertOf<typeof vault.fields>['token']>().toEqualTypeOf<string | SecretRef>();
    expectTypeOf<
      Entity<
        'vlt',
        typeof vault.fields,
        Record<never, never>,
        'chain',
        Record<never, never>,
        Record<never, never>
      >
    >().toExtend<AnyEntity>();
  });
});
