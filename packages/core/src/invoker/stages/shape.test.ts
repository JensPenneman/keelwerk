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
const rowAction = actionOf('doc.one', {
  output: rowSchema,
  entityOutput: { entity: 'doc.post', shape: 'row' },
});
const pageAction = actionOf('doc.list', {
  output: pageSchema,
  page,
  entityOutput: { entity: 'doc.post', shape: 'page' },
});
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

describe('the entity of an output', () => {
  test('a row-shaped output without a marker is custom: no check, no mask', async () => {
    const unmarked = actionOf('doc.unmarked', { output: rowSchema });
    const registry = registryOf([unmarked]);
    const row = { id: '2', ownerId: 'bob', title: 'theirs', secret: 's' };
    expect(await shapeStage(inputOf({ registry, action: unmarked, output: row }))).toBe(row);
  });

  test('a marker naming an entity the registry lacks is internal', async () => {
    const lost = actionOf('doc.lost', {
      output: rowSchema,
      entityOutput: { entity: 'doc.gone', shape: 'row' },
    });
    await expect(
      shapeStage(inputOf({ registry: registryOf([lost]), action: lost, output: mine })),
    ).rejects.toMatchObject({ code: 'core.internal' });
  });

  test('the marker names the entity whose plan decides', async () => {
    const twin = { ref: 'b.post', module: 'b', name: 'post', descriptor: post } as never;
    const marked = actionOf('b.one', {
      output: rowSchema,
      entityOutput: { entity: 'b.post', shape: 'row' },
    });
    const registry = registryOf([marked], {
      entities: new Map([['b.post', twin]]),
    });
    await expect(shapeStage(inputOf({ registry, action: marked, output: mine }))).rejects.toThrow(
      /fell outside the read plan of b\.post\.get/,
    );
  });
});

describe('the rows a command returns', () => {
  const close = actionOf('doc.post.close', {
    kind: 'command',
    entity: 'doc.post',
    instance: true,
    output: rowSchema,
    entityOutput: { entity: 'doc.post', shape: 'row' },
  });
  const closable = ruleEntry({
    id: 'doc.post.closable',
    effect: 'allow',
    actions: ['close'],
    where: (ctx) => ({ ownerId: (ctx as { principal: { subject: string } }).principal.subject }),
  });
  const frozen = ruleEntry({
    id: 'doc.post.frozen',
    effect: 'deny',
    actions: ['close'],
    where: () => ({ title: { eq: 'mine' } }),
    reason: 'A closed post is frozen.',
  });
  const rules = [normalizeRule(own), normalizeRule(closable), normalizeRule(frozen)];
  const registry = registryOf([close]);

  test('a deny condition on the command does not hide the row it returns', async () => {
    expect(await shapeStage(inputOf({ registry, rules, action: close, output: mine }))).toEqual(
      mine,
    );
  });

  test('a row outside the caller read plan answers the reference, never an error', async () => {
    for (const environment of ['test', 'development', 'production'] as const) {
      expect(
        await shapeStage(
          inputOf({
            registry,
            rules,
            action: close,
            environment,
            output: { ...theirs, version: 3 },
          }),
        ),
      ).toEqual({ entity: 'doc.post', id: '2', version: 3 });
    }
  });
});

describe('a command of a caller without read rights', () => {
  const update = actionOf('doc.post.update', {
    kind: 'command',
    entity: 'doc.post',
    instance: true,
    output: rowSchema,
    entityOutput: { entity: 'doc.post', shape: 'row' },
  });
  const list = actionOf('doc.post.sweep', {
    kind: 'command',
    entity: 'doc.post',
    output: pageSchema,
    page,
    entityOutput: { entity: 'doc.post', shape: 'page' },
  });
  const writeOnly = ruleEntry({
    id: 'doc.post.writeOnly',
    effect: 'allow',
    actions: ['update', 'sweep'],
    where: () => ({}),
  });
  const registry = registryOf([update, list]);
  const secret = { id: '2', ownerId: 'bob', title: 'theirs', body: 'secret of a', version: 4 };

  test('the command rules grant no read: the answer is the reference, and a replay agrees', async () => {
    const rules = [normalizeRule(writeOnly)];
    const first = await shapeStage(inputOf({ registry, rules, action: update, output: secret }));
    expect(first).toEqual({ entity: 'doc.post', id: '2', version: 4 });
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(await shapeStage(inputOf({ registry, rules, action: update, output: secret }))).toEqual(
      first,
    );
  });

  test('a readable row comes back masked by its fields', async () => {
    const rules = [normalizeRule(writeOnly), normalizeRule(reveal)];
    const row = { id: '1', ownerId: 'ada', title: 'mine', secret: 's', note: 'n' };
    expect(await shapeStage(inputOf({ registry, rules, action: update, output: row }))).toEqual({
      id: '1',
      ownerId: 'ada',
      title: 'mine',
      $masked: ['note', 'secret'],
    });
  });

  test('a page drops the rows outside the plan without failing', async () => {
    const rules = [normalizeRule(writeOnly), normalizeRule(own)];
    const output = { items: [theirs, mine], pageInfo: {}, queryState: '0' };
    expect(await shapeStage(inputOf({ registry, rules, action: list, output }))).toEqual({
      items: [mine],
      pageInfo: {},
      queryState: '0',
    });
  });
});
