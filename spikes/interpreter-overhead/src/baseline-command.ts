import type { EventMeta, NewEvent, Receipt, StorageRow } from '@keelwerk/core';
import { hybridClock, newUuidV7 } from '@keelwerk/core';
import type { BenchInput } from './bench-input.ts';
import type { BenchWorld } from './bench-world.ts';
import { nextCommandId } from './next-command-id.ts';

const clock = hybridClock('sbaseline000');

const meta: EventMeta = {
  actor: { kind: 'user', id: 'ada', via: 'test' },
  commandId: null,
  action: 'bench.baseline',
  causationId: null,
  correlationId: 'req-1',
  client: null,
  merge: null,
  traceparent: null,
  writer: { build: 'spike', revision: 1 },
  flags: [],
  decision: null,
};

const eq = (id: string) => ({ op: 'eq', field: 'id', value: id }) as const;

/**
 * The same unit written imperatively against the adapter: claim the receipt, read each row with
 * its position, lock and read the row to write, update it, append its event, complete the receipt
 * and commit. No generator, no request, no answerer, no decision record, no hash chain. It also
 * skips what the interpreter's load does on top of the read: the visibility check, the authority
 * lookup and the decoding of the row, so the per-load overhead measured against it is an upper bound.
 */
export async function baselineCommand(world: BenchWorld, input: BenchInput): Promise<void> {
  const commandId = nextCommandId();
  const now = Temporal.Now.instant();
  const { descriptor } = world;
  await world.runtime.adapter.unit(world.namespace, world.scope, async (unit) => {
    const receipt: Receipt = {
      commandId,
      action: 'bench.baseline',
      fingerprint: commandId,
      principal: null,
      principalResolver: null,
      principalId: null,
      status: 'pending',
      outcome: null,
      apiVersion: '2026-11-04',
      request: { transport: 'test', remoteAddress: null, userAgent: null },
      clientId: null,
      clientSeq: null,
      expiresAt: now.add({ milliseconds: 86_400_000 }),
    };
    if ((await unit.receipts.claim(receipt)) !== 'inserted') throw new Error('receipt exists');
    const positions: bigint[] = [];
    for (let index = 0; index < input.requests; index += 1) {
      const id = input.ids[index];
      if (id === undefined) continue;
      const page = await unit.rows.find(descriptor, {
        where: eq(id),
        page: { first: 1 },
        positioned: true,
      });
      if (page.position !== undefined) positions.push(page.position);
    }
    const query = { where: eq(input.writeId), page: { first: 1 } } as const;
    const rows: readonly StorageRow[] =
      unit.rows.lock === undefined
        ? (await unit.rows.find(descriptor, { ...query, forUpdate: true })).rows
        : await unit.rows.lock(descriptor, query, { mode: 'update' });
    positions.push((await unit.events.head()) ?? 0n);
    const row = rows[0];
    if (row === undefined) throw new Error('the row to write is missing');
    const version = Number(row.version);
    const next: StorageRow = { ...row, hits: input.hits, version: version + 1, updatedAt: now };
    await unit.rows.update(descriptor, [
      { id: input.writeId, expectedVersion: version, values: next },
    ]);
    const event: NewEvent = {
      eventId: newUuidV7(),
      name: 'changed',
      schemaVersion: 1,
      shape: descriptor.shape.id,
      data: { set: { hits: input.hits } },
      before: { hits: row.hits },
      hlc: clock.tick(now.epochMilliseconds),
      recordedAt: now,
      meta,
      transient: false,
      prevHash: null,
      hash: null,
    };
    await unit.events.append([
      {
        stream: { type: 'bench.item', id: input.writeId },
        expectedVersion: version,
        partition: null,
        events: [event],
      },
    ]);
    await unit.receipts.complete(commandId, { ok: true, value: {}, effects: [] });
  });
}
