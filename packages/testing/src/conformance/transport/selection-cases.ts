import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** The selection limits of the second milestone (16.4.12): skipped under the marker `m2`. */
export function selectionCases(target: TransportTarget): void {
  test.skip('m2: a selection beyond the limits is refused before any row is read', async () => {
    const sent = await sendCall(target, {
      action: 'loans.loan.query',
      input: { first: 100_000 },
      caller: { subject: freshName('ada') },
    });
    expect(sent.decoded).toMatchObject({ ok: false, kind: 'validation' });
  });

  test.skip('m2: a selection path that repeats an entity type is refused (16.4.12)', async () => {
    const sent = await sendCall(target, {
      action: 'loans.loan.query',
      input: { include: ['book', 'loans', 'book'] },
      caller: { subject: freshName('ada') },
    });
    expect(sent.decoded).toMatchObject({ ok: false, kind: 'validation', code: 'core.validation' });
  });
}
