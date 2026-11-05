import { describe, expect, test } from 'vitest';
import type { CliHost } from '../src/context/cli-host.ts';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const receiptId = 'rcpt_01j0000000000000000000000a';
const register = [
  'call',
  'accounts.register',
  '--display-name',
  'J',
  '--email',
  'j@x.io',
  '--async',
];

interface Script {
  /** The statuses `core.commandReceipt.get` answers in turn; the last repeats. */
  readonly statuses: readonly string[];
  /** The answer when the original request is sent again. */
  readonly replay?: Response;
  /** Leaves `receiptId` out of the accepted answer. */
  readonly withoutReceiptId?: boolean;
  /** The receipt is gone. */
  readonly gone?: boolean;
}

/** A deployment that accepts the command, reports the scripted statuses and answers the replay. */
function deployment(script: Script) {
  const reads: unknown[] = [];
  const invoked: Record<string, unknown>[] = [];
  let turn = 0;
  const handler = portalServer({
    invoke: (body) => {
      invoked.push(body);
      if (body.action === 'core.commandReceipt.get') {
        reads.push(body.input);
        if (script.gone === true)
          return json({ ok: true, value: { list: [], notFound: [receiptId] } });
        const status = script.statuses[Math.min(turn, script.statuses.length - 1)];
        turn += 1;
        return json({
          ok: true,
          value: { list: [{ commandId: body.commandId, status }], notFound: [] },
        });
      }
      if (invoked.filter((one) => one.action === body.action).length > 1) {
        return script.replay ?? json({ ok: true, value: { done: true } });
      }
      return json({
        ok: true,
        value: null,
        receipt: { commandId: String(body.commandId), status: 'accepted' },
        ...(script.withoutReceiptId === true ? {} : { receiptId }),
      });
    },
  });
  return { handler, reads, invoked };
}

/** A host whose clock only moves when the CLI sleeps. */
function clocked(fake: ReturnType<typeof createFakeHost>, onSleep?: () => void): CliHost {
  let elapsed = 0;
  return {
    ...fake.host,
    now: () => fake.host.now() + elapsed,
    sleep: async (milliseconds) => {
      fake.sleeps.push(milliseconds);
      elapsed += milliseconds;
      onSleep?.();
    },
  };
}

function run(script: Script, extra: readonly string[], signal?: AbortSignal, onSleep?: () => void) {
  const served = deployment(script);
  const fake = createFakeHost({ files: remoteProfileFiles, handler: served.handler });
  const pending = runCliWith(
    [...register, ...extra, '--output', 'json'],
    clocked(fake, onSleep),
    signal,
  );
  return pending.then((result) => ({ ...result, ...served, sleeps: fake.sleeps }));
}

describe('--wait', () => {
  test('polls the receipt 250 ms apart, doubling, then sends the request again and prints its value', async () => {
    const result = await run({ statuses: ['pending', 'accepted', 'accepted', 'completed'] }, [
      '--wait',
    ]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ done: true });
    expect(result.sleeps).toEqual([250, 500, 1000]);
    expect(result.reads).toEqual([
      { ids: [receiptId] },
      { ids: [receiptId] },
      { ids: [receiptId] },
      { ids: [receiptId] },
    ]);
    const sent = result.invoked.filter((body) => body.action === 'accounts.register');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.commandId).toBe(sent[0]?.commandId);
    expect(sent[1]?.input).toEqual(sent[0]?.input);
  });

  test('a failed receipt replays the stored error and the command exits with its kind', async () => {
    const replay = json({
      ok: false,
      error: {
        kind: 'conflict',
        code: 'accounts.email_taken',
        message: 'This e-mail address is already in use.',
        requestId: 'r1',
        retryable: false,
      },
    });
    const result = await run({ statuses: ['accepted', 'failed'], replay }, ['--wait']);
    expect(result.code).toBe(7);
    expect(result.stderr).toContain('accounts.email_taken');
    expect(result.stdout).toBe('');
  });

  test('a receipt that is not there is cli.receipt_not_found (6)', async () => {
    const result = await run({ statuses: [], gone: true }, ['--wait']);
    expect(result.code).toBe(6);
    expect(result.stderr).toContain('cli.receipt_not_found');
  });

  test('past the limit the receipt is printed and the command ends with cli.wait_timeout (10)', async () => {
    const result = await run({ statuses: ['accepted'] }, ['--wait', '1']);
    expect(result.code).toBe(10);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'accepted' });
    expect(result.stderr).toContain('cli.wait_timeout');
    expect(result.sleeps).toEqual([250, 500, 250]);
    expect(result.invoked.filter((body) => body.action === 'accounts.register')).toHaveLength(1);
  });

  test('an answer without a receipt id is cli.wait_unavailable (11) and nothing is polled', async () => {
    const result = await run({ statuses: ['completed'], withoutReceiptId: true }, ['--wait']);
    expect(result.code).toBe(11);
    expect(result.stderr).toContain('cli.wait_unavailable');
    expect(result.reads).toEqual([]);
  });

  test('without a value the wait has no limit: the pause stops doubling at 2 s', async () => {
    const statuses = [...Array.from({ length: 8 }, () => 'accepted'), 'completed'];
    const result = await run({ statuses }, ['--wait']);
    expect(result.code).toBe(0);
    expect(result.sleeps).toEqual([250, 500, 1000, 2000, 2000, 2000, 2000, 2000]);
  });

  test('Ctrl-C ends the wait with 130', async () => {
    const controller = new AbortController();
    const result = await run({ statuses: ['accepted'] }, ['--wait'], controller.signal, () =>
      controller.abort(),
    );
    expect(result.code).toBe(130);
    expect(result.stdout).toBe('');
  });

  test('without --wait the receipt is printed and nothing is polled', async () => {
    const result = await run({ statuses: ['completed'] }, []);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'accepted' });
    expect(result.reads).toEqual([]);
  });
});
