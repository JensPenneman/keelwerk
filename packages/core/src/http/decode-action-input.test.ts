import { describe, expect, it } from 'vitest';
import { shopItem, shopSurface } from '../../test/shop-surface.ts';
import { actionOf } from '../../test/surface-kit.ts';
import { normalizeWireFilter } from '../conditions/normalize-wire-filter.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { parseTypeId } from '../ids/parse-type-id.ts';
import { renderTypeId } from '../ids/render-type-id.ts';
import type { FieldNode } from '../surface/field-node.ts';
import { generatedNodes } from '../surface/generated-action-nodes.ts';
import { decodeActionInput } from './decode-action-input.ts';
import { decodeInput } from './decode-input.ts';

const base = { optional: false, access: 'read-write' } as const;
const item = shopItem;
const surface = shopSurface;

const query = actionOf('shop.item.query', {
  generated: 'query',
  entity: 'shop.item',
  kind: 'query',
  input: generatedNodes('query', item).input,
});
const create = actionOf('shop.item.create', {
  generated: 'create',
  entity: 'shop.item',
  input: generatedNodes('create', item).input,
});

const id = (prefix: string): { wire: string; uuid: string } => {
  const uuid = crypto.randomUUID();
  return { wire: renderTypeId(prefix, uuid), uuid };
};
const filterOf = (filter: unknown): unknown =>
  (decodeActionInput(surface, query, { filter }) as { filter: unknown }).filter;
const failureOf = (run: () => unknown): KeelwerkError => {
  try {
    run();
  } catch (thrown) {
    if (thrown instanceof KeelwerkError) return thrown;
  }
  throw new Error('expected a KeelwerkError');
};

describe('decodeActionInput over the filter of a generated action', () => {
  it('a bare public id and eq, ne, in and nin on a reference decode to its uuid', () => {
    const a = id('itm');
    const b = id('itm');
    expect(filterOf({ parent: a.wire })).toEqual({ parent: a.uuid });
    expect(a.wire).not.toBe(a.uuid);
    expect(parseTypeId(a.wire, 'itm')).toBe(a.uuid);
    expect(filterOf({ parent: { eq: a.wire, ne: b.wire } })).toEqual({
      parent: { eq: a.uuid, ne: b.uuid },
    });
    expect(filterOf({ parent: { in: [b.wire, a.wire], nin: [a.wire, b.wire] } })).toEqual({
      parent: { in: [b.uuid, a.uuid], nin: [a.uuid, b.uuid] },
    });
  });

  it('the id of the entity decodes like a reference', () => {
    const a = id('itm');
    const b = id('itm');
    expect(filterOf({ id: a.wire })).toEqual({ id: a.uuid });
    expect(filterOf({ id: { nin: [a.wire, b.wire] } })).toEqual({ id: { nin: [a.uuid, b.uuid] } });
  });

  it('contains on a list of references decodes the item, and eq on it the whole list', () => {
    const a = id('tag');
    const b = id('tag');
    expect(filterOf({ tags: { contains: a.wire } })).toEqual({ tags: { contains: a.uuid } });
    expect(filterOf({ tags: { eq: [a.wire, b.wire] } })).toEqual({
      tags: { eq: [a.uuid, b.uuid] },
    });
  });

  it('some, none, every and is decode with the related entity, through a dotted path and nested relation objects', () => {
    const a = id('itm');
    const n = id('nte');
    expect(filterOf({ notes: { some: { id: n.wire } } })).toEqual({
      notes: { some: { id: n.uuid } },
    });
    expect(filterOf({ owner: { is: { parent: a.wire } } })).toEqual({
      owner: { is: { parent: a.uuid } },
    });
    expect(filterOf({ 'owner.notes': { none: { id: n.wire } } })).toEqual({
      'owner.notes': { none: { id: n.uuid } },
    });
    expect(filterOf({ owner: { notes: { every: { item: a.wire } } } })).toEqual({
      owner: { notes: { every: { item: a.uuid } } },
    });
  });

  it('and, or and not recurse at any depth', () => {
    const a = id('itm');
    expect(
      filterOf({ and: [{ or: [{ not: { parent: a.wire } }, { label: 'x' }] }, { id: a.wire }] }),
    ).toEqual({ and: [{ or: [{ not: { parent: a.uuid } }, { label: 'x' }] }, { id: a.uuid }] });
  });

  it("the filters of queryChanges and watch decode like the query's", () => {
    const a = id('itm');
    for (const kind of ['queryChanges', 'watch'] as const) {
      const action = actionOf(`shop.item.${kind}`, {
        generated: kind,
        entity: 'shop.item',
        input: generatedNodes(kind, item).input,
      });
      const wire =
        kind === 'watch'
          ? { filter: { parent: a.wire } }
          : { filter: { parent: a.wire }, sinceQueryState: 's' };
      expect(decodeActionInput(surface, action, wire)).toMatchObject({
        filter: { parent: a.uuid },
      });
    }
  });

  it("another entity's public id is refused with the issue a plain reference input gets, at the operand's path", () => {
    const n = id('nte');
    const plain = failureOf(() =>
      decodeActionInput(surface, create, { label: 'x', tags: [], related: [], parent: n.wire }),
    );
    const error = failureOf(() => filterOf({ parent: { eq: n.wire } }));
    expect(error.issues?.[0]?.message).toBe(plain.issues?.[0]?.message);
    expect(error.issues?.[0]?.path).toEqual(['filter', 'parent', 'eq']);
  });

  it('a bare uuid is refused in a filter as in a plain input', () => {
    const a = id('itm');
    const plain = failureOf(() =>
      decodeActionInput(surface, create, { label: 'x', tags: [], related: [], parent: a.uuid }),
    );
    const error = failureOf(() => filterOf({ parent: a.uuid }));
    expect(error.issues?.[0]?.message).toBe(plain.issues?.[0]?.message);
    expect(error.issues?.[0]?.path).toEqual(['filter', 'parent']);
  });

  it('every bad operand and the issues of the other members come in one validation error', () => {
    const n = id('nte');
    const error = failureOf(() =>
      decodeActionInput(surface, query, {
        filter: { parent: { in: ['x', n.wire] }, 'owner.notes': { some: { id: 1 } } },
        first: 'many',
      }),
    );
    const reference = failureOf(() => decodeInput(query.input, { first: 'many' }));
    expect(error.kind).toBe(reference.kind);
    expect(error.code).toBe(reference.code);
    expect(error.message).toBe(reference.message);
    const paths = (error.issues ?? []).map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['first', 'filter.parent.in.0', 'filter.parent.in.1']),
    );
  });

  it('operands of other fields, startsWith, isNull, null operands and unknown keys are left as they are', () => {
    const filter = {
      label: { startsWith: 'itm_x', isNull: false },
      parent: { isNull: true },
      unknown: 'itm_x',
      notes: 'itm_x',
    };
    expect(filterOf(filter)).toEqual(filter);
    expect(filterOf({ parent: null })).toEqual({ parent: null });
    expect(filterOf({ parent: { eq: null } })).toEqual({ parent: { eq: null } });
  });

  it("a declared action's filter member is left as it is", () => {
    const json: FieldNode = { ...base, optional: true, kind: 'json', schema: {} };
    const custom = actionOf('shop.item.search', {
      entity: 'shop.item',
      kind: 'query',
      input: { ...base, kind: 'shape', fields: { filter: json } },
    });
    const a = id('itm');
    expect(decodeActionInput(surface, custom, { filter: { parent: a.wire } })).toEqual({
      filter: { parent: a.wire },
    });
  });

  it('an input without a filter decodes exactly as decodeInput does, a void input included', () => {
    const wire = { first: 3 };
    expect(decodeActionInput(surface, query, wire)).toEqual(decodeInput(query.input, wire));
    const none = actionOf('shop.ping', { input: { ...base, kind: 'void' } });
    expect(decodeActionInput(surface, none, undefined)).toBeUndefined();
  });

  it('a set of references decodes from an array operand to a Set, in eq and contains', () => {
    const a = id('tag');
    const b = id('tag');
    expect(filterOf({ related: { eq: [a.wire, b.wire] } })).toEqual({
      related: { eq: new Set([a.uuid, b.uuid]) },
    });
    expect(filterOf({ related: [b.wire, a.wire] })).toEqual({
      related: new Set([a.uuid, b.uuid]),
    });
    expect(filterOf({ related: { contains: a.wire } })).toEqual({
      related: { contains: a.uuid },
    });
    const repeated = failureOf(() => filterOf({ related: { eq: [a.wire, a.wire] } }));
    expect(repeated.issues?.[0]?.path).toEqual(['filter', 'related', 'eq', 1]);
  });

  it('startsWith, and contains on an id or a reference that is no collection, are refused at the operator', () => {
    const a = id('itm');
    for (const filter of [
      { parent: { startsWith: 'itm_01h' } },
      { parent: { contains: a.wire } },
      { id: { startsWith: '0190' } },
      { tags: { startsWith: 'tag_' } },
      { not: { notes: { some: { item: { startsWith: '0190' } } } } },
    ]) {
      const error = failureOf(() => filterOf(filter));
      expect(error.code).toBe('core.validation');
      expect(error.issues?.at(-1)?.path.at(-1)).toMatch(/^(startsWith|contains)$/);
    }
    expect(failureOf(() => filterOf({ parent: { startsWith: 'x' } })).issues?.[0]).toEqual({
      path: ['filter', 'parent', 'startsWith'],
      message: 'is not an operator of a field that holds an id',
    });
  });

  describe('a key __proto__ is a key like any other', () => {
    const normalised = (filter: unknown): unknown => {
      try {
        return normalizeWireFilter(filter);
      } catch (thrown) {
        return thrown instanceof KeelwerkError ? `${thrown.code}: ${thrown.message}` : thrown;
      }
    };

    it.each([
      '{"__proto__":"x"}',
      '{"__proto__":{"a":1}}',
      '{"or":[{"__proto__":1}]}',
      '{"label":"a","__proto__":1}',
      '{"not":{"__proto__":"x"}}',
      '{"notes":{"some":{"__proto__":"x"}}}',
    ])('%s reaches the pipeline as it was sent', (json) => {
      const sent: unknown = JSON.parse(json);
      const decoded = filterOf(sent);
      expect(decoded).toEqual(sent);
      expect(normalised(decoded)).toEqual(normalised(sent));
      expect(normalised(decoded)).not.toEqual({ op: 'and', conditions: [] });
    });

    it('stays an own key beside a decoded operand, as a field and as an operator', () => {
      const a = id('itm');
      const field = filterOf(JSON.parse(`{"parent":"${a.wire}","__proto__":"x"}`)) as object;
      expect(Object.keys(field)).toEqual(['parent', '__proto__']);
      expect(Object.getPrototypeOf(field)).toBe(Object.prototype);
      expect(Reflect.get(field, 'parent')).toBe(a.uuid);
      const operator = filterOf(
        JSON.parse(`{"parent":{"eq":"${a.wire}","__proto__":{}}}`),
      ) as Record<string, object>;
      expect(Object.keys(operator.parent ?? {})).toEqual(['eq', '__proto__']);
      expect(Object.getPrototypeOf(operator.parent)).toBe(Object.prototype);
      const sent = JSON.parse(`{"parent":{"eq":"${a.uuid}","__proto__":{}}}`);
      expect(normalised(operator)).toEqual(normalised(sent));
    });
  });

  describe('the bounds of the walk', () => {
    const nested = (levels: number): unknown => {
      let filter: unknown = { label: 'x' };
      for (let level = 0; level < levels; level += 1) filter = { not: filter };
      return filter;
    };

    it('refuses 10 000 levels as a malformed request with the path of the level that went over', () => {
      const error = failureOf(() => filterOf(nested(10_000)));
      expect(error.kind).toBe('validation');
      expect(error.code).toBe('core.malformed_request');
      expect(error.issues?.[0]?.path).toEqual(['filter', ...Array<string>(33).fill('not')]);
    });

    it('takes 32 levels and refuses 33', () => {
      expect(() => filterOf(nested(31))).not.toThrow();
      expect(failureOf(() => filterOf(nested(40))).code).toBe('core.malformed_request');
    });

    it('counts each segment of a dotted relation path as a level', () => {
      const key = Array<string>(5000).fill('owner').join('.');
      const error = failureOf(() => filterOf({ [key]: { is: { label: 'a' } } }));
      expect(error.code).toBe('core.malformed_request');
      expect(error.issues?.[0]?.path).toEqual(['filter', key]);
    });

    it('refuses a filter with more than 10 000 members', () => {
      const wide = { and: Array.from({ length: 10_001 }, () => ({ label: 'x' })) };
      expect(failureOf(() => filterOf(wide)).code).toBe('core.malformed_request');
    });
  });
});
