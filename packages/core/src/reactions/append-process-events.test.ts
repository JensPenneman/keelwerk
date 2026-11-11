import { describe, expect, test, vi } from 'vitest';
import { reactionOf, reactionRegistry, reactionTenantScope } from '../../test/reaction-kit.ts';
import { hybridClock } from '../clock/hybrid-clock.ts';
import { personalSealerKey } from '../encryption/personal-sealer-key.ts';
import { sealProcessEvent } from '../encryption/seal-process-event.ts';
import type { SealingContext } from '../encryption/sealing-context.ts';
import { chainHash } from '../events/chain-hash.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { NewEvent } from '../events/new-event.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { Unit } from '../storage/unit.ts';
import { appendProcessEvents } from './append-process-events.ts';
import type { FoldedProcess } from './fold-process-state.ts';
import { processStreamRef } from './process-stream-ref.ts';

let sequence = 0;
vi.mock('../ids/new-uuid-v7.ts', () => ({
  newUuidV7: () => `0197a1c2-7b3e-7c11-9a55-${String(++sequence).padStart(12, '0')}`,
}));

const tally = reactionOf(reactionRegistry(), 'tally');
const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';
const stream = processStreamRef(reactionTenantScope, 'logs.tally', subject);
const dataKey: DataKey = { id: 'dk-1', material: new Uint8Array(32).fill(7) };
const now = Temporal.Instant.from('2026-03-01T08:00:00Z');
const meta: EventMeta = {
  actor: { kind: 'service', id: 'logs.system', via: 'core.module' },
  commandId: 'logs.tally:e1',
  action: 'logs.tally',
  causationId: 'e1',
  correlationId: 'corr-1',
  client: null,
  merge: null,
  traceparent: null,
  writer: { build: 'b', revision: 1 },
  flags: [],
  decision: null,
};
const draft = (type: string, values: Record<string, unknown>): EventDraft => ({
  kind: 'event',
  type,
  target: 'logs.tally',
  entity: 'logs.tally',
  id: stream.id,
  values,
});
const fresh: FoldedProcess = {
  stream,
  subject,
  state: { count: 0 },
  version: 0,
  lastHash: null,
};

const context = {
  unit: { namespace: { id: 'ns-1' }, keys: { addRefs: () => Promise.resolve() } },
  random: (bytes: number) => new Uint8Array(bytes).fill(1),
  dataKey: () => Promise.resolve(dataKey),
} as unknown as SealingContext;

/** A unit that records the batches appended and seals like the runtime's sealing unit. */
function recordingUnit(version = 0) {
  const batches: {
    expectedVersion: number;
    tenancy?: 'tenant';
    events: readonly NewEvent[];
  }[] = [];
  const unit = {
    scope: reactionTenantScope,
    events: {
      append: (
        batch: readonly {
          expectedVersion: number;
          tenancy?: 'tenant';
          events: readonly NewEvent[];
        }[],
      ) => {
        for (const one of batch) {
          if (one.expectedVersion !== version) {
            return Promise.reject(
              Object.assign(new Error('moved'), {
                kind: 'conflict',
                code: 'core.version_mismatch',
              }),
            );
          }
          batches.push(one);
        }
        return Promise.resolve([]);
      },
    },
  } as unknown as Unit;
  Object.defineProperty(unit, personalSealerKey, {
    value: { sealProcessEvent: (input: never) => sealProcessEvent(context, input) },
  });
  return { unit, batches };
}

const run = (unit: Unit, drafts: readonly EventDraft[], folded = fresh) =>
  appendProcessEvents({
    unit,
    reaction: tally,
    folded,
    drafts,
    meta,
    hybridClock: hybridClock('n'),
    now,
  });

describe('appending the events of a process', () => {
  test('golden: sealed envelope of a personal member, version, hlc and the hash chain', async () => {
    sequence = 0;
    const { unit, batches } = recordingUnit();
    const ids = await run(unit, [
      draft('noted', { note: 'ada@example.com', n: 1 }),
      draft('noted', { note: 'second', n: 2 }),
    ]);
    const [batch] = batches;
    expect(batch?.expectedVersion).toBe(0);
    // The kernel names the tenancy; the unit has no `rows`, so a descriptor lookup would throw.
    expect(batch?.tenancy).toBe('tenant');
    const [first, second] = batch?.events ?? [];
    expect(ids).toEqual([first?.eventId, second?.eventId]);
    expect(JSON.stringify(batch?.events)).not.toContain('example.com');
    expect((first?.hlc ?? '') < (second?.hlc ?? '')).toBe(true);
    // The final stored format, pinned: event ids and the clock are fixed, so the sealed envelope
    // (`$kwe`, key id, nonce `n`, ciphertext `c`), the shape, the hybrid clock and the hash chain are
    // the same bytes on every run. A change here changes what every stored process stream holds.
    const stored = {
      name: 'noted',
      schemaVersion: 1,
      // The hash of { process: 'logs.tally', tracks: {} } (processShapeId).
      shape: 'd83d140b629172f2d1f7350cfef18035021b941d651fd66a456de129d4ead771',
      before: null,
      transient: false,
      meta,
      recordedAt: now,
    };
    expect(batch?.events).toEqual([
      {
        ...stored,
        eventId: '0197a1c2-7b3e-7c11-9a55-000000000001',
        data: {
          note: {
            $kwe: 1,
            k: 'dk-1',
            n: 'AQEBAQEBAQEBAQEB',
            c: 'VIDt1tDalG-8pLBEXlQfXIrP_od7tV3SDUi7tFsdbVcK',
          },
          n: 1,
        },
        hlc: '019ca86950000000-n',
        prevHash: null,
        hash: '7f7c90b0b4a2b0e67f2aac9cd11d3747e0598a924be2a95c46b40323229d124c',
      },
      {
        ...stored,
        eventId: '0197a1c2-7b3e-7c11-9a55-000000000002',
        data: {
          note: {
            $kwe: 1,
            k: 'dk-1',
            n: 'AQEBAQEBAQEBAQEB',
            c: 'VJLs1P_RiCxEBdcEKzzjyRY8nKkhq72E',
          },
          n: 2,
        },
        hlc: '019ca86950000001-n',
        prevHash: '7f7c90b0b4a2b0e67f2aac9cd11d3747e0598a924be2a95c46b40323229d124c',
        hash: '459cc9b4b9bc38b88302eb386527b1941e44886424e57ede053224a792b56306',
      },
    ]);
    // The hash covers the stored (sealed) payload: recomputed from the record it is the same.
    for (const [index, event] of [first, second].entries()) {
      expect(event?.hash).toBe(
        chainHash(event?.prevHash ?? null, {
          eventId: event?.eventId ?? '',
          streamId: stream.id,
          version: index + 1,
          name: 'noted',
          schemaVersion: 1,
          data: event?.data,
          before: null,
          hlc: event?.hlc ?? '',
          recordedAt: now,
          actor: meta.actor,
          writer: meta.writer,
          flags: [],
          decision: null,
          commandId: meta.commandId,
          client: null,
        }),
      );
    }
  });

  test('the first event of a folded stream chains onto its last hash', async () => {
    const { unit, batches } = recordingUnit(2);
    await run(unit, [draft('noted', { note: 'x', n: 1 })], {
      ...fresh,
      version: 2,
      lastHash: 'a'.repeat(64),
    });
    expect(batches[0]?.events[0]?.prevHash).toBe('a'.repeat(64));
  });

  test('an undeclared name and a payload its shape refuses are validation errors', async () => {
    const { unit } = recordingUnit();
    await expect(run(unit, [draft('missing', {})])).rejects.toMatchObject({ kind: 'validation' });
    await expect(run(unit, [draft('noted', { note: 'x', n: 'one' })])).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  test('a stream that moved since it was folded is a conflict', async () => {
    const { unit } = recordingUnit(3);
    await expect(run(unit, [draft('noted', { note: 'x', n: 1 })])).rejects.toMatchObject({
      code: 'core.version_mismatch',
    });
  });

  test('no draft appends nothing', async () => {
    const { unit, batches } = recordingUnit();
    expect(await run(unit, [])).toEqual([]);
    expect(batches).toEqual([]);
  });
});
