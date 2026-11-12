import { describe, expect, test } from 'vitest';
import { tokenCheck } from './token-check.ts';

const base = {
  rules: [{ id: 'library.book.readers', digest: 'abc' }],
  principal: { id: 'u1', roles: ['b', 'a'], memberships: [] },
  entity: 'library.book',
  partition: '',
};

describe('tokenCheck over flags', () => {
  test('no flags or an empty list keeps the M1 check b0dcbba4', () => {
    expect(tokenCheck(base)).toBe('b0dcbba4');
    expect(tokenCheck({ ...base, flags: [] })).toBe('b0dcbba4');
  });

  test('another variant of a read flag changes the check, their order does not', () => {
    const on = [
      { key: 'library.newFlow', variant: 'true' },
      { key: 'library.banner', variant: 'a' },
    ];
    const off = [
      { key: 'library.newFlow', variant: 'false' },
      { key: 'library.banner', variant: 'a' },
    ];
    expect(tokenCheck({ ...base, flags: on })).not.toBe('b0dcbba4');
    expect(tokenCheck({ ...base, flags: on })).not.toBe(tokenCheck({ ...base, flags: off }));
    expect(tokenCheck({ ...base, flags: on })).toBe(
      tokenCheck({ ...base, flags: [...on].reverse() }),
    );
  });
});

describe('tokenCheck over a live selector', () => {
  const live = { apiVersion: '2026-11-04', ids: ['b', 'a'], includeArchived: false };

  test('without live the M1 check b0dcbba4 stands', () => {
    expect(tokenCheck(base)).toBe('b0dcbba4');
  });

  // The live member now tells a selector without `ids` or `fields` from an empty list (`null` against
  // `[]`) and covers `fields`, so these goldens replace cf5f3386 of the earlier format.
  test('golden: the live check of the base with apiVersion 2026-11-04, ids [b, a], includeArchived false is 9834e8ad', () => {
    expect(tokenCheck({ ...base, live })).toBe('9834e8ad');
  });

  test('a kernel source condition is part of the check; without one the check is unchanged', () => {
    const open = { apiVersion: '2026-11-04' };
    const north = { op: 'eq', field: 'depot', value: 'north' };
    const south = { op: 'eq', field: 'depot', value: 'south' };
    expect(tokenCheck({ ...base, live: { ...open, where: north } })).not.toBe(
      tokenCheck({ ...base, live: { ...open, where: south } }),
    );
    expect(tokenCheck({ ...base, live: { ...open, where: north } })).not.toBe(
      tokenCheck({ ...base, live: open }),
    );
    expect(tokenCheck({ ...base, live: open })).toBe('2cc0e6a4');
  });

  test('goldens: a live member without ids is 2cc0e6a4, with ids [] is fde6b953, with fields [title] is 92721a7e', () => {
    const open = { apiVersion: '2026-11-04', includeArchived: false };
    expect(tokenCheck({ ...base, live: open })).toBe('2cc0e6a4');
    expect(tokenCheck({ ...base, live: { ...open, ids: [] } })).toBe('fde6b953');
    expect(tokenCheck({ ...base, live: { ...open, fields: ['title'] } })).toBe('92721a7e');
  });

  test('no ids is not an empty list of ids, and the fields are part of the check', () => {
    const open = { apiVersion: '2026-11-04', includeArchived: false };
    expect(tokenCheck({ ...base, live: open })).not.toBe(
      tokenCheck({ ...base, live: { ...open, ids: [] } }),
    );
    const title = tokenCheck({ ...base, live: { ...open, fields: ['title'] } });
    expect(title).not.toBe(tokenCheck({ ...base, live: open }));
    expect(title).not.toBe(tokenCheck({ ...base, live: { ...open, fields: ['title', 'note'] } }));
    expect(tokenCheck({ ...base, live: { ...open, fields: ['note', 'title'] } })).toBe(
      tokenCheck({ ...base, live: { ...open, fields: ['title', 'note'] } }),
    );
    expect(tokenCheck({ ...base, live: { ...open, fields: [] } })).not.toBe(
      tokenCheck({ ...base, live: open }),
    );
  });

  test('another apiVersion, ids or includeArchived changes the check; id order does not', () => {
    const check = tokenCheck({ ...base, live });
    expect(check).not.toBe('b0dcbba4');
    expect(tokenCheck({ ...base, live: { ...live, apiVersion: '2026-11-11' } })).not.toBe(check);
    expect(tokenCheck({ ...base, live: { ...live, ids: ['a'] } })).not.toBe(check);
    expect(tokenCheck({ ...base, live: { ...live, includeArchived: true } })).not.toBe(check);
    expect(tokenCheck({ ...base, live: { ...live, ids: ['a', 'b'] } })).toBe(check);
  });
});
