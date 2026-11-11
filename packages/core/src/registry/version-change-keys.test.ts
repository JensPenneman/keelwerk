import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { shelfItem } from '../../test/version-change-kit.ts';
import { applyVersionChanges } from '../api-versions/apply-version-changes.ts';
import { defineVersionChange } from '../api-versions/define-version-change.ts';
import { runChangeFixtures } from '../api-versions/run-change-fixtures.ts';
import { translateInput } from '../api-versions/translate-input.ts';
import { translateOutput } from '../api-versions/translate-output.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { defineCommand } from '../dsl/define-command.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from './action-entry.ts';
import { buildRegistry } from './build-registry.ts';
import { checkVersionChangeChain } from './check-version-change-chain.ts';
import { checkVersionChanges } from './check-version-changes.ts';
import type { Registry } from './registry.ts';

const base = { id: 'shelf', version: '2.0.0' } as const;
const change = (spec: object) =>
  defineVersionChange(base as never, { since: '2.0.0', ...spec } as never);

const api = defineApiVersions({
  '2026-01-01': {},
  '2026-02-01': { changes: ['shelf.first'] },
  '2026-03-01': { changes: ['shelf.second'] },
});

/** The action `shelf.place` is renamed to `shelf.drop` by the second change; the first, older one is keyed as the action stood then. */
function renamed(key: string, fixtures: readonly object[] = []) {
  const module = makeModule(
    { ...base, entities: { item: shelfItem } },
    {
      actions: {
        drop: defineCommand(
          base as never,
          {
            input: shape({ n: field.integer(), older: field.boolean().optional() }),
            output: shape({}),
            decide: () => ({ events: [] }),
          } as never,
        ),
      },
      changes: {
        first: change({
          surface: [],
          input: { [key]: (value: object) => ({ ...value, older: true }) },
          output: { [key]: (value: object) => ({ ...value, older: true }) },
          fixtures,
        }),
        second: change({ surface: [{ action: 'shelf.drop', renamedFrom: 'shelf.place' }] }),
      },
    },
  );
  const app = appOf([module], { api });
  const registry = buildRegistry(app);
  const drop = registry.actions.get('shelf.drop');
  if (drop === undefined) throw new Error('no shelf.drop');
  return { app, registry, drop };
}

describe('the keys of a change name the actions on its newer side (section 18.2)', () => {
  const { app, registry, drop } = renamed('shelf.place');

  test('a transform keyed by the older ref composes although a later change renamed the action', () => {
    expect(checkVersionChanges(app, registry)).toEqual([]);
  });

  test.each([
    ['2026-01-01', true],
    ['2026-02-01', false],
    ['2026-03-01', false],
  ])('at %s the older transform runs: %s, in both directions', (apiVersion, runs) => {
    const translation = applyVersionChanges({ registry, api, apiVersion });
    expect(translateInput(translation, drop, { n: 1 })).toEqual(
      runs ? { n: 1, older: true } : { n: 1 },
    );
    expect(translateOutput(translation, drop, { n: 1 })).toEqual(
      runs ? { n: 1, older: true } : { n: 1 },
    );
  });

  test('the action a lacking change keys is touched under its head ref', () => {
    const translation = applyVersionChanges({ registry, api, apiVersion: '2026-02-01' });
    expect(translation.touched.has('shelf.drop')).toBe(true);
    expect(applyVersionChanges({ registry, api, apiVersion: '2026-03-01' }).touched.size).toBe(0);
  });

  test('a key with the head name is refused, and the message names the point', () => {
    const wrong = renamed('shelf.drop');
    const problems = checkVersionChanges(wrong.app, wrong.registry);
    expect(problems.map((problem) => [problem.code, problem.ref])).toEqual([
      ['invalidVersionChange', 'shelf.first'],
    ]);
    expect(problems[0]?.message).toContain("'shelf.drop'");
    expect(problems[0]?.message).toContain("'shelf.second'");
  });

  test('a key that was never an action is refused', () => {
    const wrong = renamed('shelf.nothing');
    expect(checkVersionChanges(wrong.app, wrong.registry).map((problem) => problem.ref)).toEqual([
      'shelf.first',
    ]);
  });

  test('a fixture keyed by the older ref runs, one keyed by the head ref does not', async () => {
    const fixture = (ref: string) => ({ ref, older: { n: 1 }, newer: { n: 1, older: true } });
    const fine = renamed('shelf.place', [fixture('shelf.place')]);
    expect(await runChangeFixtures(fine.registry, api)).toEqual([]);
    const wrong = renamed('shelf.place', [fixture('shelf.drop')]);
    const failures = await runChangeFixtures(wrong.registry, api);
    expect(failures.map((failure) => failure.ref)).toEqual(['shelf.drop']);
  });
});

describe('the order of changes adopted at different dates (section 18.2)', () => {
  test('the fixture runner orders by adoption date like the compose check, so a fixture of an older-adopted change resolves through a later rename', async () => {
    // "shelf.a" has the later `since` but is adopted first; "shelf.b" renames the action after it.
    const dated = defineApiVersions({
      '2025-12-01': {},
      '2026-01-01': { changes: ['shelf.a'] },
      '2026-02-01': { changes: ['shelf.b'] },
    });
    const module = makeModule(
      { ...base, entities: { item: shelfItem } },
      {
        actions: {
          drop: defineCommand(
            base as never,
            {
              input: shape({ n: field.integer(), older: field.boolean().optional() }),
              output: shape({}),
              decide: () => ({ events: [] }),
            } as never,
          ),
        },
        changes: {
          a: defineVersionChange(
            base as never,
            {
              since: '2.0.0',
              surface: [],
              input: { 'shelf.place': (value: object) => ({ ...value, older: true }) },
              fixtures: [{ ref: 'shelf.place', older: { n: 1 }, newer: { n: 1, older: true } }],
            } as never,
          ),
          b: defineVersionChange(
            base as never,
            {
              since: '1.0.0',
              surface: [{ action: 'shelf.drop', renamedFrom: 'shelf.place' }],
            } as never,
          ),
        },
      },
    );
    const app = appOf([module], { api: dated });
    const registry = buildRegistry(app);
    expect(checkVersionChanges(app, registry)).toEqual([]);
    expect(await runChangeFixtures(registry, dated)).toEqual([]);
  });
});

describe('an added required field that a later change renames (section 18.2)', () => {
  const crate = defineEntity({
    prefix: 'crt',
    fields: { label: field.string(), size: field.integer() },
  });
  const added = change({ surface: [{ entity: crate, field: 'amount', addedRequired: true }] });
  const rename = change({ surface: [{ entity: crate, field: 'size', renamedFrom: 'amount' }] });

  /** A registry whose only action is a declared command creating crates, with the given input fields. */
  function declared(
    members: object,
    changes: Readonly<Record<string, object>> = { first: added, second: rename },
    ref = 'shelf.crate.make',
  ): Registry {
    const module = makeModule({ ...base, entities: { crate } }, { changes });
    const registry = buildRegistry(appOf([module], { api: null }));
    const create = registry.actions.get('shelf.crate.create');
    if (create === undefined) throw new Error('no create');
    const { generated: _generated, ...declaredAction } = create;
    const make: ActionEntry = { ...declaredAction, ref, input: shape(members as never) };
    return { ...registry, actions: new Map([[make.ref, make]]) };
  }

  const ordered = (registry: Registry) => [
    registry.versionChanges.get('shelf.first'),
    registry.versionChanges.get('shelf.second'),
  ];

  test('a declared creating command that names the field by its head name is refused without a transform', () => {
    const registry = declared({ label: field.string(), size: field.integer() });
    const [first, second] = ordered(registry);
    if (first === undefined || second === undefined) throw new Error('missing change');
    expect(
      checkVersionChangeChain(registry, [first, second]).map((problem) => problem.ref),
    ).toEqual(['shelf.first']);
  });

  test('a transform keyed by the action as it stood then is the one that counts when a later change renames the action', () => {
    const keyed = (key: string) => ({
      first: change({
        surface: [{ entity: crate, field: 'amount', addedRequired: true }],
        input: { [key]: (value: unknown) => value },
      }),
      second: rename,
      third: change({
        surface: [{ action: 'shelf.crate.build', renamedFrom: 'shelf.crate.make' }],
      }),
    });
    const members = { label: field.string(), size: field.integer() };
    const problemsOf = (key: string) => {
      const registry = declared(members, keyed(key), 'shelf.crate.build');
      const chain = ['first', 'second', 'third'].map((id) => {
        const found = registry.versionChanges.get(`shelf.${id}`);
        if (found === undefined) throw new Error('missing change');
        return found;
      });
      return checkVersionChangeChain(registry, chain).map((problem) => problem.ref);
    };
    expect(problemsOf('shelf.crate.make')).toEqual([]);
    expect(problemsOf('shelf.crate.build')).toEqual(['shelf.first']);
  });

  test('a declared command that does not name it needs nothing', () => {
    const registry = declared({ label: field.string() });
    const [first, second] = ordered(registry);
    if (first === undefined || second === undefined) throw new Error('missing change');
    expect(checkVersionChangeChain(registry, [first, second])).toEqual([]);
  });
});

describe('a fixture of a change whose added field a later change renames (section 18.2)', () => {
  const crate = defineEntity({
    prefix: 'crt',
    fields: { label: field.string(), size: field.integer().default(0) },
  });
  const fixture = (older: object, newer: object) => ({
    ref: 'shelf.crate.create',
    older,
    newer,
  });
  const failuresOf = (fixtures: readonly object[]) => {
    const module = makeModule(
      { ...base, entities: { crate } },
      {
        changes: {
          first: change({
            surface: [{ entity: crate, field: 'amount', addedRequired: true }],
            fixtures,
          }),
          second: change({ surface: [{ entity: crate, field: 'size', renamedFrom: 'amount' }] }),
        },
      },
    );
    const chain = defineApiVersions({
      '2026-01-01': {},
      '2026-02-01': { changes: ['shelf.first'] },
      '2026-03-01': { changes: ['shelf.second'] },
    });
    return runChangeFixtures(buildRegistry(appOf([module], { api: chain })), chain);
  };

  test('is written in the newer names, translated on through the later change and valid at the head', async () => {
    expect(await failuresOf([fixture({ label: 'x' }, { label: 'x', amount: 0 })])).toEqual([]);
  });

  test('a fixture that is really wrong still fails', async () => {
    const wrongNewer = await failuresOf([fixture({ label: 'x' }, { label: 'x', amount: 7 })]);
    expect(wrongNewer.map((failure) => failure.message)).toEqual([
      expect.stringContaining('not to the newer input'),
    ]);
    const wrongHead = await failuresOf([fixture({ label: 1 }, { label: 1, amount: 0 })]);
    expect(wrongHead.map((failure) => failure.message)).toEqual([
      expect.stringContaining('does not fit the input'),
    ]);
  });
});

describe('the refusal of a change that does not fit its point (section 18.2)', () => {
  test('says how changes adopted at one date are ordered', () => {
    const module = makeModule(
      { ...base, entities: { item: shelfItem } },
      {
        changes: {
          broken: change({ surface: [{ entity: shelfItem, field: 'nothing', renamedFrom: 'x' }] }),
        },
      },
    );
    const app = appOf([module], { api: null });
    const [problem] = checkVersionChanges(app, buildRegistry(app));
    expect(problem?.message).toContain(
      'Changes adopted at one date apply in the order of their since and then their id',
    );
  });
});
