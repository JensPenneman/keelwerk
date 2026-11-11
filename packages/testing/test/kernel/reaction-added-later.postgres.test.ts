import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { bootReactions, relayOwner } from './support/reactions-kit.ts';
import { relayWithReactions } from './support/relay-variants.ts';

const stops: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.map((stop) => stop()));
});

describe('a reaction added in a later deploy', () => {
  test('gets jobs for the events after the dispatcher checkpoint, among them a backlog written while the dispatcher was down, and for no earlier event', {
    timeout: 180_000,
  }, async () => {
    const database = await createTestDatabase('reaction_added_later');
    const external = {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    };

    // Deploy 1: the relay app without the reaction `latest`; one signal, settled, stopped.
    const first = await bootReactions({ external, app: relayWithReactions(['echo']) });
    stops.push(() => first.stop());
    const join = {
      backendId: first.runtime.backendId,
      tenants: { acme: first.runtime.tenants.acme.id, globex: first.runtime.tenants.globex.id },
    };
    const early = await first.send('acme', { channel: 'early' });
    if (!early.ok) throw early.error;
    await first.settle();
    await first.stop();

    // While no dispatcher runs: a process of the app without any asynchronous reaction writes a signal.
    const quiet = await startTestRuntime(relayWithReactions([], true), {
      tenants: ['acme', 'globex'],
      external,
      join,
    });
    stops.push(() => quiet.stop());
    const written = await quiet.invoker.invoke<unknown, { signalId: string }>({
      action: 'relay.send',
      input: { channel: 'backlog', text: 'hello', owner: relayOwner },
      carrier: testCarrier(quiet.tenants.acme, testPrincipal(relayOwner)),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    if (!written.ok) throw written.error;
    await quiet.stop();

    // Deploy 2: the app adds the reaction `latest`; one more signal.
    const second = await bootReactions({
      external,
      join,
      app: relayWithReactions(['echo', 'latest']),
    });
    stops.push(() => second.stop());
    const late = await second.send('acme', { channel: 'late' });
    if (!late.ok) throw late.error;
    await second.settle();

    const rows = (await second.rows('acme', 'relay.echo')).map(
      (row) => `${row.reaction}:${row.signal}`,
    );
    const signal = (id: string, reaction: string) => `${reaction}:${id}`;
    // The old reaction answers each signal once: the first signal is not dispatched again.
    expect(rows.filter((row) => row === signal(early.value.signalId, 'relay.echo'))).toHaveLength(
      1,
    );
    expect(rows.filter((row) => row === signal(written.value.signalId, 'relay.echo'))).toHaveLength(
      1,
    );
    expect(rows.filter((row) => row === signal(late.value.signalId, 'relay.echo'))).toHaveLength(1);
    // The new reaction has no job for the early signal and one for each event after the checkpoint.
    expect(rows).not.toContain(signal(early.value.signalId, 'relay.latest'));
    expect(rows).toContain(signal(written.value.signalId, 'relay.latest'));
    expect(rows).toContain(signal(late.value.signalId, 'relay.latest'));
    expect(new Set(rows).size).toBe(rows.length);
  });
});
