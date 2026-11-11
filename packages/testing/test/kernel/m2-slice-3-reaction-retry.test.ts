import { describe, test } from 'vitest';
import { bootReactions } from './support/reactions-kit.ts';
import { runSliceThree } from './support/slice-three.ts';

describe('SLICE M2-3: reactions retry per tenant and never delay another tenant', () => {
  test.each(['memory', 'pglite'] as const)('on %s', { timeout: 60_000 }, async (adapter) => {
    const kit = await bootReactions({ adapter, watched: true });
    try {
      await runSliceThree(kit);
    } finally {
      await kit.stop();
    }
  });
});
