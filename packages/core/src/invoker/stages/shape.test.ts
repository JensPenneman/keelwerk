import { describe, expect, test } from 'vitest';
import { ruleEntry } from '../../../test/authorization/fixtures.ts';
import { post } from '../../../test/authorization/post-fixture.ts';
import { actionOf, registryOf, user } from '../../../test/invoker/invoker-kit.ts';
import type { DroppedRow } from '../../authorization/dropped-row.ts';
import { normalizeRule } from '../../authorization/normalize-rule.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import type { ShapeInput } from './shape.ts';
import { shape as shapeStage } from './shape.ts';

const keys = ['id', 'createdAt', 'updatedAt', 'archivedAt', 'version', ...Object.keys(post.fields)];
const rowSchema = shape(Object.fromEntries(keys.map((key) => [key, field.string().optional()])));
const pageSchema = shape({
  items: field.list(field.json(rowSchema)),
  pageInfo: field.json(shape({})),
  queryState: field.string(),
});
const page = { sortable: [], defaultSort: [], defaultSize: 20, maxSize: 100 } as const;
const rowAction = actionOf('doc.one', { output: rowSchema });
const pageAction = actionOf('doc.list', { output: pageSchema, page });
const customAction = actionOf('doc.custom', { output: shape({ n: field.integer() }) });
const registry = registryOf([rowAction, pageAction, customAction]);
const own = ruleEntry({
  id: 'doc.post.own',
  effect: 'allow',
  actions: ['read'],
  where: (ctx) => ({ ownerId: (ctx as { principal: { subject: string } }).principal.subject }),
});
const reveal = ruleEntry({
  id: 'doc.post.reveal',
  effect: 'allow',
  actions: ['read'],
  fields: ['title'],
  where: () => ({}),
});

function inputOf(over: Partial<ShapeInput> & Pick<ShapeInput, 'action' | 'output'>): ShapeInput {
  return {
    registry,
    rules: [normalizeRule(own)],
    principal: user('ada'),
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    environment: 'test',
    onDropped: () => undefined,
    ...over,
  };
}

const mine = { id: '1', ownerId: 'ada', title: 'mine' };
const theirs = { id: '2', ownerId: 'bob', title: 'theirs' };

describe('shape', () => {
  test('rows inside the plan pass untouched', async () => {
    const output = await shapeStage(
      inputOf({ action: pageAction, output: { items: [mine], pageInfo: {}, queryState: '0' } }),
    );
    expect(output).toEqual({ items: [mine], pageInfo: {}, queryState: '0' });
    expect(await shapeStage(inputOf({ action: rowAction, output: mine }))).toEqual(mine);
  });

  test('tests and development fail a row outside the plan', async () => {
    for (const environment of ['test', 'development'] as const) {
      await expect(
        shapeStage(
          inputOf({
            action: pageAction,
            environment,
            output: { items: [mine, theirs], pageInfo: {}, queryState: '0' },
          }),
        ),
      ).rejects.toMatchObject({ kind: 'internal', code: 'core.row_outside_plan' });
    }
  });

  test('production drops the row, reports it, and keeps the rest of the page', async () => {
    const dropped: DroppedRow[] = [];
    const output = await shapeStage(
      inputOf({
        action: pageAction,
        environment: 'production',
        onDropped: (row) => dropped.push(row),
        output: { items: [theirs, mine], pageInfo: {}, queryState: '0' },
      }),
    );
    expect(output).toEqual({ items: [mine], pageInfo: {}, queryState: '0' });
    expect(dropped).toEqual([expect.objectContaining({ entity: 'doc.post', rowId: '2' })]);
  });

  test('production answers not_found for a lone row outside the plan', async () => {
    await expect(
      shapeStage(inputOf({ action: rowAction, environment: 'production', output: theirs })),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('no allow rule means every row is outside the plan', async () => {
    await expect(
      shapeStage(
        inputOf({ action: rowAction, rules: [], environment: 'production', output: mine }),
      ),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('maskable fields the rules do not reveal are left out and named in $masked', async () => {
    const row = { id: '1', ownerId: 'ada', title: 'mine', secret: 's', note: 'n' };
    const output = await shapeStage(
      inputOf({ action: rowAction, rules: [normalizeRule(reveal)], output: row }),
    );
    expect(output).toEqual({ id: '1', ownerId: 'ada', title: 'mine', $masked: ['note', 'secret'] });
  });

  test('a page whose items are not a list is internal', async () => {
    await expect(
      shapeStage(inputOf({ action: pageAction, output: { items: 'x' } })),
    ).rejects.toMatchObject({ kind: 'internal' });
    await expect(shapeStage(inputOf({ action: rowAction, output: 'x' }))).rejects.toMatchObject({
      kind: 'internal',
    });
  });

  test('a custom output is checked against its schema in development only', async () => {
    const wrong = { n: 'not a number' };
    await expect(
      shapeStage(inputOf({ action: customAction, environment: 'development', output: wrong })),
    ).rejects.toMatchObject({ kind: 'internal' });
    expect(
      await shapeStage(inputOf({ action: customAction, environment: 'production', output: wrong })),
    ).toBe(wrong);
    expect(
      await shapeStage(
        inputOf({ action: customAction, environment: 'development', output: { n: 1 } }),
      ),
    ).toEqual({ n: 1 });
  });
});

describe('an output whose fields match two entities', () => {
  const twin = (ref: string) =>
    ({ ref, module: ref.split('.')[0], name: 'post', descriptor: post }) as never;
  const twins = registryOf([rowAction], {
    entities: new Map([
      ['a.post', twin('a.post')],
      ['b.post', twin('b.post')],
    ]),
  });

  test('the action without its own entity is internal', async () => {
    await expect(
      shapeStage(inputOf({ registry: twins, action: rowAction, output: mine })),
    ).rejects.toMatchObject({ code: 'core.internal' });
  });

  test('the action takes its own entity, whose plan decides', async () => {
    const own = actionOf('b.one', { output: rowSchema, entity: 'b.post' });
    const registry = registryOf([own], { entities: twins.entities });
    await expect(shapeStage(inputOf({ registry, action: own, output: mine }))).rejects.toThrow(
      /fell outside the read plan of b\.one/,
    );
  });
});
