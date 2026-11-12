import { describe, expect, test } from 'vitest';
import { flushUsage } from '../api-versions/flush-usage.ts';
import { erasureKeys } from './erasure-keys.ts';
import { kernelServices } from './kernel-services.ts';

describe('the kernel services', () => {
  test('start with the erasure keys, which replay before the worker starts, and end with the usage flush', () => {
    expect(kernelServices).toHaveLength(4);
    expect(kernelServices[0]).toBe(erasureKeys);
    expect(kernelServices.at(-1)).toBe(flushUsage);
  });
});
