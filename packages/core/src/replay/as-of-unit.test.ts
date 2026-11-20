import { describe, expect, test } from 'vitest';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { Unit } from '../storage/unit.ts';
import type { AsOfContext } from './as-of-context.ts';
import { asOfUnit } from './as-of-unit.ts';

const receipts = { ref: 'core.commandReceipt' } as unknown as EntityDescriptor;

function view(): Unit {
  const unit = { scope: { level: 'tenant' }, rows: {}, events: {} } as unknown as Unit;
  const context = {
    registry: { entities: new Map([[receipts.ref, { ref: receipts.ref, descriptor: receipts }]]) },
    behaviours: {},
    reads: { take: () => ({ at: 5n }), ceiling: () => 5n },
    feedHorizon: undefined,
  } as unknown as AsOfContext;
  return asOfUnit(unit, context);
}

describe('a read of an entity whose change records retention purges', () => {
  test('a positioned find of core.commandReceipt cannot be re-decided', async () => {
    await expect(view().rows.find(receipts, { positioned: true })).rejects.toMatchObject({
      kind: 'unsupported',
      message: 'a decision that read core.commandReceipt cannot be re-decided',
      details: { replay: 'unsupported' },
    });
  });

  test('so is every other read of it', async () => {
    const unit = view();
    await expect(unit.rows.findOne(receipts, {})).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(unit.rows.count(receipts)).rejects.toMatchObject({ kind: 'unsupported' });
  });
});
