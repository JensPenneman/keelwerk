import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** The scenario that needs the effect wait of `@keelwerk/events` (S-39): skipped under the marker `m2`. */
export function waitEffectsCases(target: TransportTarget): void {
  test.skip('m2: waiting for the effects of a command returns when they are done', async () => {
    const sent = await sendCall(
      target,
      lendCall(freshName('ada'), freshName('Odyssey'), { prefer: 'async' }),
    );
    expect(sent.decoded).toMatchObject({ ok: true, accepted: true });
    const done = await sendCall(target, {
      action: 'core.effects.wait',
      input: { ids: [] },
      caller: { subject: freshName('ada') },
    });
    expect(done.decoded.ok).toBe(true);
  });
}
