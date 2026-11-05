import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { caller, tenantOf, value } from './support/generated-kit.ts';

interface Node {
  readonly kind: string;
  readonly optional: boolean;
  readonly fields?: Readonly<Record<string, Node>>;
  readonly item?: Node;
}

const surface = JSON.parse(
  readFileSync(
    new URL(
      '../../src/fixtures/apps/library/generated/api-surface/library/2026-11-04.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { actions: { ref: string; input: Node; output: Node }[] };

const pageMembers = ['items', 'pageInfo', 'total', 'queryState'];

function nodeOf(ref: string): { input: Node; output: Node } {
  const action = surface.actions.find((item) => item.ref === ref);
  if (action === undefined) throw new Error(`the surface has no ${ref}`);
  return action;
}

function conforms(node: Node, value: Record<string, unknown>, what: string): void {
  if (node.kind === 'page') {
    expect(Object.keys(value).filter((name) => !pageMembers.includes(name))).toEqual([]);
    return;
  }
  const declared = Object.keys(node.fields ?? {});
  expect(
    Object.keys(value).filter((name) => !declared.includes(name)),
    `${what}: undeclared`,
  ).toEqual([]);
  const required = Object.entries(node.fields ?? {})
    .filter(([, member]) => !member.optional)
    .map(([name]) => name);
  expect(
    required.filter((name) => !(name in value)),
    `${what}: missing`,
  ).toEqual([]);
}

describe('each generated action answers the shape of its surface node', () => {
  test('inputs and outputs', { timeout: 90_000 }, async () => {
    const { runtime, tenant: acme } = await tenantOf('memory');
    const call = caller(runtime, acme);
    const book = { title: 'T', isbn: 'i', addedBy: 'ada' };
    const asked = async (kind: string, input: Record<string, unknown>) => {
      const node = nodeOf(`library.book.${kind}`);
      conforms({ ...node.input, fields: node.input.fields ?? {} }, input, `${kind} input`);
      const out = await value<Record<string, unknown>>(call(`library.book.${kind}`, input));
      conforms(node.output, out, `${kind} output`);
      return out;
    };
    const created = await asked('create', book);
    const id = String(created.id);
    const got = await asked('get', { ids: [id] });
    await asked('get', { ids: [id], includeArchived: true });
    await asked('query', { first: 5 });
    await asked('query', { first: 5, includeArchived: true });
    await asked('queryChanges', { sinceQueryState: (await asked('query', {})).queryState });
    await asked('changes', { since: String(got.state) });
    conforms(nodeOf('library.book.changes').input, { since: 's', partition: 'p' }, 'changes input');
    await asked('update', { id, patch: { title: 'U' }, ifVersion: 1 });
    const history = await asked('history', { id, fromVersion: 1, limit: 1 });
    const entry = nodeOf('library.book.history').output.fields?.entries?.item;
    if (entry === undefined) throw new Error('the history node has no entries');
    const entries = history.entries as Record<string, unknown>[];
    for (const row of entries) conforms(entry, row, 'history entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      version: 1,
      actor: expect.anything(),
      changes: expect.anything(),
    });
    expect(await asked('history', { id, fromVersion: 2 })).toMatchObject({
      entries: [expect.objectContaining({ version: 2 })],
    });
    await asked('set', { create: [{ ...book, isbn: 'j' }], archive: [{ id }] });
    await asked('restore', { id });
    await asked('archive', { id });
  });
});
