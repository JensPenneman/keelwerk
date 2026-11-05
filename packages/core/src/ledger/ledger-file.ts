import { open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import { encodeLedgerRecord } from './encode-ledger-record.ts';
import { readLedger } from './read-ledger.ts';

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** Where the file sink writes. */
export interface LedgerFileOptions {
  /** The file, on a volume the placement's backups do not reach (section 14.7.6). Its directory must exist. */
  readonly path: string;
}

/**
 * The file sink of the ledger (sections 14.7.6 and 15.1.8): JSON lines, one canonical record per
 * line, only appended, synced to disk once per batch. A batch is written with one write and
 * resolves after the sync; a file that ends without a line feed (a torn write) gets one first so
 * the new records start on a line of their own. Appends of one sink run in order.
 */
export function ledgerFile(options: LedgerFileOptions): LedgerSink {
  const { path } = options;
  let queue: Promise<unknown> = Promise.resolve();
  let refused = 0;
  const write = async (lines: string): Promise<void> => {
    const existed = await stat(path).then(
      () => true,
      () => false,
    );
    const handle = await open(path, 'a+');
    try {
      const { size } = await handle.stat();
      let prefix = '';
      if (size > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, size - 1);
        if (last[0] !== 0x0a) prefix = '\n';
      }
      await handle.appendFile(prefix + lines, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!existed) await syncDirectory(path);
  };
  return {
    id: `file:${path}`,
    append: (records) => {
      if (records.length === 0) return Promise.resolve();
      const lines = records.map((record) => `${encodeLedgerRecord(record)}\n`).join('');
      const done = queue.then(() => write(lines));
      queue = done.catch(() => undefined);
      return done.catch((error: unknown) => {
        refused += 1;
        throw error;
      });
    },
    refusedAppends: () => refused,
    read: () => readLedger(path),
  };
}
