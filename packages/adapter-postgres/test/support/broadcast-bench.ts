import { setTimeout as delay } from 'node:timers/promises';
import type { DataAdapter, Logger } from '@keelwerk/core';
import { keepIdleClients } from '@keelwerk/testing/postgres';
import { postgresAdapter } from '../../src/postgres-adapter.ts';
import type { FeedHarness } from './feed-harness.ts';
import { feedHarness } from './feed-harness.ts';
import { known } from './store-rows.ts';
import { testEnvironment } from './test-environment.ts';

/** How long a broadcast test waits for a payload. */
export const waitMs = 15_000;

/** What a broadcast test file works with. */
export interface BroadcastBench {
  readonly harness: FeedHarness;
  /** The warnings the adapters of the bench logged. */
  readonly warnings: string[];
  /** What `connect()` answered, per adapter. */
  readonly connected: Map<DataAdapter, { readonly broadcast?: boolean }>;
  /** An adapter named `applicationName` over the file's database, or over `url`; closed with the bench. */
  open(
    applicationName: string,
    accelerations?: { readonly notify: false },
    url?: string,
  ): Promise<DataAdapter>;
  close(): Promise<void>;
}

/** The file's database and the adapters opened over it. */
export async function broadcastBench(databaseName: string): Promise<BroadcastBench> {
  const harness = await feedHarness(databaseName);
  const opened: DataAdapter[] = [];
  const warnings: string[] = [];
  const connected = new Map<DataAdapter, { readonly broadcast?: boolean }>();
  const recorder: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings.push(message);
    },
    error: () => undefined,
    child: () => recorder,
  };
  return {
    harness,
    warnings,
    connected,
    open: async (applicationName, accelerations, url = harness.database.appUrl) => {
      const adapter = postgresAdapter({
        applicationName,
        entities: (ref) => known.get(ref),
        ...(accelerations === undefined ? {} : { accelerations }),
      }).create(
        { id: 'main', url, strategy: 'shared-tables', pool: { max: 2, ...keepIdleClients } },
        testEnvironment(undefined, recorder),
      );
      connected.set(adapter, await adapter.connect());
      opened.push(adapter);
      return adapter;
    },
    close: async () => {
      for (const adapter of opened.splice(0)) await adapter.close(5000);
      await harness.close();
    },
  };
}

export function broadcastOf(adapter: DataAdapter): NonNullable<DataAdapter['broadcast']> {
  if (adapter.broadcast === undefined) throw new Error('the adapter has no broadcast');
  return adapter.broadcast;
}

/** Publishes every 200 ms until the iterator answers, at most 15 s. */
export async function received(
  adapter: DataAdapter,
  channel: string,
  payload: Uint8Array,
  iterator: AsyncIterator<Uint8Array>,
): Promise<Uint8Array> {
  const next = iterator.next();
  // A subscription that is already lost rejects at once, before the race below reads it.
  next.catch(() => undefined);
  const deadline = Date.now() + waitMs;
  for (;;) {
    await broadcastOf(adapter).publish(channel, payload);
    const answer = await Promise.race([next, delay(200).then(() => undefined)]);
    if (answer !== undefined) {
      if (answer.done === true) throw new Error('the iterable ended');
      return answer.value;
    }
    if (Date.now() > deadline) throw new Error(`nothing received on ${channel}`);
  }
}
