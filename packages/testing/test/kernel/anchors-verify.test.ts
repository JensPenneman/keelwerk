import { connectRewindCheck, createAnchorWriter, verifyAnchors } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { arraySink, bookShelf, targetsOf, tenantId, writer } from './support/anchor-kit.ts';
import { clock as fixedClock, open, silent } from './support/run-read-kit.ts';

describe('verification against the anchors', () => {
  test('a chain with its anchors verifies; a forged hash, a missing position and a head behind the anchor are named', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    await addBooks(adapter, 2);
    const sink = arraySink();
    await createAnchorWriter({
      sinks: [sink],
      clock: fixedClock,
      writer,
      resolve: targetsOf(adapter),
      log: silent,
    }).onBatch([tenantId]);
    expect(await verifyAnchors([sink], targetsOf(adapter))).toEqual({
      checked: 1,
      unresolved: [],
      findings: [],
    });
    expect(await connectRewindCheck([sink], targetsOf(adapter))).toEqual([]);

    const [real] = sink.records;
    if (real?.type !== 'anchor') throw new Error('no anchor was written');
    const forged = arraySink();
    forged.records.push({ ...real, hash: 'f'.repeat(64) }, { ...real, position: '9' });
    const verdict = await verifyAnchors([forged], targetsOf(adapter));
    expect(verdict.findings).toEqual([
      expect.objectContaining({ kind: 'mismatch', scopeId: tenantId, position: real.position }),
      expect.objectContaining({ kind: 'missing', scopeId: tenantId, position: '9' }),
      expect.objectContaining({ kind: 'behind', scopeId: tenantId, newest: '9' }),
    ]);
    expect(await connectRewindCheck([forged], targetsOf(adapter))).toEqual([tenantId]);
    expect((await verifyAnchors([sink], async () => new Map())).unresolved).toEqual([tenantId]);
  });
});
