import { describe, expect, test, vi } from 'vitest';
import type { Receipt } from '../storage/receipt.ts';
import { erasedFingerprint } from '../subjects/erased-fingerprint.ts';
import { assertSameRequest } from './assert-same-request.ts';

const kwf = `kwf1.${'a'.repeat(64)}`;
const legacy = 'b'.repeat(64);
const receipt = (fingerprint: string, principalId = 'p1'): Receipt =>
  ({ fingerprint, principal: { resolver: 'session', principalId } }) as unknown as Receipt;
const mismatch = { code: 'core.idempotency_mismatch' };

describe('assertSameRequest', () => {
  test('equal kwf1 passes and the legacy thunk is not called', () => {
    const thunk = vi.fn(() => legacy);
    expect(() => assertSameRequest(receipt(kwf), receipt(kwf), thunk)).not.toThrow();
    expect(thunk).not.toHaveBeenCalled();
  });

  test('another kwf1 fails without calling the thunk', () => {
    const thunk = vi.fn(() => legacy);
    expect(() =>
      assertSameRequest(receipt(kwf), receipt(`kwf1.${'c'.repeat(64)}`), thunk),
    ).toThrowError(expect.objectContaining(mismatch));
    expect(thunk).not.toHaveBeenCalled();
  });

  test('a bare-hex text equal to the legacy form passes', () => {
    expect(() => assertSameRequest(receipt(legacy), receipt(kwf), () => legacy)).not.toThrow();
  });

  test('a bare hex text that differs fails', () => {
    expect(() =>
      assertSameRequest(receipt(legacy), receipt(kwf), () => 'c'.repeat(64)),
    ).toThrowError(expect.objectContaining(mismatch));
  });

  test('erased fails without calling the thunk', () => {
    const thunk = vi.fn(() => erasedFingerprint);
    expect(() => assertSameRequest(receipt(erasedFingerprint), receipt(kwf), thunk)).toThrowError(
      expect.objectContaining(mismatch),
    );
    expect(thunk).not.toHaveBeenCalled();
  });

  test('another principal fails, whatever the fingerprints', () => {
    expect(() => assertSameRequest(receipt(kwf), receipt(kwf, 'p2'), () => legacy)).toThrowError(
      expect.objectContaining(mismatch),
    );
    expect(() => assertSameRequest(receipt(legacy), receipt(kwf, 'p2'), () => legacy)).toThrowError(
      expect.objectContaining(mismatch),
    );
  });
});
