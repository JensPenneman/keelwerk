import { KeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { expectDenied } from './expect-denied.ts';

const forbidden = new KeelwerkError({
  kind: 'forbidden',
  code: 'core.forbidden',
  message: 'x',
  rules: [{ id: 'library.book.readers', effect: 'allow' }],
});

describe('expectDenied', () => {
  test('passes for a refusal, and when the named rule is among the rules', async () => {
    await expectDenied(Promise.reject(forbidden));
    await expectDenied(Promise.reject(forbidden), 'library.book.readers');
  });

  test('fails when the named rule is not among the rules', async () => {
    await expect(expectDenied(Promise.reject(forbidden), 'other')).rejects.toThrow();
  });

  test('fails for a call that resolved', async () => {
    await expect(expectDenied(Promise.resolve(1))).rejects.toThrow();
  });

  test('fails for a rejection that is not a refusal', async () => {
    await expect(expectDenied(Promise.reject(new TypeError('x')))).rejects.toThrow();
    const invalid = new KeelwerkError({
      kind: 'validation',
      code: 'core.validation',
      message: 'x',
    });
    await expect(expectDenied(Promise.reject(invalid))).rejects.toThrow();
  });
});
