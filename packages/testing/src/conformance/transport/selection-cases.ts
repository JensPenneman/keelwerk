import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/**
 * The selection limits of the second milestone (16.4.12): they apply to a transport whose request
 * can follow relations (the codec's `followsRelations`), and are skipped for the others. A dotted
 * path in `properties` is the abstract selection that follows reference fields (decision D5 of the
 * GraphQL transport): the codec turns it into the transport's own selection.
 */
export function selectionCases(target: TransportTarget): void {
  const follows = target.codec.followsRelations === true;

  test.skipIf(!follows)(
    'a selection beyond the limits is refused before any row is read',
    async () => {
      const subject = freshName('ada');
      const lent = await sendCall(target, lendCall(subject, freshName('Dune')));
      expect(lent.decoded.ok).toBe(true);
      const sent = await sendCall(target, {
        action: 'loans.loan.query',
        input: { properties: Array.from({ length: 1001 }, () => 'bookTitle') },
        caller: { subject },
      });
      expect(sent.decoded).toMatchObject({
        ok: false,
        kind: 'validation',
        code: 'core.validation',
      });
      // The limit itself is what refused it, not some other validation failure.
      expect(JSON.stringify(sent.body)).toMatch(/cost limit/);
    },
  );

  test.skipIf(!follows)(
    'a selection path that repeats an entity type is refused (16.4.12)',
    async () => {
      const sent = await sendCall(target, {
        action: 'loans.loan.query',
        input: { properties: ['bookId.relatedTo.title'] },
        caller: { subject: freshName('ada') },
      });
      expect(sent.decoded).toMatchObject({
        ok: false,
        kind: 'validation',
        code: 'core.validation',
      });
      expect(JSON.stringify(sent.body)).toMatch(/repeats the entity type/);
    },
  );
}
