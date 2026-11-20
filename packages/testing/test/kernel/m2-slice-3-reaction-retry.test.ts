import { describe, test } from 'vitest';
import { bootReactions, reactionsStart } from './support/reactions-kit.ts';
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

  // Full jitter includes zero (architecture 9.5.4): a draw below 1/20001 makes the delay of attempt 2
  // zero, so the retry is due at the pinned instant. The slice must hold whatever the process draws.
  test.each(['memory', 'pglite'] as const)(
    'a retry the process would draw at zero at the pinned instant still waits, on %s',
    { timeout: 60_000 },
    async (adapter) => {
      const saved = Math.random;
      let clockOf: (() => Temporal.Instant) | undefined;
      const pinned = reactionsStart.add({ seconds: 11 });
      Math.random = () => (clockOf?.().equals(pinned) === true ? 1 / 30_000 : 0.999);
      try {
        const kit = await bootReactions({ adapter, watched: true });
        clockOf = kit.now;
        try {
          await runSliceThree(kit);
        } finally {
          await kit.stop();
        }
      } finally {
        Math.random = saved;
      }
    },
  );
});
