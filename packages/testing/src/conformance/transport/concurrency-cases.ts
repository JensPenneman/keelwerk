import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { loansOf } from './loans-of.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/**
 * Concurrent duplicates (16.4.8): requests in flight at once meet in the scope's unit queue, so
 * the second replays the first; a duplicate of a command that was accepted and has not finished is
 * told the command is still running. M1 has no worker, so an accepted command stays unfinished,
 * which holds the first command's receipt open for as long as the test needs.
 */
export function concurrencyCases(target: TransportTarget): void {
  test('two requests with one command id queue behind each other: one runs, the other replays it', async () => {
    const ada = freshName('ada');
    const commandId = crypto.randomUUID();
    const title = freshName('Dune');
    const answers = await Promise.all([
      sendCall(target, lendCall(ada, title, { commandId })),
      sendCall(target, lendCall(ada, title, { commandId })),
    ]);
    expect(answers.map((sent) => sent.decoded.ok)).toEqual([true, true]);
    expect(new Set(answers.map((sent) => JSON.stringify(sent.decoded))).size).toBe(1);
    expect(await loansOf(target, ada)).toHaveLength(1);
  });

  test.skipIf(!target.codec.marksReplays)(
    'of two requests with one command id, exactly one is marked a replay',
    async () => {
      const ada = freshName('ada');
      const commandId = crypto.randomUUID();
      const title = freshName('Dune');
      const answers = await Promise.all([
        sendCall(target, lendCall(ada, title, { commandId })),
        sendCall(target, lendCall(ada, title, { commandId })),
      ]);
      expect(answers.filter((sent) => target.codec.isReplay(sent))).toHaveLength(1);
    },
  );

  test('a duplicate of a command that is accepted and not finished is a conflict, retryable', async () => {
    const ada = freshName('ada');
    const commandId = crypto.randomUUID();
    const title = freshName('Ulysses');
    const first = await sendCall(target, lendCall(ada, title, { commandId, prefer: 'async' }));
    expect(first.decoded).toMatchObject({ ok: true, accepted: true });
    const duplicate = await sendCall(target, lendCall(ada, title, { commandId }));
    expect(duplicate.decoded).toEqual({
      ok: false,
      kind: 'conflict',
      code: 'core.command_in_progress',
    });
    expect(duplicate.response.status).toBe(409);
    expect(await loansOf(target, ada)).toEqual([]);
  });

  test('two different commands for one book: one runs, the other finds it lent', async () => {
    const ada = freshName('ada');
    const title = freshName('Emma');
    const answers = await Promise.all([
      sendCall(target, lendCall(ada, title)),
      sendCall(target, lendCall(ada, title)),
    ]);
    const codes = answers.map((sent) => (sent.decoded.ok ? 'ok' : sent.decoded.code)).toSorted();
    expect(codes).toEqual(['loans.already_lent', 'ok']);
    expect(await loansOf(target, ada)).toHaveLength(1);
  });
}
