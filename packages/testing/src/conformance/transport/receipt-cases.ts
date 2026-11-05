import { commandReceiptId } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { loansOf } from './loans-of.ts';
import { originOf } from './origin-of.ts';
import { requestHeaders } from './request-headers.ts';
import { responseRecord } from './response-record.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** Asynchronous acceptance (S-24): 202 and the receipt, with the `Location` of the stored receipt on REST (the protocol's envelope has no place for one). */
export function receiptCases(target: TransportTarget): void {
  test('a command that prefers async answers 202 with its receipt and has not run', async () => {
    const ada = freshName('ada');
    const commandId = crypto.randomUUID();
    const sent = await sendCall(
      target,
      lendCall(ada, freshName('Dune'), { commandId, prefer: 'async' }),
    );
    expect(sent.decoded).toEqual({
      ok: true,
      value: { commandId, status: 'accepted' },
      accepted: true,
    });
    expect(sent.response.status).toBe(202);
    expect(sent.response.headers.get('preference-applied')).toBe('respond-async');
    expect(await loansOf(target, ada)).toEqual([]);
  });

  test('the 202 body carries the receipt of the command', async () => {
    const commandId = crypto.randomUUID();
    const sent = await sendCall(
      target,
      lendCall(freshName('ada'), freshName('Emma'), { commandId, prefer: 'async' }),
    );
    expect(sent.response.status).toBe(202);
    const body = responseRecord(sent.body);
    const receipt = responseRecord(body?.receipt) ?? body;
    expect(receipt?.commandId).toBe(commandId);
  });

  test.skipIf(target.codec.expectedReceiptLocation('x') === null)(
    'the answer names where the stored receipt of the tenant and the command is',
    async () => {
      const commandId = crypto.randomUUID();
      const sent = await sendCall(
        target,
        lendCall(freshName('ada'), freshName('Emma'), { commandId, prefer: 'async' }),
      );
      const tenant = target.tenants.acme;
      expect(target.codec.receiptLocationOf(sent)).toBe(
        target.codec.expectedReceiptLocation(commandReceiptId(tenant?.id ?? '', commandId)),
      );
    },
  );

  test.skipIf(target.codec.expectedReceiptLocation('x') === null)(
    'the submitter follows the Location to its receipt and another principal does not',
    async () => {
      const ada = freshName('ada');
      const commandId = crypto.randomUUID();
      const sent = await sendCall(
        target,
        lendCall(ada, freshName('Emma'), { commandId, prefer: 'async' }),
      );
      const location = target.codec.receiptLocationOf(sent);
      expect(location).not.toBeNull();
      const follow = (subject: string): Promise<Response> => {
        const caller = { subject };
        return target.fetch(
          new Request(`${originOf(target, caller)}${location}`, {
            method: 'GET',
            headers: requestHeaders(caller),
          }),
        );
      };
      const own = await follow(ada);
      expect(own.status).toBe(200);
      const receipt = responseRecord(await own.json());
      expect(receipt?.commandId).toBe(commandId);
      expect(receipt?.status).toBe('accepted');
      const other = await follow(freshName('eve'));
      expect(other.status).toBe(404);
      expect(responseRecord(await other.json())?.code).toBe('core.not_found');
    },
  );

  test.skipIf(target.codec.expectedReceiptLocation('x') === null)(
    "the submitter's Location sent to another tenant's domain finds no receipt",
    async () => {
      const ada = freshName('ada');
      const sent = await sendCall(
        target,
        lendCall(ada, freshName('Emma'), { commandId: crypto.randomUUID(), prefer: 'async' }),
      );
      const location = target.codec.receiptLocationOf(sent);
      expect(location).not.toBeNull();
      const caller = { subject: ada, tenant: 'globex' };
      const response = await target.fetch(
        new Request(`${originOf(target, caller)}${location}`, {
          method: 'GET',
          headers: requestHeaders(caller),
        }),
      );
      expect(response.status).toBe(404);
      expect(responseRecord(await response.json())?.code).toBe('core.not_found');
    },
  );

  test.skipIf(target.codec.expectedReceiptLocation('x') === null)(
    "an anonymous caller following the submitter's Location finds no receipt",
    async () => {
      const sent = await sendCall(
        target,
        lendCall(freshName('ada'), freshName('Emma'), {
          commandId: crypto.randomUUID(),
          prefer: 'async',
        }),
      );
      const location = target.codec.receiptLocationOf(sent);
      expect(location).not.toBeNull();
      const caller = { subject: null };
      const response = await target.fetch(
        new Request(`${originOf(target, caller)}${location}`, {
          method: 'GET',
          headers: requestHeaders(caller),
        }),
      );
      expect(response.status).toBe(404);
      expect(responseRecord(await response.json())?.code).toBe('core.not_found');
    },
  );

  test('the same command id answers the same receipt again', async () => {
    const ada = freshName('ada');
    const commandId = crypto.randomUUID();
    const title = freshName('Hamlet');
    const first = await sendCall(target, lendCall(ada, title, { commandId, prefer: 'async' }));
    const second = await sendCall(target, lendCall(ada, title, { commandId, prefer: 'async' }));
    expect(second.decoded).toEqual(first.decoded);
  });

  test('a command that does not ask for async runs inside the request', async () => {
    const ada = freshName('ada');
    const sent = await sendCall(target, lendCall(ada, freshName('Odyssey'), { prefer: 'sync' }));
    expect(sent.response.status).toBe(200);
    expect(await loansOf(target, ada)).toHaveLength(1);
  });
}
