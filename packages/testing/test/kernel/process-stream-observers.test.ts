import { defineApp } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { observer } from './support/observer-module.ts';
import { bootReactions, relayOwner, tenantEventsOf } from './support/reactions-kit.ts';
import type { RelayApp } from './support/relay-app.ts';
import { relay } from './support/relay-module.ts';
import { watch } from './support/watch-module.ts';

// The relay app plus a module whose reaction listens to `all`: the process `relay.tally` writes its
// events to a stream of its own, and no reaction may be given them.
const app = defineApp({
  id: 'relayapp',
  modules: [relay, watch, observer] as never,
}) as unknown as RelayApp;
const kit = await bootReactions({ app, watched: true });
afterAll(() => kit.stop());

describe('the events of a process stream (S-124, S-136)', () => {
  test('are in the log, and no reaction is given them, an on-all one included', async () => {
    expect((await kit.send('acme', { channel: 'obs', contact: 'ada@example.com' })).ok).toBe(true);
    expect((await kit.send('acme', { channel: 'obs', owner: relayOwner })).ok).toBe(true);
    await kit.settle();
    const logged = await tenantEventsOf(kit, 'acme');
    expect(logged.filter((event) => event.type === 'relay.tally.noted')).toHaveLength(2);
    const seen = await kit.rows('acme', 'observer.seenEvent');
    const types = seen.map((row) => String(row.type));
    // The observer got the entity events, once for each signal ...
    expect(types.filter((type) => type === 'relay.signal.created')).toHaveLength(2);
    expect(types).toContain('relay.echo.created');
    // ... and no event of the process's own stream.
    expect(types).not.toContain('relay.tally.noted');
    expect(seen.map((row) => String(row.stream))).not.toContain('relay.tally');
    // Nor was a job made for them: a job for a process event would name the stream type of the process.
    const streamTypes = (kit.spy?.enqueued ?? []).map(({ job }) =>
      'input' in job.run ? (job.run.input as { streamType?: string }).streamType : undefined,
    );
    expect(streamTypes).toContain('relay.signal');
    expect(streamTypes).not.toContain('relay.tally');
  });
});
