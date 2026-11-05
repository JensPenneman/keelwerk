import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineModule } from '../dsl/define-module.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { unicodeVersion } from '../encryption/unicode-version.ts';
import { field } from '../fields/field.ts';
import { relation } from '../fields/relation.ts';
import { buildRegistry } from './build-registry.ts';
import { tracksOf } from './tracks-of.ts';

const fullApp = defineApp({ id: 'full', modules: [accounts, teams, auth] });
const bareApp = defineApp({ id: 'bare', modules: [accounts, auth] });
const renamedApp = defineApp({ id: 'other', modules: [accounts, teams, auth] });
const full = buildRegistry(fullApp);
const bare = buildRegistry(bareApp);
const profile = full.entities.get('accounts.profile');

describe('entity descriptors (section 14.3.2)', () => {
  test('a profile with every contribution active', () => {
    const descriptor = profile?.descriptor;
    // Each index records the Unicode version of the runtime, which the snapshot must not depend on.
    for (const index of Object.values(descriptor?.derivedIndexes ?? {})) {
      expect(index.unicode).toBe(unicodeVersion());
    }
    expect({
      ...descriptor,
      derivedIndexes: Object.fromEntries(
        Object.entries(descriptor?.derivedIndexes ?? {}).map(([column, index]) => [
          column,
          { ...index, unicode: '<runtime>' },
        ]),
      ),
    }).toMatchSnapshot();
  });

  test('physical names are the core functions of the names (S-59)', () => {
    expect(profile?.descriptor.table).toBe('accounts__profile');
    expect(full.entities.get('core.commandReceipt')?.descriptor.table).toBe(
      'core__command_receipt',
    );
    expect(profile?.descriptor.fields.lastLoginAt?.column).toBe('last_login_at');
    expect(profile?.descriptor.fields.displayName?.column).toBe('display_name');
  });

  test('the tracks are the ones the shape lists, derived from it (section 14.6.1)', () => {
    for (const registry of [full, bare]) {
      for (const entry of registry.entities.values()) {
        expect(entry.tracks).toEqual(tracksOf(entry.ref, entry.descriptor.shape));
        expect(entry.tracks.map((track) => track.track)).toEqual(
          Object.keys(entry.descriptor.shape.tracks),
        );
      }
    }
    expect(profile?.tracks).toEqual([
      { entity: 'accounts.profile', track: 'accounts', version: 0, contributedBy: null },
      { entity: 'accounts.profile', track: 'auth->accounts', version: 0, contributedBy: 'auth' },
      {
        entity: 'accounts.profile',
        track: 'auth->accounts[teams]',
        version: 0,
        contributedBy: 'auth',
      },
    ]);
    expect(bare.entities.get('accounts.profile')?.tracks.map((track) => track.track)).toEqual([
      'accounts',
      'auth->accounts',
    ]);
  });

  test('a conditional part is a track of the owner, without a contributor', () => {
    const credential = full.entities.get('auth.credential');
    expect(credential?.tracks.map((track) => [track.track, track.contributedBy])).toEqual([
      ['auth', null],
      ['auth[accounts]', null],
    ]);
    expect(credential?.descriptor.fields.profileId?.ref).toEqual({
      entity: 'accounts.profile',
      foreignKey: true,
    });
    expect(auth.entities.credential).toBeDefined();
  });

  test('the shape id follows the active tracks', () => {
    const withTeams = profile?.descriptor.shape.id;
    const without = bare.entities.get('accounts.profile')?.descriptor.shape.id;
    expect(withTeams).toMatch(/^[0-9a-f]{64}$/);
    expect(without).not.toBe(withTeams);
    expect(buildRegistry(renamedApp).entities.get('accounts.profile')?.descriptor.shape.id).toBe(
      withTeams,
    );
  });

  test('contributed fields and relations record their contributor', () => {
    expect(profile?.origin).toEqual({
      lastLoginAt: 'auth',
      lastCredentialId: 'auth',
      credentials: 'auth',
      defaultTeamName: 'auth',
    });
    expect(profile?.descriptor.relations.credentials).toEqual({
      kind: 'many',
      target: 'auth.credential',
      by: 'subject',
      to: 'id',
      contributedBy: 'auth',
    });
  });

  test('tags are positive and allocated in order inside each contributor', () => {
    const byContributor = new Map<string, number[]>();
    for (const [name, descriptor] of Object.entries(profile?.descriptor.fields ?? {})) {
      const key = profile?.origin[name] ?? '';
      byContributor.set(key, [...(byContributor.get(key) ?? []), descriptor.tag]);
    }
    expect(byContributor.size).toBeGreaterThan(1);
    for (const tags of byContributor.values()) {
      expect(tags.every((tag) => tag > 0)).toBe(true);
    }
    expect(byContributor.get('')?.[0]).toBe(1);
  });

  test('toggling a contribution leaves the tags of the other tracks unchanged', () => {
    const tagsOf = (
      registry: ReturnType<typeof buildRegistry>,
      pick: (name: string, origin: Readonly<Record<string, string>>) => boolean,
    ): Record<string, number> => {
      const entry = registry.entities.get('accounts.profile');
      return Object.fromEntries(
        Object.entries(entry?.descriptor.fields ?? {})
          .filter(([name]) => pick(name, entry?.origin ?? {}))
          .map(([name, descriptor]) => [name, descriptor.tag]),
      );
    };
    const alone = buildRegistry(defineApp({ id: 'alone', modules: [accounts] } as never));
    const own = (name: string, origin: Readonly<Record<string, string>>): boolean =>
      origin[name] === undefined;
    const contributed = (name: string, origin: Readonly<Record<string, string>>): boolean =>
      origin[name] === 'auth' && name !== 'defaultTeamName';
    expect(Object.keys(tagsOf(full, own)).length).toBeGreaterThan(0);
    expect(tagsOf(alone, own)).toEqual(tagsOf(full, own));
    expect(tagsOf(bare, own)).toEqual(tagsOf(full, own));
    expect(Object.keys(tagsOf(full, contributed)).length).toBeGreaterThan(0);
    expect(tagsOf(bare, contributed)).toEqual(tagsOf(full, contributed));
  });

  test('a through relation records its join entity, keys and the field that reaches the target', () => {
    const registry = buildRegistry({
      kind: 'app',
      id: 'clubs',
      modules: [...defineApp({ id: 'seed', modules: [] }).modules, clubsModule()],
      execution: {},
      appActions: {},
      authorization: {},
      policies: {},
      api: null,
    });
    const club = registry.entities.get('clubs.club')?.descriptor;
    expect(club?.relations.members).toEqual({
      kind: 'many',
      target: 'clubs.person',
      by: 'clubId',
      to: 'id',
      through: { module: 'clubs', entity: 'membership', by: 'clubId', to: 'id', via: 'personId' },
      contributedBy: null,
    });
    expect(club?.relations.memberships?.through).toBeUndefined();
  });

  test('max and min merge types pass through to the descriptor', () => {
    const gauge = defineEntity({
      prefix: 'gge',
      fields: {
        high: field.integer().merge('max'),
        low: field.integer().merge('min'),
        plain: field.integer(),
      },
    });
    const registry = buildRegistry({
      kind: 'app',
      id: 'gauges',
      modules: [...defineApp({ id: 'seed', modules: [] }).modules, gaugesModule(gauge)],
      execution: {},
      appActions: {},
      authorization: {},
      policies: {},
      api: null,
    });
    const fields = registry.entities.get('gauges.gauge')?.descriptor.fields;
    expect([fields?.high?.merge, fields?.low?.merge, fields?.plain?.merge]).toEqual([
      'max',
      'min',
      'lww',
    ]);
  });

  test('personal fields carry their capabilities, normaliser, parameters and derived index fields', () => {
    const note = defineEntity({
      prefix: 'nte',
      dataSubject: 'owner',
      fields: {
        owner: field.subject(),
        email: field
          .string({ maxLength: 120 })
          .personal({ queries: ['eq', 'prefix', 'order'], normalize: 'email' }),
      },
    });
    const registry = buildRegistry({
      kind: 'app',
      id: 'notes',
      modules: [...defineApp({ id: 'seed', modules: [] }).modules, notesModule(note)],
      execution: {},
      appActions: {},
      authorization: {},
      policies: {},
      api: null,
    });
    const descriptor = registry.entities.get('notes.note')?.descriptor;
    expect(descriptor?.fields.email?.personal).toEqual({
      subject: 'owner',
      queries: ['eq', 'prefix', 'order'],
      normalize: { id: 'email', version: 1 },
      params: {
        eq: { bits: 128 },
        prefix: { min: 3, max: 32 },
        contains: { bits: 12 },
        order: { bytes: 16 },
      },
      keys: 'tenant',
    });
    expect(Object.keys(descriptor?.derivedIndexes ?? {})).toEqual([
      'email__eq',
      'email__prefix',
      'email__order',
    ]);
    expect(descriptor?.derivedIndexes.email__order).toEqual({
      field: 'email',
      kind: 'ore',
      query: 'order',
      column: 'email__order',
      keyVersion: 1,
      unicode: unicodeVersion(),
    });
    expect(descriptor?.fields.email?.constraints).toEqual({ maxLength: 120 });
    expect(descriptor?.fields.owner?.personal).toBe(false);
  });
});

function notesModule(note: ReturnType<typeof defineEntity>): never {
  return defineModule(
    defineModuleBase({ id: 'notes', version: '0.1.0', entities: { note } } as never),
    {},
  ) as never;
}

function gaugesModule(gauge: ReturnType<typeof defineEntity>): never {
  return defineModule(
    defineModuleBase({ id: 'gauges', version: '0.1.0', entities: { gauge } } as never),
    {},
  ) as never;
}

function clubsModule(): never {
  const person = defineEntity({ prefix: 'prs', fields: { name: field.string() } });
  const membership = defineEntity({
    prefix: 'mbr',
    fields: { clubId: field.string(), personId: field.string() },
  });
  const club = defineEntity({
    prefix: 'clb',
    fields: { name: field.string() },
    relations: {
      members: relation.through.own('person', {
        by: 'clubId',
        to: 'id',
        join: 'membership',
        via: 'personId',
      }),
      memberships: relation.many.own('membership', { by: 'clubId', to: 'id' }),
    },
  });
  return defineModule(
    defineModuleBase({
      id: 'clubs',
      version: '0.1.0',
      entities: { club, person, membership },
    } as never),
    {},
  ) as never;
}
