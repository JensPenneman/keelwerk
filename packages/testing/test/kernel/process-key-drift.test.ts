import { processStreamRef } from '@keelwerk/core';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { bootReactions, relayOtherOwner, relayOwner } from './support/reactions-kit.ts';
import { relayControl } from './support/relay-control.ts';

const lines: LoggedLine[] = [];
const kit = await bootReactions({ watched: true, logger: recordingLogger(lines) });
afterAll(() => kit.stop());
afterEach(() => {
  relayControl.tallyKey = undefined;
});
const { runtime, spy } = kit;

const streamHolds = (owner: string) =>
  runtime.adapter.unit(
    runtime.namespace,
    kit.scopeOf('acme'),
    (unit) => unit.events.readStream(processStreamRef(kit.scopeOf('acme'), 'relay.tally', owner)),
    { readOnly: true },
  );

describe('the instance of a process (7.7)', () => {
  test('does not move with the row between the dispatch and the run: the job decides under the instance of its event', async () => {
    // No worker takes a reaction job until the row has changed.
    if (spy === undefined) throw new Error('the kit is not watched');
    spy.refuseTake = (queue) => queue === 'reactions';
    const sent = await kit.send('acme', { channel: 'drift' });
    if (!sent.ok) throw new Error('the signal was not written');
    await kit.dispatcher.settled();
    expect(spy.enqueued.some((one) => one.job.queue === 'reactions')).toBe(true);
    const moved = await kit.call('acme', 'relay.reassign', {
      signal: sent.value.signalId,
      owner: relayOtherOwner,
    });
    expect(moved.ok).toBe(true);
    spy.refuseTake = undefined;
    await kit.settle();
    const rows = (await kit.rows('acme', 'relay.echo')).filter(
      (row) => row.reaction === 'relay.tally' && row.channel === 'drift',
    );
    expect(rows).toHaveLength(1);
    // The stream is the one the event named, not the one the row moved to.
    expect(await streamHolds(relayOwner)).toHaveLength(1);
    expect(await streamHolds(relayOtherOwner)).toHaveLength(0);
    expect(spy.completions.filter((one) => one.outcome.kind === 'dead')).toEqual([]);
  });

  test('a job queued before the key function changed still decides on its own instance', async () => {
    if (spy === undefined) throw new Error('the kit is not watched');
    spy.refuseTake = (queue) => queue === 'reactions';
    const sent = await kit.send('acme', { channel: 'deploy' });
    if (!sent.ok) throw new Error('the signal was not written');
    await kit.dispatcher.settled();
    // A deploy changes the process's key function: it now names another instance.
    relayControl.tallyKey = relayOtherOwner;
    spy.refuseTake = undefined;
    await kit.settle();
    const rows = (await kit.rows('acme', 'relay.echo')).filter(
      (row) => row.reaction === 'relay.tally' && row.channel === 'deploy',
    );
    expect(rows).toHaveLength(1);
    const before = (await streamHolds(relayOwner)).length;
    expect(before).toBeGreaterThanOrEqual(1);
    expect(await streamHolds(relayOtherOwner)).toHaveLength(0);
    expect(spy.completions.filter((one) => one.outcome.kind === 'dead')).toEqual([]);
  });

  test('a job that runs after the erasure of its subject decides nothing, is logged', async () => {
    if (spy === undefined) throw new Error('the kit is not watched');
    const gone = '00000000-0000-4000-8000-0000000000c3';
    spy.refuseTake = (queue) => queue === 'reactions';
    const sent = await kit.send('acme', { channel: 'erased', owner: gone });
    if (!sent.ok) throw new Error('the signal was not written');
    await kit.dispatcher.settled();
    // The subject is erased between the dispatch and the run.
    const { runtime } = kit;
    await runtime.adapter.unit(runtime.namespace, kit.scopeOf('acme'), (unit) =>
      unit.keys.shred(gone),
    );
    spy.refuseTake = undefined;
    const completed = spy.completions.length;
    await kit.settle();
    const tallyJobs = new Set(
      spy.takes
        .flatMap((take) => take.jobs)
        .filter((job) => 'action' in job.run && job.run.action === 'relay.tally')
        .map((job) => job.id),
    );
    const tallyOutcomes = spy.completions
      .slice(completed)
      .filter((one) => tallyJobs.has(one.attempt.jobId))
      .map((one) => one.outcome.kind);
    expect(tallyOutcomes).toEqual(['succeeded']);
    expect(spy.completions.filter((one) => one.outcome.kind === 'dead')).toEqual([]);
    const tallies = (await kit.rows('acme', 'relay.echo')).filter(
      (row) => row.reaction === 'relay.tally' && row.channel === 'erased',
    );
    expect(tallies).toEqual([]);
    expect(
      await runtime.adapter.unit(
        runtime.namespace,
        kit.scopeOf('acme'),
        (unit) =>
          unit.events.readStream(processStreamRef(kit.scopeOf('acme'), 'relay.tally', gone)),
        { readOnly: true },
      ),
    ).toEqual([]);
    expect(
      lines.filter(
        (line) => line.message === 'a process job found its subject erased and decides nothing',
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain(gone);
  });
});
