import { describe, expect, test } from 'vitest';
import { shopItem } from '../../test/shop-surface.ts';
import { toWire } from '../wire/to-wire.ts';
import { generatedNodes } from './generated-action-nodes.ts';

const nodes = generatedNodes('watch', shopItem);

const base = { optional: false, access: 'read-write' } as const;
const optional = { optional: true, access: 'read-write' } as const;
const itemId = { ...base, kind: 'ref', target: 'shop.item', prefix: 'itm' } as const;
const tagId = { ...base, kind: 'ref', target: 'shop.tag', prefix: 'tag' } as const;

/** The row of a watch item: every field of `shop.item`, each optional. */
const rowFields = {
  id: { ...optional, access: 'read', kind: 'id', target: 'shop.item', prefix: 'itm' },
  parent: { ...itemId, optional: true },
  tags: { ...optional, kind: 'list', item: tagId },
  related: { ...optional, kind: 'set', item: tagId },
  label: { ...optional, kind: 'string' },
};

function members(node: { readonly kind: string }): Record<string, { readonly kind: string }> {
  if (node.kind !== 'shape') {
    throw new TypeError('a shape was expected');
  }
  return (node as unknown as { fields: Record<string, { kind: string }> }).fields;
}

describe('the surface nodes of the generated watch', () => {
  test("the watch input carries WatchInput's members", () => {
    expect(Object.keys(members(nodes.input))).toEqual([
      'ids',
      'filter',
      'fields',
      'includeArchived',
      'from',
      'after',
      'partition',
    ]);
    expect(Object.keys(members(nodes.input))).not.toContain('since');
    expect(nodes.input).toEqual({
      ...base,
      kind: 'shape',
      fields: {
        ids: { ...optional, kind: 'list', item: itemId },
        filter: { ...optional, kind: 'json', schema: {}, input: {}, output: {} },
        fields: { ...optional, kind: 'list', item: { ...base, kind: 'string' } },
        includeArchived: { ...optional, kind: 'boolean' },
        from: { ...optional, kind: 'enum', values: ['now', 'beginning'] },
        after: { ...optional, kind: 'string' },
        partition: { ...optional, kind: 'string' },
      },
    });
  });

  test('a watch item is { type, id, version, cause, reason, row }', () => {
    expect(Object.keys(members(nodes.output))).toEqual([
      'type',
      'id',
      'version',
      'cause',
      'reason',
      'row',
    ]);
    expect(nodes.output).toEqual({
      ...base,
      kind: 'shape',
      fields: {
        type: {
          ...base,
          kind: 'enum',
          values: ['created', 'changed', 'restored', 'archived', 'removed'],
        },
        id: itemId,
        version: { ...optional, kind: 'integer', wide: false },
        cause: { ...optional, kind: 'string' },
        reason: { ...optional, kind: 'enum', values: ['left-view', 'purged', 'erased'] },
        row: { ...optional, kind: 'shape', fields: rowFields },
      },
    });
  });

  test('toWire encodes created, archived without row, and removed', () => {
    const id = crypto.randomUUID();
    const created = toWire(nodes.output, {
      type: 'created',
      id,
      version: 1,
      cause: 'shop.item.created',
      row: { label: 'a' },
    }) as Record<string, unknown>;
    expect(created.type).toBe('created');
    expect(created.version).toBe(1);
    expect(created.row).toEqual({ label: 'a' });
    expect(String(created.id)).toMatch(/^itm_/);
    const archived = toWire(nodes.output, { type: 'archived', id, version: 2 }) as Record<
      string,
      unknown
    >;
    expect(archived).not.toHaveProperty('row');
    const removed = toWire(nodes.output, { type: 'removed', id, reason: 'purged' }) as Record<
      string,
      unknown
    >;
    expect(removed).toMatchObject({ type: 'removed', reason: 'purged' });
    expect(removed).not.toHaveProperty('version');
    expect(removed).not.toHaveProperty('row');
  });
});
