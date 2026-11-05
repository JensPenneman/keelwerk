import { open } from 'node:fs/promises';
import type { LedgerRecord } from '../kernel/ledger-record.ts';
import { parseLedgerLine } from './parse-ledger-line.ts';

/** Every record of the file at `path` that this release knows, in append order; a file that does not exist yet holds none. */
export async function* readLedger(path: string): AsyncGenerator<LedgerRecord, void, undefined> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') return;
    throw error;
  }
  try {
    for await (const line of handle.readLines({ encoding: 'utf8' })) {
      const record = parseLedgerLine(line);
      if (record !== undefined) yield record;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}
