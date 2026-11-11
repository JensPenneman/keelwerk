import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { hooks } from '../../test/fixtures/modules/hooks/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { appOf, contributionTo, makeModule } from '../../test/registry-kit.ts';
import { core } from '../core-module/module.ts';
import { contracts } from '../dsl/contracts.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineQuery } from '../dsl/define-query.ts';
import { typedOutput } from '../dsl/typed-output.ts';
import { defineError } from '../errors/define-error.ts';
import { field } from '../fields/field.ts';
import type { AnyModule } from '../model/any-module.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { ApiSurface } from './api-surface.ts';
import { deriveSurface } from './derive-surface.ts';
import type { FieldNode } from './field-node.ts';
import { renderSurfaceArtefact } from './render-surface-artefact.ts';
import { sortedJson } from './sorted-json.ts';
import type { SurfaceSource } from './surface-source.ts';

const head = '2026-11-04';

function sourceOf(modules: readonly AnyModule[]): SurfaceSource {
  const app = appOf(modules, { id: 'subject' });
  return { ...app, registry: buildRegistry(app) };
}

function surfaceOf(modules: readonly AnyModule[]): ApiSurface {
  const derived = deriveSurface(sourceOf(modules), head);
  expect(derived.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  return derived.surface;
}

/** Everything the module-owned parts of the surface say, without the core's own entities, actions and codes. */
function withoutCore(surface: ApiSurface): unknown {
  return {
    ...surface,
    modules: surface.modules.filter((module) => module.id !== 'core'),
    entities: surface.entities.filter((entity) => entity.module !== 'core'),
    actions: surface.actions.filter((action) => action.module !== 'core'),
    errors: surface.errors.filter((error) => !error.code.startsWith('core.')),
    events: surface.events.filter((event) => !event.entity.startsWith('core.')),
    hash: undefined,
  };
}

function nodesOf(node: FieldNode): FieldNode[] {
  switch (node.kind) {
    case 'shape':
      return [node, ...Object.values(node.fields).flatMap(nodesOf)];
    case 'list':
    case 'set':
    case 'page':
      return [node, ...nodesOf(node.item)];
    default:
      return [node];
  }
}

const vault = defineEntity({
  prefix: 'vlt',
  fields: {
    label: field.string({ maxLength: 40 }).describe('What it is called.'),
    amount: field.decimal({ precision: 10, scale: 2 }).optional(),
    note: field.string().optional().hidden(),
    tenantId: field.string().optional(),
    digest: field.verifier(),
    pin: field.secret().optional(),
    tags: field.list(field.string()),
  },
});
const stash = makeModule({ id: 'stash', entities: { vault } });

describe('deriveSurface (section 16.2)', () => {
  test('the accounts module gives the golden surface', () => {
    const surface = surfaceOf([accounts]);
    expect(sortedJson(withoutCore(surface))).toMatchSnapshot();
    expect(surface.hash).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/);
    expect(surface.format).toBe('keelwerk.surface/1');
    expect(surface.app).toBe('subject');
    expect(surface.apiVersion).toBe(head);
  });

  test('swapped tuple order gives the same surface and the same hash', () => {
    const forward = surfaceOf([accounts, teams, hooks, stash]);
    const backward = surfaceOf([stash, hooks, teams, accounts]);
    expect(backward.hash).toBe(forward.hash);
    expect(renderSurfaceArtefact(backward)).toBe(renderSurfaceArtefact(forward));
  });

  test('deriving twice gives the same bytes; the hash changes with the content', () => {
    const once = renderSurfaceArtefact(surfaceOf([accounts]));
    expect(renderSurfaceArtefact(surfaceOf([accounts]))).toBe(once);
    expect(surfaceOf([accounts]).hash).not.toBe(surfaceOf([accounts, auth]).hash);
  });

  test('hidden, verifier and tenantId fields are absent from entities, inputs and outputs', () => {
    const surface = surfaceOf([stash]);
    const entity = surface.entities.find((candidate) => candidate.ref === 'stash.vault');
    expect(Object.keys(entity?.fields ?? {}).sort()).toEqual([
      'amount',
      'archivedAt',
      'createdAt',
      'id',
      'label',
      'pin',
      'tags',
      'updatedAt',
      'version',
    ]);
    for (const action of surface.actions.filter((candidate) => candidate.module === 'stash')) {
      for (const node of [...nodesOf(action.input), ...nodesOf(action.output)]) {
        if (node.kind !== 'shape') continue;
        expect(Object.keys(node.fields)).not.toContain('note');
        expect(Object.keys(node.fields)).not.toContain('digest');
        expect(Object.keys(node.fields)).not.toContain('tenantId');
      }
    }
    expect(JSON.stringify(surface)).not.toContain('"digest"');
  });

  test('field nodes carry access, description, decimal limits and tags', () => {
    const entity = surfaceOf([stash]).entities.find((candidate) => candidate.ref === 'stash.vault');
    expect(entity?.fields.label).toMatchObject({
      kind: 'string',
      maxLength: 40,
      description: 'What it is called.',
      access: 'read-write',
      tag: 1,
    });
    expect(entity?.fields.amount).toMatchObject({ kind: 'decimal', precision: 10, scale: 2 });
    expect(entity?.fields.pin).toMatchObject({ kind: 'secret', access: 'write' });
    expect(entity?.fields.id).toMatchObject({ kind: 'id', access: 'read', prefix: 'vlt' });
    expect(entity?.fields.version).toMatchObject({ kind: 'integer', access: 'read' });
  });

  test('every action input is a shape or void and every declared error is listed', () => {
    const surface = surfaceOf([accounts, teams, auth, hooks, stash]);
    expect(surface.actions.length).toBeGreaterThan(100);
    for (const action of surface.actions) {
      expect(['shape', 'void', 'foreign']).toContain(action.input.kind);
      for (const code of action.errors) {
        expect(surface.errors.map((error) => error.code)).toContain(code);
      }
    }
    const generated = surface.actions.filter((action) => action.generated !== undefined);
    expect(generated.every((action) => action.input.kind === 'shape')).toBe(true);
  });

  test('sorts every array and lists the core codes', () => {
    const surface = surfaceOf([accounts, auth]);
    const sorted = (values: readonly string[]): boolean =>
      values.every((value, index) => index === 0 || (values[index - 1] ?? '') < value);
    expect(sorted(surface.modules.map((module) => module.id))).toBe(true);
    expect(sorted(surface.entities.map((entity) => entity.ref))).toBe(true);
    expect(sorted(surface.actions.map((action) => action.ref))).toBe(true);
    expect(sorted(surface.errors.map((error) => error.code))).toBe(true);
    expect(surface.errors.map((error) => error.code)).toContain('core.version_mismatch');
    expect(surface.errors.map((error) => error.code)).toContain('accounts.email_taken');
  });

  test('reports an API version the app does not have', () => {
    const derived = deriveSurface(sourceOf([accounts]), '2020-01-01');
    expect(derived.problems.map((problem) => problem.code)).toContain('unknownApiVersions');
  });

  test('carries the principal resolvers the modules fill, sorted by id', () => {
    const first = {
      id: 'logins.session',
      describe: () => ({ scheme: 'cookie' as const, name: '__Host-session' }),
    };
    const second = {
      id: 'logins.key',
      describe: () => ({ scheme: 'bearer' as const, description: 'An API key.' }),
    };
    const logins = makeModule(
      { id: 'logins', contributions: { toCore: contributionTo(core as unknown as AnyModule, {}) } },
      { contributes: { toCore: { extensionPoints: { principalResolvers: [first, second] } } } },
    );
    expect(surfaceOf([logins]).resolvers).toEqual([
      { id: 'logins.key', scheme: 'bearer', description: 'An API key.' },
      { id: 'logins.session', scheme: 'cookie', name: '__Host-session' },
    ]);
    expect(surfaceOf([accounts]).resolvers).toEqual([]);
  });

  test('resolvers filled by two modules give the same hash in either tuple order', () => {
    const resolverModule = (id: string, scheme: 'cookie' | 'bearer'): AnyModule =>
      makeModule(
        { id, contributions: { toCore: contributionTo(core as unknown as AnyModule, {}) } },
        {
          contributes: {
            toCore: {
              extensionPoints: {
                principalResolvers: [{ id: `${id}.resolver`, describe: () => ({ scheme }) }],
              },
            },
          },
        },
      );
    const alpha = resolverModule('alpha', 'cookie');
    const beta = resolverModule('beta', 'bearer');
    const forward = surfaceOf([alpha, beta]);
    const backward = surfaceOf([beta, alpha]);
    expect(forward.resolvers?.map((resolver) => resolver.id)).toEqual([
      'alpha.resolver',
      'beta.resolver',
    ]);
    expect(backward.hash).toBe(forward.hash);
  });

  test('the core actions stay in the surface of an older app version', () => {
    const app = appOf([accounts], {
      api: defineApiVersions({ '2026-06-01': {}, '2026-12-01': {} }),
    });
    const derived = deriveSurface({ ...app, registry: buildRegistry(app) }, '2026-06-01');
    expect(derived.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
    expect(derived.surface.actions.filter((action) => action.module === 'core')).not.toEqual([]);
    expect(derived.surface.actions.some((action) => action.module === 'accounts')).toBe(true);
  });

  test('a module query with a typed output has an open object as its output', () => {
    const base = (stash as unknown as { readonly base: object }).base;
    const docs = makeModule(
      { id: 'docs' },
      {
        actions: {
          report: defineQuery(
            base as never,
            {
              output: typedOutput<{ a: string }>(),
              read: () => ({ a: 'x' }),
            } as never,
          ),
        },
      },
    );
    const action = surfaceOf([docs]).actions.find((candidate) => candidate.ref === 'docs.report');
    expect(action?.output).toMatchObject({ kind: 'foreign', input: { type: 'object' } });
  });

  test('two definitions of one error code with another message are a problem', () => {
    const base = (stash as unknown as { readonly base: object }).base;
    const taken = (message: string) => defineError('docs.taken', { kind: 'conflict', message });
    const query = (message: string) =>
      defineQuery(base as never, { errors: [taken(message)], read: () => undefined } as never);
    const docs = makeModule(
      { id: 'docs' },
      { actions: { first: query('One.'), second: query('Two.') } },
    );
    const derived = deriveSurface(sourceOf([docs]), head);
    expect(derived.problems.map((problem) => problem.code)).toContain('conflictingErrors');
  });

  test('defineApp refuses a json field whose schema cannot be described', () => {
    const plain = {
      '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
    };
    const broken = defineEntity({ prefix: 'brk', fields: { blob: field.json(plain as never) } });
    const module = makeModule({ id: 'broken', entities: { broken } });
    expect(() => defineApp({ id: 'broken-app', modules: [module as never] })).toThrow();
  });
});

describe('the surface of a subscription', () => {
  test('shows its event as the output', () => {
    const live = makeModule({ id: 'live', provides: [contracts.live] });
    const surface = surfaceOf([accounts, auth, live]);
    const action = surface.actions.find((one) => one.ref === 'auth.sessionEvents');
    expect(action?.kind).toBe('subscription');
    expect(action?.output).toMatchObject({
      kind: 'shape',
      fields: { sessionId: expect.anything(), kind: expect.anything() },
    });
  });
});
