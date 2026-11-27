import type { bootWorld } from './erasure-move-orders-world.ts';

/**
 * What the control ledger holds after `from`: the keys with a tombstone, the keys with one that
 * names ada's erasure, how many copies of each erasure record, and the position read up to.
 */
export async function readLedger(
  runtime: Awaited<ReturnType<typeof bootWorld>>['runtime'],
  from: bigint,
  subjects: { readonly ada: string; readonly bea: string },
) {
  const [ada, bea] = [subjects.ada.toLowerCase(), subjects.bea.toLowerCase()];
  const entries = await runtime.control.adapter.unit(
    runtime.control.namespace,
    { level: 'deployment' },
    (unit) => unit.ledger?.since(from, 100_000) ?? Promise.resolve([]),
    { readOnly: true },
  );
  let command: string | undefined;
  let cursor = from;
  for (const { seq, record } of entries) {
    cursor = seq;
    if (record.type === 'erasure' && record.subjectId.toLowerCase() === ada) {
      command = record.commandId;
    }
  }
  const tombstoned = new Set<string>();
  const ownTombstoned = new Set<string>();
  let copies = 0;
  let copiesBea = 0;
  for (const { record } of entries) {
    if (record.type === 'keyTombstone') {
      tombstoned.add(record.keyId);
      if (record.commandId !== undefined && record.commandId === command) {
        ownTombstoned.add(record.keyId);
      }
    }
    if (record.type === 'erasure') {
      if (record.subjectId.toLowerCase() === ada) copies += 1;
      else if (record.subjectId.toLowerCase() === bea) copiesBea += 1;
    }
  }
  return { cursor, tombstoned, ownTombstoned, copies, copiesBea };
}
