import { describe, expect, test } from 'vitest';
import { createFlagChain } from './create-flag-chain.ts';
import type { FlagProvider } from './flag-provider.ts';

const deployed: FlagProvider = {
  id: 'vendor',
  sync: true,
  start: () => Promise.resolve(),
  resolve: () => undefined,
};

describe('createFlagChain', () => {
  test("core.targeting first, the deployment's providers next, env last outside production", () => {
    for (const environment of ['development', 'test'] as const) {
      const chain = createFlagChain({ providers: [deployed], environment, env: {} });
      expect(chain.map((provider) => provider.id)).toEqual(['core.targeting', 'vendor', 'env']);
    }
  });

  test('production has no env provider', () => {
    const chain = createFlagChain({ providers: [deployed], environment: 'production', env: {} });
    expect(chain.map((provider) => provider.id)).toEqual(['core.targeting', 'vendor']);
  });
});
