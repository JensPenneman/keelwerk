import { describe, expect, test } from 'vitest';
import { shelfApi, shelfApp } from '../../test/version-change-kit.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { translate } from '../invoker/stages/translate.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { applyVersionChanges } from './apply-version-changes.ts';
import { translateError } from './translate-error.ts';
import { translateInput } from './translate-input.ts';
import { translateOutput } from './translate-output.ts';

const { registry } = shelfApp();
const older = applyVersionChanges({ registry, api: shelfApi(), apiVersion: '2026-11-04' });

function action(ref: string): ActionEntry {
  const found = registry.actions.get(ref);
  if (found === undefined) throw new Error(`no action ${ref}`);
  return found;
}

describe('translateInput and translateOutput (section 18.2)', () => {
  test('a renamed field is renamed in rows, patches, set items, selections, sorts and nested filters', () => {
    expect(translateInput(older, action('shelf.item.create'), { title: 'a' })).toEqual({
      label: 'a',
      size: 1,
    });
    expect(
      translateInput(older, action('shelf.item.update'), { id: 'i', patch: { title: 'b' } }),
    ).toEqual({ id: 'i', patch: { label: 'b' } });
    expect(
      translateInput(older, action('shelf.item.set'), {
        create: [{ title: 'a' }],
        update: [{ id: 'i', patch: { title: 'b' } }],
      }),
    ).toEqual({
      create: [{ label: 'a', size: 1 }],
      update: [{ id: 'i', patch: { label: 'b' } }],
    });
    expect(
      translateInput(older, action('shelf.item.get'), { ids: ['i'], properties: ['title', 'id'] }),
    ).toEqual({ ids: ['i'], properties: ['label', 'id'] });
    expect(
      translateInput(older, action('shelf.item.query'), {
        sort: [{ field: 'title', direction: 'desc' }, { field: 'id' }],
        properties: ['title'],
        filter: {
          and: [{ title: 'x' }, { not: { title: { startsWith: 'a' } } }, { or: [{ title: null }] }],
        },
      }),
    ).toEqual({
      sort: [{ field: 'label', direction: 'desc' }, { field: 'id' }],
      properties: ['label'],
      filter: {
        and: [{ label: 'x' }, { not: { label: { startsWith: 'a' } } }, { or: [{ label: null }] }],
      },
    });
    expect(
      translateInput(older, action('shelf.rack.query'), {
        filter: { name: 'r', items: { some: { title: 'x' }, none: { title: 'y' } } },
      }),
    ).toEqual({ filter: { name: 'r', items: { some: { label: 'x' }, none: { label: 'y' } } } });
  });

  test('the output answers the older names, and `$masked` follows', () => {
    const row = { id: 'i', label: 'a', note: undefined, $masked: ['label', 'note'] };
    expect(translateOutput(older, action('shelf.item.create'), row)).toEqual({
      id: 'i',
      title: 'a',
      note: undefined,
      $masked: ['colour', 'note', 'title'],
    });
    expect(
      translateOutput(older, action('shelf.item.query'), { items: [{ id: 'i', label: 'a' }] }),
    ).toMatchObject({ items: [{ id: 'i', title: 'a', $masked: ['colour'] }] });
  });

  test('an added required field takes the head default at the older version, and is dropped from its output', () => {
    expect(translateInput(older, action('shelf.item.create'), { title: 'a' })).toMatchObject({
      size: 1,
    });
    expect(translateInput(older, action('shelf.item.update'), { id: 'i', patch: {} })).toEqual({
      id: 'i',
      patch: {},
    });
    expect(
      translateOutput(older, action('shelf.item.archive'), { id: 'i', label: 'a', size: 3 }),
    ).not.toHaveProperty('size');
  });

  test('a removed field is accepted and dropped in input, and reported masked in output unless a transform sets it', () => {
    expect(
      translateInput(older, action('shelf.item.create'), { title: 'a', colour: 'red' }),
    ).toEqual({ label: 'a', size: 1 });
    const archived = translateOutput(older, action('shelf.item.archive'), { id: 'i', label: 'a' });
    expect(archived).toMatchObject({ $masked: ['colour'] });
    const got = translateOutput(older, action('shelf.item.get'), {
      list: [{ id: 'i', label: 'a' }],
    });
    expect(got).toEqual({ list: [{ id: 'i', title: 'a', colour: 'grey' }] });
  });

  test('`$masked` follows renames; a reference a command answers is not masked', () => {
    expect(
      translateOutput(older, action('shelf.item.create'), {
        entity: 'shelf.item',
        id: 'i',
        version: 1,
      }),
    ).toEqual({ entity: 'shelf.item', id: 'i', version: 1 });
  });

  test('custom transforms see the newer names in both directions', () => {
    const seen: unknown[] = [];
    const custom = {
      ...registry,
      versionChanges: new Map(registry.versionChanges),
    };
    const base = registry.versionChanges.get('shelf.labelRename');
    if (base === undefined) throw new Error('missing change');
    custom.versionChanges.set('shelf.labelRename', {
      ...base,
      input: {
        'shelf.item.create': (value: unknown) => {
          seen.push(value);
          return { ...(value as object), size: 7 };
        },
      },
      output: {
        'shelf.item.create': (value: unknown) => {
          seen.push(value);
          return value;
        },
      },
    });
    const translation = applyVersionChanges({
      registry: custom,
      api: null,
      apiVersion: null,
      only: ['shelf.labelRename'],
    });
    expect(translateInput(translation, action('shelf.item.create'), { title: 'a' })).toEqual({
      label: 'a',
      size: 7,
    });
    expect(translateOutput(translation, action('shelf.item.create'), { label: 'a' })).toEqual({
      title: 'a',
    });
    expect(seen).toEqual([{ label: 'a' }, { label: 'a' }]);
  });

  test('a throwing transform is core.version_change_failed with change, action and direction', () => {
    const base = registry.versionChanges.get('shelf.labelRename');
    if (base === undefined) throw new Error('missing change');
    const broken = {
      ...registry,
      versionChanges: new Map([
        [
          base.id,
          {
            ...base,
            input: {
              'shelf.item.create': () => {
                throw new Error('boom');
              },
            },
            output: { 'shelf.item.create': () => 'text' },
          },
        ],
      ]),
    };
    const translation = applyVersionChanges({
      registry: broken,
      api: null,
      apiVersion: null,
      only: [base.id],
    });
    const failure = (run: () => unknown): KeelwerkError => {
      try {
        run();
      } catch (error) {
        return error as KeelwerkError;
      }
      throw new Error('did not throw');
    };
    expect(
      failure(() => translateInput(translation, action('shelf.item.create'), {})),
    ).toMatchObject({
      kind: 'internal',
      code: 'core.version_change_failed',
      details: { change: 'shelf.labelRename', action: 'shelf.item.create', direction: 'input' },
    });
    expect(
      failure(() => translateOutput(translation, action('shelf.item.create'), {})),
    ).toMatchObject({
      code: 'core.version_change_failed',
      details: { direction: 'output' },
    });
  });

  test('a subscription item translates per item and a page per row', async () => {
    const item = await translate(older, 'output', action('shelf.item.archive'), {
      id: 'i',
      label: 'a',
    });
    expect(item).toMatchObject({ title: 'a' });
    const page = await translate(older, 'output', action('shelf.item.query'), {
      items: [
        { id: 'a', label: 'x' },
        { id: 'b', label: 'y' },
      ],
      pageInfo: { endCursor: 'abc' },
    });
    expect(page).toMatchObject({
      items: [{ title: 'x' }, { title: 'y' }],
      pageInfo: { endCursor: 'abc' },
    });
  });

  test('an untouched action and an absent translation pass the value as it is', async () => {
    const value = { name: 'r' };
    expect(await translate(older, 'output', action('shelf.rack.create'), value)).toBe(value);
    expect(await translate(undefined, 'input', action('shelf.item.create'), value)).toBe(value);
  });

  test('state tokens, cursors and json fields are never renamed', () => {
    const row = {
      id: 'i',
      label: 'a',
      meta: { title: 'kept', label: 'kept' },
    };
    expect(translateOutput(older, action('shelf.item.archive'), row)).toMatchObject({
      title: 'a',
      meta: { title: 'kept', label: 'kept' },
    });
    const query = translateInput(older, action('shelf.item.query'), {
      first: 5,
      after: 'title',
      filter: { meta: { eq: { title: 'x' } } },
    });
    expect(query).toEqual({ first: 5, after: 'title', filter: { meta: { eq: { title: 'x' } } } });
    expect(
      translateOutput(older, action('shelf.item.get'), { list: [], state: 'title', notFound: [] }),
    ).toMatchObject({ state: 'title' });
  });

  test('translate checks the translated input against the head schema', async () => {
    expect(await translate(older, 'input', action('shelf.item.create'), { title: 'a' })).toEqual({
      label: 'a',
      size: 1,
    });
    await expect(
      translate(older, 'input', action('shelf.item.create'), { size: 'x' }),
    ).rejects.toMatchObject({ kind: 'internal', code: 'core.version_change_failed' });
  });
});

describe('translateError', () => {
  test('maps a renamed code and keeps kind and message', () => {
    const original = new KeelwerkError({
      kind: 'conflict',
      code: 'shelf.full',
      message: 'The shelf is full.',
      details: { size: 1 },
      issues: [{ path: ['a'], message: 'm' }],
    });
    const mapped = translateError(older, original);
    expect(mapped).toMatchObject({
      kind: 'conflict',
      code: 'shelf.no_room',
      message: 'The shelf is full.',
      details: { size: 1 },
      issues: [{ path: ['a'], message: 'm' }],
    });
    const other = new KeelwerkError({ kind: 'not_found', code: 'core.not_found', message: 'x' });
    expect(translateError(older, other)).toBe(other);
  });

  test("maps the paths of issues back to the version's names, a head-only field to its parent", () => {
    const issue = (path: readonly (string | number)[]) => ({ path, message: 'm' });
    const error = (...paths: (readonly (string | number)[])[]) =>
      new KeelwerkError({
        kind: 'validation',
        code: 'core.validation',
        message: 'x',
        issues: paths.map(issue),
      });
    expect(
      translateError(older, error(['label'], ['size'], ['note']), action('shelf.item.create'))
        .issues,
    ).toEqual([issue(['title']), issue([]), issue(['note'])]);
    expect(
      translateError(
        older,
        error(['create', 0, 'label'], ['update', 1, 'patch', 'label']),
        action('shelf.item.set'),
      ).issues,
    ).toEqual([issue(['create', 0, 'title']), issue(['update', 1, 'patch', 'title'])]);
    const outside = error(['other', 'label']);
    expect(translateError(older, outside, action('shelf.item.create'))).toBe(outside);
    expect(translateError(older, outside)).toBe(outside);
  });
});
