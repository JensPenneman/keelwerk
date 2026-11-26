import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';
import { m2ComposeChecks } from './m2-compose-checks.ts';

const stop = { kind: 'boolean', default: true, purpose: 'kill-switch' } as const;

function problemsOf(flag: unknown) {
  const app = appOf([makeModule({ id: 'shop', flags: { stop: flag as never } })]);
  return m2ComposeChecks.flatMap((check) => check(app, buildRegistry(app)));
}

describe('checkKillSwitchDeclarations', () => {
  test('a kill switch at the level of the principal does not compose', () => {
    expect(problemsOf(defineFlag({ ...stop, level: 'principal' }))).toEqual([
      expect.objectContaining({ code: 'killSwitchInvalid', severity: 'error', ref: 'shop.stop' }),
    ]);
  });

  test('a kill switch that is not boolean does not compose', () => {
    const others = [
      { kind: 'string', default: 'on' },
      { kind: 'number', default: 1 },
      { kind: 'variant', variants: ['on', 'off'], default: 'on' },
      { kind: 'json', schema: shape({}), default: {} },
    ] as const;
    for (const other of others) {
      const declared = defineFlag({ ...other, purpose: 'kill-switch', level: 'tenant' });
      expect(problemsOf(declared)).toEqual([
        expect.objectContaining({ code: 'killSwitchInvalid', ref: 'shop.stop' }),
      ]);
    }
  });

  test('a boolean kill switch of the level deployment, backend or tenant composes, and so does a principal-level flag of another purpose', () => {
    for (const level of ['deployment', 'backend', 'tenant'] as const) {
      expect(problemsOf(defineFlag({ ...stop, level }))).toEqual([]);
    }
    expect(
      problemsOf(
        defineFlag({ kind: 'boolean', default: false, purpose: 'operational', level: 'principal' }),
      ),
    ).toEqual([]);
  });
});
