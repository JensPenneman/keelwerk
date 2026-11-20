import { afterEach, describe, expect, test } from 'vitest';
import { bootQueues, stopQueues } from './support/erasure-queues-kit.ts';
import { queuesControl } from './support/erasure-queues-module.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

afterEach(stopQueues);

const marker = 'queues marker address';

type Booted = Awaited<ReturnType<typeof bootQueues>>;

/** The history rows of the jobs of one queue, as stored: outcome and the closed error code. */
async function historyOf(booted: Booted, queue: string) {
  return (await booted.framework('kw_job_history'))
    .filter((row) => row.queue === queue)
    .map((row) => ({
      outcome: String(row.outcome),
      code: (typeof row.error === 'string' ? JSON.parse(row.error) : row.error)?.code as
        | string
        | undefined,
    }));
}

/** The lines that say a job ended unrun after an erasure: one for each such job, and none names the subject. */
function endedLines(booted: Booted): string[] {
  const ended = booted.lines.filter((line) => line.message.includes('ended without running'));
  expect(ended.map((line) => line.level)).toEqual(['info']);
  expect(JSON.stringify(ended)).not.toContain(booted.subject);
  return ended.map((line) => String(line.fields.queue));
}

const receiptsOf = async (booted: Booted, action: string) =>
  (await booted.rowsOf('core.commandReceipt')).filter((row) => row.action === action);

describe('a job whose personal key is destroyed ends without running (14.7.5, D8)', () => {
  test('a timer set for a subject who is erased before it fires ends succeeded: no receipt, nothing decided', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    await booted.operator.invoke('queues.arm', {
      ownerId: booted.subject as never,
      address: marker,
      runs: false,
    });
    // The timer holds the address sealed under the subject's key, never as text.
    const waiting = (await booted.framework('kw_jobs')).filter((row) => row.queue === 'timers');
    expect(waiting).toHaveLength(1);
    expect(JSON.stringify(waiting)).toContain('$kwe');
    expect(JSON.stringify(waiting)).not.toContain(marker);

    await booted.erase(booted.subject);
    await booted.later({ hours: 2 });

    expect(await historyOf(booted, 'timers')).toEqual([{ outcome: 'succeeded', code: undefined }]);
    expect((await booted.framework('kw_jobs')).filter((row) => row.queue === 'timers')).toEqual([]);
    expect(queuesControl.decided).toEqual([]);
    expect(await receiptsOf(booted, 'queues.hold')).toEqual([]);
    expect(endedLines(booted)).toEqual(['timers']);
  });

  test('the same timer for a subject who is alive opens and runs its command', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    await booted.operator.invoke('queues.arm', {
      ownerId: booted.subject as never,
      address: marker,
      runs: true,
    });
    await booted.later({ hours: 2 });
    expect(queuesControl.decided).toEqual(['queues.accept']);
    expect(await historyOf(booted, 'timers')).toEqual([{ outcome: 'succeeded', code: undefined }]);
    expect(await receiptsOf(booted, 'queues.accept')).toHaveLength(1);
  });

  test('a command job of another principal about the erased subject ends failed with core.key_destroyed, and so does its receipt', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    const accepted = await booted.operator.invoke(
      'queues.hold',
      { ownerId: booted.subject as never, address: marker },
      { prefer: 'async' },
    );
    const commandId = String((accepted as { commandId: string }).commandId);
    await booted.runtime.drainJobs();
    // The first attempt decided and failed with a retryable error: the job waits for its retry.
    expect(queuesControl.decided).toEqual(['queues.hold']);

    await booted.erase(booted.subject);
    await booted.later({ hours: 48 });

    // The second attempt never decided: the input could not be opened, and nothing retried it.
    expect(queuesControl.decided).toEqual(['queues.hold']);
    const receipt = await booted.inTenant((unit) => unit.receipts.get(commandId));
    expect(receipt?.status).toBe('failed');
    expect(receipt?.outcome).toMatchObject({ ok: false, error: { code: 'core.key_destroyed' } });
    const history = (await historyOf(booted, 'commands')).filter(
      (row) => row.code === 'core.key_destroyed',
    );
    expect(history).toEqual([{ outcome: 'failed', code: 'core.key_destroyed' }]);
    expect(
      (await booted.framework('kw_jobs')).filter((row) =>
        JSON.stringify(row).includes('queues.hold'),
      ),
    ).toEqual([]);
    expect(endedLines(booted)).toEqual(['commands']);
  });

  test('an effect with a sealed input ends failed with core.key_destroyed, and no effect stays requested', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    const opened = await booted.operator.invoke('queues.open', {
      ownerId: booted.subject as never,
      topic: 'queues marker topic',
    });
    const ticketId = String((opened as { ticketId: string }).ticketId);
    await booted.operator.invoke('queues.send', { ticketId: ticketId as never, to: marker });
    await booted.runtime.drainJobs();
    // The first attempt ran the executor, which was not reachable: the effect waits for its retry.
    expect(queuesControl.executed).toBe(1);
    expect((await booted.rowsOf('core.effect')).map((row) => row.status)).toEqual(['requested']);

    await booted.erase(booted.subject);
    await booted.later({ hours: 2 });

    expect(queuesControl.executed).toBe(1);
    const effects = await booted.rowsOf('core.effect');
    expect(effects.map((row) => row.status)).toEqual(['failed']);
    expect(JSON.stringify(effects)).toContain('core.key_destroyed');
    expect(JSON.stringify(effects)).not.toContain(marker);
    expect(endedLines(booted)).toEqual(['queues-mail']);
  });

  test('an effect whose subject is erased before its executor ran ends failed with core.key_destroyed, and the executor never runs', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    const opened = await booted.operator.invoke('queues.open', {
      ownerId: booted.subject as never,
      topic: 'queues marker topic',
    });
    const ticketId = String((opened as { ticketId: string }).ticketId);
    await booted.operator.invoke('queues.sendAt', {
      ticketId: ticketId as never,
      to: marker,
      at: booted.start.add({ hours: 1 }),
    });
    await booted.runtime.drainJobs();
    expect(queuesControl.executed).toBe(0);
    expect((await booted.rowsOf('core.effect')).map((row) => row.status)).toEqual(['requested']);

    await booted.erase(booted.subject);
    await booted.later({ hours: 2 });

    expect(queuesControl.executed).toBe(0);
    const effects = await booted.rowsOf('core.effect');
    expect(effects.map((row) => row.status)).toEqual(['failed']);
    expect(JSON.stringify(effects)).toContain('core.key_destroyed');
    expect(JSON.stringify(effects)).not.toContain(marker);
    // One line for the one job that ended; the count is pinned where the attempt begins.
    expect(endedLines(booted)).toEqual(['queues-mail']);
  });

  test('a reaction that runs after the erasure sees the event without the personal member, and no plaintext', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    await booted.operator.invoke('queues.open', {
      ownerId: booted.subject as never,
      topic: 'queues marker topic',
    });
    await booted.dispatcher.settled();
    await booted.runtime.drainJobs();
    // The first attempt saw the value and failed with a retryable error.
    expect(queuesControl.seen).toHaveLength(1);
    expect(queuesControl.seen[0]).toContain('queues marker topic');

    await booted.erase(booted.subject);
    await booted.later({ hours: 2 });

    expect(queuesControl.seen).toHaveLength(2);
    expect(queuesControl.seen[1]).not.toContain('queues marker topic');
    expect(JSON.parse(queuesControl.seen[1] ?? '{}')).toMatchObject({ current: null });
  });
});
