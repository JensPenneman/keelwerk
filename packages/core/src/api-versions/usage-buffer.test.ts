import { describe, expect, test } from 'vitest';
import { createUsageBuffer } from './usage-buffer.ts';

const key = {
  day: '2026-11-12',
  backendId: 'b',
  tenantId: 't',
  apiVersion: '2026-11-04',
  transport: 'rest',
  item: '',
};

describe('createUsageBuffer', () => {
  test('adds per key and drains in key order', () => {
    const buffer = createUsageBuffer();
    buffer.add({ ...key, transport: 'rest' });
    buffer.add({ ...key, transport: 'graphql' });
    buffer.add({ ...key, transport: 'rest' });
    expect(buffer.size).toBe(2);
    expect(buffer.drain()).toEqual([
      { ...key, transport: 'graphql', count: 1 },
      { ...key, transport: 'rest', count: 2 },
    ]);
  });

  test('drain empties and restore merges counts back', () => {
    const buffer = createUsageBuffer();
    buffer.add(key);
    const drained = buffer.drain();
    expect(buffer.size).toBe(0);
    buffer.add(key);
    buffer.restore(drained);
    expect(buffer.drain()).toEqual([{ ...key, count: 2 }]);
  });
});
