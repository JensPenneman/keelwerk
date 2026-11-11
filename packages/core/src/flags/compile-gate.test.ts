import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { compileGate } from './compile-gate.ts';

const flags = {
  checkout: defineFlag({
    kind: 'boolean',
    default: false,
    level: 'tenant',
    purpose: 'release',
    expires: '2027-06-30',
  }),
  halt: defineFlag({ kind: 'boolean', default: true, level: 'deployment', purpose: 'kill-switch' }),
};

const registry = buildRegistry(appOf([makeModule({ id: 'shop', flags, gate: 'checkout' })]));

function action(spec: Partial<ActionEntry>): ActionEntry {
  return { ref: 'shop.pay', module: 'shop', ...spec } as ActionEntry;
}

describe('compileGate', () => {
  test('an action gate is the deny rule <ref>.gate at authorize', () => {
    expect(compileGate(registry, action({ gate: 'checkout' }))).toEqual([
      { rule: 'shop.pay.gate', key: 'shop.checkout', stage: 'authorize' },
      { rule: 'shop.gate', key: 'shop.checkout', stage: 'authorize' },
    ]);
  });

  test('a kill-switch gate is checked at admit', () => {
    const [gate] = compileGate(registry, action({ gate: 'halt' }));
    expect(gate).toEqual({ rule: 'shop.pay.gate', key: 'shop.halt', stage: 'admit' });
  });

  test('a module gate covers its actions, contributed ones included', () => {
    expect(compileGate(registry, action({}))).toEqual([
      { rule: 'shop.gate', key: 'shop.checkout', stage: 'authorize' },
    ]);
    const contributed = action({ ref: 'extra.thing', module: 'extra', contributedBy: 'shop' });
    expect(compileGate(registry, contributed)).toEqual([
      { rule: 'shop.gate', key: 'shop.checkout', stage: 'authorize' },
    ]);
  });

  test('a module without a gate and an action without one have none', () => {
    const open = buildRegistry(appOf([makeModule({ id: 'plain', flags })]));
    expect(compileGate(open, action({ ref: 'plain.go', module: 'plain' }))).toEqual([]);
  });

  test('a gate that names no flag is an internal error', () => {
    expect(() => compileGate(registry, action({ gate: 'missing' }))).toThrow(/not a flag/);
  });
});
