import { describe, expect, test } from 'vitest';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { checkServiceCaller } from './check-service-caller.ts';

const caused = { scope: { backend: null, tenant: null } };
const principal = moduleServicePrincipal('b', caused);

describe('checkServiceCaller', () => {
  test("another module's code does not act as B.system on B's own action", () => {
    expect(() => checkServiceCaller(principal, { module: 'b', ref: 'b.z' }, 'a')).toThrowError(
      expect.objectContaining({ kind: 'forbidden', rules: [] }),
    );
  });

  test('the code of B passes, and so does an action of A', () => {
    expect(() => checkServiceCaller(principal, { module: 'b', ref: 'b.z' }, 'b')).not.toThrow();
    expect(() => checkServiceCaller(principal, { module: 'a', ref: 'a.z' }, 'a')).not.toThrow();
  });

  test('a principal the kernel did not mint is not judged here', () => {
    const copy = { ...principal };
    expect(() => checkServiceCaller(copy, { module: 'b', ref: 'b.z' }, 'a')).not.toThrow();
  });
});
