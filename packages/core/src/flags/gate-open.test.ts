import { describe, expect, test } from 'vitest';
import type { CompiledGate } from './compiled-gate.ts';
import type { FlagSnapshot } from './flag-snapshot.ts';
import { gateOpen } from './gate-open.ts';

const gate: CompiledGate = { rule: 'shop.pay.gate', key: 'shop.live', stage: 'admit' };
const snapshotOf = (value: unknown) => ({ read: () => ({ value }) }) as unknown as FlagSnapshot;

describe('gateOpen', () => {
  test('a gate without a flag snapshot reads closed', () => {
    expect(gateOpen(gate, undefined)).toBe(false);
  });

  test('a gate opens only on a snapshot that reads true', () => {
    expect(gateOpen(gate, snapshotOf(true))).toBe(true);
    expect(gateOpen(gate, snapshotOf(false))).toBe(false);
    expect(gateOpen(gate, snapshotOf('true'))).toBe(false);
  });
});
