import { expect, test } from 'vitest';
import { dueAt } from './due-at.ts';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { loansOf } from './loans-of.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** Idempotent replay (16.4.8): the command id makes a retry harmless, and a different request under the same id is refused. */
export function idempotencyCases(target: TransportTarget): void {
  test('a replay answers the recorded output and writes nothing twice', async () => {
    const ada = freshName('ada');
    const commandId = crypto.randomUUID();
    const title = freshName('Dune');
    const first = await sendCall(target, lendCall(ada, title, { commandId }));
    const second = await sendCall(target, lendCall(ada, title, { commandId }));
    expect(second.decoded).toEqual(first.decoded);
    expect(second.response.status).toBe(200);
    expect(await loansOf(target, ada)).toHaveLength(1);
  });

  // The protocol's envelope has no replay member (16.8.2); REST marks a replay with `Idempotent-Replayed`.
  test.skipIf(!target.codec.marksReplays)(
    'a replay is marked and the first answer is not',
    async () => {
      const commandId = crypto.randomUUID();
      const title = freshName('Dune');
      const ada = freshName('ada');
      const first = await sendCall(target, lendCall(ada, title, { commandId }));
      const second = await sendCall(target, lendCall(ada, title, { commandId }));
      expect(target.codec.isReplay(first)).toBe(false);
      expect(target.codec.isReplay(second)).toBe(true);
    },
  );

  test('the command id the client chose is the one the transport reports', async () => {
    const commandId = crypto.randomUUID();
    const sent = await sendCall(
      target,
      lendCall(freshName('ada'), freshName('Emma'), { commandId }),
    );
    expect(sent.decoded.ok).toBe(true);
    expect(target.codec.commandIdOf(sent)).toBe(
      target.codec.reportsChosenCommandId ? commandId : null,
    );
  });

  test('a command without an id gets one from the transport, and the answer reports it', async () => {
    const sent = await sendCall(target, lendCall(freshName('ada'), freshName('Odyssey')));
    expect(target.codec.commandIdOf(sent)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('the same id with another input is an idempotency mismatch', async () => {
    const ada = freshName('ada');
    const commandId = crypto.randomUUID();
    await sendCall(target, lendCall(ada, freshName('Hamlet'), { commandId }));
    const other = await sendCall(target, {
      action: 'loans.lend',
      input: { bookTitle: 'Macbeth', dueAt },
      caller: { subject: ada },
      commandId,
    });
    expect(other.decoded).toEqual({
      ok: false,
      kind: 'conflict',
      code: 'core.idempotency_mismatch',
    });
    expect(other.response.status).toBe(422);
  });

  test('a failed command is replayed as the same failure', async () => {
    const ada = freshName('ada');
    const title = freshName('Dune');
    await sendCall(target, lendCall(ada, title));
    const commandId = crypto.randomUUID();
    const first = await sendCall(target, lendCall(ada, title, { commandId }));
    const second = await sendCall(target, lendCall(ada, title, { commandId }));
    expect(first.decoded).toEqual({ ok: false, kind: 'conflict', code: 'loans.already_lent' });
    expect(second.decoded).toEqual(first.decoded);
  });
}
