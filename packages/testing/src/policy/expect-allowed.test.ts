import { KeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { expectAllowed } from './expect-allowed.ts';

describe('expectAllowed', () => {
  test('passes for a call that resolved', async () => {
    await expectAllowed(Promise.resolve(1));
  });

  test('fails for a refusal by the policy', async () => {
    const forbidden = new KeelwerkError({
      kind: 'forbidden',
      code: 'core.forbidden',
      message: 'x',
      rules: [{ id: 'library.book.readers', effect: 'allow' }],
    });
    await expect(expectAllowed(Promise.reject(forbidden))).rejects.toThrow();
  });

  test('fails for a call that did not reach the action', async () => {
    const invalid = new KeelwerkError({
      kind: 'validation',
      code: 'core.validation',
      message: 'x',
    });
    await expect(expectAllowed(Promise.reject(invalid))).rejects.toThrow();
  });

  test('rethrows a rejection that is not a KeelwerkError', async () => {
    await expect(expectAllowed(Promise.reject(new TypeError('boom')))).rejects.toThrow('boom');
  });

  test('passes for an error the action declares', async () => {
    const declared = new KeelwerkError({
      kind: 'conflict',
      code: 'library.isbn_taken',
      message: 'x',
    } as never);
    await expectAllowed(Promise.reject(declared));
  });
});
