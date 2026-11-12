import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { place, shelfItem } from '../../test/version-change-kit.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { defineCommand } from '../dsl/define-command.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { checkVersionChanges } from '../registry/check-version-changes.ts';
import { applyVersionChanges } from './apply-version-changes.ts';
import { defineVersionChange } from './define-version-change.ts';
import { translateInput } from './translate-input.ts';
import { translateOutput } from './translate-output.ts';

const base = { id: 'shelf', version: '2.0.0' } as const;
const change = (surface: object) =>
  defineVersionChange(base as never, { since: '2.0.0', surface: [surface] } as never);

function chain(changes: Readonly<Record<string, object>>, entityActions: object = {}) {
  const module = makeModule(
    { ...base, entities: { item: shelfItem } },
    { actions: { place }, entityActions, changes },
  );
  const api = defineApiVersions({
    '2026-01-01': {},
    '2026-02-01': { changes: ['shelf.first'] },
    '2026-03-01': { changes: ['shelf.second'] },
  });
  const app = appOf([module], { api });
  const registry = buildRegistry(app);
  const at = (apiVersion: string) => applyVersionChanges({ registry, api, apiVersion });
  const action = (ref: string) => {
    const found = registry.actions.get(ref);
    if (found === undefined) throw new Error(`no action ${ref}`);
    return found;
  };
  return { app, registry, at, action };
}

describe('a change chained over three versions (section 18.2)', () => {
  const { app, registry, at, action } = chain({
    first: change({ entity: shelfItem, field: 'title', renamedFrom: 'name' }),
    second: change({ entity: shelfItem, field: 'label', renamedFrom: 'title' }),
  });
  const create = action('shelf.item.create');

  test('the compose check accepts the chain', () => {
    expect(checkVersionChanges(app, registry)).toEqual([]);
  });

  test.each([
    ['2026-01-01', 'name'],
    ['2026-02-01', 'title'],
    ['2026-03-01', 'label'],
  ])('at %s the field is called %s, in both directions', (version, name) => {
    const translation = at(version);
    expect(translateInput(translation, create, { [name]: 'a' })).toEqual({ label: 'a' });
    expect(translateOutput(translation, create, { id: 'i', label: 'a' })).toEqual({
      id: 'i',
      [name]: 'a',
    });
  });
});

describe('an added required field that is renamed later', () => {
  const { app, registry, at, action } = chain({
    first: change({ entity: shelfItem, field: 'amount', addedRequired: true }),
    second: change({ entity: shelfItem, field: 'size', renamedFrom: 'amount' }),
  });

  test('composes, and the oldest version takes the default of the head name', () => {
    expect(checkVersionChanges(app, registry)).toEqual([]);
    expect(translateInput(at('2026-01-01'), action('shelf.item.create'), { label: 'a' })).toEqual({
      label: 'a',
      size: 1,
    });
    expect(
      translateOutput(at('2026-01-01'), action('shelf.item.create'), { id: 'i', size: 3 }),
    ).toEqual({
      id: 'i',
    });
  });
});

describe('an added required field and a declared action that edits a row', () => {
  const edit = defineCommand(
    base as never,
    {
      input: shape({ label: field.string().optional(), size: field.integer().optional() }),
      decide: () => ({ events: [] }),
    } as never,
  );
  const required = defineCommand(
    base as never,
    {
      input: shape({ size: field.integer() }),
      decide: () => ({ events: [] }),
    } as never,
  );
  const defaulted = defineCommand(
    base as never,
    {
      input: shape({ size: field.integer().default(5) }),
      decide: () => ({ events: [] }),
    } as never,
  );
  const { at, action } = chain(
    {
      first: change({ entity: shelfItem, field: 'size', addedRequired: true }),
      second: change({}),
    },
    { item: { edit, required, defaulted } },
  );

  test('an older caller leaves out a member the action marks optional, and nothing is filled in', () => {
    const input = { id: 'itm_1', label: 'a' };
    expect(translateInput(at('2026-01-01'), action('shelf.item.edit'), input)).toEqual(input);
  });

  test('a member the action gives its own default is left out too, as a head caller leaves it out', () => {
    const input = { id: 'itm_1' };
    expect(translateInput(at('2026-01-01'), action('shelf.item.defaulted'), input)).toEqual(input);
  });

  test('a member the action requires takes the default of the entity', () => {
    expect(
      translateInput(at('2026-01-01'), action('shelf.item.required'), { id: 'itm_1' }),
    ).toEqual({ id: 'itm_1', size: 1 });
  });
});

describe('an added required field without a default and an editing action', () => {
  const edit = defineCommand(
    base as never,
    {
      input: shape({ label: field.string().optional() }),
      decide: () => ({ events: [] }),
    } as never,
  );
  const keep = (value: unknown): unknown => value;
  const { app, registry } = chain(
    {
      first: defineVersionChange(
        base as never,
        {
          since: '2.0.0',
          surface: [{ entity: shelfItem, field: 'label', addedRequired: true }],
          input: { 'shelf.item.create': keep, 'shelf.item.set': keep },
        } as never,
      ),
      second: change({}),
    },
    { item: { edit } },
  );

  test('the actions that create need an input transform, an action that edits with an optional member does not', () => {
    expect(checkVersionChanges(app, registry)).toEqual([]);
  });
});
