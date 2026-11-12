import { parseSealedValueText } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { bootQueues, stopQueues } from './support/erasure-queues-kit.ts';

afterEach(stopQueues);

type Booted = Awaited<ReturnType<typeof bootQueues>>;

const sealedTextOf = (row: Record<string, unknown>): string => {
  const found = /kwv1\.[^."\\]+\.[^."\\]+\.[^."\\]+/.exec(JSON.stringify(row.input));
  if (found === null) throw new Error(`no sealed text in ${JSON.stringify(row.input)}`);
  return found[0];
};

const principalOf = (row: Record<string, unknown>): string => {
  const principal = typeof row.principal === 'string' ? JSON.parse(row.principal) : row.principal;
  return String((principal as { principalId?: unknown }).principalId);
};

/** Whether the value key a stored `kwv1` text names still opens it. */
const opens = (booted: Booted, text: string): Promise<boolean> => {
  const sealed = parseSealedValueText(text);
  if (sealed === undefined) throw new Error('not a sealed text');
  return booted.inTenant(async (unit) => (await unit.keys.openValue(sealed)) !== undefined);
};

const tombstonedKeys = async (booted: Booted): Promise<string[]> => {
  const entries = await booted.runtime.control.adapter.unit(
    booted.runtime.control.namespace,
    { level: 'deployment' },
    (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
    { readOnly: true },
  );
  return entries.flatMap(({ record }) => (record.type === 'keyTombstone' ? [record.keyId] : []));
};

describe('the jobs an erasure purges (14.7.5 step 5a, D7)', () => {
  test("the subject's own command job is purged and the value key of its secret is destroyed and tombstoned; another principal's job keeps its key", {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    await booted
      .userClient(booted.subject)
      .invoke('queues.stash', { note: 'own stash marker' as never }, { prefer: 'async' });
    await booted.operator.invoke(
      'queues.stash',
      { note: 'operator stash marker' as never },
      { prefer: 'async' },
    );
    await booted.runtime.drainJobs();
    const stashes = (await booted.framework('kw_jobs')).filter((row) =>
      JSON.stringify(row.input).includes('queues.stash'),
    );
    expect(stashes).toHaveLength(2);
    const own = stashes.find((row) => principalOf(row) === booted.subject);
    const other = stashes.find((row) => principalOf(row) !== booted.subject);
    if (own === undefined || other === undefined) throw new Error('the two jobs are not there');
    const [ownText, otherText] = [sealedTextOf(own), sealedTextOf(other)];
    expect(await opens(booted, ownText)).toBe(true);
    expect(await opens(booted, otherText)).toBe(true);

    await booted.erase(booted.subject);

    const left = (await booted.framework('kw_jobs')).filter((row) =>
      JSON.stringify(row.input).includes('queues.stash'),
    );
    expect(left).toHaveLength(1);
    expect(sealedTextOf(left[0] ?? {})).toBe(otherText);
    // The secret of the purged job can no longer be opened, and its key id is in the control ledger.
    expect(await opens(booted, ownText)).toBe(false);
    const ownKey = parseSealedValueText(ownText)?.keyId ?? '';
    const otherKey = parseSealedValueText(otherText)?.keyId ?? '';
    expect(await tombstonedKeys(booted)).toContain(ownKey);
    // The job of the other principal is not the subject's to take down.
    expect(await opens(booted, otherText)).toBe(true);
    expect(await tombstonedKeys(booted)).not.toContain(otherKey);
  });

  test('a timer the subject caused, which the module runs, is kept; it ends when it fires', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootQueues();
    // The subject's own request sets the timer; the job runs as the module, with the subject as the cause.
    await booted.userClient(booted.subject).invoke('queues.arm', {
      ownerId: booted.subject as never,
      address: 'caused timer marker',
      runs: true,
    });
    const timers = () =>
      booted.framework('kw_jobs').then((rows) => rows.filter((row) => row.queue === 'timers'));
    expect(await timers()).toHaveLength(1);

    await booted.erase(booted.subject);

    expect(await timers()).toHaveLength(1);
    await booted.later({ hours: 2 });
    expect(await timers()).toEqual([]);
    expect((await booted.framework('kw_job_history')).map((row) => row.outcome)).toContain(
      'succeeded',
    );
  });
});
