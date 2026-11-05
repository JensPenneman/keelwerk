import { describe, expect, test } from 'vitest';
import { ruleEntry } from '../../../test/authorization/fixtures.ts';
import { post } from '../../../test/authorization/post-fixture.ts';
import { actionOf, registryOf, user } from '../../../test/invoker/invoker-kit.ts';
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
const pageAction = actionOf('doc.list', {
  output: pageSchema,
  page,
  entityOutput: { entity: 'doc.post', shape: 'page' },
});
const registry = registryOf([pageAction]);
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

describe('the cursors of a page', () => {
  const cursorOf = (fields: readonly string[], values: readonly unknown[], id: string): string =>
    Buffer.from(JSON.stringify([fields, values, id, 'sig']), 'utf8').toString('base64url');
  const rules = [normalizeRule(reveal)];
  const row = (id: string, ownerId: string, title: string, secret: string) => ({
    id,
    ownerId,
    title,
    secret,
  });
  const pageOutput = (items: readonly object[], start: string, end: string) => ({
    items,
    pageInfo: { startCursor: start, endCursor: end },
    queryState: '0',
  });

  test('a sort on a field the caller may not read never reaches the cursors', async () => {
    const items = [row('1', 'ada', 'one', 'top secret a'), row('2', 'ada', 'two', 'top secret b')];
    const output = pageOutput(
      items,
      cursorOf(['secret'], ['top secret a'], '1'),
      cursorOf(['secret'], ['top secret b'], '2'),
    );
    for (const environment of ['test', 'development'] as const) {
      await expect(
        shapeStage(inputOf({ action: pageAction, rules, environment, output })),
      ).rejects.toThrow(/sorted by "secret"/);
    }
    const stripped = await shapeStage(
      inputOf({ action: pageAction, rules, environment: 'production', output }),
    );
    expect(stripped).toMatchObject({ pageInfo: { startCursor: null, endCursor: null } });
    expect(JSON.stringify(stripped)).not.toContain('top secret');
    expect(JSON.stringify(stripped)).not.toContain(cursorOf(['secret'], ['top secret a'], '1'));
  });

  test('a page whose edge row was dropped has null cursors', async () => {
    const items = [row('1', 'ada', 'mine', 's'), row('2', 'bob', 'theirs', 's')];
    const output = pageOutput(
      items,
      cursorOf(['title'], ['mine'], '1'),
      cursorOf(['title'], ['theirs'], '2'),
    );
    const answer = await shapeStage(
      inputOf({ action: pageAction, environment: 'production', output }),
    );
    expect(answer).toMatchObject({
      items: [{ id: '1' }],
      pageInfo: { startCursor: cursorOf(['title'], ['mine'], '1'), endCursor: null },
    });
  });

  test('a sort on a revealed field keeps its cursors', async () => {
    const items = [row('1', 'ada', 'one', 's'), row('2', 'ada', 'two', 's')];
    const output = pageOutput(
      items,
      cursorOf(['title'], ['one'], '1'),
      cursorOf(['title'], ['two'], '2'),
    );
    const answer = await shapeStage(inputOf({ action: pageAction, rules, output }));
    expect(answer).toMatchObject({ pageInfo: output.pageInfo });
  });

  test('a hidden sort whose value equals a visible one is still refused', async () => {
    const items = [row('1', 'ada', 'same', 'same'), row('2', 'ada', 'same2', 'same2')];
    const output = pageOutput(
      items,
      cursorOf(['secret'], ['same'], '1'),
      cursorOf(['secret'], ['same2'], '2'),
    );
    await expect(
      shapeStage(inputOf({ action: pageAction, rules, environment: 'test', output })),
    ).rejects.toThrow(/sorted by "secret"/);
  });

  test('a visible sort whose value equals a hidden field is still accepted', async () => {
    const items = [row('1', 'ada', 'same', 'same'), row('2', 'ada', 'same2', 'same2')];
    const output = pageOutput(
      items,
      cursorOf(['title'], ['same'], '1'),
      cursorOf(['title'], ['same2'], '2'),
    );
    const answer = await shapeStage(inputOf({ action: pageAction, rules, output }));
    expect(answer).toMatchObject({ pageInfo: output.pageInfo });
  });
});
