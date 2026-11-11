import { describe, expect, test } from 'vitest';
import { checkPrincipalFromRef } from './check-principal-from-ref.ts';
import type { ComposableApp } from './composable-app.ts';
import type { Registry } from './registry.ts';

const app = {} as ComposableApp;

function registryOf(executions: readonly string[], fills: readonly unknown[]): Registry {
  return {
    actions: new Map(executions.map((execution, index) => [`m.a${index}`, { execution }])),
    fills: new Map([
      [
        'core.principalResolvers',
        fills.map((fill) => ({
          point: 'core.principalResolvers',
          module: 'auth',
          bound: false,
          fill,
        })),
      ],
    ]),
  } as unknown as Registry;
}

const withRef = { id: 'auth.session', resolve: () => undefined, fromRef: () => undefined };
const withoutRef = { id: 'keys.bearer', resolve: () => undefined };

describe('checkPrincipalFromRef', () => {
  test('warns for a resolver without fromRef when an action runs asynchronously', () => {
    const problems = checkPrincipalFromRef(
      app,
      registryOf(['sync', 'async'], [withRef, withoutRef]),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'principalFromRefMissing',
        severity: 'warning',
        ref: 'keys.bearer',
        module: 'auth',
      }),
    ]);
  });

  test('an either action counts as asynchronous', () => {
    expect(checkPrincipalFromRef(app, registryOf(['either'], [withoutRef]))).toHaveLength(1);
  });

  test('says nothing when every action is synchronous or every resolver has fromRef', () => {
    expect(checkPrincipalFromRef(app, registryOf(['sync'], [withoutRef]))).toEqual([]);
    expect(checkPrincipalFromRef(app, registryOf(['async'], [withRef]))).toEqual([]);
  });

  test('leaves a bound fill alone: the check never builds it', () => {
    let built = 0;
    const bound = {
      point: 'core.principalResolvers',
      module: 'auth',
      bound: true,
      fill: () => {
        built += 1;
        return [withoutRef];
      },
    };
    const registry = {
      actions: new Map([['m.a', { execution: 'async' }]]),
      fills: new Map([['core.principalResolvers', [bound]]]),
    } as unknown as Registry;
    expect(checkPrincipalFromRef(app, registry)).toEqual([]);
    expect(built).toBe(0);
  });
});
