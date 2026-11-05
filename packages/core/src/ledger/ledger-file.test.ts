import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { LedgerRecord } from '../kernel/ledger-record.ts';
import { encodeLedgerRecord } from './encode-ledger-record.ts';
import { ledgerFile } from './ledger-file.ts';
import { parseLedgerLine } from './parse-ledger-line.ts';

const anchor = (position: number): LedgerRecord => ({
  type: 'anchor',
  scopeId: '0192f3a0-0000-7000-8000-000000000001',
  position: String(position),
  hash: 'ab'.repeat(32),
  stream: { type: 'library.book', id: '0192f3a0-0000-7000-8000-0000000000b1' },
  recordedAt: '2026-11-05T10:00:00Z',
  writer: { process: '0192f3a0-0000-7000-8000-0000000000c1', build: 'cd'.repeat(32) },
});

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fileIn(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kw-ledger-'));
  directories.push(directory);
  return join(directory, 'ledger.log');
}

async function recordsOf(path: string): Promise<LedgerRecord[]> {
  const found: LedgerRecord[] = [];
  for await (const record of ledgerFile({ path }).read()) found.push(record);
  return found;
}

describe('the ledger record format (F-12, S-34)', () => {
  test('golden: an anchor is one line of RFC 8785 canonical JSON', () => {
    expect(encodeLedgerRecord(anchor(7))).toBe(
      '{"hash":"abababababababababababababababababababababababababababababababab","position":"7","recordedAt":"2026-11-05T10:00:00Z","scopeId":"0192f3a0-0000-7000-8000-000000000001","stream":{"id":"0192f3a0-0000-7000-8000-0000000000b1","type":"library.book"},"type":"anchor","writer":{"build":"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd","process":"0192f3a0-0000-7000-8000-0000000000c1"}}',
    );
  });

  test('a line parses back to the record; unknown types and unusable lines are skipped', () => {
    expect(parseLedgerLine(encodeLedgerRecord(anchor(7)))).toEqual(anchor(7));
    expect(parseLedgerLine('{"type":"erasure","scopeId":"x"}')).toBeUndefined();
    expect(parseLedgerLine('{"type":"anchor","scopeId":"x"}')).toBeUndefined();
    expect(parseLedgerLine('{"type":"anchor","scopeId":"x","position":"-1"}')).toBeUndefined();
    expect(parseLedgerLine('{"type":"anch')).toBeUndefined();
    expect(parseLedgerLine('[1]')).toBeUndefined();
  });
});

describe('the file sink', () => {
  test('a file that does not exist holds no records', async () => {
    expect(await recordsOf(await fileIn())).toEqual([]);
  });

  test('appends batches in order, one line per record, and never rewrites', async () => {
    const path = await fileIn();
    const sink = ledgerFile({ path });
    await sink.append([anchor(1), anchor(2)]);
    await sink.append([]);
    await sink.append([anchor(3)]);
    expect(
      (await recordsOf(path)).map((record) => (record.type === 'anchor' ? record.position : '')),
    ).toEqual(['1', '2', '3']);
    const text = await readFile(path, 'utf8');
    expect(text.split('\n')).toHaveLength(4);
    expect(text.endsWith('\n')).toBe(true);
    expect(
      text.startsWith(`${encodeLedgerRecord(anchor(1))}\n${encodeLedgerRecord(anchor(2))}\n`),
    ).toBe(true);
  });

  test('concurrent appends of one sink do not interleave', async () => {
    const path = await fileIn();
    const sink = ledgerFile({ path });
    await Promise.all([1, 2, 3, 4, 5].map((n) => sink.append([anchor(n), anchor(n + 10)])));
    const positions = (await recordsOf(path)).map((record) =>
      record.type === 'anchor' ? Number(record.position) : 0,
    );
    expect(positions).toEqual([1, 11, 2, 12, 3, 13, 4, 14, 5, 15]);
  });

  test('records of a type this release does not know are skipped', async () => {
    const path = await fileIn();
    await writeFile(path, `{"type":"erasure","scopeId":"x"}\n${encodeLedgerRecord(anchor(1))}\n`);
    expect(await recordsOf(path)).toEqual([anchor(1)]);
  });

  test('a torn last line is skipped and the next batch starts on a line of its own', async () => {
    const path = await fileIn();
    const sink = ledgerFile({ path });
    await sink.append([anchor(1)]);
    await appendFile(path, '{"type":"anchor","scopeId":"0192');
    expect(await recordsOf(path)).toEqual([anchor(1)]);
    await sink.append([anchor(2)]);
    expect(await recordsOf(path)).toEqual([anchor(1), anchor(2)]);
  });

  test('a missing directory is an error, not a silent no-op', async () => {
    const path = join(await fileIn(), 'nowhere', 'ledger.log');
    await expect(ledgerFile({ path }).append([anchor(1)])).rejects.toThrow();
  });

  test('counts the appends it refused', async () => {
    const path = join(await fileIn(), 'nowhere', 'ledger.log');
    const sink = ledgerFile({ path });
    expect(sink.refusedAppends?.()).toBe(0);
    await sink.append([anchor(1)]).catch(() => undefined);
    await sink.append([anchor(2)]).catch(() => undefined);
    expect(sink.refusedAppends?.()).toBe(2);
  });
});
