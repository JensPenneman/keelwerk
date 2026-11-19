import { newUuidV7, renderTypeId } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/**
 * The scenario of the effect wait (7.9.5, 16.4.7) that every transport with a stream can show: the
 * status watch of an effect the caller never requested opens with `head` and no status, which is how a
 * client learns the id is not found. The round trip of a real effect (a status that settles) is pinned
 * in the client's and the command line's tests.
 */
export function waitEffectsCases(target: TransportTarget): void {
  const { codec } = target;
  const skip = codec.subscribe === undefined || target.live !== true;

  test.skipIf(skip)(
    'the status watch of an effect the caller never requested opens with head and no status',
    async () => {
      if (codec.subscribe === undefined) throw new Error('The codec has no stream endpoint.');
      const ada = freshName('ada');
      const lent = await sendCall(target, lendCall(ada, freshName('Odyssey')));
      expect(lent.decoded.ok).toBe(true);
      // The precondition of the case: `loans.lend` starts no effect, so the id below is one nobody requested.
      expect(lent.response.headers.get('keelwerk-effects')).toBeNull();
      expect(
        typeof lent.body === 'object' && lent.body !== null ? 'effects' in lent.body : false,
      ).toBe(false);
      const stream = await codec.subscribe(target, {
        action: 'core.effectStatusWatch',
        input: { ids: [renderTypeId('eff', newUuidV7())] },
        caller: { subject: ada },
      });
      try {
        expect(stream.response.status).toBe(200);
        const frames = await stream.until((frame) => frame.event === 'head');
        expect(frames.at(-1)?.event).toBe('head');
        expect(frames.filter((frame) => frame.event === 'data')).toHaveLength(0);
      } finally {
        await stream.close();
      }
    },
  );
}
