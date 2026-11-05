import type { DataAdapter, LedgerRecord, LedgerSink, ScopeTarget } from '@keelwerk/core';
import { runDirect } from './command-kit.ts';
import { namespace, tenant } from './run-read-kit.ts';

export const tenantId = tenant.level === 'tenant' ? tenant.tenantId : '';
export const writer = { process: 'process-1', build: 'build-1' };

export function arraySink(): LedgerSink & { readonly records: LedgerRecord[] } {
  const records: LedgerRecord[] = [];
  return {
    id: 'array',
    records,
    append: async (batch) => {
      records.push(...batch);
    },
    read: async function* () {
      yield* records;
    },
  };
}

export function targetsOf(adapter: DataAdapter) {
  return async (ids: ReadonlySet<string>): Promise<ReadonlyMap<string, ScopeTarget>> =>
    new Map(
      ids.has(tenantId) ? [[tenantId, { scope: tenant, namespace, handle: { adapter } }]] : [],
    );
}

/** Makes the books of one test: each call adds `count` books with ISBNs no earlier call of this factory used. */
export function bookShelf() {
  let isbns = 0;
  return async (adapter: DataAdapter, count: number): Promise<readonly string[]> => {
    const ids: string[] = [];
    for (let n = 0; n < count; n += 1) {
      isbns += 1;
      const result = await runDirect({
        adapter,
        action: 'library.addBook',
        input: { title: `Book ${isbns}`, isbn: `isbn-anchors-${isbns}` },
      });
      ids.push((result.output as { bookId: string }).bookId);
    }
    return ids;
  };
}

export function steppedClock(start: Temporal.Instant) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now = now.add({ milliseconds: ms });
    },
  };
}

export const anchorsOf = (sink: { readonly records: LedgerRecord[] }) =>
  sink.records.flatMap((record) =>
    record.type === 'anchor' ? [`${record.position}@${record.recordedAt}`] : [],
  );
