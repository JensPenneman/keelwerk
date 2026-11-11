import { describe, expect, test } from 'vitest';
import { shelfApi, shelfApp } from '../../test/version-change-kit.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { applyVersionChanges } from './apply-version-changes.ts';
import { translateInput } from './translate-input.ts';
import { translateOutput } from './translate-output.ts';

const { registry } = shelfApp();

function action(ref: string): ActionEntry {
  const found = registry.actions.get(ref);
  if (found === undefined) throw new Error(`no action ${ref}`);
  return found;
}

type Row = Readonly<Record<string, unknown>>;

/** The older version, where the removed `colour` is built by `build` for every row `shelf.item.get` answers. */
function olderWith(build: (row: Row) => Row, id = 'shelf.colourRemoved') {
  const base = registry.versionChanges.get(id);
  if (base === undefined) throw new Error('missing change');
  const custom = { ...registry, versionChanges: new Map(registry.versionChanges) };
  custom.versionChanges.set(id, {
    ...base,
    output: {
      'shelf.item.get': (value: unknown) => {
        const page = value as { readonly list: readonly Row[] };
        return { ...page, list: page.list.map(build) };
      },
    },
  });
  return applyVersionChanges({ registry: custom, api: shelfApi(), apiVersion: '2026-11-04' });
}

/** The older version, where `shelf.item.get` is answered by `build`, given the whole answer. */
function olderWithPage(build: (page: { readonly list: readonly Row[] }) => object) {
  const base = registry.versionChanges.get('shelf.colourRemoved');
  if (base === undefined) throw new Error('missing change');
  const custom = { ...registry, versionChanges: new Map(registry.versionChanges) };
  custom.versionChanges.set('shelf.colourRemoved', {
    ...base,
    output: { 'shelf.item.get': (value: unknown) => build(value as { list: readonly Row[] }) },
  });
  return applyVersionChanges({ registry: custom, api: shelfApi(), apiVersion: '2026-11-04' });
}

const get = () => action('shelf.item.get');
const answer = (row: Row) => ({ list: [row] });

describe('a custom output transform and the masked members (section 16.4.5)', () => {
  const masked = { id: 'i', version: 1, label: 'a', $masked: ['note'] };
  const rows = (translation: ReturnType<typeof olderWith>, row: Row = masked) =>
    (translateOutput(translation, get(), answer(row)) as { list: Row[] }).list;

  test('a member the transform leaves undefined is named in $masked and taken out', () => {
    const translation = olderWith((row) => ({ ...row, colour: row.note }));
    const [row] = rows(translation);
    expect(row).toEqual({ id: 'i', version: 1, title: 'a', $masked: ['colour', 'note'] });
    expect(row).not.toHaveProperty('colour');
  });

  test('a member the transform leaves out is named in $masked (the existing rule)', () => {
    const translation = olderWith((row) => row);
    expect(rows(translation)).toEqual([
      { id: 'i', version: 1, title: 'a', $masked: ['colour', 'note'] },
    ]);
  });

  test('a fallback the transform answers is put out and not named, deliberately', () => {
    const translation = olderWith((row) => ({ ...row, colour: row.note ?? 'none' }));
    expect(rows(translation)).toEqual([
      { id: 'i', version: 1, title: 'a', colour: 'none', $masked: ['note'] },
    ]);
  });

  test('a transform that reads $masked can leave its member undefined to have it named', () => {
    const translation = olderWith((row) => ({
      ...row,
      colour: Array.isArray(row.$masked) && row.$masked.includes('note') ? undefined : 'x',
    }));
    expect(rows(translation)).toEqual([
      { id: 'i', version: 1, title: 'a', $masked: ['colour', 'note'] },
    ]);
    const plain = { id: 'p', version: 1, label: 'b' };
    expect(rows(translation, plain)).toEqual([{ id: 'p', version: 1, title: 'b', colour: 'x' }]);
  });

  test('$masked stays readable on the row the transform receives', () => {
    const seen: unknown[] = [];
    const translation = olderWith((row) => {
      seen.push(row.$masked);
      return { ...row, colour: 'x' };
    });
    rows(translation);
    expect(seen).toEqual([['note']]);
  });

  test('a member that is undefined in a row without masked names is named too', () => {
    const translation = olderWith((row) => ({ ...row, colour: undefined }));
    const plain = { id: 'p', version: 1, label: 'b' };
    expect(rows(translation, plain)).toEqual([
      { id: 'p', version: 1, title: 'b', $masked: ['colour'] },
    ]);
  });

  test('a removed field named like an inherited member is named in $masked when the row lacks it', () => {
    const base = registry.versionChanges.get('shelf.colourRemoved');
    if (base === undefined) throw new Error('missing change');
    const custom = { ...registry, versionChanges: new Map(registry.versionChanges) };
    custom.versionChanges.set('shelf.colourRemoved', {
      ...base,
      output: {},
      surface: base.surface.map((spec) =>
        spec.field === 'colour' ? { ...spec, field: 'constructor' } : spec,
      ),
    });
    const translation = applyVersionChanges({
      registry: custom,
      api: shelfApi(),
      apiVersion: '2026-11-04',
    });
    const [row] = rows(translation, { id: 'p', version: 1, label: 'b' });
    expect(row).toMatchObject({ id: 'p', title: 'b' });
    expect(row?.$masked).toContain('constructor');
  });

  test('a renamed member the transform answers as a fallback is put out under the older name', () => {
    const translation = olderWith(
      (row) => ({ ...row, label: row.note ?? 'none' }),
      'shelf.labelRename',
    );
    const [row] = rows(translation);
    expect(row).toMatchObject({ id: 'i', version: 1, title: 'none', $masked: ['note'] });
    expect(row).not.toHaveProperty('label');
  });

  test('a transform cannot obtain a masked value in any way', () => {
    const leaked: unknown[] = [];
    const translation = olderWith((row) => {
      leaked.push(
        row.note,
        { ...row },
        Object.entries(row),
        Object.values(row),
        JSON.stringify(row),
        Object.getOwnPropertyDescriptor(row, 'note'),
        Reflect.ownKeys(row),
        Reflect.ownKeys(row).map((key) => row[key as string]),
        structuredClone(row),
        Object.assign({}, row),
      );
      return row;
    });
    const holds = { id: 'i', version: 1, label: 'a', note: 'secret', $masked: ['note'] };
    translateOutput(translation, get(), answer(holds));
    expect(JSON.stringify(leaked)).not.toContain('secret');
    expect(leaked[5]).toBeUndefined();
    expect(leaked[6]).not.toContain('note');
  });

  test('a masked value in a nested row, a list or a page-level member never reaches the transform', () => {
    const leaked: unknown[] = [];
    const translation = olderWithPage((page) => {
      leaked.push(JSON.stringify(page));
      return page;
    });
    const nested = {
      id: 'i',
      version: 1,
      label: 'a',
      rack: { id: 'r', name: 'n', secret: 'deep', $masked: ['secret'] },
      $masked: ['note'],
      note: 'top',
    };
    translateOutput(translation, get(), {
      list: [nested],
      more: [{ secret: 'x', $masked: ['secret'] }],
    });
    expect(leaked.join('')).not.toMatch(/deep|top|"x"/);
    expect(leaked.join('')).toContain('"$masked":["secret"]');
  });

  test('what the transform does with the rows is taken as it is', () => {
    const list = [
      { id: 'a', version: 1, label: 'a', $masked: ['note'] },
      { id: 'b', version: 1, label: 'b' },
    ];
    const translation = olderWithPage((page) => ({
      ...page,
      count: page.list.length,
      list: [...page.list].reverse().map((row) => {
        const { id: _id, ...rest } = row;
        return { ...rest, colour: 'x' };
      }),
    }));
    expect(translateOutput(translation, get(), { list })).toMatchObject({
      count: 2,
      list: [
        { title: 'b', colour: 'x' },
        { title: 'a', colour: 'x', $masked: ['note'] },
      ],
    });
  });
});

describe('a selection that names a removed field (section 18.2)', () => {
  const older = applyVersionChanges({ registry, api: shelfApi(), apiVersion: '2026-11-04' });

  test('a name no transform produces is dropped from the head selection', () => {
    expect(
      translateInput(older, action('shelf.item.query'), { properties: ['title', 'colour'] }),
    ).toEqual({ properties: ['label'] });
    expect(translateInput(older, action('shelf.item.query'), { properties: ['colour'] })).toEqual({
      properties: [],
    });
  });

  test('a name only a custom output transform can produce widens the head selection to everything', () => {
    expect(
      translateInput(older, action('shelf.item.get'), {
        ids: ['i'],
        properties: ['title', 'colour'],
      }),
    ).toEqual({ ids: ['i'] });
  });

  test('the answer is narrowed to the selected older names again, masked names stay named', () => {
    const head = {
      list: [{ id: 'i', version: 2, label: 'a', rackId: 'r', size: 3, $masked: ['note'] }],
    };
    const input = { ids: ['i'], properties: ['title', 'colour'] };
    expect(translateOutput(older, get(), head, input)).toEqual({
      list: [{ id: 'i', version: 2, title: 'a', colour: 'grey', $masked: ['note'] }],
    });
    expect(translateOutput(older, get(), head)).toMatchObject({
      list: [{ rackId: 'r', colour: 'grey' }],
    });
  });

  test('without a selection nothing is narrowed', () => {
    const head = { list: [{ id: 'i', version: 2, label: 'a', rackId: 'r' }] };
    expect(translateOutput(older, get(), head, { ids: ['i'] })).toEqual({
      list: [{ id: 'i', version: 2, title: 'a', rackId: 'r', colour: 'grey' }],
    });
  });
});
