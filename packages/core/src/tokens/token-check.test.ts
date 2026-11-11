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
