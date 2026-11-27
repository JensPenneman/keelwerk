import type { Registry, StreamRef, Unit } from '@keelwerk/core';
import { ownedRow } from '@keelwerk/core';

/** A row that holds a value of the subject, and whether the erasure finds it as the subject's. */
export interface ReferencedRow {
  readonly stream: StreamRef;
  readonly nominated: boolean;
}

/**
 * A page of the references of the subject after `from`. A row is found as the subject's only when
 * its data subject is the subject at the moment the page is read; a row that holds a value of the
 * subject and is owned by another subject, or by nobody, is only a holder of that value.
 */
export async function referencedRows(
  unit: Unit,
  input: {
    readonly registry: Registry;
    readonly subjectId: string;
    readonly from: StreamRef | null;
    readonly limit: number;
  },
): Promise<readonly ReferencedRow[]> {
  const rows: ReferencedRow[] = [];
  for (const stream of await unit.keys.refs(input.subjectId, input.from, input.limit)) {
    const owned = await ownedRow(unit, input.registry, stream, input.subjectId);
    rows.push({ stream, nominated: owned !== undefined });
  }
  return rows;
}
